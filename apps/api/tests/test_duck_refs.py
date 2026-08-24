"""DuckDB 연합 조회의 참조 재작성 규칙.

여기서 고정하는 계약은 하나다 — **사용자가 쓴 `연결이름.…` 이 DuckDB 가 아는 이름으로
정확히 바뀌고, 그 외에는 한 글자도 건드리지 않는다.** 재작성이 과하면 멀쩡한 쿼리가
깨지고, 모자라면 "카탈로그가 없다"는 알 수 없는 오류가 난다.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from eai_api.models import Connection
from eai_api.services import duck_service as duck
from eai_api.services.duck_service import DuckError
from eai_api.services.errors import ValidationError


def _conn(name: str, ctype: str, **cfg: Any) -> Connection:
    c = Connection(name=name, type=ctype, config={"host": "h", "user": "u", **cfg})
    c.id = f"id-{name}"
    return c


@pytest.fixture(autouse=True)
def _stub_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    """DB 없이 돌린다 — 검증 대상은 파싱·재작성이지 조회가 아니다."""
    conns = [
        _conn("mysql_wms", "mysql", database="wms"),
        _conn("postgre_mes", "postgres", database="mes"),
        _conn("운영 MySQL", "mysql", database="prod"),
        _conn("sqlsrv", "mssql", database="shop"),
    ]
    monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
    monkeypatch.setattr(duck, "resolve_config", lambda _s, c: {**c.config, "password": "pw"})


def rewrite(sql: str) -> tuple[str, list[duck.AttachPlan]]:
    return duck.rewrite(object(), sql)  # type: ignore[arg-type]


class TestShape:
    def test_mysql_keeps_the_database_as_a_schema(self) -> None:
        """MySQL 은 커넥션 하나로 서버 전체가 보인다 — 데이터베이스가 곧 DuckDB 스키마다."""
        sql, plans = rewrite("select * from mysql_wms.wms.aaa")
        alias = plans[0].alias
        assert sql == f'select * from "{alias}"."wms"."aaa"'
        assert len(plans) == 1

    def test_postgres_absorbs_the_database_into_the_attach(self) -> None:
        """PostgreSQL 은 커넥션이 DB 하나에 묶인다 — 그 자리는 ATTACH 가 먹고 사라진다."""
        sql, plans = rewrite("select * from postgre_mes.mes.k123.bbb")
        alias = plans[0].alias
        assert sql == f'select * from "{alias}"."k123"."bbb"'
        assert plans[0].database == "mes"

    def test_heterogeneous_join_attaches_both(self) -> None:
        sql, plans = rewrite(
            "select a.code, b.name\n"
            "from mysql_wms.wms.aaa a\n"
            "join postgre_mes.mes.k123.bbb b on b.id = a.id"
        )
        assert len(plans) == 2
        assert {p.connection_type for p in plans} == {"mysql", "postgres"}
        assert "mysql_wms" not in sql and "postgre_mes" not in sql
        assert "a.code" in sql and "b.name" in sql  # 별칭은 그대로 남는다

    def test_same_connection_twice_attaches_once(self) -> None:
        _, plans = rewrite(
            "select * from mysql_wms.wms.aaa union all select * from mysql_wms.other.aaa"
        )
        assert len(plans) == 1  # MySQL 은 서버 하나 = 카탈로그 하나

    def test_postgres_second_database_attaches_again(self) -> None:
        """PostgreSQL 커넥션은 DB 하나만 본다 — 다른 DB 는 따로 붙어야 한다."""
        _, plans = rewrite(
            "select * from postgre_mes.mes.k123.bbb "
            "union all select * from postgre_mes.hist.k123.bbb"
        )
        assert sorted(p.database for p in plans) == ["hist", "mes"]
        assert len({p.alias for p in plans}) == 2


class TestWhatItRefusesToTouch:
    def test_plain_sql_is_untouched(self) -> None:
        sql = "select t.a, t.b from some_table t where t.a > 1"
        assert rewrite(sql) == (sql, [])

    def test_alias_sharing_a_connection_name_is_left_alone(self) -> None:
        """2단계는 손대지 않는다 — 연결 이름과 같은 별칭 쪽이 훨씬 흔하다."""
        sql = "select mysql_wms.col from t mysql_wms"
        assert rewrite(sql)[0] == sql

    def test_string_literals_are_not_rewritten(self) -> None:
        sql = "select * from mysql_wms.wms.aaa where note = 'postgre_mes.mes.k123.bbb'"
        out, plans = rewrite(sql)
        assert "'postgre_mes.mes.k123.bbb'" in out
        assert len(plans) == 1

    def test_comments_are_not_rewritten(self) -> None:
        sql = "-- postgre_mes.mes.k123.bbb\n/* mysql_wms.wms.aaa */\nselect 1 from mysql_wms.wms.aaa"
        out, plans = rewrite(sql)
        assert "-- postgre_mes.mes.k123.bbb" in out
        assert "/* mysql_wms.wms.aaa */" in out
        assert len(plans) == 1

    def test_unknown_head_is_left_for_duckdb_to_complain_about(self) -> None:
        sql = "select * from nope.db.tbl"
        assert rewrite(sql) == (sql, [])


class TestOmittedDatabase:
    """PostgreSQL·MSSQL 은 데이터베이스를 생략할 수 있다 — 연결이 이미 알고 있어서다.

    두 형태가 헷갈리지 않는 이유는 그 엔진의 테이블이 **반드시 스키마 안에** 있기 때문이다.
    3단계는 `스키마.테이블`, 4단계는 `데이터베이스.스키마.테이블` — 달리 읽힐 여지가 없다.
    """

    def test_postgres_three_parts_uses_the_connection_database(self) -> None:
        short, plans = rewrite("select * from postgre_mes.k123.bbb")
        full, _ = rewrite("select * from postgre_mes.mes.k123.bbb")
        assert short == full  # 같은 곳을 가리킨다
        assert plans[0].database == "mes"  # 연결 설정의 데이터베이스

    def test_mssql_three_parts_uses_the_connection_database(self) -> None:
        short, plans = rewrite("select * from sqlsrv.dbo.customers")
        full, _ = rewrite("select * from sqlsrv.shop.dbo.customers")
        assert short == full
        assert plans[0].database == "shop"

    def test_omitting_is_refused_when_the_connection_has_no_database(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """생략은 연결이 데이터베이스를 알고 있을 때만 뜻이 있다. 아무거나 지어 넣으면 안 된다."""
        bare = Connection(name="pg_bare", type="postgres", config={"host": "h", "user": "u"})
        bare.id = "id-pg_bare"
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: [bare])
        with pytest.raises(DuckError) as exc:
            rewrite("select * from pg_bare.public.t")
        assert "데이터베이스" in str(exc.value)

    def test_mysql_has_no_short_form(self) -> None:
        """`연결.테이블` 2단계는 `별칭.컬럼` 과 구별할 수 없다 — 그래서 손대지 않는다."""
        sql = "select * from mysql_wms.aaa"
        assert rewrite(sql) == (sql, [])


class TestWrongShapeIsLoud:
    def test_postgres_written_as_five_parts(self) -> None:
        with pytest.raises(DuckError) as exc:
            rewrite("select * from postgre_mes.mes.k123.bbb.extra")
        assert "스키마" in str(exc.value)  # 기대하는 모양을 알려 준다

    def test_mysql_written_as_four_parts(self) -> None:
        with pytest.raises(DuckError) as exc:
            rewrite("select * from mysql_wms.wms.dbo.aaa")
        assert "3단계" in str(exc.value)


class TestMssql:
    """SQL Server 는 커뮤니티 확장(`INSTALL mssql FROM community`)으로 붙는다.
    구조는 PostgreSQL 과 같다 — 커넥션이 데이터베이스 하나에 묶이고 그 안에 스키마가 있다."""

    def test_four_parts_with_the_database_absorbed_by_the_attach(self) -> None:
        sql, plans = rewrite("select * from sqlsrv.shop.dbo.customers")
        alias = plans[0].alias
        assert sql == f'select * from "{alias}"."dbo"."customers"'
        assert plans[0].database == "shop"
        assert plans[0].connection_type == "mssql"

    def test_secret_uses_the_mssql_type_and_default_port(self) -> None:
        sql = duck._build_secret("s", "mssql", {"host": "h", "user": "u", "password": "p"}, "shop")
        assert sql.startswith("CREATE OR REPLACE SECRET s (TYPE MSSQL")
        assert "PORT 1433" in sql

    def test_no_ssl_option_is_emitted_for_mssql(self) -> None:
        """MSSQL 시크릿에는 sslmode 계열 옵션이 없다 — 넣으면 시크릿 생성 자체가 거부된다."""
        sql = duck._build_secret("s", "mssql", {"host": "h", "ssl": True}, "shop")
        assert "SSL" not in sql

    def test_mssql_extension_comes_from_the_community_repo(self) -> None:
        """코어가 아니라 커뮤니티 확장이라 `FROM community` 없이는 못 받는다."""
        assert duck._EXTENSION["mssql"] == ("mssql", True)
        assert duck._EXTENSION["postgres"][1] is False


class TestQuotedNames:
    def test_quoted_connection_name_with_space(self) -> None:
        """연결 이름에 공백·한글이 들어갈 수 있다 — 큰따옴표로 경계를 준다."""
        sql, plans = rewrite('select * from "운영 MySQL".prod.orders')
        assert plans and plans[0].connection_name == "운영 MySQL"
        assert f'"{plans[0].alias}"."prod"."orders"' in sql

    def test_name_match_ignores_case_and_padding(self) -> None:
        _, plans = rewrite("select * from MYSQL_WMS.wms.aaa")
        assert len(plans) == 1

    def test_identifier_quotes_are_escaped_in_output(self) -> None:
        sql, _ = rewrite('select * from mysql_wms.wms."od""d"')
        assert '"od""d"' in sql


class TestGuard:
    @pytest.mark.parametrize(
        "sql",
        [
            "select * from mysql_wms.wms.aaa; drop table x",
            "insert into mysql_wms.wms.aaa values (1)",
            "attach 'x' as y",
        ],
    )
    def test_writes_and_multi_statements_are_refused(self, sql: str) -> None:
        with pytest.raises(ValidationError):
            duck.ensure_duck_select_only(sql)

    def test_local_file_reads_are_refused(self) -> None:
        """`disabled_filesystems` 가 마지막 방어선이지만 여기서 먼저 끊는다."""
        with pytest.raises(DuckError):
            duck.ensure_duck_select_only("select * from read_csv_auto('/etc/passwd')")

    def test_a_plain_select_passes(self) -> None:
        sql = "with x as (select 1 as a) select * from x"
        assert duck.ensure_duck_select_only(sql) == sql


class TestSecret:
    def test_password_is_a_sql_literal(self) -> None:
        """따옴표가 든 비밀번호도 안전해야 한다 — 시크릿 옵션은 평범한 문자열 리터럴이다."""
        sql = duck._build_secret("s", "postgres", {"host": "h", "user": "u", "password": "p'w x"}, "mes")
        assert "PASSWORD 'p''w x'" in sql
        assert "DATABASE 'mes'" in sql
        assert sql.startswith("CREATE OR REPLACE SECRET s (TYPE POSTGRES")

    def test_port_is_a_number_not_a_string(self) -> None:
        """MySQL 확장은 포트를 정수로 읽는다 — 문자열이면 붙는 것 자체가 실패한다."""
        sql = duck._build_secret("s", "mysql", {"host": "h", "port": 3307, "user": "u"}, "wms")
        assert "PORT 3307" in sql and "PORT '3307'" not in sql

    def test_ssl_option_differs_by_engine(self) -> None:
        pg = duck._build_secret("s", "postgres", {"host": "h", "ssl": True}, "mes")
        my = duck._build_secret("s", "mysql", {"host": "h", "ssl": True}, "wms")
        assert "SSLMODE 'require'" in pg
        assert "SSL_MODE 'required'" in my

    def test_blank_fields_are_dropped(self) -> None:
        """비밀번호 없는 계정(trust/소켓 인증)도 있다 — 빈 값을 실으면 그쪽이 깨진다."""
        sql = duck._build_secret("s", "postgres", {"host": "h", "user": "u", "password": ""}, "mes")
        assert "PASSWORD" not in sql

    def test_scrub_strips_a_password_the_driver_echoed_back(self) -> None:
        assert "s3cret" not in duck._scrub("could not connect password=s3cret host=h")
        assert "s3cret" not in duck._scrub("failed: PASSWORD='s3cret' host=h")


class TestHyphenatedNames:
    """연결 이름에 하이픈이 흔하다 (`pg-target`, `src-shop`). SQL 에서 하이픈은 빼기라
    인용 없이는 참조가 성립하지 않는다 — 그 사실을 **안내가 짚어 줘야** 한다."""

    def test_a_hyphenated_name_needs_quotes_to_resolve(self, monkeypatch: pytest.MonkeyPatch) -> None:
        conns = [_conn("pg-target", "postgres", database="warehouse")]
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
        monkeypatch.setattr(duck, "_all_connections", lambda _s: conns)
        assert rewrite("select * from pg-target.warehouse.public.t")[1] == []
        assert len(rewrite('select * from "pg-target".warehouse.public.t')[1]) == 1

    def test_the_error_names_the_connection_and_says_to_quote_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        conns = [_conn("pg-target", "postgres", database="warehouse")]
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
        monkeypatch.setattr(duck, "_all_connections", lambda _s: conns)
        err = duck.no_reference_error(object(), "select * from pg-target.warehouse.public.t")  # type: ignore[arg-type]
        assert '"pg-target"' in str(err)

    def test_the_available_list_is_copy_pasteable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """목록을 그대로 옮겨 적었는데 안 되는 것만큼 나쁜 안내가 없다."""
        conns = [_conn("src-shop", "mysql", database="shop"), _conn("plain", "mysql", database="d")]
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
        listed = duck._available(object())  # type: ignore[arg-type]
        assert '"src-shop"' in listed
        assert '"plain"' not in listed and "plain" in listed  # 멀쩡한 이름은 감싸지 않는다

    def test_display_name_matches_the_frontend_rule(self) -> None:
        assert duck.display_name("mysql_wms") == "mysql_wms"
        assert duck.display_name("pg-target") == '"pg-target"'
        assert duck.display_name("운영 MySQL") == '"운영 MySQL"'


class TestUnsupportedConnection:
    def test_pointing_at_mongo_says_so_instead_of_not_found(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """붙일 수 없는 연결은 목록에 아예 없어서, 사용자는 이름을 잘못 썼다고만 의심하게 된다."""
        mongo = _conn("docs", "mongo", database="shop")
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: [])
        monkeypatch.setattr(duck, "_all_connections", lambda _s: [mongo])
        err = duck.no_reference_error(object(), "select * from docs.shop.orders")  # type: ignore[arg-type]
        assert "docs" in str(err) and "mongo" in str(err)
        assert "MySQL" in str(err)


class TestWrongTabHint:
    """연합 조회 표기를 **일반 쿼리 탭**에 붙여 넣으면 엔진은 "그런 개체 없음"이라고만
    답한다. 표기가 틀린 게 아니라 탭을 잘못 골랐다는 걸 알려 줘야 한다."""

    def test_hint_fires_for_a_saved_connection_name(self, monkeypatch: pytest.MonkeyPatch) -> None:
        conns = [_conn("src-shop", "mysql", database="shop")]
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
        hint = duck.federation_reference_hint(object(), 'SELECT * FROM "src-shop".shop.customers')  # type: ignore[arg-type]
        assert "연합 조회" in hint and "src-shop" in hint

    def test_hint_also_fires_without_quotes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        conns = [_conn("dev_sb_vn", "mysql", database="dev")]
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
        assert duck.federation_reference_hint(object(), "select * from dev_sb_vn.dev.t")  # type: ignore[arg-type]

    def test_plain_sql_gets_no_hint(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """멀쩡한 쿼리의 오류 메시지에 엉뚱한 안내가 붙으면 그게 더 헷갈린다."""
        conns = [_conn("src-shop", "mysql", database="shop")]
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
        assert duck.federation_reference_hint(object(), "select * from dbo.customers") == ""  # type: ignore[arg-type]

    def test_a_name_inside_a_string_literal_gets_no_hint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        conns = [_conn("src-shop", "mysql", database="shop")]
        monkeypatch.setattr(duck, "_duck_connections", lambda _s: conns)
        sql = "select * from t where note = 'src-shop.shop.customers'"
        assert duck.federation_reference_hint(object(), sql) == ""  # type: ignore[arg-type]


class TestMemoryLimitMessage:
    """메모리가 모자라 스필하려다 파일 잠금에 막히면 DuckDB 는 파일 시스템 이야기를 한다.
    사용자가 한 일은 조인이 컸던 것뿐이라 그 문구로는 무엇을 고쳐야 할지 알 수 없다."""

    def test_spill_block_is_translated_to_a_memory_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # 실제 설정을 읽지 않는다 — 이 테스트가 EAI_JWT_SECRET 유무에 따라 갈리면 안 된다.
        monkeypatch.setattr(
            duck, "get_settings", lambda: SimpleNamespace(duckdb_memory_limit="1GB")
        )
        msg = duck._memory_limit_message()
        assert "1GB" in msg
        assert "메모리 상한" in msg
        assert "WHERE" in msg  # 무엇을 하라는지까지 말해 준다
        assert "EAI_DUCKDB_MEMORY_LIMIT" in msg

    def test_the_marker_matches_what_duckdb_actually_says(self) -> None:
        """DuckDB 1.5.5 원문. 이 문구가 바뀌면 번역이 조용히 멈춘다."""
        actual = "Permission Error: File system LocalFileSystem has been disabled by configuration"
        assert duck._SPILL_BLOCKED in actual
