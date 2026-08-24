"""결과 그리드 정렬·컬럼필터 래핑 로직 (SQL 인젝션 방지 포함)."""

from __future__ import annotations

from eai_api.services.connection_service import _apply_sort_filter, _escape_like


class _FakeConnector:
    """식별자 quoting 만 흉내내는 가짜 커넥터 (postgres 식 겹따옴표)."""

    def quote(self, identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'


def test_escape_like_escapes_wildcards() -> None:
    # 사용자 값의 % _ \ 는 리터럴로 취급되도록 이스케이프
    assert _escape_like("a%b_c\\d") == "a\\%b\\_c\\\\d"


def test_no_sort_no_filter_returns_original() -> None:
    exec_q, count_q, params = _apply_sort_filter(
        _FakeConnector(), "postgres", "SELECT 1", None, "asc", None
    )
    assert exec_q == count_q == "SELECT 1"
    assert params == {}


def test_filter_uses_bind_params_not_inlined() -> None:
    """필터 값은 바인드 파라미터로만 들어가고 SQL 문자열엔 리터럴로 박히지 않는다."""
    evil = "'; DROP TABLE users; --"
    exec_q, count_q, params = _apply_sort_filter(
        _FakeConnector(),
        "postgres",
        "SELECT * FROM t",
        None,
        "asc",
        [{"col": "name", "value": evil}],
    )
    # 값은 파라미터에만 있다 (쿼리 텍스트에 원문이 없다)
    assert evil not in exec_q
    assert any(evil.lower() in str(v).lower() for v in params.values())
    # 컬럼은 quoting 되고 대소문자 무시 LIKE
    assert '"name"' in exec_q
    assert "LIKE" in exec_q.upper()
    assert exec_q == count_q  # 필터만 있으면 정렬이 없어 exec==count


def test_sort_appends_order_by_only_to_exec() -> None:
    exec_q, count_q, _ = _apply_sort_filter(
        _FakeConnector(), "postgres", "SELECT * FROM t", "age", "desc", None
    )
    assert "ORDER BY" in exec_q.upper()
    assert '"age"' in exec_q
    assert exec_q.upper().rstrip().endswith("DESC")
    # 정렬은 건수에 영향 없으니 count 쿼리엔 ORDER BY 가 없어야 한다
    assert "ORDER BY" not in count_q.upper()


def test_bad_sort_dir_defaults_to_asc() -> None:
    exec_q, _, _ = _apply_sort_filter(
        _FakeConnector(), "postgres", "SELECT 1", "c", "; DROP", None
    )
    # 방향은 화이트리스트(ASC/DESC)로만 — 임의 문자열은 ASC 로
    assert exec_q.upper().rstrip().endswith("ASC")


def test_empty_filter_value_skipped() -> None:
    _, _, params = _apply_sort_filter(
        _FakeConnector(),
        "postgres",
        "SELECT 1",
        None,
        "asc",
        [{"col": "a", "value": ""}, {"col": "b", "value": "x"}],
    )
    # 빈 값 필터는 무시, 값 있는 것만 파라미터로
    assert len(params) == 1
