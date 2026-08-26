"""SQL 커넥터 — upsert 문 생성과 스트리밍 동작.

실제 DB 없이 검증 가능한 부분만 다룬다. 실제 왕복은 통합 테스트 몫이다.
"""

from __future__ import annotations

import pytest

from eai_connectors import MySqlConnector, PostgresConnector, ReadSpec, RecordBatch, WriteMode, WriteSpec
from eai_connectors.errors import ConfigurationError, UnsupportedOperation
from eai_connectors.sql_base import SqlConnector, _bind_declared


@pytest.fixture
def pg() -> PostgresConnector:
    return PostgresConnector(host="h", database="d", user="u", password="p")


@pytest.fixture
def mysql() -> MySqlConnector:
    return MySqlConnector(host="h", database="d", user="u", password="p")


class TestConstruction:
    def test_default_ports(self, pg: PostgresConnector, mysql: MySqlConnector) -> None:
        assert pg.port == 5432
        assert mysql.port == 3306

    def test_host_required(self) -> None:
        with pytest.raises(ConfigurationError):
            PostgresConnector(host="", database="d", user="u", password="p")

    def test_database_required(self) -> None:
        with pytest.raises(ConfigurationError):
            MySqlConnector(host="h", database="", user="u", password="p")

    def test_password_not_in_repr_of_url_query(self, pg: PostgresConnector) -> None:
        # SQLAlchemy URL 은 str() 에서 비밀번호를 가린다 — 로그 유출 방지의 마지막 방어선
        assert "p" not in str(pg.url).split("@")[0].split(":")[-1] or "***" in str(pg.url)


class TestUpsertSql:
    def test_postgres_upsert_uses_on_conflict(self, pg: PostgresConnector) -> None:
        sql = pg._upsert_sql("customers", "demo", ["id", "name", "grade"], ["id"])
        assert "ON CONFLICT" in sql
        assert "DO UPDATE SET" in sql
        # 키 컬럼은 갱신 대상에서 빠져야 한다 — 갱신하면 매칭된 행의 정체성이 바뀐다
        assert "name = EXCLUDED.name" in sql
        assert "grade = EXCLUDED.grade" in sql
        assert "id = EXCLUDED.id" not in sql

    def test_postgres_all_key_columns_becomes_do_nothing(self, pg: PostgresConnector) -> None:
        sql = pg._upsert_sql("t", None, ["a", "b"], ["a", "b"])
        assert "DO NOTHING" in sql

    def test_postgres_upsert_requires_keys(self, pg: PostgresConnector) -> None:
        with pytest.raises(ConfigurationError):
            pg._upsert_sql("t", None, ["a"], [])

    def test_mysql_upsert_uses_on_duplicate_key(self, mysql: MySqlConnector) -> None:
        sql = mysql._upsert_sql("customers", None, ["id", "name"], ["id"])
        assert "ON DUPLICATE KEY UPDATE" in sql
        assert "name = VALUES(name)" in sql
        assert "id = VALUES(id)" not in sql

    def test_reserved_words_are_quoted(self, pg: PostgresConnector) -> None:
        """예약어·대문자 식별자는 반드시 인용돼야 한다 (그렇지 않으면 SQL 이 깨진다)."""
        sql = pg._insert_sql("order", None, ["select", "Name"])
        assert '"order"' in sql
        assert '"select"' in sql
        assert '"Name"' in sql

    def test_insert_sql_binds_every_column(self, pg: PostgresConnector) -> None:
        sql = pg._insert_sql("t", "s", ["a", "b"])
        assert ":a" in sql and ":b" in sql
        assert "INSERT INTO s.t" in sql


class TestWriteGuards:
    def test_write_without_table_raises(self, pg: PostgresConnector) -> None:
        with pytest.raises(ConfigurationError, match="table"):
            pg.write(RecordBatch(rows=[{"a": 1}]), WriteMode.APPEND)

    def test_upsert_without_keys_raises(self) -> None:
        conn = PostgresConnector(
            host="h", database="d", user="u", password="p", write_spec=WriteSpec(table="t")
        )
        with pytest.raises(ConfigurationError, match="key_columns"):
            conn.write(RecordBatch(rows=[{"a": 1}]), WriteMode.UPSERT)

    def test_empty_batch_writes_nothing(self) -> None:
        conn = PostgresConnector(
            host="h", database="d", user="u", password="p", write_spec=WriteSpec(table="t")
        )
        result = conn.write(RecordBatch(rows=[]), WriteMode.APPEND)
        assert result.records_written == 0


class TestWatermark:
    def test_max_watermark_picks_largest(self) -> None:
        rows = [{"ts": 3}, {"ts": 1}, {"ts": 7}]
        assert SqlConnector._max_watermark(rows, "ts") == 7

    def test_max_watermark_ignores_nulls(self) -> None:
        rows = [{"ts": None}, {"ts": 5}, {"ts": None}]
        assert SqlConnector._max_watermark(rows, "ts") == 5

    def test_max_watermark_all_null_is_none(self) -> None:
        assert SqlConnector._max_watermark([{"ts": None}], "ts") is None

    def test_no_column_means_no_watermark(self) -> None:
        assert SqlConnector._max_watermark([{"ts": 1}], None) is None


