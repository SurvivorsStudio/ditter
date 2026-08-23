"""쿼리 편집기의 명령 가드 — 연결이 허용한 명령만 실행되어야 한다.

이 가드는 사용자 DB 자격증명으로 임의 SQL 이 실행되는 것을 막는 안전장치다.
허용 명령은 연결마다 체크박스로 정하고, 설정이 없으면 읽기 전용이다.
연결·DB 없이 순수하게 검증할 수 있어 유닛 테스트로 다룬다.
"""

from __future__ import annotations

import pytest

from eai_api.models import Connection
from eai_api.services.connection_service import (
    DEFAULT_STATEMENTS,
    SQL_STATEMENTS,
    connection_statements,
    ensure_select_only,
    ensure_statement_allowed,
    normalize_statements,
    validated_config,
)
from eai_api.services.errors import ValidationError

READ_ONLY = frozenset({"select"})


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1",
        "select * from mara",
        "  SELECT a, b FROM t WHERE x = 1  ",
        "SELECT * FROM t;",  # 끝 세미콜론은 허용 (하나만)
        "WITH x AS (SELECT 1) SELECT * FROM x",
        "SELECT 'delete me' AS note FROM t",  # 리터럴 안 키워드는 오탐 안 함
        "SELECT count(*) FROM t -- delete\n",  # 주석 안 키워드도 오탐 안 함
        "/* 설비 조회\nSELECT * FROM x\n*/\n\nSELECT * FROM t",  # 맨 앞 블록주석 뒤 SELECT
        "-- 메모\nSELECT * FROM t",  # 맨 앞 라인주석 뒤 SELECT
        "/* c */ WITH x AS (SELECT 1) SELECT * FROM x",  # 주석 뒤 WITH
    ],
)
def test_allows_read_only_select(sql: str) -> None:
    out = ensure_select_only(sql)
    assert out and not out.endswith(";")


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM t",
        "UPDATE t SET x = 1",
        "INSERT INTO t VALUES (1)",
        "DROP TABLE t",
        "TRUNCATE t",
        "ALTER TABLE t ADD c int",
        "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",  # 데이터 변경 CTE
        "SELECT 1; DROP TABLE t",  # 다중문
        "SELECT 1; SELECT 2",  # 다중문
        "",  # 빈 문자열
        "   ",
        "/* 주석만 있음 */",  # 주석만 → 실행할 게 없음
        "-- 그냥 메모\n",
    ],
)
def test_rejects_writes_and_multi_statements(sql: str) -> None:
    with pytest.raises(ValidationError):
        ensure_select_only(sql)


# --------------------------------------------------------- 허용 명령 (체크박스)


@pytest.mark.parametrize(
    ("sql", "verb"),
    [
        ("UPDATE t SET x = 1", "update"),
        ("update t set x = 1 where id = 2", "update"),
        ("-- 메모\nUPDATE t SET x = 1", "update"),
    ],
)
def test_allows_statement_when_checked(sql: str, verb: str) -> None:
    q, got = ensure_statement_allowed(sql, frozenset({"select", "update"}))
    assert got == verb and q


def test_rejects_statement_not_checked() -> None:
    """UPDATE 만 켠 연결에서 DELETE 는 막힌다 — 켠 것만 된다."""
    with pytest.raises(ValidationError) as exc:
        ensure_statement_allowed("DELETE FROM t", frozenset({"select", "update"}))
    assert "DELETE" in str(exc.value)


def test_write_keyword_inside_allowed_statement_still_checked() -> None:
    """선두 명령이 통과해도 문장 안의 다른 쓰기까지 허용된 것은 아니다."""
    with pytest.raises(ValidationError):
        ensure_statement_allowed(
            "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
            frozenset({"select", "update"}),
        )


def test_grant_rejected_even_if_everything_checked() -> None:
    """권한 변경은 체크박스로도 켤 수 없다."""
    with pytest.raises(ValidationError):
        ensure_statement_allowed("GRANT SELECT ON t TO u", frozenset(SQL_STATEMENTS))


def test_unknown_command_rejected() -> None:
    with pytest.raises(ValidationError):
        ensure_statement_allowed("EXEC sp_who", frozenset(SQL_STATEMENTS))


def test_multi_statement_rejected_even_when_allowed() -> None:
    with pytest.raises(ValidationError):
        ensure_statement_allowed("UPDATE t SET x = 1; DROP TABLE t", frozenset(SQL_STATEMENTS))


# ------------------------------------------------------------------ 정규화·기본값


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (["update", "select"], ("select", "update")),  # 표시 순서로 고정
        (["SELECT", "Select"], ("select",)),  # 대소문자·중복
        ("select,update", ("select", "update")),  # CSV 도 받는다
        (None, DEFAULT_STATEMENTS),
    ],
)
def test_normalize_statements(raw: object, expected: tuple[str, ...]) -> None:
    assert normalize_statements(raw) == expected


@pytest.mark.parametrize("raw", [["selct"], [], "", {"select": True}, [1]])
def test_normalize_rejects_bad_values(raw: object) -> None:
    with pytest.raises(ValidationError):
        normalize_statements(raw)


def test_validated_config_normalizes_only_that_key() -> None:
    cfg = validated_config({"host": "db", "allowed_statements": ["UPDATE", "select"]})
    assert cfg == {"host": "db", "allowed_statements": ["select", "update"]}
    assert validated_config({"host": "db"}) == {"host": "db"}  # 없으면 그대로


def test_connection_without_setting_is_read_only() -> None:
    """이 기능 이전에 만든 연결은 SELECT 만 — 조용히 쓰기가 열리면 안 된다."""
    conn = Connection(id="c1", name="old", type="mysql", config={"host": "db"})
    assert connection_statements(conn) == frozenset({"select"})


def test_broken_setting_falls_back_to_read_only() -> None:
    conn = Connection(id="c2", name="broken", type="mysql", config={"allowed_statements": "선택"})
    assert connection_statements(conn) == frozenset({"select"})


def test_connection_statements_reads_setting() -> None:
    conn = Connection(
        id="c3", name="rw", type="mysql", config={"allowed_statements": ["select", "update"]}
    )
    assert connection_statements(conn) == frozenset({"select", "update"})
