"""MSSQL · MongoDB 커넥터 (Phase 2).

실제 서버 없이 검증 가능한 부분 — 문장 생성, 설정 검증, 문서 정규화.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from eai_connectors import MongoConnector, MsSqlConnector, ReadSpec, RecordBatch, WriteMode, WriteSpec
from eai_connectors.errors import ConfigurationError
from eai_connectors.mongo import _infer_columns, _normalize, _parse_filter


@pytest.fixture
def mssql() -> MsSqlConnector:
    return MsSqlConnector(host="h", database="d", user="u", password="p")


class TestMsSql:
    def test_default_port(self, mssql: MsSqlConnector) -> None:
        assert mssql.port == 1433

    def test_odbc_driver_lands_in_url(self, mssql: MsSqlConnector) -> None:
        assert mssql.url_query()["driver"] == "ODBC Driver 18 for SQL Server"

    def test_odbc_driver_is_overridable(self) -> None:
        conn = MsSqlConnector(
            host="h", database="d", user="u", password="p", odbc_driver="ODBC Driver 17 for SQL Server"
        )
        assert conn.url_query()["driver"] == "ODBC Driver 17 for SQL Server"

    def test_encrypt_follows_ssl_flag(self) -> None:
        secure = MsSqlConnector(host="h", database="d", user="u", password="p", ssl=True)
        plain = MsSqlConnector(host="h", database="d", user="u", password="p", ssl=False)
        assert secure.url_query()["Encrypt"] == "yes"
        assert plain.url_query()["Encrypt"] == "no"

    def test_certificate_trust_can_be_turned_off(self) -> None:
        strict = MsSqlConnector(
            host="h", database="d", user="u", password="p", trust_server_certificate=False
        )
        assert strict.url_query()["TrustServerCertificate"] == "no"

    def test_merge_statement_shape(self, mssql: MsSqlConnector) -> None:
        sql = mssql._upsert_sql("customers", "dbo", ["id", "name", "grade"], ["id"])
        assert sql.startswith("MERGE INTO")
        assert "WHEN MATCHED THEN UPDATE SET" in sql
        assert "WHEN NOT MATCHED THEN INSERT" in sql
        # MERGE 는 세미콜론이 없으면 문법 오류다
        assert sql.rstrip().endswith(";")

    def test_merge_excludes_key_from_update(self, mssql: MsSqlConnector) -> None:
        sql = mssql._upsert_sql("t", None, ["id", "name"], ["id"])
        assert "target.name = source.name" in sql
        assert "target.id = source.id" in sql.split("WHEN MATCHED")[0]  # ON 절에는 있어야 한다
        assert "target.id = source.id" not in sql.split("WHEN MATCHED")[1]  # UPDATE 절에는 없어야 한다

    def test_merge_without_updatable_columns_skips_matched_clause(self, mssql: MsSqlConnector) -> None:
        sql = mssql._upsert_sql("t", None, ["id"], ["id"])
        assert "WHEN MATCHED" not in sql
        assert "WHEN NOT MATCHED THEN INSERT" in sql

    def test_merge_requires_keys(self, mssql: MsSqlConnector) -> None:
        with pytest.raises(ConfigurationError, match="key_columns"):
            mssql._upsert_sql("t", None, ["a"], [])


class TestMongoConstruction:
    def test_database_required(self) -> None:
        with pytest.raises(ConfigurationError, match="database"):
            MongoConnector(host="h", database="")

    def test_host_or_uri_required(self) -> None:
        with pytest.raises(ConfigurationError):
            MongoConnector(host="", database="d")

    def test_uri_alone_is_enough(self) -> None:
        conn = MongoConnector(host="", uri="mongodb://x:27017", database="d")
        assert conn.uri == "mongodb://x:27017"

    def test_read_requires_collection(self) -> None:
        conn = MongoConnector(host="h", database="d")
        with pytest.raises(ConfigurationError, match="컬렉션"):
            list(conn.read(ReadSpec(query='{"a": 1}', table=None)))

    def test_write_requires_collection(self) -> None:
        conn = MongoConnector(host="h", database="d")
        with pytest.raises(ConfigurationError, match="컬렉션"):
            conn.write(RecordBatch(rows=[{"a": 1}]), WriteMode.APPEND)

    def test_upsert_requires_key_columns(self) -> None:
        conn = MongoConnector(host="h", database="d", write_spec=WriteSpec(table="c"))
        with pytest.raises(ConfigurationError, match="key_columns"):
            conn.write(RecordBatch(rows=[{"a": 1}]), WriteMode.UPSERT)

    def test_empty_batch_writes_nothing(self) -> None:
        conn = MongoConnector(host="h", database="d", write_spec=WriteSpec(table="c"))
        assert conn.write(RecordBatch(rows=[]), WriteMode.APPEND).records_written == 0


class TestMongoFilter:
    def test_empty_filter_means_all(self) -> None:
        assert _parse_filter(None) == {}
        assert _parse_filter("   ") == {}

    def test_json_object_is_parsed(self) -> None:
        assert _parse_filter('{"status": "active"}') == {"status": "active"}

    def test_operators_are_preserved(self) -> None:
        assert _parse_filter('{"age": {"$gt": 20}}') == {"age": {"$gt": 20}}

    def test_invalid_json_rejected(self) -> None:
        with pytest.raises(ConfigurationError, match="JSON"):
            _parse_filter("{status: active}")

    def test_non_object_rejected(self) -> None:
        with pytest.raises(ConfigurationError, match="객체"):
            _parse_filter("[1, 2, 3]")


class TestMongoNormalize:
    def test_objectid_becomes_string(self) -> None:
        """ObjectId 를 그대로 두면 Parquet 직렬화와 DB 적재가 모두 깨진다."""
        from bson import ObjectId

        oid = ObjectId()
        assert _normalize({"_id": oid}) == {"_id": str(oid)}

    def test_decimal128_becomes_decimal(self) -> None:
        from decimal import Decimal

        from bson.decimal128 import Decimal128

        assert _normalize({"amt": Decimal128("12.34")}) == {"amt": Decimal("12.34")}

    def test_nested_documents_are_normalized(self) -> None:
        from bson import ObjectId

        oid = ObjectId()
        assert _normalize({"meta": {"ref": oid}}) == {"meta": {"ref": str(oid)}}

    def test_objectids_inside_lists_are_normalized(self) -> None:
        from bson import ObjectId

        oid = ObjectId()
        assert _normalize({"refs": [oid]}) == {"refs": [str(oid)]}

    def test_ordinary_values_pass_through(self) -> None:
        ts = datetime(2026, 7, 1, tzinfo=UTC)
        row = {"name": "김도영", "n": 1, "ok": True, "ts": ts, "none": None}
        assert _normalize(row) == row


class TestMongoSchemaInference:
    def test_empty_sample_yields_no_columns(self) -> None:
        assert _infer_columns([]) == []

    def test_field_present_in_every_document_is_not_nullable(self) -> None:
        columns = {c.name: c for c in _infer_columns([{"a": 1}, {"a": 2}])}
        assert columns["a"].nullable is False

    def test_field_missing_from_some_documents_is_nullable(self) -> None:
        columns = {c.name: c for c in _infer_columns([{"a": 1}, {"b": 2}])}
        assert columns["a"].nullable is True
        assert columns["b"].nullable is True

    def test_id_is_marked_primary_key(self) -> None:
        columns = {c.name: c for c in _infer_columns([{"_id": 1, "x": 2}])}
        assert columns["_id"].primary_key is True
        assert columns["x"].primary_key is False

    def test_mixed_types_are_reported_together(self) -> None:
        columns = {c.name: c for c in _infer_columns([{"v": 1}, {"v": "text"}])}
        assert columns["v"].data_type == "int | str"


class TestRegistry:
    def test_new_types_are_registered(self) -> None:
        from eai_connectors import supported_types

        assert set(supported_types()) == {
            "mysql", "postgres", "mssql", "mongo", "sap_rfc", "s3", "local_file",
            "gemini", "bedrock", "ollama",
        }

    def test_build_mssql(self) -> None:
        from eai_connectors import build

        conn = build("mssql", {"host": "h", "database": "d", "user": "u", "password": "p"})
        assert isinstance(conn, MsSqlConnector)

    def test_build_mongo_accepts_its_own_keys(self) -> None:
        from eai_connectors import build

        conn = build("mongo", {"host": "h", "database": "d", "replica_set": "rs0", "auth_source": "admin"})
        assert isinstance(conn, MongoConnector)
        assert conn.replica_set == "rs0"
        assert conn.auth_source == "admin"
        assert conn.extra == {}  # 알려진 키는 extra 로 새지 않아야 한다
