"""CDC Sink Worker — Kafka 토픽을 구독해 타깃에 적재한다 (Phase 4c).

기획안 §6.3. 배치 엔진(``engine.py``)이 아니라 ``scheduler.py`` 계열의 **상주 프로세스**다 —
``python -m eai_worker.cdc_sink`` 로 돌며 끝나지 않는다.

흐름:
    Debezium → Kafka 토픽 → (여기) 이벤트 파싱 → 타깃 write() → 오프셋 커밋

핵심 원칙 (배치의 "워터마크는 적재 뒤에" 와 같다):
- **오프셋은 write 성공 뒤에만 커밋한다.** 먼저 커밋하면 워커가 죽는 순간 그 구간이 유실된다.
  그래서 at-least-once 이고, upsert 타깃이면 사실상 effectively-once 다.
- 삭제 처리 방식(soft/hard/ignore)은 소스 노드 설정에서 온다 (2026-07-31 결정: 기본 soft).

이 단계의 경계(의도된 한계):
- **변환 노드는 아직 적용하지 않는다.** CDC 경로는 소스→타깃 원본 복제다 (변환은 이후 단계).
- **물리 삭제(hard)** 는 커넥터 write() 계약에 삭제가 없어 실제 타깃 반영이 안 된다 —
  라우팅·정책은 완성되어 있고, ``ConnectorSinkWriter.delete`` 가 명확히 거부한다.
"""

from __future__ import annotations

import contextlib
import logging
import signal
import time
import types
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC
from enum import StrEnum
from typing import Any, Protocol

from eai_api.schemas.dag import PipelineDefinition

logger = logging.getLogger(__name__)

#: 한 번의 poll 이 기다리는 시간(ms)과 마이크로배치 상한
POLL_TIMEOUT_MS = 1000
MAX_BATCH_RECORDS = 500
#: 활성 스트림 목록을 다시 스캔해 토픽 구독을 갱신하는 주기(초).
#: 이 덕분에 스트림을 새로 켜도 수동 재시작 없이 최대 이 시간 안에 자동 구독된다.
#: 프론트 카운트다운(Monitor)이 이 값과 같아야 한다.
ROUTER_REFRESH_SECONDS = 10


class SinkAction(StrEnum):
    UPSERT = "upsert"
    DELETE = "delete"
    SKIP = "skip"


@dataclass(slots=True)
class SinkRecord:
    """Kafka 에서 꺼낸 이벤트 하나. ``value`` 가 None 이면 tombstone(삭제 표식)."""

    topic: str
    value: dict[str, Any] | None
    key: dict[str, Any] | None = None
    partition: int = 0
    offset: int = 0


@dataclass(frozen=True, slots=True)
class TargetRoute:
    """한 소스 테이블의 이벤트가 흘러갈 타깃 하나 (테이블 + 컬럼 매핑)."""

    node_id: str
    connection_id: str
    #: 이 라우트가 받을 소스 테이블명(마지막 조각). None 이면 모든 소스 테이블을 받는다(레거시 단일 타깃).
    source_table: str | None
    #: 명시 타깃 테이블. 비면 소스 테이블명을 토픽에서 뽑아 그대로 쓴다 (1:1 복제)
    target_table: str | None
    key_columns: tuple[str, ...]
    #: 타깃 스키마(namespace). 지정 안 하면 커넥터 기본 스키마(public 등)에 쓴다.
    #: 배치 엔진은 WriteSpec.namespace 로 이걸 반영하는데, CDC 도 같아야 한다.
    namespace: str | None = None
    #: 컬럼 리네임/캐스팅/비활성화. (원본, 대상, cast|None, disabled) 튜플들.
    #: 비면 원본 그대로(항등). 지정 안 한 컬럼도 기본은 동일 이름 그대로 통과한다.
    column_map: tuple[tuple[str, str, str | None, bool], ...] = ()
    #: 지정 안 한 컬럼을 버릴지. False(기본)면 미지정 컬럼은 동일 이름으로 통과.
    drop_unmapped: bool = False


