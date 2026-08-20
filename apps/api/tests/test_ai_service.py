"""AI 어시스턴트 서비스 — DB·네트워크 없이 되는 것만 본다.

실제 Gemini 호출은 통합 검증 몫이고 여기서는:
 - intent·메시지·연결 종류 검증
 - 커넥터 generate 위임 + SQL 추출
 - 스키마 문맥 조립(방언·상한·미지원 타입 안내)
"""

from __future__ import annotations

import pytest

from eai_api.services import ai_service as svc
from eai_api.services.ai_service import _extract_sql
from eai_api.services.errors import ValidationError


class _Conn:
    def __init__(self, type_: str, name: str = "c") -> None:
        self.type = type_
        self.name = name


class _AiConnector:
    def __init__(self, text: str = "```sql\nSELECT 1\n```\n설명") -> None:
        self.text = text
        self.seen: dict = {}

    def generate(self, messages, *, system=None, **_):
        self.seen = {"messages": messages, "system": system}
        return type("R", (), {"text": self.text, "usage": {"promptTokenCount": 4}})()


def _patch(monkeypatch, *, ai_conn, connector, db_conn=None, tables=None) -> None:
    conns = {"ai": ai_conn}
    if db_conn is not None:
        conns["db"] = db_conn
    monkeypatch.setattr(svc, "get_connection", lambda _s, cid: conns[cid])
    monkeypatch.setattr(svc, "open_cached_connector", lambda _s, _c: connector)
    monkeypatch.setattr(svc, "discover_schema", lambda *a, **k: tables or [])


def test_unknown_intent(monkeypatch) -> None:
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=_AiConnector())
    with pytest.raises(ValidationError):
        svc.chat(None, ai_connection_id="ai", messages=[{"role": "user", "content": "x"}], intent="nope")  # type: ignore[arg-type]


def test_empty_messages(monkeypatch) -> None:
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=_AiConnector())
    with pytest.raises(ValidationError):
        svc.chat(None, ai_connection_id="ai", messages=[])  # type: ignore[arg-type]


def test_non_ai_connection_rejected(monkeypatch) -> None:
    class _NotAi:  # generate 없음
        pass

    _patch(monkeypatch, ai_conn=_Conn("postgres"), connector=_NotAi())
    with pytest.raises(ValidationError):
        svc.chat(None, ai_connection_id="ai", messages=[{"role": "user", "content": "x"}])  # type: ignore[arg-type]


def test_generate_and_extract_sql(monkeypatch) -> None:
    conn = _AiConnector()
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    out = svc.chat(None, ai_connection_id="ai", messages=[{"role": "user", "content": "1 뽑아줘"}])  # type: ignore[arg-type]
    assert out.sql == "SELECT 1"
    assert "SELECT 1" in out.content
    assert out.usage["promptTokenCount"] == 4
    # 대상 DB 를 안 줬으니 스키마 문맥 없음
    assert out.dialect is None


def test_schema_context_for_sql_db(monkeypatch) -> None:
    col = type("C", (), {"name": "id", "data_type": "int", "primary_key": True})()
    col2 = type("C", (), {"name": "name", "data_type": "text", "primary_key": False})()
    tbl = type("T", (), {"qualified_name": "public.users", "columns": [col, col2]})()
    conn = _AiConnector()
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn, db_conn=_Conn("postgres"), tables=[tbl])
    out = svc.chat(
        None,  # type: ignore[arg-type]
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "유저 뽑아줘"}],
        db_connection_id="db",
    )
    assert out.dialect == "PostgreSQL"
    # 스키마가 시스템 프롬프트에 들어갔다
    assert "public.users" in conn.seen["system"]
    assert "id int PK" in conn.seen["system"]


def test_unsupported_db_type_notes(monkeypatch) -> None:
    conn = _AiConnector()
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn, db_conn=_Conn("mongo"))
    out = svc.chat(
        None,  # type: ignore[arg-type]
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "x"}],
        db_connection_id="db",
    )
    assert out.dialect is None
    assert out.schema_note and "지원하지 않아" in out.schema_note


def test_extract_sql_variants() -> None:
    assert _extract_sql("```sql\nSELECT 1\n```") == "SELECT 1"
    assert _extract_sql("설명\n```\nSELECT 2\n```\n끝") == "SELECT 2"
    assert _extract_sql("코드블록 없음") is None
