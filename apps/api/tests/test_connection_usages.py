"""연결 사용처 탐지.

DAG 정의에서 어떤 노드가 특정 연결을 쓰는지 뽑는 로직을 검증한다.
JSONB containment 로 후보를 좁히는 부분은 PostgreSQL 전용이라 통합 검증 몫이고,
여기서는 노드 확정 로직(nodes_using)을 DB 없이 본다.
"""

from __future__ import annotations

from eai_api.services.connection_service import nodes_using


def node(node_id: str, connection_id: str | None, kind: str = "source.postgres") -> dict:
    params: dict[str, object] = {}
    if connection_id is not None:
        params["connection_id"] = connection_id
    return {"id": node_id, "kind": kind, "params": params}


def definition(*nodes: dict) -> dict:
    return {"nodes": list(nodes), "edges": [], "variables": {}}


class TestNodesUsing:
    def test_no_match(self) -> None:
        d = definition(node("src", "other-conn"))
        assert nodes_using(d, "target-conn") == []

    def test_single_match(self) -> None:
        d = definition(node("src", "c1"), node("tgt", "c2", "target.db"))
        assert nodes_using(d, "c1") == ["src"]

    def test_multiple_nodes_same_connection(self) -> None:
        """한 파이프라인이 소스·타깃 양쪽에서 같은 연결을 쓸 수 있다."""
        d = definition(node("src", "c1"), node("tgt", "c1", "target.db"))
        assert nodes_using(d, "c1") == ["src", "tgt"]

    def test_result_is_sorted(self) -> None:
        d = definition(node("zeta", "c1"), node("alpha", "c1"), node("mid", "c1"))
        assert nodes_using(d, "c1") == ["alpha", "mid", "zeta"]

    def test_nodes_without_connection_are_ignored(self) -> None:
        """트리거·변환 노드는 connection_id 가 없다 — 걸리면 안 된다."""
        d = definition(
            node("trg", None, "trigger.schedule"),
            node("flt", None, "transform.filter"),
            node("src", "c1"),
        )
        assert nodes_using(d, "c1") == ["src"]

    def test_empty_definition(self) -> None:
        assert nodes_using({}, "c1") == []
        assert nodes_using(None, "c1") == []
        assert nodes_using({"nodes": []}, "c1") == []

    def test_malformed_nodes_do_not_crash(self) -> None:
        """저장이 검증하지만, 사용처 조회는 삭제 직전 방어선이라 깨지면 안 된다."""
        d = {"nodes": ["not-a-dict", {"id": "ok", "params": {"connection_id": "c1"}}, {}]}
        assert nodes_using(d, "c1") == ["ok"]

    def test_connection_id_compared_as_string(self) -> None:
        # UUID 가 숫자로 저장될 일은 없지만, 타입이 흔들려도 매칭돼야 한다
        d = {"nodes": [{"id": "n", "params": {"connection_id": 123}}]}
        assert nodes_using(d, "123") == ["n"]

    def test_node_without_id_falls_back(self) -> None:
        d = {"nodes": [{"params": {"connection_id": "c1"}}]}
        assert nodes_using(d, "c1") == ["?"]