@dataclass(frozen=True, slots=True)
class TopicRoute:
    """한 토픽을 어떻게 처리할지 — 삭제 정책과 타깃 목록."""

    delete_mode: str
    routes: tuple[TargetRoute, ...]


@dataclass(slots=True)
class SinkStats:
    consumed: int = 0
    upserted: int = 0
    deleted: int = 0
    skipped: int = 0

    def add(self, other: SinkStats) -> None:
        self.consumed += other.consumed
        self.upserted += other.upserted
        self.deleted += other.deleted
        self.skipped += other.skipped


# ------------------------------------------------------------------ 순수 로직


def source_table_from_topic(topic: str) -> str:
    """``eai_<id>.<schema>.<table>`` 에서 테이블명(마지막 조각)을 뽑는다."""
    return topic.rsplit(".", 1)[-1]


def _is_deleted(value: dict[str, Any]) -> bool:
    return value.get("__deleted") is True or str(value.get("__deleted", "")).lower() == "true"


def normalize_row(value: dict[str, Any], delete_mode: str) -> dict[str, Any]:
    """Debezium 메타 필드(``__op``·``__ts_ms`` 등)를 걷어낸다.

    soft 모드에서만 ``__deleted`` 를 불리언으로 남겨 타깃이 삭제 이력을 갖게 한다.
    """
    out: dict[str, Any] = {}
    for k, v in value.items():
        if k.startswith("__"):
            if delete_mode == "soft" and k == "__deleted":
                out["__deleted"] = _is_deleted(value)
            continue
        out[k] = v
    return out


def parse_event(value: dict[str, Any] | None, delete_mode: str) -> tuple[SinkAction, dict[str, Any]]:
    """이벤트 하나를 (동작, 정규화된 행) 으로 해석한다. 삭제 정책이 동작을 가른다."""
    if value is None:  # tombstone
        return (SinkAction.DELETE, {}) if delete_mode == "hard" else (SinkAction.SKIP, {})

    if _is_deleted(value):
        if delete_mode == "soft":
            return SinkAction.UPSERT, normalize_row(value, "soft")
        if delete_mode == "hard":
            return SinkAction.DELETE, normalize_row(value, "hard")
        return SinkAction.SKIP, {}  # ignore

    return SinkAction.UPSERT, normalize_row(value, delete_mode)


class SinkWriter(Protocol):
    """타깃 적재 계약. 실제 구현은 커넥터를, 테스트는 대역을 쓴다."""

    def upsert(self, route: TargetRoute, table: str, rows: list[dict[str, Any]]) -> int: ...

    def delete(self, route: TargetRoute, table: str, keys: list[dict[str, Any]]) -> int: ...


def apply_column_map(row: dict[str, Any], route: TargetRoute) -> dict[str, Any]:
    """라우트의 컬럼 매핑을 한 행에 적용한다 (리네임/캐스팅/비활성화).

    규칙:
    - 지정 안 한 컬럼은 **동일 이름 그대로** 통과한다 (drop_unmapped=True 면 버린다).
    - disabled 컬럼은 결과에서 제외한다 (타깃에 안 넣음).
    - target 이 source 와 다르면 리네임한다. cast 가 있으면 값을 변환한다.
    삭제 표식 ``__deleted`` 는 매핑과 무관하게 반드시 보존한다 (soft 삭제가 타깃에 남도록).
    """
    if not route.column_map:
        return row
    from .nodes.transform import CASTS  # 지연 import — fork 안전, 가벼움

    out: dict[str, Any] = {} if route.drop_unmapped else dict(row)
    mapped_sources: set[str] = set()
    for src, tgt, cast, disabled in route.column_map:
        mapped_sources.add(src)
        if disabled:
            out.pop(src, None)
            continue
        if src not in row:
            continue
        val = row[src]
        if cast and cast in CASTS:
            with contextlib.suppress(TypeError, ValueError):
                val = CASTS[cast](val)
        if tgt != src:
            out.pop(src, None)
        out[tgt] = val
    # __deleted 는 soft 삭제 표식이라 기본 보존한다 —
    # 단 사용자가 이미 매핑/제외(리네임 __deleted→X 등)했으면 그 의도를 존중하고 다시 넣지 않는다.
    if "__deleted" in row and "__deleted" not in out and "__deleted" not in mapped_sources:
        out["__deleted"] = row["__deleted"]
    return out


