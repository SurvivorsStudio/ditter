"""Extract 노드 — 소스에서 배치를 스트리밍한다."""

from __future__ import annotations

import logging
from collections.abc import Iterator

from eai_api.schemas.dag import PipelineNode
from eai_connectors import BaseConnector, ReadSpec, RecordBatch

from ..context import RunContext

logger = logging.getLogger(__name__)


def extract(
    node: PipelineNode,
    connector: BaseConnector,
    ctx: RunContext,
    *,
    watermark: object = None,
) -> Iterator[RecordBatch]:
    """소스 노드를 실행해 배치를 흘린다.

    ``full_refresh`` 이거나 체크포인트가 없으면 워터마크 없이 전체를 읽는다.
    """
    params = node.params
    effective_watermark = None if ctx.full_refresh else watermark

    spec = ReadSpec(
        table=params.get("table"),
        # SAP BAPI 처럼 테이블이 아닌 함수 호출로 읽는 소스도 있다
        function=params.get("function_name"),
        namespace=params.get("namespace"),
        query=params.get("query"),
        columns=params.get("columns"),
        incremental_column=params.get("incremental_column"),
        watermark=effective_watermark,
        batch_size=int(params.get("batch_size", 5_000)),
        limit=params.get("limit"),
        # 노드 파라미터를 통째로 넘긴다 — 커넥터별 옵션(SAP 의 mode/where/result_table,
        # Mongo 의 필터 등)은 여기를 통해서만 커넥터에 닿는다
        params=params,
    )

    mode = "전체" if effective_watermark is None else f"증분(> {effective_watermark})"
    source_label = spec.table or spec.function or "(쿼리)"
    ctx.log(f"소스 읽기 시작: {source_label} · {mode} · batch={spec.batch_size}", node_id=node.id)

    emitted = 0
    for batch in connector.read(spec):
        emitted += len(batch)
        # 워터마크는 여기서 관측만 하고, 체크포인트 승격은 적재 성공 후 엔진이 한다
        ctx.observe_watermark(node.id, batch.max_watermark)
        if batch.rows:
            ctx.add_records(node.id, len(batch))
            ctx.log(f"{len(batch):,}건 읽음 (누적 {emitted:,})", node_id=node.id)
        yield batch

    ctx.log(f"소스 읽기 완료: 총 {emitted:,}건", node_id=node.id)
