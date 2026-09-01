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


def test_interpret_intent_forbids_sql_and_includes_query(monkeypatch) -> None:
    # 해석 의도는 프로세 답변만 — 시스템 프롬프트가 SQL 금지를 명시하고, 실행 쿼리를 문맥에 싣는다.
    conn = _AiConnector(text="상위 5개 공장의 태그 수입니다. plant_cd 별로 고르게 분포합니다.")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    out = svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "결과 표: ..."}],
        intent="sql.interpret",
        sql="SELECT plant_cd, COUNT(*) FROM t GROUP BY plant_cd",
    )  # type: ignore[arg-type]
    assert out.sql is None  # 해석 답변엔 SQL 이 없다
    assert "코드블록" in conn.seen["system"]  # SQL 금지 규칙
    assert "SELECT plant_cd" in conn.seen["system"]  # 실행된 쿼리를 문맥에 실었다


def test_schema_context_for_sql_db(monkeypatch) -> None:
    col = type("C", (), {"name": "id", "data_type": "int", "primary_key": True})()
    col2 = type("C", (), {"name": "name", "data_type": "text", "primary_key": False})()
    tbl = type("T", (), {"qualified_name": "public.users", "name": "users", "columns": [col, col2]})()
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


def _table(qn: str, cols: list[tuple[str, str, bool]]):
    name = qn.split(".")[-1]
    columns = [type("C", (), {"name": c, "data_type": d, "primary_key": pk})() for c, d, pk in cols]
    return type("T", (), {"qualified_name": qn, "name": name, "columns": columns})()


def test_mentioned_table_beyond_cap_gets_columns(monkeypatch) -> None:
    """테이블이 상한을 넘어도, 사용자가 언급한 테이블은 컬럼까지 실리고 전체 이름은 다 나온다."""
    # 상한(60)을 넘기는 더미 테이블 + 사용자가 콕 집은 t_s10_eqp_tag(맨 뒤)
    tables = [_table(f"public.t{i}", [("id", "int", True)]) for i in range(80)]
    tables.append(_table("public.t_s10_eqp_tag", [("plant_cd", "varchar", False), ("tag", "text", False)]))
    conn = _AiConnector()
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn, db_conn=_Conn("postgres"), tables=tables)
    svc.chat(
        None,  # type: ignore[arg-type]
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "t_s10_eqp_tag 에서 K123 조회해줘"}],
        db_connection_id="db",
    )
    system = conn.seen["system"]
    # 언급한 테이블의 컬럼이 상세에 들어갔다
    assert "public.t_s10_eqp_tag(plant_cd varchar" in system
    # 컬럼을 못 실은 테이블도 이름은 전부 들어간다
    assert "전체 테이블 이름" in system
    assert "public.t79" in system


def test_include_samples_injects_rows(monkeypatch) -> None:
    """예시 데이터 켜면 언급 테이블의 실제 행이 프롬프트에 들어가 값→컬럼 매핑을 돕는다."""
    tbl = _table("public.t_s10_eqp_tag", [("plant_cd", "varchar", False), ("tag", "text", False)])
    conn = _AiConnector()
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn, db_conn=_Conn("postgres"), tables=[tbl])
    monkeypatch.setattr(
        svc,
        "preview_rows",
        lambda *a, **k: (["plant_cd", "tag"], [{"plant_cd": "K123", "tag": "A"}], False),
    )
    svc.chat(
        None,  # type: ignore[arg-type]
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "t_s10_eqp_tag 에서 K123 조회"}],
        db_connection_id="db",
        include_samples=True,
    )
    system = conn.seen["system"]
    assert "예시 데이터" in system
    assert "plant_cd=K123" in system  # AI 가 K123→plant_cd 를 볼 수 있다


def test_samples_off_by_default(monkeypatch) -> None:
    tbl = _table("public.t_s10_eqp_tag", [("plant_cd", "varchar", False)])
    conn = _AiConnector()
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn, db_conn=_Conn("postgres"), tables=[tbl])
    called = {"n": 0}

    def _pv(*a, **k):
        called["n"] += 1
        return (["plant_cd"], [{"plant_cd": "K123"}], False)

    monkeypatch.setattr(svc, "preview_rows", _pv)
    svc.chat(
        None,  # type: ignore[arg-type]
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "t_s10_eqp_tag 에서 K123"}],
        db_connection_id="db",
    )
    assert called["n"] == 0  # 기본은 예시 데이터를 안 읽는다(외부 전송 최소)


def test_extract_sql_variants() -> None:
    assert _extract_sql("```sql\nSELECT 1\n```") == "SELECT 1"
    assert _extract_sql("설명\n```\nSELECT 2\n```\n끝") == "SELECT 2"
    assert _extract_sql("코드블록 없음") is None