def process_records(
    records: list[SinkRecord],
    router: dict[str, TopicRoute],
    writer: SinkWriter,
) -> SinkStats:
    """레코드 묶음을 타깃별로 모아 적재한다.

    같은 (타깃노드, 스키마, 테이블) 로 가는 이벤트를 마이크로배치로 합친 뒤 한 번에 write 한다 —
    건당 적재는 타깃을 죽인다. 이 함수가 던지면 호출자는 오프셋을 커밋하지 않는다.
    """
    stats = SinkStats()
    upserts: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    deletes: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    #: (node_id, namespace, table) → route. 그룹 키로 route 객체를 되찾는다.
    route_by_key: dict[tuple[str, str, str], TargetRoute] = {}

    for rec in records:
        topic_route = router.get(rec.topic)
        if topic_route is None:
            logger.debug("라우팅 없는 토픽 무시: %s", rec.topic)
            continue
        stats.consumed += 1
        action, row = parse_event(rec.value, topic_route.delete_mode)
        if action is SinkAction.SKIP:
            stats.skipped += 1
            continue

        for route in topic_route.routes:
            table = route.target_table or source_table_from_topic(rec.topic)
            key = (route.node_id, route.namespace or "", table)
            route_by_key[key] = route
            mapped = apply_column_map(row, route)
            if action is SinkAction.UPSERT:
                upserts[key].append(mapped)
            else:  # DELETE
                pk = rec.key or {c: mapped.get(c) for c in route.key_columns}
                deletes[key].append(pk)

    for key, rows in upserts.items():
        stats.upserted += writer.upsert(route_by_key[key], key[2], rows)
    for key, keys in deletes.items():
        stats.deleted += writer.delete(route_by_key[key], key[2], keys)
    return stats


def _table_name(qualified: str) -> str:
    """``schema.table`` / ``db.table`` 에서 테이블명(마지막 조각)만 뽑는다."""
    return qualified.rsplit(".", 1)[-1]


def _build_column_map(columns: Any) -> tuple[tuple[str, str, str | None, bool], ...]:
    """컬럼 매핑 설정(list of {source, target?, cast?, disabled?})을 라우트 튜플로.

    disabled 항목은 target 이 없어도 된다(제외만 하므로). 잘못된 cast 는 무시한다
    — 검증에서 걸러지지만, sink 가 여기서도 죽지 않게 방어한다.
    """
    from .nodes.transform import CASTS

    out: list[tuple[str, str, str | None, bool]] = []
    for c in columns or []:
        if not isinstance(c, dict) or not c.get("source"):
            continue
        disabled = bool(c.get("disabled"))
        target = str(c.get("target") or c["source"])
        cast = str(c["cast"]) if c.get("cast") in CASTS else None
        out.append((str(c["source"]), target, cast, disabled))
    return tuple(out)


