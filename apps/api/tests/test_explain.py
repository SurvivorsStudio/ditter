"""쿼리 실행 계획(EXPLAIN) 서비스 로직.

실제 EXPLAIN 실행은 DB(방언)별이라 통합 검증 몫이고, 여기서는 DB 없이 되는 것만 본다:
 - 커넥터에 위임하고 계획 텍스트를 돌려주는지
 - EXPLAIN ANALYZE 의 비SELECT 는 역할(operator/editor)까지 요구하는지
 - 순수 EXPLAIN(비실행)은 역할 없이도 되는지
"""

from __future__ import annotations

import pytest

from eai_api.services import connection_service as svc
from eai_api.services.connection_service import PermissionDeniedError
from eai_api.services.errors import ValidationError


class _FakeConn:
    type = "postgres"


class _ExplainConn:
    def explain(self, query: str, *, analyze: bool = False) -> str:
        return f"PLAN analyze={analyze} :: {query}"


def _patch(monkeypatch, verb: str) -> None:
    monkeypatch.setattr(svc, "get_connection", lambda _s, _c: _FakeConn())
    monkeypatch.setattr(svc, "connection_statements", lambda _c: frozenset({"select", verb}))
    monkeypatch.setattr(svc, "ensure_statement_allowed", lambda q, _a: (q, verb))
    monkeypatch.setattr(svc, "open_cached_connector", lambda _s, _c: _ExplainConn())


def test_explain_delegates_to_connector(monkeypatch) -> None:
    _patch(monkeypatch, "select")
    plan = svc.explain_query(None, "c1", query="SELECT 1", analyze=True)  # type: ignore[arg-type]
    assert "analyze=True" in plan and "SELECT 1" in plan


def test_explain_analyze_non_select_needs_role(monkeypatch) -> None:
    """EXPLAIN ANALYZE 는 실제로 실행되므로 UPDATE 는 operator 권한이 있어야 한다."""
    _patch(monkeypatch, "update")
    with pytest.raises(PermissionDeniedError):
        svc.explain_query(None, "c1", query="UPDATE t SET x=1", analyze=True, can_write=False)  # type: ignore[arg-type]


def test_explain_only_non_select_no_role_needed(monkeypatch) -> None:
    """순수 EXPLAIN 은 실행하지 않으므로 역할 검사를 하지 않는다."""
    _patch(monkeypatch, "update")
    plan = svc.explain_query(None, "c1", query="UPDATE t SET x=1", analyze=False, can_write=False)  # type: ignore[arg-type]
    assert "analyze=False" in plan


def test_ensure_statement_allows_explain_as_readonly() -> None:
    """편집기에서 EXPLAIN 을 직접 돌릴 수 있다 — 허용 목록(SELECT-only)과 무관."""
    q, verb = svc.ensure_statement_allowed("EXPLAIN SELECT 1", frozenset({"select"}))
    assert verb == "explain"
    assert q == "EXPLAIN SELECT 1"


def test_ensure_statement_explain_with_write_needs_command() -> None:
    """EXPLAIN 안의 UPDATE 는 그 명령이 허용돼야 한다(EXPLAIN ANALYZE UPDATE 안전장치)."""
    with pytest.raises(ValidationError):
        svc.ensure_statement_allowed("EXPLAIN ANALYZE UPDATE t SET x=1", frozenset({"select"}))
    # UPDATE 가 허용되면 통과
    _q, verb = svc.ensure_statement_allowed(
        "EXPLAIN ANALYZE UPDATE t SET x=1", frozenset({"select", "update"})
    )
    assert verb == "explain"
