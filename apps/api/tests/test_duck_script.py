"""연합 조회 → 파이썬 코드.

여기서 고정하는 계약은 둘이다. **붙여 넣고 바로 돌아가야 하고**(편집기 문법이 아니라
DuckDB 가 아는 이름이 들어가야 한다), **비밀번호가 절대 실리면 안 된다**(코드는 복사되고
커밋된다 — 한 번 새면 되돌릴 수 없다).
"""

from __future__ import annotations

import ast
from typing import Any

import pytest

from eai_api.models import Connection
from eai_api.services import duck_script
from eai_api.services import duck_service as duck
from eai_api.services.errors import ValidationError


def _conn(name: str, ctype: str, **cfg: Any) -> Connection:
    c = Connection(
        name=name, type=ctype, config={"host": "db.local", "user": "svc", **cfg}
    )
    c.id = f"id-{name}"
    return c


CONNS = [
    _conn("mysql_wms", "mysql", database="wms", port=3307),
    _conn("postgre-mes", "postgres", database="mes"),
    _conn("운영 MySQL", "mysql", database="prod"),
]


class _Scalars(list):  # type: ignore[type-arg]
    def scalars(self) -> list[Connection]:
        return list(self)


class FakeSession:
    """`get`(연결 조회)과 `execute`(오류 안내가 훑는 전체 목록)만 흉내 낸다."""

    def get(self, _model: Any, cid: str) -> Connection | None:
        return next((c for c in CONNS if c.id == cid), None)

    def execute(self, _stmt: Any) -> _Scalars:
        return _Scalars(CONNS)


@pytest.fixture(autouse=True)
def _stub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(duck, "_duck_connections", lambda _s: CONNS)
    monkeypatch.setattr(
        duck, "resolve_config", lambda _s, c: {**c.config, "password": "s3cr3t-pw"}
    )


def build(sql: str) -> str:
    return duck.build_python_script(FakeSession(), query=sql)  # type: ignore[arg-type]


class TestItRuns:
    def test_the_output_is_valid_python(self) -> None:
        ast.parse(build("select * from mysql_wms.wms.aaa"))

    def test_editor_syntax_is_gone_and_duckdb_names_are_in(self) -> None:
        """편집기 문법은 EAI 안에서만 통한다 — 밖에서 돌리려면 카탈로그 이름이어야 한다."""
        code = build('select * from "postgre-mes".mes.k123.bbb')
        assert '"postgre-mes".mes.k123.bbb' not in code
        assert '"postgre_mes"."k123"."bbb"' in code

    def test_every_referenced_connection_becomes_a_catalog(self) -> None:
        code = build(
            'select * from mysql_wms.wms.aaa a join "postgre-mes".mes.k123.bbb b on b.id=a.id'
        )
        assert code.count("'password_env'") == 2
        assert "'MYSQL'" in code and "'POSTGRES'" in code

    def test_community_extension_is_flagged_so_install_adds_from_community(self) -> None:
        conn = _conn("sqlsrv", "mssql", database="shop")
        CONNS.append(conn)
        try:
            code = build("select * from sqlsrv.shop.dbo.customers")
            assert "'community': True" in code
            assert "FROM community" in code  # 템플릿의 INSTALL 분기
        finally:
            CONNS.remove(conn)


class TestNoSecrets:
    def test_the_password_never_appears(self) -> None:
        code = build("select * from mysql_wms.wms.aaa")
        assert "s3cr3t-pw" not in code

    def test_an_env_var_stands_in_for_it(self) -> None:
        code = build("select * from mysql_wms.wms.aaa")
        assert "EAI_PW_MYSQL_WMS" in code
        assert "os.environ.get" in code

    def test_non_secret_config_is_kept(self) -> None:
        """접속 정보까지 빼면 붙여 넣어도 못 돌린다 — 비밀번호만 뺀다."""
        code = build("select * from mysql_wms.wms.aaa")
        assert "'HOST': 'db.local'" in code
        assert "'PORT': 3307" in code
        assert "'USER': 'svc'" in code


class TestReadableAliases:
    def test_alias_comes_from_the_connection_name(self) -> None:
        """실행 경로의 해시 별칭(eai_37e8…)이 늘어서 있으면 어느 연결인지 알 수 없다."""
        code = build('select * from "postgre-mes".mes.k123.bbb')
        assert "'alias': 'postgre_mes'" in code  # 하이픈을 밑줄로 다듬는다
        assert "eai_" not in code

    def test_names_that_are_not_identifiers_are_tidied(self) -> None:
        code = build('select * from "운영 MySQL".prod.orders')
        assert "'alias': 'mysql'" in code  # 한글·공백을 걷어낸 나머지
        assert "# 운영 MySQL (mysql)" in code  # 원래 이름은 주석으로 남는다

    def test_two_connections_that_tidy_to_the_same_name_do_not_collide(self) -> None:
        a, b = _conn("wms-db", "postgres", database="one"), _conn("wms db", "postgres", database="two")
        CONNS.extend([a, b])
        try:
            code = build('select x.* from "wms-db".one.public.t x, "wms db".two.public.t y')
            assert "'alias': 'wms_db'" in code
            assert "'alias': 'wms_db_two'" in code or "'alias': 'wms_db_2'" in code
        finally:
            CONNS.remove(a)
            CONNS.remove(b)

    def test_the_same_table_twice_gets_one_catalog(self) -> None:
        code = build(
            "select * from mysql_wms.wms.aaa a join mysql_wms.wms.bbb b on b.id=a.id"
        )
        assert code.count("'password_env'") == 1


class TestGuard:
    def test_a_write_is_refused_before_any_code_is_made(self) -> None:
        with pytest.raises(ValidationError):
            build("insert into mysql_wms.wms.aaa values (1)")

    def test_a_query_with_no_connection_reference_is_refused(self) -> None:
        with pytest.raises(duck.DuckError):
            build("select 1")


def test_password_env_name_is_a_valid_shell_variable() -> None:
    assert duck_script.password_env("postgre_mes") == "EAI_PW_POSTGRE_MES"
    assert duck_script.password_env("wms-db") == "EAI_PW_WMS_DB"