def resolve_target_routes(definition: PipelineDefinition) -> list[TargetRoute]:
    """DAG 의 타깃 노드들을 라우트로 만든다.

    타깃에 ``table_mappings`` 가 있으면 **소스 테이블마다** 라우트를 하나씩 만든다
    (테이블별 타깃·컬럼 리네임·키). 없으면 레거시 단일 타깃(모든 소스 → 하나).
    """
    routes: list[TargetRoute] = []
    for node in definition.nodes:
        if not node.is_target:
            continue
        connection_id = str(node.params.get("connection_id") or "")
        if not connection_id:
            continue

        mappings = node.params.get("table_mappings")
        if isinstance(mappings, list) and mappings:
            node_ns = str(node.params["namespace"]) if node.params.get("namespace") else None
            for m in mappings:
                if not isinstance(m, dict) or not m.get("source_table"):
                    continue
                routes.append(
                    TargetRoute(
                        node_id=node.id,
                        connection_id=connection_id,
                        source_table=_table_name(str(m["source_table"])),
                        target_table=(str(m["target_table"]) if m.get("target_table") else None),
                        key_columns=tuple(str(c) for c in (m.get("key_columns") or [])),
                        namespace=(str(m["target_namespace"]) if m.get("target_namespace") else node_ns),
                        column_map=_build_column_map(m.get("columns")),
                        drop_unmapped=bool(m.get("drop_unmapped", False)),
                    )
                )
        else:
            # 단일 타깃 — 컬럼 매핑은 노드의 column_map(팝업에서 저장)을 쓴다. 없으면 항등(동일 이름).
            routes.append(
                TargetRoute(
                    node_id=node.id,
                    connection_id=connection_id,
                    source_table=None,  # 모든 소스 테이블을 이 하나로
                    target_table=(str(node.params["table"]) if node.params.get("table") else None),
                    key_columns=tuple(str(c) for c in (node.params.get("key_columns") or [])),
                    namespace=(str(node.params["namespace"]) if node.params.get("namespace") else None),
                    column_map=_build_column_map(node.params.get("column_map")),
                    drop_unmapped=bool(node.params.get("drop_unmapped", False)),
                )
            )
    return routes


# ------------------------------------------------------------ Kafka 소비 루프


class SinkConsumer(Protocol):
    """Kafka 컨슈머 계약. 테스트는 인메모리 대역을 주입한다."""

    def poll(self, timeout_ms: int, max_records: int) -> list[SinkRecord]: ...

    def commit(self) -> None: ...

    def resubscribe(self, topics: list[str]) -> None: ...

    def close(self) -> None: ...


def run_once(
    consumer: SinkConsumer,
    router: dict[str, TopicRoute],
    writer: SinkWriter,
    topic_to_stream: dict[str, str] | None = None,
) -> SinkStats:
    """poll → 적재 → 커밋 을 한 번 돈다.

    **커밋은 write 가 전부 성공한 뒤에만** 한다 (at-least-once). ``process_records`` 가
    던지면 커밋을 건너뛰어 다음 회차에 같은 오프셋을 다시 받는다.

    ``topic_to_stream`` 을 주면 커밋 뒤 스트림별 지표를 되기록한다 (Monitor 표시용).
    """
    records = consumer.poll(POLL_TIMEOUT_MS, MAX_BATCH_RECORDS)
    if not records:
        return SinkStats()
    stats = process_records(records, router, writer)
    consumer.commit()
    if topic_to_stream:
        counts, last_ts = _aggregate_by_stream(records, topic_to_stream)
        _report_metrics(counts, last_ts)
    return stats


# ------------------------------------------------------------ 런타임 구현 (지연 로딩)