def test_chart_block_is_not_extracted_as_sql() -> None:
    # ```chart 스펙을 SQL 로 착각하면 안 된다 — 그러면 '새 쿼리 탭'에 JSON 이 들어간다.
    text = '차트입니다.\n```chart\n{"type":"bar","labels":["A"],"series":[{"data":[1]}]}\n```'
    assert _extract_sql(text) is None


def test_chart_intent_outputs_chart_block(monkeypatch) -> None:
    spec = (
        '```chart\n'
        '{"type":"bar","title":"공장별","labels":["V113"],'
        '"series":[{"name":"태그수","data":[3285]}]}\n```'
    )
    conn = _AiConnector(text=f"막대 차트로 표현했습니다.\n{spec}")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    out = svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "막대 차트로"}],
        intent="data.chart",
        sql="SELECT plant_cd, COUNT(*) FROM t GROUP BY plant_cd",
    )  # type: ignore[arg-type]
    assert out.sql is None  # 차트 스펙은 sql 로 새지 않는다
    assert "```chart" in out.content
    assert "labels" in conn.seen["system"]  # 차트 형식 안내가 시스템 프롬프트에 있다


def test_tune_intent_includes_explain_plan(monkeypatch) -> None:
    # 계획 기반 튜닝 — EXPLAIN 텍스트가 시스템 프롬프트에 실려 근거로 쓰인다.
    conn = _AiConnector(text="```sql\nSELECT ...\n```\n날짜 범위로 바꿔 인덱스를 씁니다.")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "튜닝"}],
        intent="sql.tune",
        sql="SELECT * FROM orders WHERE YEAR(ordered_at)=2024",
        explain="Filter: (year(o.ordered_at) = 2024)  cost=320",
    )  # type: ignore[arg-type]
    assert "실행 계획" in conn.seen["system"]
    assert "cost=320" in conn.seen["system"]  # 실제 계획을 문맥에 실었다
    assert "CREATE INDEX" in conn.seen["system"]  # 인덱스 제안 규칙


def test_fix_intent_includes_query_and_error(monkeypatch) -> None:
    conn = _AiConnector(text="```sql\nSELECT * FROM shop.customers\n```\n3번째 줄의 '111' 을 지웠습니다.")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    out = svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "고쳐줘"}],
        intent="sql.fix",
        sql="SELECT *\nfrom shop.customers\n111",
        error="pymysql ProgrammingError (1064) near '111'",
    )  # type: ignore[arg-type]
    assert out.sql == "SELECT * FROM shop.customers"  # 고친 쿼리를 추출한다
    assert "111" in conn.seen["system"]  # 실패한 쿼리를 문맥에 실었다
    assert "1064" in conn.seen["system"]  # 오류 메시지도 실었다


def test_report_intent_forbids_code_blocks(monkeypatch) -> None:
    conn = _AiConnector(text="## 보고서\n- 요점")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    out = svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "보고서 써줘"}],
        intent="data.report",
        sql="SELECT 1",
    )  # type: ignore[arg-type]
    assert out.sql is None
    assert "마크다운" in conn.seen["system"]


def test_answer_language_defaults_to_korean(monkeypatch) -> None:
    # 프롬프트 본문은 한국어 그대로 두고, 답변 언어만 마지막 한 줄로 정한다.
    conn = _AiConnector(text="```sql\nSELECT 1\n```")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "전체 조회"}],
    )  # type: ignore[arg-type]
    assert conn.seen["system"].endswith("- 설명과 질문은 **한국어**로 작성하라.")


def test_answer_language_english(monkeypatch) -> None:
    conn = _AiConnector(text="```sql\nSELECT 1\n```")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "select everything"}],
        locale="en",
    )  # type: ignore[arg-type]
    system = conn.seen["system"]
    assert system.endswith("- Write your explanations and questions in **English**.")
    # 규칙 본문은 그대로 한국어다 — 번역한 것이 아니라 출력 언어만 덧붙였다.
    assert "```sql 코드블록" in system


def test_unknown_locale_falls_back_to_korean(monkeypatch) -> None:
    # 지시를 아예 빼면 모델이 제멋대로 고른다 — 모르는 값은 ko 로 떨군다.
    conn = _AiConnector(text="ok")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "hi"}],
        locale="ja",
    )  # type: ignore[arg-type]
    assert conn.seen["system"].endswith("- 설명과 질문은 **한국어**로 작성하라.")


def test_interpret_prompt_does_not_pin_output_language(monkeypatch) -> None:
    # 본문이 "한국어로 해석한다"를 박아 두면 en 요청에서 지시가 충돌한다.
    conn = _AiConnector(text="요약")
    _patch(monkeypatch, ai_conn=_Conn("gemini"), connector=conn)
    svc.chat(
        None,
        ai_connection_id="ai",
        messages=[{"role": "user", "content": "결과 표: ..."}],
        intent="sql.interpret",
        locale="en",
    )  # type: ignore[arg-type]
    body = conn.seen["system"].rsplit("\n\n", 1)[0]  # 마지막 언어 지시 줄을 뺀 본문
    assert "한국어" not in body
