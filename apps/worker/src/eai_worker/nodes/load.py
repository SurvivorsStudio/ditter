"""Load 노드 — 타깃에 배치를 적재한다.

멱등성(설계 문서 §1):
- DB 타깃      : upsert(키 기준) 또는 overwrite(트랜잭션 내 선삭제)
- 오브젝트/파일 : ``run_id=<id>/`` 경로 분리 + 재시도 시 해당 prefix 선정리 (S3·로컬 파일)
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any, Protocol, TypeGuard, runtime_checkable

from eai_api.schemas.dag import PipelineNode
from eai_connectors import BaseConnector, RecordBatch, WriteMode

from ..context import RunContext

logger = logging.getLogger(__name__)


@runtime_checkable
class ObjectPartTarget(Protocol):
    """run_id= 경로 분리로 멱등성을 확보하는 타깃 (S3·로컬 파일).

    구체 클래스를 import 하면 boto3 등이 워커 기동 때 딸려 올라오므로,
    구조적 타이핑으로만 다룬다.
    """

    writes_object_parts: bool

    def purge_run_prefix(self) -> int: ...


def _is_object_target(connector: BaseConnector) -> TypeGuard[ObjectPartTarget]:
    """커넥터가 스스로 붙인 ``writes_object_parts`` 표시로 판별한다."""
    return bool(getattr(connector, "writes_object_parts", False))


def load(
    node: PipelineNode,
    connector: BaseConnector,
    upstream: Iterator[RecordBatch],
    ctx: RunContext,
) -> dict[str, Any]:
    """업스트림 배치를 전부 소비해 적재하고 요약을 돌려준다."""
    mode = _resolve_mode(node)
    is_object_target = _is_object_target(connector)

    if mode is WriteMode.OVERWRITE and _is_object_target(connector):
        # 같은 Run 을 재시도하는 경우 이전 파트가 남아 중복이 된다 — 먼저 지운다
        # (인라인 호출은 TypeGuard 로 connector 를 ObjectPartTarget 으로 좁히기 위한 것)
        removed = connector.purge_run_prefix()
        if removed:
            ctx.log(f"이전 실행 산출물 {removed}개 정리", node_id=node.id)

    written = 0
    batches = 0
    last_location: str | None = None
    max_watermark: Any = None
    first_db_overwrite_done = False

    for batch in upstream:
        if batch.max_watermark is not None:
            max_watermark = (
                batch.max_watermark if max_watermark is None else max(max_watermark, batch.max_watermark)
            )
        if not batch.rows:
            continue

        # DB overwrite 는 첫 배치에서만 테이블을 비운다 — 매 배치 비우면 마지막 배치만 남는다
        batch_mode = mode
        if mode is WriteMode.OVERWRITE and not is_object_target:
            if first_db_overwrite_done:
                batch_mode = WriteMode.APPEND
            else:
                first_db_overwrite_done = True

        result = connector.write(batch, batch_mode)
        written += result.records_written
        batches += 1
        last_location = result.location or last_location
        ctx.add_records(node.id, result.records_written)
        ctx.log(f"{result.records_written:,}건 적재 → {result.location} (누적 {written:,})", node_id=node.id)

    ctx.log(f"적재 완료: 총 {written:,}건 / {batches}배치 · mode={mode}", node_id=node.id)
    return {"records": written, "location": last_location, "max_watermark": max_watermark, "mode": str(mode)}


def _resolve_mode(node: PipelineNode) -> WriteMode:
    raw = str(node.params.get("mode", "")).lower()
    if raw:
        try:
            return WriteMode(raw)
        except ValueError as exc:
            from eai_connectors.errors import ConfigurationError

            raise ConfigurationError(f"알 수 없는 적재 모드: {raw} (가능: append/upsert/overwrite)") from exc
    # 기본값: DB 는 upsert 가 안전(멱등), 오브젝트/파일(S3·로컬)은 append
    from eai_api.schemas.dag import OBJECT_TARGET_KINDS

    return WriteMode.APPEND if node.kind in OBJECT_TARGET_KINDS else WriteMode.UPSERT
