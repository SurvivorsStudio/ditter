"""CDC 스트림 도메인 로직 — 수명주기 오케스트레이션 (Phase 4b, 기획안 §6).

배치의 ``run_service`` 에 대응한다. 다만 실행 모델이 달라(끝나지 않는 스트림) Run 이 아니라
``CdcStream`` 을 다루고, Celery 큐 대신 **Debezium(Kafka Connect)** 에 커넥터를 등록/해제한다.

Sink Worker(4c)는 아직 없다 — 이 단계에서는 소스 캡처(Debezium)까지만 세운다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import CDC_ACTIVE_STATUSES, CdcStream, CdcStreamStatus, Pipeline
from ..schemas.dag import CDC_SOURCE_KINDS, NODE_CONNECTOR_TYPE, NodeKind, PipelineDefinition
from ..schemas.stream import CdcStreamListItem, PreflightCheck, PreflightOut
from . import cdc_connect, connection_service, pipeline_service
from .errors import ConflictError, NotFoundError, ValidationError

logger = logging.getLogger(__name__)

#: CDC 를 지원하는 소스 커넥터 타입 (MySQL·PostgreSQL 에 이어 MSSQL/SQL Server 추가)
CDC_SUPPORTED_TYPES = frozenset({"mysql", "postgres", "mssql"})


@dataclass(frozen=True, slots=True)
class CdcSourceSpec:
    """CDC 파이프라인에서 뽑아낸, 커넥터 하나를 세우는 데 필요한 전부."""

    node_id: str
    source_type: str  # mysql | postgres | mssql
    connection_id: str
    tables: list[str] = field(default_factory=list)
    snapshot: str = "initial"
    delete_mode: str = "soft"


def extract_cdc_source(definition: PipelineDefinition) -> CdcSourceSpec:
    """DAG 에서 CDC 소스 노드를 찾아 스펙으로 만든다.

    4b 는 스트림당 CDC 소스 **하나**만 다룬다 — 여러 개면 커넥터도 여러 개라 수명주기가
    복잡해진다. 둘 이상이면 명시적으로 거부한다(조용히 첫 번째를 고르지 않는다).
    """
    cdc_nodes = [n for n in definition.nodes if n.kind in CDC_SOURCE_KINDS]
    if not cdc_nodes:
        raise ValidationError("CDC 소스 노드가 없습니다 — 이 파이프라인은 CDC 스트림이 아닙니다")
    if len(cdc_nodes) > 1:
        raise ValidationError(
            f"CDC 소스가 {len(cdc_nodes)}개입니다 — 스트림 하나에는 소스 하나만 지원합니다"
        )

    node = cdc_nodes[0]
    source_type = NODE_CONNECTOR_TYPE.get(NodeKind(node.kind), "")
    connection_id = str(node.params.get("connection_id") or "")
    if not connection_id:
        raise ValidationError(f"CDC 소스 '{node.id}' 에 connection_id 가 없습니다")

    tables = node.params.get("tables")
    if not isinstance(tables, list):
        single = node.params.get("table")
        tables = [str(single)] if single else []
    tables = [str(t) for t in tables if str(t).strip()]
    if not tables:
        raise ValidationError(f"CDC 소스 '{node.id}' 에 캡처할 테이블이 없습니다")

    return CdcSourceSpec(
        node_id=node.id,
        source_type=source_type,
        connection_id=connection_id,
        tables=tables,
        snapshot=str(node.params.get("snapshot", "initial")),
        delete_mode=str(node.params.get("delete_mode", "soft")),
    )


# --------------------------------------------------------------------- 조회


def get_stream(session: Session, stream_id: str) -> CdcStream:
    stream = session.get(CdcStream, stream_id)
    if stream is None:
        raise NotFoundError(f"CDC 스트림을 찾을 수 없습니다: {stream_id}")
    return stream


def active_stream_for(session: Session, pipeline_id: str) -> CdcStream | None:
    stmt = select(CdcStream).where(
        CdcStream.pipeline_id == pipeline_id,
        CdcStream.status.in_(sorted(str(s) for s in CDC_ACTIVE_STATUSES)),
    )
    return session.execute(stmt).scalars().first()


def list_active_streams(session: Session) -> list[CdcStream]:
    """running·paused·provisioning 상태의 스트림. Sink Worker 가 구독 대상을 정하는 근거."""
    stmt = select(CdcStream).where(
        CdcStream.status.in_(sorted(str(s) for s in CDC_ACTIVE_STATUSES))
    )
    return list(session.execute(stmt).scalars())


def list_streams(session: Session, *, status: str | None = None) -> list[CdcStreamListItem]:
    stmt = (
        select(CdcStream, Pipeline.name)
        .join(Pipeline, Pipeline.id == CdcStream.pipeline_id)
        .order_by(CdcStream.created_at.desc())
    )
    if status:
        stmt = stmt.where(CdcStream.status == status)

    items: list[CdcStreamListItem] = []
    for stream, name in session.execute(stmt).all():
        metrics = stream.metrics or {}
        items.append(
            CdcStreamListItem(
                id=stream.id,
                pipeline_id=stream.pipeline_id,
                pipeline_name=name,
                status=stream.status,
                engine=stream.engine,
                events_total=int(metrics.get("events_total", 0)),
                eps=float(metrics.get("eps", 0.0)),
                lag_ms=metrics.get("lag_ms"),
                # sink 가 이 스트림 토픽을 구독했는지. running 인데 아직이면 UI 가 '구독 대기중'을 보여준다.
                subscribed=bool(metrics.get("subscribed", False)),
                last_event_at=stream.last_event_at,
                started_at=stream.created_at,
            )
        )
    return items


# --------------------------------------------------------------------- 수명주기


def start_stream(session: Session, pipeline_id: str) -> CdcStream:
    """CDC 파이프라인을 켠다: 검증 → CdcStream 생성 → Debezium 커넥터 등록.

    Debezium 등록이 실패하면 스트림을 ``failed`` 로 남기고(커밋) 502 로 올린다 —
    유령 레코드 없이 무엇이 왜 실패했는지 남긴다 (run_service 와 같은 원칙).
    """
    pipeline = pipeline_service.get_pipeline(session, pipeline_id)
    definition = pipeline_service.assert_runnable(pipeline)  # 에러 있으면 여기서 막힌다

    spec = extract_cdc_source(definition)
    if spec.source_type not in CDC_SUPPORTED_TYPES:
        raise ValidationError(
            f"CDC 를 지원하지 않는 소스 타입입니다: {spec.source_type} "
            f"(현재 지원: {', '.join(sorted(CDC_SUPPORTED_TYPES))})"
        )

    if active_stream_for(session, pipeline_id) is not None:
        raise ConflictError("이미 실행 중인 CDC 스트림이 있습니다 — 먼저 정지하세요")

    conn = connection_service.get_connection(session, spec.connection_id)
    if NODE_CONNECTOR_TYPE.get(NodeKind(f"source.cdc.{spec.source_type}")) != conn.type:
        raise ValidationError(
            f"연결 타입 불일치: 노드는 {spec.source_type} 를 기대하지만 연결은 {conn.type} 입니다"
        )
    resolved = connection_service.resolve_config(session, conn)

    stream = CdcStream(
        pipeline_id=pipeline.id,
        status=CdcStreamStatus.PROVISIONING,
        source_connection_id=conn.id,
    )
    session.add(stream)
    session.flush()  # id 확보 — 커넥터 이름·토픽 접두에 쓴다

    config = cdc_connect.build_connector_config(
        stream_id=stream.id,
        source_type=spec.source_type,
        connection=resolved,
        tables=spec.tables,
        snapshot=spec.snapshot,
        delete_mode=spec.delete_mode,
        kafka_bootstrap_servers=get_settings().kafka_bootstrap_servers,
    )
    name = cdc_connect.connector_name(stream.id)
    topics = cdc_connect.topics_for(
        stream.id, spec.source_type, str(resolved.get("database", "")), spec.tables
    )

    try:
        cdc_connect.get_debezium_client().put_connector(name, config)
    except Exception as exc:
        stream.status = CdcStreamStatus.FAILED
        stream.error = str(exc)[:2000]
        session.commit()  # 실패 상태를 남긴다 — 예외로 롤백되지 않도록
        logger.error("CDC 스트림 %s 등록 실패: %s", stream.id, exc)
        raise

    stream.status = CdcStreamStatus.RUNNING
    stream.debezium_connector = name
    stream.topics = topics
    stream.error = None
    session.flush()
    logger.info("CDC 스트림 %s 시작 (connector=%s, topics=%d)", stream.id, name, len(topics))
    return stream


def _require_connector(stream: CdcStream) -> str:
    if not stream.debezium_connector:
        raise ValidationError("이 스트림에는 등록된 커넥터가 없습니다")
    return stream.debezium_connector


def pause_stream(session: Session, stream_id: str) -> CdcStream:
    stream = get_stream(session, stream_id)
    if stream.status != CdcStreamStatus.RUNNING:
        raise ValidationError(f"실행 중인 스트림만 일시정지할 수 있습니다 (현재: {stream.status})")
    cdc_connect.get_debezium_client().pause(_require_connector(stream))
    stream.status = CdcStreamStatus.PAUSED
    session.flush()
    return stream


def resume_stream(session: Session, stream_id: str) -> CdcStream:
    stream = get_stream(session, stream_id)
    if stream.status != CdcStreamStatus.PAUSED:
        raise ValidationError(f"일시정지된 스트림만 재개할 수 있습니다 (현재: {stream.status})")
    cdc_connect.get_debezium_client().resume(_require_connector(stream))
    stream.status = CdcStreamStatus.RUNNING
    session.flush()
    return stream


def stop_stream(session: Session, stream_id: str) -> CdcStream:
    """스트림을 내린다: Debezium 커넥터 삭제 후 stopped.

    삭제는 멱등이다 — 이미 없어도 성공으로 친다. 정지가 실패하면 안 되기 때문이다.
    """
    stream = get_stream(session, stream_id)
    if stream.status == CdcStreamStatus.STOPPED:
        return stream
    if stream.debezium_connector:
        cdc_connect.get_debezium_client().delete(stream.debezium_connector)
    stream.status = CdcStreamStatus.STOPPED
    session.flush()
    logger.info("CDC 스트림 %s 정지", stream.id)
    return stream


def delete_stream(session: Session, stream_id: str) -> None:
    """중지·실패한 스트림 이력을 삭제한다.

    활성(provisioning·running·paused) 스트림은 삭제할 수 없다 — 커넥터가 아직 살아 있으므로
    먼저 stop 으로 내려야 한다. 그렇지 않으면 유령 커넥터가 남는다.
    """
    stream = get_stream(session, stream_id)
    if stream.status in CDC_ACTIVE_STATUSES:
        raise ConflictError(
            f"활성 스트림은 삭제할 수 없습니다 (현재: {stream.status}) — 먼저 중지하세요"
        )
    session.delete(stream)
    session.flush()
    logger.info("CDC 스트림 %s 이력 삭제", stream_id)


def refresh_status(session: Session, stream_id: str) -> CdcStream:
    """Debezium 실제 상태를 읽어 저장 상태와 어긋나면 맞춘다.

    진실의 원천은 Kafka Connect 다 — 커넥터가 FAILED 로 죽었는데 우리 DB 가 running 이면
    UI 가 거짓말을 하게 된다. 활성 스트림에만 물어본다.
    """
    stream = get_stream(session, stream_id)
    if stream.status not in CDC_ACTIVE_STATUSES or not stream.debezium_connector:
        return stream
    try:
        info = cdc_connect.get_debezium_client().status(stream.debezium_connector)
    except Exception as exc:  # 상태 조회 실패로 스트림을 죽이지는 않는다
        logger.warning("CDC 스트림 %s 상태 조회 실패: %s", stream.id, exc)
        return stream

    connector_state = str((info.get("connector") or {}).get("state", "")).upper()
    task_states = [str(t.get("state", "")).upper() for t in info.get("tasks") or []]
    if connector_state == "FAILED" or "FAILED" in task_states:
        stream.status = CdcStreamStatus.FAILED
        stream.error = "Debezium 커넥터가 FAILED 상태입니다"
        session.flush()
    return stream


# --------------------------------------------------------------------- preflight


def preflight(session: Session, connection_id: str) -> PreflightOut:
    """연결이 CDC 소스로 쓸 준비가 됐는지 점검한다.

    4b 는 세 가지를 본다: (1) 지원 타입인가 (2) 연결에서 CDC 를 켰는가 (3) 접속되는가.
    소스 DB 의 binlog/WAL 설정 확인은 이후 단계에서 더한다.
    """
    conn = connection_service.get_connection(session, connection_id)
    checks: list[PreflightCheck] = []

    type_ok = conn.type in CDC_SUPPORTED_TYPES
    checks.append(
        PreflightCheck(
            key="type",
            label="CDC 지원 소스 타입",
            ok=type_ok,
            detail=(
                f"{conn.type} 지원됨"
                if type_ok
                else f"{conn.type} 은(는) 아직 CDC 미지원 (가능: {', '.join(sorted(CDC_SUPPORTED_TYPES))})"
            ),
        )
    )
    checks.append(
        PreflightCheck(
            key="cdc_enabled",
            label="연결에서 CDC 사용",
            ok=bool(conn.cdc_enabled),
            detail="켜짐" if conn.cdc_enabled else "연결 설정에서 'CDC 사용'을 켜세요",
        )
    )

    health = connection_service.test_connection(session, connection_id)
    reachable = str(health.status) == "ok"
    checks.append(
        PreflightCheck(
            key="reachable",
            label="소스 접속 가능",
            ok=reachable,
            detail=health.message or ("연결 정상" if reachable else "접속 실패"),
        )
    )

    return PreflightOut(
        connection_id=conn.id,
        connection_name=conn.name,
        ready=all(c.ok for c in checks),
        checks=checks,
    )
