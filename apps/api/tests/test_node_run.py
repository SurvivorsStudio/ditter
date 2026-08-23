"""단일 노드 실행 관문 (assert_node_runnable).

전체 파이프라인 관문과 달리 '그 노드까지의 하위 그래프'만 본다 —
타깃이 없거나 소스가 하류에 안 붙어 있어도, 그 노드가 데이터를 만들 수 있으면 통과시킨다.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from eai_api.services.errors import ValidationError
from eai_api.services.pipeline_service import assert_node_runnable


def pipeline(nodes: list[dict[str, Any]], edges: list[dict[str, Any]] | None = None) -> Any:
    """assert_node_runnable 은 .definition 만 읽는다 — 가벼운 가짜로 충분하다."""
    return SimpleNamespace(definition={"nodes": nodes, "edges": edges or [], "variables": {}})


CONN = "conn-1"


class TestAssertNodeRunnable:
    def test_source_alone_is_runnable(self) -> None:
        """소스만 있고 타깃이 없어도 그 소스는 독립 실행(미리보기)할 수 있다."""
        p = pipeline(
            [{"id": "src", "kind": "source.postgres", "params": {"connection_id": CONN, "table": "t"}}]
        )
        assert_node_runnable(p, "src")  # 예외 없이 통과

    def test_target_with_upstream_is_runnable(self) -> None:
        p = pipeline(
            [
                {"id": "src", "kind": "source.postgres", "params": {"connection_id": CONN, "table": "t"}},
                {"id": "tgt", "kind": "target.file", "params": {"connection_id": CONN}},
            ],
            [{"source": "src", "target": "tgt"}],
        )
        assert_node_runnable(p, "tgt")

    def test_missing_connection_blocks(self) -> None:
        p = pipeline([{"id": "src", "kind": "source.postgres", "params": {"table": "t"}}])
        with pytest.raises(ValidationError, match="connection_id"):
            assert_node_runnable(p, "src")

    def test_missing_table_blocks(self) -> None:
        p = pipeline([{"id": "src", "kind": "source.postgres", "params": {"connection_id": CONN}}])
        with pytest.raises(ValidationError, match="table"):
            assert_node_runnable(p, "src")

    def test_unknown_node_is_error(self) -> None:
        p = pipeline(
            [{"id": "src", "kind": "source.postgres", "params": {"connection_id": CONN, "table": "t"}}]
        )
        with pytest.raises(ValidationError, match="찾을 수 없"):
            assert_node_runnable(p, "ghost")

    def test_trigger_node_cannot_run(self) -> None:
        p = pipeline([{"id": "trg", "kind": "trigger.manual", "params": {}}])
        with pytest.raises(ValidationError, match="실행할 수 없"):
            assert_node_runnable(p, "trg")

    def test_memo_node_cannot_run(self) -> None:
        p = pipeline([{"id": "m", "kind": "note.memo", "params": {"text": "hi"}}])
        with pytest.raises(ValidationError, match="실행할 수 없"):
            assert_node_runnable(p, "m")

    def test_upstream_error_blocks_target(self) -> None:
        """타깃 실행은 상류에 문제가 있으면 막힌다 (상류 소스가 데이터를 못 만듦)."""
        p = pipeline(
            [
                {"id": "src", "kind": "source.postgres", "params": {"table": "t"}},  # connection 없음
                {"id": "tgt", "kind": "target.file", "params": {"connection_id": CONN}},
            ],
            [{"source": "src", "target": "tgt"}],
        )
        with pytest.raises(ValidationError, match="connection_id"):
            assert_node_runnable(p, "tgt")

    def test_unrelated_broken_node_does_not_block(self) -> None:
        """다른 가지의 문제 노드는 이 노드 실행을 막지 않는다."""
        p = pipeline(
            [
                {"id": "src", "kind": "source.postgres", "params": {"connection_id": CONN, "table": "t"}},
                {"id": "tgt", "kind": "target.file", "params": {"connection_id": CONN}},
                {"id": "broken", "kind": "source.mysql", "params": {}},  # 설정 안 된 별개 소스
            ],
            [{"source": "src", "target": "tgt"}],
        )
        assert_node_runnable(p, "tgt")  # broken 은 스코프 밖이라 무시