class ConnectorSinkWriter:
    """커넥터로 실제 적재하는 writer. import 를 무겁게 하지 않도록 안에서만 로딩한다."""

    def upsert(self, route: TargetRoute, table: str, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        from eai_api.db import session_scope
        from eai_api.services import connection_service
        from eai_connectors import RecordBatch, WriteMode, WriteSpec

        with session_scope() as session:
            conn = connection_service.get_connection(session, route.connection_id)
            spec = WriteSpec(table=table, namespace=route.namespace, key_columns=route.key_columns)
            connector = connection_service.open_connector(session, conn, write_spec=spec)
            try:
                mode = WriteMode.UPSERT if route.key_columns else WriteMode.APPEND
                result = connector.write(RecordBatch(rows=rows, columns=list(rows[0].keys())), mode)
            finally:
                connector.close()
        return result.records_written

    def delete(self, route: TargetRoute, table: str, keys: list[dict[str, Any]]) -> int:
        from eai_connectors.errors import UnsupportedOperation

        # 커넥터 write() 계약에는 삭제가 없다 — 물리 삭제는 아직 지원하지 않는다 (기획안 §9).
        raise UnsupportedOperation(
            "물리 삭제(hard)는 아직 타깃에 반영할 수 없습니다 — soft(기본) 또는 ignore 를 쓰세요",
            connector="cdc-sink",
        )


def _load_router() -> tuple[dict[str, TopicRoute], dict[str, str]]:
    """활성 스트림들을 읽어 (topic→처리방식, topic→stream_id) 두 맵을 만든다.

    소스 노드의 삭제 정책과 타깃 라우트를 스트림의 토픽마다 붙인다.
    topic→stream_id 는 배치마다 어느 스트림에 지표를 되기록할지 알아내는 데 쓴다.
    """
    from eai_api.db import session_scope
    from eai_api.services import cdc_service, pipeline_service

    router: dict[str, TopicRoute] = {}
    topic_to_stream: dict[str, str] = {}
    with session_scope() as session:
        for stream in cdc_service.list_active_streams(session):
            try:
                pipeline = pipeline_service.get_pipeline(session, stream.pipeline_id)
                definition = PipelineDefinition.model_validate(pipeline.definition or {})
                spec = cdc_service.extract_cdc_source(definition)
                routes = tuple(resolve_target_routes(definition))
            except Exception:
                logger.exception("스트림 %s 라우팅 구성 실패 — 건너뜁니다", stream.id)
                continue
            for topic in stream.topics or []:
                tname = source_table_from_topic(topic)
                # 이 소스 테이블을 받는 라우트만 붙인다 (source_table=None 은 모든 테이블).
                matched = tuple(r for r in routes if r.source_table in (None, tname))
                router[topic] = TopicRoute(delete_mode=spec.delete_mode, routes=matched)
                topic_to_stream[topic] = stream.id
    return router, topic_to_stream


def _aggregate_by_stream(
    records: list[SinkRecord], topic_to_stream: dict[str, str]
) -> tuple[dict[str, int], dict[str, int]]:
    """배치를 스트림별 (건수, 마지막 소스 변경시각 ts_ms) 로 접는다 — 지표용."""
    counts: dict[str, int] = defaultdict(int)
    last_ts: dict[str, int] = {}
    for rec in records:
        sid = topic_to_stream.get(rec.topic)
        if not sid:
            continue
        counts[sid] += 1
        ts = rec.value.get("__ts_ms") if isinstance(rec.value, dict) else None
        if isinstance(ts, int):
            last_ts[sid] = ts
    return dict(counts), last_ts


def _report_metrics(counts: dict[str, int], last_ts: dict[str, int]) -> None:
    """스트림별 지표를 cdc_streams 에 되기록한다 (Monitor 표시용).

    **베스트에포트다** — 지표 갱신이 실패해도 데이터 적재 경로를 절대 막지 않는다
    (events.py 의 "부가 채널" 철학). 진실의 원천은 Kafka 오프셋이고 이건 UI 캐시다.
    """
    if not counts:
        return
    from datetime import datetime

    from eai_api.db import session_scope
    from eai_api.models import CdcStream

    now = datetime.now(UTC)
    now_ms = int(now.timestamp() * 1000)
    try:
        with session_scope() as session:
            for sid, count in counts.items():
                stream = session.get(CdcStream, sid)
                if stream is None:
                    continue
                m = dict(stream.metrics or {})
                prev_ms = int(m.get("_last_report_ms", now_ms))
                delta_s = max((now_ms - prev_ms) / 1000.0, 0.001)
                m["events_total"] = int(m.get("events_total", 0)) + count
                m["eps"] = round(count / delta_s, 2)
                if sid in last_ts:
                    m["lag_ms"] = max(now_ms - last_ts[sid], 0)
                m["_last_report_ms"] = now_ms
                stream.metrics = m
                stream.last_event_at = now
    except Exception:
        logger.exception("스트림 지표 갱신 실패 — 데이터 경로에는 영향 없음")


def _mark_subscribed(stream_ids: set[str]) -> None:
    """sink 가 구독한 스트림에 subscribed 플래그를 남긴다.

    Monitor 는 running 인데 subscribed 가 아직 없으면 '구독 대기중'으로 보여준다.
    이것도 베스트에포트 — 실패해도 적재에는 영향 없다.
    """
    if not stream_ids:
        return
    from eai_api.db import session_scope
    from eai_api.models import CdcStream

    try:
        with session_scope() as session:
            for sid in stream_ids:
                stream = session.get(CdcStream, sid)
                if stream is None or (stream.metrics or {}).get("subscribed"):
                    continue
                m = dict(stream.metrics or {})
                m["subscribed"] = True
                stream.metrics = m
    except Exception:
        logger.exception("구독 표시 실패 — 데이터 경로에는 영향 없음")


_running = True


def _handle_signal(signum: int, _frame: types.FrameType | None) -> None:
    global _running
    logger.info("종료 신호 수신 (%s) — 현재 배치를 마치고 종료합니다", signum)
    _running = False


def main(consumer_factory: Callable[[list[str]], SinkConsumer] | None = None) -> None:
    """상주 루프. ``consumer_factory`` 를 주면(테스트) 그것을, 없으면 Kafka 를 쓴다."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    router, topic_to_stream = _load_router()
    topics = sorted(router)
    if not topics:
        logger.warning("활성 CDC 스트림이 없습니다 — %d초마다 다시 확인합니다", ROUTER_REFRESH_SECONDS)

    make = consumer_factory or _kafka_consumer_factory
    consumer = make(topics)
    writer: SinkWriter = ConnectorSinkWriter()
    _mark_subscribed(set(topic_to_stream.values()))
    logger.info("CDC Sink 기동 — 토픽 %d개 구독 (%d초마다 자동 재구독)", len(topics), ROUTER_REFRESH_SECONDS)

    last_refresh = time.monotonic()
    try:
        while _running:
            # 주기적으로 활성 스트림을 다시 스캔해 토픽 구독을 갱신한다.
            # 새 스트림을 켜도 수동 재시작 없이 여기서 자동으로 붙는다.
            if time.monotonic() - last_refresh >= ROUTER_REFRESH_SECONDS:
                last_refresh = time.monotonic()
                try:
                    new_router, new_map = _load_router()
                    new_topics = sorted(new_router)
                    if new_topics != topics:
                        consumer.resubscribe(new_topics)
                        logger.info("토픽 재구독: %d개 → %d개", len(topics), len(new_topics))
                    router, topic_to_stream, topics = new_router, new_map, new_topics
                    _mark_subscribed(set(topic_to_stream.values()))
                except Exception:
                    logger.exception("토픽 재구독 실패 — 다음 주기에 다시 시도합니다")

            try:
                stats = run_once(consumer, router, writer, topic_to_stream)
                if stats.consumed:
                    logger.info(
                        "적재 %d건 (upsert=%d delete=%d skip=%d)",
                        stats.consumed, stats.upserted, stats.deleted, stats.skipped,
                    )
            except Exception:
                logger.exception("Sink 배치 실패 — 오프셋 미커밋, 다음 회차에 재시도합니다")
                time.sleep(1.0)
    finally:
        consumer.close()
        logger.info("CDC Sink 종료")


def _kafka_consumer_factory(topics: list[str]) -> SinkConsumer:
    from .kafka_consumer import KafkaSinkConsumer

    return KafkaSinkConsumer(topics)


if __name__ == "__main__":
    main()
