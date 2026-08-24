"""Phase 4b — Debezium 설정 빌더 · Kafka Connect 클라이언트 · CDC 소스 추출.

DB·네트워크 없이 순수하게 검증한다 (저장소 관례: 모든 테스트가 페이크 기반).
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from eai_api.schemas.dag import PipelineDefinition, PipelineEdge, PipelineNode
from eai_api.services import cdc_connect, cdc_service
from eai_api.services.errors import DependencyError, ValidationError

MYSQL_CONN = {"host": "db", "port": 3306, "user": "u", "password": "p", "database": "shop"}
PG_CONN = {"host": "db", "port": 5432, "user": "u", "password": "p", "database": "shop"}
MSSQL_CONN = {"host": "db", "user": "u", "password": "p", "database": "shop"}
SID = "11111111-2222-3333-4444-555555555555"


def cfg(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = dict(
        stream_id=SID, source_type="mysql", connection=MYSQL_CONN, tables=["orders", "customers"]
    )
    base.update(over)
    return cdc_connect.build_connector_config(**base)


class TestNaming:
    def test_topic_prefix_replaces_hyphens(self) -> None:
        assert cdc_connect.topic_prefix(SID) == "eai_11111111_2222_3333_4444_555555555555"

    def test_connector_name(self) -> None:
        assert cdc_connect.connector_name(SID) == f"eai.{SID}"

    def test_server_id_is_deterministic_and_in_range(self) -> None:
        a = cdc_connect._server_id(SID)
        assert a == cdc_connect._server_id(SID)
        assert 5400 <= a < 6400
        assert cdc_connect._server_id("other-id") != a  # 스트림마다 달라야 한다

    def test_topics_for_qualifies_tables(self) -> None:
        topics = cdc_connect.topics_for(SID, "mysql", "shop", ["orders", "customers"])
        assert topics == [
            "eai_11111111_2222_3333_4444_555555555555.shop.orders",
            "eai_11111111_2222_3333_4444_555555555555.shop.customers",
        ]

    def test_topics_for_postgres_defaults_to_public_schema(self) -> None:
        topics = cdc_connect.topics_for(SID, "postgres", "shop", ["orders"])
        assert topics[0].endswith(".public.orders")

    def test_topics_for_mssql_includes_database_and_dbo_schema(self) -> None:
        # SQL Server 토픽은 4단계다: prefix.database.schema.table (DB 를 한 단계 더 포함)
        topics = cdc_connect.topics_for(SID, "mssql", "shop", ["orders"])
        assert topics[0] == f"{cdc_connect.topic_prefix(SID)}.shop.dbo.orders"

    def test_topics_for_mssql_keeps_explicit_schema_but_adds_db(self) -> None:
        topics = cdc_connect.topics_for(SID, "mssql", "shop", ["sales.orders"])
        assert topics[0].endswith(".shop.sales.orders")

    def test_topics_for_mssql_does_not_double_prefix_db(self) -> None:
        # 이미 db.schema.table 로 준 경우 DB 를 다시 붙이지 않는다
        topics = cdc_connect.topics_for(SID, "mssql", "shop", ["shop.dbo.orders"])
        assert topics[0].endswith(".shop.dbo.orders")
        assert not topics[0].endswith(".shop.shop.dbo.orders")


class TestBuildConfigMysql:
    def test_core_fields(self) -> None:
        c = cfg()
        assert c["connector.class"] == "io.debezium.connector.mysql.MySqlConnector"
        assert c["topic.prefix"] == "eai_11111111_2222_3333_4444_555555555555"
        assert c["table.include.list"] == "shop.orders,shop.customers"
        assert c["database.include.list"] == "shop"
        assert c["database.server.id"] == str(cdc_connect._server_id(SID))
        assert "schema.history.internal.kafka.bootstrap.servers" in c
        assert c["database.password"] == "p"

    def test_snapshot_passthrough(self) -> None:
        assert cfg(snapshot="never")["snapshot.mode"] == "never"

    def test_json_converter_schemas_disabled(self) -> None:
        # schemas.enable=true 면 메시지가 {schema,payload} 봉투로 나가 sink 가 깨진다
        c = cfg()
        assert c["value.converter.schemas.enable"] == "false"
        assert c["key.converter.schemas.enable"] == "false"
        assert c["value.converter"] == "org.apache.kafka.connect.json.JsonConverter"

    def test_soft_delete_smt(self) -> None:
        c = cfg(delete_mode="soft")
        assert c["transforms.unwrap.delete.handling.mode"] == "rewrite"
        assert c["transforms.unwrap.drop.tombstones"] == "true"

    def test_hard_delete_smt(self) -> None:
        assert cfg(delete_mode="hard")["transforms.unwrap.delete.handling.mode"] == "none"

    def test_ignore_delete_smt(self) -> None:
        assert cfg(delete_mode="ignore")["transforms.unwrap.delete.handling.mode"] == "drop"


class TestBuildConfigPostgres:
    def test_core_fields(self) -> None:
        c = cfg(source_type="postgres", connection=PG_CONN)
        assert c["connector.class"] == "io.debezium.connector.postgresql.PostgresConnector"
        assert c["plugin.name"] == "pgoutput"
        assert c["slot.name"] == "eai_11111111_2222_3333_4444_555555555555"
        assert c["publication.name"] == "eai_11111111_2222_3333_4444_555555555555_pub"
        assert c["database.dbname"] == "shop"
        assert c["table.include.list"] == "public.orders,public.customers"

    def test_when_needed_downgrades_to_initial(self) -> None:
        c = cfg(source_type="postgres", connection=PG_CONN, snapshot="when_needed")
        assert c["snapshot.mode"] == "initial"


class TestBuildConfigMssql:
    def test_core_fields(self) -> None:
        c = cfg(source_type="mssql", connection=MSSQL_CONN)
        assert c["connector.class"] == "io.debezium.connector.sqlserver.SqlServerConnector"
        # 2.x 는 database.dbname 이 아니라 database.names(복수) 를 쓴다
        assert c["database.names"] == "shop"
        assert "database.dbname" not in c
        # 기본 스키마 dbo 로 정규화된다
        assert c["table.include.list"] == "dbo.orders,dbo.customers"
        # 포트를 안 주면 1433 로 기본
        assert c["database.port"] == "1433"
        # MySQL 처럼 스키마 이력 토픽이 필요하다
        assert "schema.history.internal.kafka.bootstrap.servers" in c
        # PostgreSQL 전용 키는 없어야 한다
        assert "plugin.name" not in c and "slot.name" not in c

    def test_encrypt_follows_ssl_flag(self) -> None:
        assert cfg(source_type="mssql", connection=MSSQL_CONN)["database.encrypt"] == "false"
        secure = cfg(source_type="mssql", connection={**MSSQL_CONN, "ssl": True})
        assert secure["database.encrypt"] == "true"

    def test_trust_server_certificate_default_on(self) -> None:
        # 지정 안 하면 사내 자체서명 인증서를 신뢰(기본 True)
        assert cfg(source_type="mssql", connection=MSSQL_CONN)["database.trustServerCertificate"] == "true"
        off = cfg(source_type="mssql", connection={**MSSQL_CONN, "trust_server_certificate": False})
        assert "database.trustServerCertificate" not in off

    def test_never_snapshot_maps_to_no_data(self) -> None:
        c = cfg(source_type="mssql", connection=MSSQL_CONN, snapshot="never")
        assert c["snapshot.mode"] == "no_data"

    def test_delete_smt_shared_with_others(self) -> None:
        c = cfg(source_type="mssql", connection=MSSQL_CONN, delete_mode="soft")
        assert c["transforms.unwrap.delete.handling.mode"] == "rewrite"


class TestBuildConfigErrors:
    def test_unsupported_source_type(self) -> None:
        with pytest.raises(ValidationError, match="CDC 를 지원하지 않는"):
            cfg(source_type="oracle")

    def test_no_tables(self) -> None:
        with pytest.raises(ValidationError, match="테이블이 최소 하나"):
            cfg(tables=[])

    def test_bad_delete_mode(self) -> None:
        with pytest.raises(ValidationError, match="삭제 처리"):
            cfg(delete_mode="purge")

    def test_missing_database(self) -> None:
        with pytest.raises(ValidationError, match="database"):
            cfg(connection={"host": "db", "user": "u", "password": "p"})


# ----------------------------------------------------------------- Kafka Connect 클라이언트


class FakeResp:
    def __init__(self, status: int, payload: Any = None) -> None:
        self.status = status
        self.data = json.dumps(payload).encode() if payload is not None else b""


class FakeHttp:
    """urllib3.PoolManager 흉내 — 호출을 기록하고 미리 정한 응답을 돌려준다."""

    def __init__(self, responses: dict[tuple[str, str], FakeResp]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, Any]] = []

    def request(self, method: str, url: str, body: Any = None, headers: Any = None) -> FakeResp:
        self.calls.append((method, url, json.loads(body) if body else None))
        # 경로 꼬리로 매칭한다
        for (m, suffix), resp in self.responses.items():
            if m == method and url.endswith(suffix):
                return resp
        return FakeResp(200, {})


def client_with(responses: dict[tuple[str, str], FakeResp]) -> tuple[cdc_connect.DebeziumClient, FakeHttp]:
    http = FakeHttp(responses)
    return cdc_connect.DebeziumClient("http://debezium:8083", http=http), http


class TestDebeziumClient:
    def test_put_connector_sends_config(self) -> None:
        client, http = client_with({("PUT", "/config"): FakeResp(201, {"name": "eai.x"})})
        client.put_connector("eai.x", {"connector.class": "..."})
        method, url, body = http.calls[0]
        assert method == "PUT" and url.endswith("/connectors/eai.x/config")
        assert body == {"connector.class": "..."}

    def test_error_status_raises_dependency_error(self) -> None:
        client, _ = client_with({("PUT", "/config"): FakeResp(409, {"message": "이미 있음"})})
        with pytest.raises(DependencyError, match="이미 있음"):
            client.put_connector("eai.x", {})

    def test_delete_is_idempotent_on_404(self) -> None:
        client, _ = client_with({("DELETE", "eai.x"): FakeResp(404, {"message": "없음"})})
        client.delete("eai.x")  # 예외 없이 통과해야 한다

    def test_status_gone_on_404(self) -> None:
        client, _ = client_with({("GET", "status"): FakeResp(404)})
        assert client.status("eai.x")["connector"]["state"] == "GONE"

    def test_pause_resume(self) -> None:
        client, http = client_with(
            {("PUT", "pause"): FakeResp(202), ("PUT", "resume"): FakeResp(202)}
        )
        client.pause("eai.x")
        client.resume("eai.x")
        assert [c[0] for c in http.calls] == ["PUT", "PUT"]
        assert http.calls[0][1].endswith("/connectors/eai.x/pause")


# ----------------------------------------------------------------- CDC 소스 추출


def _defn(*nodes: PipelineNode, edges: list[PipelineEdge] | None = None) -> PipelineDefinition:
    return PipelineDefinition(nodes=list(nodes), edges=edges or [])


def node(nid: str, kind: str, **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, params=params)  # type: ignore[arg-type]


class TestExtractCdcSource:
    def test_extracts_single_source(self) -> None:
        d = _defn(
            node("src", "source.cdc.mysql", connection_id="c1", tables=["a", "b"], delete_mode="hard"),
            node("tgt", "target.db", connection_id="c2", table="t", mode="append"),
            edges=[PipelineEdge(source="src", target="tgt")],
        )
        spec = cdc_service.extract_cdc_source(d)
        assert spec.source_type == "mysql"
        assert spec.connection_id == "c1"
        assert spec.tables == ["a", "b"]
        assert spec.delete_mode == "hard"

    def test_single_table_param(self) -> None:
        d = _defn(
            node("src", "source.cdc.postgres", connection_id="c1", table="orders"),
            node("tgt", "target.db", connection_id="c2", table="t", mode="append"),
            edges=[PipelineEdge(source="src", target="tgt")],
        )
        spec = cdc_service.extract_cdc_source(d)
        assert spec.source_type == "postgres"
        assert spec.tables == ["orders"]

    def test_extracts_mssql_source(self) -> None:
        d = _defn(
            node("src", "source.cdc.mssql", connection_id="c1", tables=["dbo.orders"]),
            node("tgt", "target.db", connection_id="c2", table="t", mode="append"),
            edges=[PipelineEdge(source="src", target="tgt")],
        )
        spec = cdc_service.extract_cdc_source(d)
        assert spec.source_type == "mssql"
        assert spec.tables == ["dbo.orders"]

    def test_no_cdc_source_raises(self) -> None:
        d = _defn(node("src", "source.postgres", connection_id="c1", table="t"))
        with pytest.raises(ValidationError, match="CDC 소스 노드가 없습니다"):
            cdc_service.extract_cdc_source(d)

    def test_multiple_cdc_sources_raises(self) -> None:
        d = _defn(
            node("s1", "source.cdc.mysql", connection_id="c1", table="a"),
            node("s2", "source.cdc.mysql", connection_id="c1", table="b"),
        )
        with pytest.raises(ValidationError, match="소스가 2개"):
            cdc_service.extract_cdc_source(d)

    def test_missing_connection_raises(self) -> None:
        d = _defn(node("src", "source.cdc.mysql", table="a"))
        with pytest.raises(ValidationError, match="connection_id"):
            cdc_service.extract_cdc_source(d)
