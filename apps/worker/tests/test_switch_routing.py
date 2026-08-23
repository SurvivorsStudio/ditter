"""스위치 라우팅 — 엔진이 소비 엣지의 source_handle 로 케이스를 분배한다.

실행기(_switch)는 각 행에 ROUTE_KEY 태그만 붙이고, 실제 분배는 engine._build_stream
이 엣지별로 _route_filter 를 걸어 처리한다. 여기서는 그 분배 로직을 검증한다.
"""

from __future__ import annotations

from collections.abc import Iterator

from eai_api.schemas.dag import PipelineNode
from eai_connectors import RecordBatch

from eai_worker.context import RunContext
from eai_worker.engine import _build_stream, _Exec, _route_filter
from eai_worker.nodes.transform import ROUTE_KEY
from eai_worker.spool import SpooledStream


class FakeContext(RunContext):
    def __init__(self) -> None:
        super().__init__(run_id="r", pipeline_id="p")

    def log(self, message: str, *, node_id: str | None = None, level: str = "info") -> None:
        pass

    def set_node(self, node_id: str, **changes: object) -> None:
        pass


def _tagged(rows_with_route: list[tuple[dict, str]], columns: list[str]) -> RecordBatch:
    rows = [{**r, ROUTE_KEY: route} for r, route in rows_with_route]
    return RecordBatch(rows=rows, columns=columns, is_last=True)


def test_route_filter_keeps_handle_and_strips_tag() -> None:
    batch = _tagged([({"id": 1}, "a"), ({"id": 2}, "b"), ({"id": 3}, "a")], ["id"])
    out = list(_route_filter(iter([batch]), "a"))
    assert [r["id"] for b in out for r in b.rows] == [1, 3]
    # 라우팅 태그는 다운스트림에 노출되지 않는다
    assert all(ROUTE_KEY not in r for b in out for r in b.rows)


def test_route_filter_unknown_handle_yields_nothing() -> None:
    batch = _tagged([({"id": 1}, "a")], ["id"])
    out = list(_route_filter(iter([batch]), "zzz"))
    assert [r for b in out for r in b.rows] == []


def _switch_node(nid: str) -> PipelineNode:
    return PipelineNode(id=nid, kind="logic.switch", params={})  # type: ignore[arg-type]


def _sink(nid: str) -> PipelineNode:
    return PipelineNode(id=nid, kind="target.file", params={})  # type: ignore[arg-type]


def test_build_stream_routes_each_edge_to_its_handle() -> None:
    """스위치 → 두 다운스트림. 각 다운스트림은 자기 핸들의 부분집합만 받는다."""
    sw, a, b = _switch_node("sw"), _sink("a"), _sink("b")
    # 미리 태그된 스위치 출력을 스풀에 심어 _stream_of 가 바로 tee 하도록 한다
    tagged = _tagged(
        [({"id": 1}, "hot"), ({"id": 2}, "cold"), ({"id": 3}, "hot"), ({"id": 4}, "__default__")],
        ["id"],
    )
    spool = SpooledStream(iter([tagged]), label="sw")
    state = _Exec(
        node_map={"sw": sw, "a": a, "b": b},
        upstream={"sw": [], "a": ["sw"], "b": ["sw"]},
        downstream={"sw": ["a", "b"], "a": [], "b": []},
        in_edges={"sw": [], "a": [("sw", "hot")], "b": [("sw", "cold")]},
        ctx=FakeContext(),
        spools={"sw": spool},
    )
    try:

        def ids(stream: Iterator[RecordBatch]) -> list[int]:
            return [r["id"] for batch in stream for r in batch.rows]

        assert ids(_build_stream(a, state)) == [1, 3]  # hot
        assert ids(_build_stream(b, state)) == [2]  # cold
    finally:
        spool.cleanup()