class TestS3Connector:
    def test_s3_read_is_unsupported(self) -> None:
        from eai_connectors import S3Connector

        conn = S3Connector(bucket="b")
        with pytest.raises(UnsupportedOperation):
            list(conn.read(ReadSpec(table="x")))

    def test_s3_upsert_is_unsupported(self) -> None:
        from eai_connectors import S3Connector

        conn = S3Connector(bucket="b", write_spec=WriteSpec(table="t"))
        with pytest.raises(UnsupportedOperation, match="upsert"):
            conn.write(RecordBatch(rows=[{"a": 1}]), WriteMode.UPSERT)

    def test_bucket_required(self) -> None:
        from eai_connectors import S3Connector

        with pytest.raises(ConfigurationError):
            S3Connector(bucket="")

    def test_unknown_format_rejected(self) -> None:
        from eai_connectors import S3Connector

        with pytest.raises(ConfigurationError, match="포맷"):
            S3Connector(bucket="b", write_spec=WriteSpec(file_format="avro"))

    def test_run_prefix_isolates_each_run(self) -> None:
        """실행 단위 경로 분리가 S3 멱등성의 근거다."""
        from eai_connectors import S3Connector

        a = S3Connector(bucket="b", write_spec=WriteSpec(path_prefix="raw", table="cust", run_id="R1"))
        b = S3Connector(bucket="b", write_spec=WriteSpec(path_prefix="raw", table="cust", run_id="R2"))
        assert a._run_prefix() == "raw/cust/run_id=R1"
        assert b._run_prefix() == "raw/cust/run_id=R2"
        assert a._run_prefix() != b._run_prefix()

    def test_serialize_jsonl_handles_korean_and_dates(self) -> None:
        # 직렬화 로직은 S3·로컬 파일이 공유하는 serialize 모듈에 있다
        from datetime import datetime

        from eai_connectors.serialize import serialize

        payload = serialize(
            "jsonl", [{"name": "김도영", "ts": datetime(2026, 7, 1)}], ["name", "ts"]
        )
        text = payload.decode("utf-8")
        assert "김도영" in text  # ensure_ascii=False 유지 확인
        assert "2026-07-01" in text

    def test_serialize_csv_uses_declared_columns(self) -> None:
        from eai_connectors.serialize import serialize

        payload = serialize("csv", [{"a": 1, "b": 2}], ["a", "b"])
        assert payload.decode("utf-8").splitlines()[0] == "a,b"


class TestRegistry:
    def test_build_rejects_unknown_type(self) -> None:
        from eai_connectors import build

        with pytest.raises(ConfigurationError, match="알 수 없는"):
            build("oracle", {})

    def test_build_passes_known_keys_and_bundles_rest(self) -> None:
        from eai_connectors import build

        conn = build(
            "postgres",
            {"host": "h", "database": "d", "user": "u", "password": "p", "weird_option": 1},
        )
        assert isinstance(conn, PostgresConnector)
        assert conn.extra == {"weird_option": 1}

    def test_supported_types(self) -> None:
        from eai_connectors import supported_types

        # Phase 2 에서 mssql·mongo, Phase 3 에서 sap_rfc,
        # 이후 AI(gemini·bedrock·ollama — 마지막은 로컬 오픈웨이트) 가 추가됐다
        assert set(supported_types()) == {
            "mysql", "postgres", "mssql", "mongo", "sap_rfc", "s3", "local_file",
            "gemini", "bedrock", "ollama",
        }


class TestCustomQueryBinding:
    """커스텀 SQL 의 바인드 파라미터 선별 (_bind_declared).

    ``ReadSpec.params`` 는 노드 파라미터를 통째로 담는다 — 커넥터별 옵션이 커넥터에 닿는
    유일한 통로라서다. 그래서 SQL 의 바인드 파라미터가 아닌 것(`query`·`connection_id`…)이
    섞여 들어오고, 그대로 묶으면 SQLAlchemy 가 거부한다.
    """

    def test_node_params_do_not_leak_into_binds(self) -> None:
        # 실제로 났던 오류: "This text() construct doesn't define a bound parameter named 'query'"
        stmt = _bind_declared(
            "SELECT * FROM shop.customers WHERE name = 'kim'",
            {"query": "SELECT ...", "connection_id": "c1", "batch_size": 5000},
        )
        assert stmt.compile().params == {}

    def test_declared_params_are_bound(self) -> None:
        stmt = _bind_declared("SELECT * FROM t WHERE a = :a", {"a": 1, "batch_size": 5000})
        assert stmt.compile().params == {"a": 1}

    def test_declared_but_missing_stays_unbound(self) -> None:
        """값이 없으면 묶지 않는다 — 실행 시점에 SQLAlchemy 가 알려주는 편이 낫다."""
        stmt = _bind_declared("SELECT * FROM t WHERE a = :a", {})
        assert stmt.compile().params == {"a": None}

    def test_only_declared_subset_is_bound(self) -> None:
        stmt = _bind_declared("SELECT * FROM t WHERE a = :a", {"a": 1, "b": 2})
        assert stmt.compile().params == {"a": 1}

    def test_quoted_literal_is_not_a_bind(self) -> None:
        """`'kim'` 처럼 따옴표 안의 값은 바인드가 아니다 — $변수 치환 결과가 이 모양이다."""
        stmt = _bind_declared("SELECT * FROM t WHERE name = 'kim'", {"name": "someone-else"})
        assert stmt.compile().params == {}
