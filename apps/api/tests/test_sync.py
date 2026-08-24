"""실시간 DB 동기화(SymmetricDS) — DAG 계약·SYM_* SQL 생성·스펙 해석.

SymmetricDS 도 SQL Server 도 없이 검증한다. 실제 서버가 필요한 것(preflight 쿼리·트리거
생성)은 여기서 다루지 않고, **서버 없이도 틀릴 수 있는 것**만 본다 — 그리기 규칙,
생성되는 SQL 의 모양과 순서, 기본값 확정 로직.
"""

from __future__ import annotations

import pytest

from eai_api.schemas.dag import (
    SYNC_CHANNELS,
    SYNC_SOURCE_KINDS,
    SYNC_TARGET_KINDS,
    PipelineDefinition,
    PipelineEdge,
    PipelineNode,
    validate_definition,
)
from eai_api.services import symmetric_config
from eai_api.services.errors import ValidationError
from eai_api.services.symmetric_client import SymmetricClient, SymmetricUnavailableError
from eai_api.services.sync_service import extract_sync_spec

SRC_CONN = "conn-mssql"
TGT_CONN = "conn-pg"


def node(nid: str, kind: str, **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, params=params)  # type: ignore[arg-type]


def edge(source: str, target: str) -> PipelineEdge:
    return PipelineEdge(source=source, target=target)


def errors(d: PipelineDefinition) -> list[str]:
    return [i.message for i in validate_definition(d) if i.level == "error"]


def warnings(d: PipelineDefinition) -> list[str]:
    return [i.message for i in validate_definition(d) if i.level == "warning"]


def sync_pipeline(
    *,
    tables: object = None,
    target_params: dict[str, object] | None = None,
    **src_params: object,
) -> PipelineDefinition:
    """정상적인 동기화 트리거 → 동기화 소스 → 동기화 타깃 파이프라인."""
    params: dict[str, object] = {
        "connection_id": SRC_CONN,
        "tables": tables if tables is not None else [{"name": "INVENTORY", "channel": "realtime"}],
    }
    params.update(src_params)
    tgt: dict[str, object] = {
        "connection_id": TGT_CONN,
        "namespace": "public",
        "table_mappings": [{"source_table": "INVENTORY", "target_table": "inventory"}],
    }
    tgt.update(target_params or {})
    return PipelineDefinition(
        nodes=[
            node("trg", "trigger.sync"),
            node("src", "source.sync.mssql", **params),
            node("tgt", "target.sync.db", **tgt),
        ],
        edges=[edge("trg", "src"), edge("src", "tgt")],
    )


class TestNodeKinds:
    def test_sync_source_is_a_source_but_not_cdc(self) -> None:
        for kind in SYNC_SOURCE_KINDS:
            n = node("s", kind)
            assert n.is_source
            assert n.is_sync_source
            assert not n.is_cdc_source

    def test_sync_target_is_a_target(self) -> None:
        for kind in SYNC_TARGET_KINDS:
            n = node("t", kind)
            assert n.is_target
            assert n.is_sync_target

    def test_sync_trigger_is_a_trigger(self) -> None:
        trg = node("t", "trigger.sync")
        assert trg.is_trigger
        assert trg.is_sync_trigger
        assert not trg.is_cdc_trigger


class TestPipelineRules:
    def test_happy_path_has_no_errors(self) -> None:
        assert errors(sync_pipeline()) == []

    def test_transform_between_source_and_target_is_rejected(self) -> None:
        """이 기능에서 가장 중요한 규칙 — 데이터가 워커를 지나지 않는다."""
        d = sync_pipeline()
        d.nodes.append(node("f", "transform.filter", conditions=[]))
        d.edges = [edge("trg", "src"), edge("src", "f"), edge("f", "tgt")]
        msgs = errors(d)
        assert any("변환 노드를 둘 수 없습니다" in m for m in msgs)
        assert any("동기화 타깃에만 이을 수 있습니다" in m for m in msgs)

    def test_batch_trigger_is_rejected(self) -> None:
        d = sync_pipeline()
        d.nodes.append(node("s2", "trigger.schedule", cron="* * * * *"))
        d.edges.append(edge("s2", "src"))
        assert any("동기화 트리거만" in m for m in errors(d))

    def test_batch_source_cannot_be_mixed(self) -> None:
        d = sync_pipeline()
        d.nodes.append(node("b", "source.mysql", connection_id=SRC_CONN, table="t"))
        d.edges.append(edge("b", "tgt"))
        assert any("다른 소스와 한 파이프라인에" in m for m in errors(d))

    def test_other_target_cannot_be_mixed(self) -> None:
        d = sync_pipeline()
        d.nodes.append(node("s3", "target.s3", connection_id=TGT_CONN, path_prefix="x"))
        d.edges.append(edge("src", "s3"))
        assert any("타깃 외의 타깃을 함께" in m for m in errors(d))

    def test_target_without_source_is_rejected(self) -> None:
        d = PipelineDefinition(
            nodes=[node("tgt", "target.sync.db", connection_id=TGT_CONN)], edges=[]
        )
        assert any("동기화 소스가 없습니다" in m for m in errors(d))

    def test_two_sources_are_rejected(self) -> None:
        d = sync_pipeline()
        d.nodes.append(
            node("src2", "source.sync.mssql", connection_id=SRC_CONN, tables=[{"name": "ORDERS"}])
        )
        d.edges.append(edge("src2", "tgt"))
        assert any("소스는 하나여야" in m for m in errors(d))

    def test_missing_trigger_is_only_a_warning(self) -> None:
        d = sync_pipeline()
        d.nodes = [n for n in d.nodes if n.id != "trg"]
        d.edges = [edge("src", "tgt")]
        assert errors(d) == []
        assert any("동기화 트리거가 연결되지 않았습니다" in m for m in warnings(d))

    def test_sync_source_cannot_be_referenced_by_node_ref(self) -> None:
        d = sync_pipeline()
        d.nodes[1].label = "재고"
        d.nodes[2].params["table_mappings"] = [
            {"source_table": "INVENTORY", "target_table": "${재고.ITEM_CD}"}
        ]
        assert any("행을 우리 쪽으로 읽어 오지 않습니다" in m for m in errors(d))


class TestSourceNodeValidation:
    def test_empty_table_list_is_rejected(self) -> None:
        assert any("테이블이 지정되지 않았습니다" in m for m in errors(sync_pipeline(tables=[])))

    def test_unknown_channel_is_rejected(self) -> None:
        d = sync_pipeline(tables=[{"name": "A", "channel": "turbo"}])
        assert any("알 수 없는 채널" in m for m in errors(d))

    def test_all_documented_channels_are_accepted(self) -> None:
        for channel in SYNC_CHANNELS:
            d = sync_pipeline(
                tables=[{"name": "A", "channel": channel}],
                target_params={"table_mappings": [{"source_table": "A", "target_table": "a"}]},
            )
            assert errors(d) == [], channel

    def test_duplicate_table_is_rejected_case_insensitively(self) -> None:
        """SQL Server 는 식별자 대소문자를 구분하지 않는다 — 같은 테이블이다."""
        d = sync_pipeline(tables=[{"name": "ORDERS"}, {"name": "orders"}])
        assert any("중복" in m for m in errors(d))

    def test_non_integer_load_order_is_rejected(self) -> None:
        d = sync_pipeline(tables=[{"name": "A", "initial_load_order": "먼저"}])
        assert any("정수여야" in m for m in errors(d))

    def test_unknown_purpose_is_rejected(self) -> None:
        assert any("복제본 용도" in m for m in errors(sync_pipeline(purpose="maybe")))


class TestTargetNodeValidation:
    def test_missing_mappings_warns_about_identifier_folding(self) -> None:
        d = sync_pipeline(target_params={"table_mappings": None})
        assert errors(d) == []
        assert any("소문자로 접" in m for m in warnings(d))

    def test_duplicate_mapping_is_rejected(self) -> None:
        d = sync_pipeline(
            target_params={
                "table_mappings": [
                    {"source_table": "INVENTORY", "target_table": "a"},
                    {"source_table": "inventory", "target_table": "b"},
                ]
            }
        )
        assert any("매핑이 중복" in m for m in errors(d))


class TestExtractSpec:
    def test_reads_source_target_and_tables(self) -> None:
        spec = extract_sync_spec(sync_pipeline())
        assert spec.source_connection_id == SRC_CONN
        assert spec.target_connection_id == TGT_CONN
        assert [t.name for t in spec.tables] == ["INVENTORY"]
        assert spec.tables[0].channel == "realtime"

    def test_target_table_defaults_to_lowercase(self) -> None:
        """PostgreSQL 은 인용하지 않은 식별자를 소문자로 접는다 (기획안 §6)."""
        spec = extract_sync_spec(sync_pipeline(target_params={"table_mappings": []}))
        assert spec.tables[0].target_table == "inventory"

    def test_explicit_mapping_wins(self) -> None:
        spec = extract_sync_spec(
            sync_pipeline(
                target_params={
                    "table_mappings": [
                        {"source_table": "inventory", "target_table": "wms_inventory"}
                    ]
                }
            )
        )
        assert spec.tables[0].target_table == "wms_inventory"

    def test_target_namespace_falls_back_to_node_namespace(self) -> None:
        spec = extract_sync_spec(sync_pipeline())
        assert spec.tables[0].target_namespace == "public"

    def test_defaults_for_judgement_fields(self) -> None:
        spec = extract_sync_spec(sync_pipeline())
        assert spec.purpose == "readonly"
        assert spec.load_test_ack is False
        assert spec.initial_load is True


# ------------------------------------------------------------------ SYM_* SQL


def plan(**kwargs: object) -> symmetric_config.SyncPlan:
    tables = kwargs.pop("tables", None) or [
        symmetric_config.SyncTable(name="INVENTORY", channel="realtime", target_table="inventory")
    ]
    return symmetric_config.SyncPlan(stream_id="abc12345-0000-0000-0000-000000000000", tables=tables)  # type: ignore[arg-type]


def sqls(statements: list[symmetric_config.Statement]) -> str:
    return "\n".join(s for s, _ in statements)


class TestPlan:
    def test_rejects_empty_tables(self) -> None:
        with pytest.raises(ValidationError):
            symmetric_config.SyncPlan(stream_id="x", tables=[])

    def test_rejects_injectable_table_prefix(self) -> None:
        """접두어는 SQL 에 식별자로 조립되는 **유일한** 자리라 형식을 강제한다."""
        with pytest.raises(ValidationError):
            symmetric_config.SyncPlan(
                stream_id="x",
                tables=[symmetric_config.SyncTable(name="A")],
                table_prefix="SYM; DROP TABLE users--",
            )

    def test_ids_are_stable_and_scoped_to_the_stream(self) -> None:
        a = symmetric_config.trigger_id("abc12345-0000", "INVENTORY")
        b = symmetric_config.trigger_id("abc12345-0000", "INVENTORY")
        c = symmetric_config.trigger_id("zzz99999-0000", "INVENTORY")
        assert a == b
        assert a != c
        assert len(a) <= symmetric_config.MAX_ID_LENGTH

    def test_trigger_and_router_ids_never_collide(self) -> None:
        assert symmetric_config.trigger_id("s", "T") != symmetric_config.router_id("s", "T")


class TestSetupStatements:
    def test_every_value_is_a_bound_parameter(self) -> None:
        """테이블 이름·필터가 SQL 문자열에 박히면 그 자리가 곧 주입 통로가 된다."""
        p = plan(
            tables=[
                symmetric_config.SyncTable(
                    name="ORDERS'; DROP TABLE x--",
                    row_filter="c.WAREHOUSE_CD = 'WH01'",
                    target_table="orders",
                )
            ]
        )
        for sql, params in symmetric_config.build_setup_statements(p):
            assert "DROP TABLE x" not in sql
            assert "WH01" not in sql
            assert all(f":{k}" in sql for k in params)

    def test_forces_push_even_if_the_link_already_exists(self) -> None:
        """SymmetricDS 가 노드 등록 중에 이 링크를 'W'(풀 대기)로 먼저 만든다.
        넣기만 하고 넘어가면 푸시가 아니라 타깃의 풀 주기로 돌아간다 — 실측 16초의 원인."""
        stmts = symmetric_config.build_group_statements(plan())
        updates = [(sql, prm) for sql, prm in stmts if sql.startswith("UPDATE")]
        assert updates, "이미 있는 링크를 P 로 되돌리는 UPDATE 가 없다"
        sql, prm = updates[0]
        assert "NODE_GROUP_LINK" in sql
        assert prm["action"] == "P"

    def test_creates_push_link(self) -> None:
        text = sqls(symmetric_config.build_group_statements(plan()))
        assert "NODE_GROUP_LINK" in text
        params = [p for _, p in symmetric_config.build_group_statements(plan())]
        assert any(p.get("action") == "P" for p in params)

    def test_creates_all_three_channels(self) -> None:
        stmts = symmetric_config.build_channel_statements(plan())
        ids = {p["cid"] for _, p in stmts}
        assert ids == {"realtime", "standard", "bulk"}

    def test_channels_are_not_overwritten_if_present(self) -> None:
        """운영이 부하 테스트 결과로 조정한 max_batch_size 를 되돌리면 안 된다."""
        for sql, _ in symmetric_config.build_channel_statements(plan()):
            assert "IF NOT EXISTS" in sql
            assert "UPDATE" not in sql

    def test_table_setup_deletes_before_inserting(self) -> None:
        """다시 시작할 때 옛 트리거가 남아 조용히 계속 도는 것이 가장 나쁘다."""
        stmts = symmetric_config.build_table_statements(plan())
        kinds = [sql.split()[0] for sql, _ in stmts]
        assert kinds[:3] == ["DELETE", "DELETE", "DELETE"]
        assert kinds[3:] == ["INSERT", "INSERT", "INSERT"]

    def test_delete_order_respects_foreign_keys(self) -> None:
        stmts = symmetric_config.build_table_statements(plan())
        text = sqls(stmts[:3])
        assert text.index("TRIGGER_ROUTER") < text.index("SYM_ROUTER")

    def test_row_filter_switches_router_type(self) -> None:
        without = [p for _, p in symmetric_config.build_table_statements(plan())]
        assert any(p.get("rtype") == "default" for p in without)

        with_filter = [
            p
            for _, p in symmetric_config.build_table_statements(
                plan(tables=[symmetric_config.SyncTable(name="A", row_filter="c.X = 1")])
            )
        ]
        assert any(p.get("rtype") == "subselect" for p in with_filter)

    def test_blank_filter_becomes_null_not_empty_string(self) -> None:
        """빈 표현식은 조건으로 읽혀 아무 행도 라우팅하지 않는다."""
        for _, params in symmetric_config.build_table_statements(plan()):
            if "expr" in params:
                assert params["expr"] is None


class TestTeardownAndPause:
    def test_teardown_leaves_shared_config_alone(self) -> None:
        """채널·노드 그룹을 지우면 남의 동기화가 끊긴다."""
        text = sqls(symmetric_config.build_teardown_statements(plan()))
        assert "CHANNEL" not in text
        assert "NODE_GROUP" not in text
        assert text.count("DELETE") == 3

    def test_pause_disables_routing_not_the_channel(self) -> None:
        stmts = symmetric_config.build_enable_statements(plan(), enabled=False)
        text = sqls(stmts)
        assert "TRIGGER_ROUTER" in text
        assert "CHANNEL" not in text
        assert all(p["enabled"] == 0 for _, p in stmts)

    def test_resume_re_enables(self) -> None:
        stmts = symmetric_config.build_enable_statements(plan(), enabled=True)
        assert all(p["enabled"] == 1 for _, p in stmts)

    def test_teardown_targets_the_same_ids_setup_created(self) -> None:
        p = plan()
        created = {
            params["tid"]
            for _, params in symmetric_config.build_table_statements(p)
            if "tid" in params
        }
        removed = {
            params["tid"]
            for _, params in symmetric_config.build_teardown_statements(p)
            if "tid" in params
        }
        assert created == removed


class TestMonitoringQueries:
    def test_pending_rows_query_uses_the_documented_shape(self) -> None:
        sql, _ = symmetric_config.pending_data_sql(plan())
        assert "pending_rows" in sql
        assert "NOT EXISTS" in sql

    def test_initial_load_targets_the_target_group(self) -> None:
        sql, params = symmetric_config.build_initial_load_statement(plan())
        assert "initial_load_enabled = 1" in sql
        assert params["tgt"] == symmetric_config.TARGET_GROUP


# --------------------------------------------------- 사이드카 엔진 탐지


class _FakeResponse:
    def __init__(self, status: int, body: bytes = b"") -> None:
        self.status = status
        self.data = body


class _FakeHttp:
    """urllib3.PoolManager 대役. 마지막 URL 을 기록하고 정해진 응답을 돌려준다."""

    def __init__(self, status: int, body: bytes = b"") -> None:
        self.response = _FakeResponse(status, body)
        self.url = ""

    def request(self, method: str, url: str, **_: object) -> _FakeResponse:
        self.url = url
        return self.response


def client(status: int, body: bytes = b"") -> tuple[SymmetricClient, _FakeHttp]:
    http = _FakeHttp(status, body)
    return SymmetricClient("http://symmetricds:31415", http=http), http


class TestEngineProbe:
    """실측 응답(3.15.22)을 못박아 둔다.

    REST(/api/version)로 확인하던 때는 공식 이미지에 REST 모듈이 없어 항상 404 였다.
    지금은 동기화 서블릿을 두드리는데, 코드 의미를 잘못 읽으면 **엔진이 없는데 점검을
    통과**시켜 버린다 — 그러면 켜도 데이터가 한 건도 오지 않는다.
    """

    def test_probes_a_sub_path_not_the_bare_engine_uri(self) -> None:
        """하위 경로 없이 부르면 엔진이 살아 있는데도 602 가 나온다 (실측)."""
        c, http = client(659)
        c.probe_engine("eai-source")
        assert http.url == "http://symmetricds:31415/sync/eai-source/pull"

    def test_probe_path_has_no_side_effect(self) -> None:
        """registration 을 두드리면 실제 등록을 시도한다 — pull 이어야 한다."""
        from eai_api.services.symmetric_client import PROBE_PATH

        assert PROBE_PATH == "pull"

    def test_659_means_engine_exists(self) -> None:
        # "659 Missing node ID or security token" — 서블릿이 그 엔진으로 라우팅한 것이다
        c, _ = client(659, b"659 Missing node ID or security token")
        assert c.probe_engine("eai-source") is True

    def test_603_means_engine_name_not_found(self) -> None:
        # "603 No matching URI handler" — 다른 엔진은 있는데 이 이름이 없다
        c, _ = client(603, b"603 No matching URI handler")
        assert c.probe_engine("eai-target") is False

    def test_602_means_no_engines_at_all(self) -> None:
        c, _ = client(602)
        assert c.probe_engine("eai-source") is False

    def test_sync_triggers_failure_is_not_fatal_type(self) -> None:
        """REST 가 없는 이미지에서는 404 가 온다 — 잡아서 경고로 낮출 수 있어야 한다."""
        c, _ = client(404, b"404 No static resource api/version.")
        with pytest.raises(SymmetricUnavailableError):
            c.sync_triggers("eai-source")


class TestDriverErrorWrapping:
    """드라이버 예외를 도메인 예외로 감싸는지.

    안 감싸면 원시 SQLAlchemy 예외가 그대로 올라가 **처리되지 않은 500** 이 되고,
    그러면 CORS 헤더가 안 붙어 브라우저는 "서버에 연결할 수 없습니다"로 표시한다 —
    서버는 멀쩡히 답했는데도 원인이 화면에 닿지 않는다. 실제로 겪었다.
    """

    def test_wraps_into_dependency_error_with_driver_detail(self) -> None:
        from sqlalchemy.exc import ProgrammingError

        from eai_api.services.errors import DependencyError
        from eai_api.services.sync_service import _wrap

        exc = ProgrammingError("stmt", {}, Exception("Invalid object name 'SYM_NODE_GROUP'."))
        wrapped = _wrap(exc, "SymmetricDS 설정 반영")

        assert isinstance(wrapped, DependencyError)
        assert wrapped.status_code == 502  # 500 이면 CORS 없이 나가던 그 경로다
        assert "SYM_NODE_GROUP" in str(wrapped)
        assert "SymmetricDS 설정 반영" in str(wrapped)

    def test_only_first_line_is_surfaced(self) -> None:
        """드라이버 예외는 스택이 길다 — 화면에 첫 줄만 올린다."""
        from sqlalchemy.exc import ProgrammingError

        from eai_api.services.sync_service import _wrap

        exc = ProgrammingError("stmt", {}, Exception("첫 줄" + chr(10) + "둘째 줄"))
        assert "둘째 줄" not in str(_wrap(exc, "소스 조회"))


class TestSeparateConfigDatabase:
    """SYM_* 45개를 업무 DB 대신 전용 DB 에 두는 구성.

    실환경에서 확인했다 — 전용 DB 에 SYM_* 를 두고 `source_catalog_name` 으로 업무 DB 의
    테이블을 가리키면, 트리거는 업무 테이블에 붙되 캡처는 전용 DB 로 간다.
    """

    def test_catalog_is_empty_when_same_database(self) -> None:
        """같은 DB 면 비워 둔다 — 기존 스트림의 동작을 바꾸지 않기 위해서다."""
        spec = extract_sync_spec(sync_pipeline())
        assert spec.sync_database == ""
        assert all(t.catalog == "" for t in spec.tables)

    def test_catalog_comes_from_the_connection_not_the_node(self) -> None:
        """업무 DB 이름은 **연결**에 있다. 노드 params 에서 읽으면 항상 비어서,
        전용 설정 DB 를 써도 트리거가 엉뚱한 DB 를 찾는다 — 실제로 그렇게 짰다가 고쳤다."""
        from eai_api.services.sync_service import _with_catalog

        spec = extract_sync_spec(sync_pipeline(sync_database="wms_sync"))
        assert spec.sync_database == "wms_sync"
        assert all(t.catalog == "" for t in spec.tables)  # DAG 만으로는 알 수 없다

        filled = _with_catalog(spec, "WMS")
        assert all(t.catalog == "WMS" for t in filled.tables)

    def test_catalog_stays_empty_without_a_dedicated_database(self) -> None:
        """같은 DB 면 NULL 이어야 한다 — 기존 스트림의 동작을 바꾸지 않기 위해서다."""
        from eai_api.services.sync_service import _with_catalog

        spec = _with_catalog(extract_sync_spec(sync_pipeline()), "WMS")
        assert all(t.catalog == "" for t in spec.tables)

    def test_trigger_row_carries_the_catalog(self) -> None:
        p = plan(
            tables=[symmetric_config.SyncTable(name="INVENTORY", catalog="WMS", target_table="inventory")]
        )
        params = [prm for _, prm in symmetric_config.build_table_statements(p) if "catalog" in prm]
        assert params and params[0]["catalog"] == "WMS"

    def test_blank_catalog_becomes_null_not_empty_string(self) -> None:
        """빈 문자열을 넣으면 SymmetricDS 가 이름이 ''인 DB 를 찾는다 — NULL 이어야 한다."""
        params = [prm for _, prm in symmetric_config.build_table_statements(plan()) if "catalog" in prm]
        assert params and params[0]["catalog"] is None


class TestStopIsIdempotent:
    """SYM_* 가 사라진 뒤에도 정지할 수 있어야 한다.

    실제로 막혔다 — SymmetricDS 를 다른 DB 로 옮기면서 SYM_* 를 지웠더니, 스트림은
    running 으로 남았는데 정지는 "테이블이 없다"로 실패하고 시작은 409 로 막혔다.
    정지도 시작도 못 하는 막다른 상태다. 지울 것이 없으면 이미 내려간 것으로 본다.
    """

    def test_unreadable_state_is_treated_as_still_present(self) -> None:
        """조회 자체가 불가능하면 '있다'로 본다 — 없다고 단정해 정지를 건너뛰면
        원본에 트리거가 남는다. 안전한 쪽으로 실패해야 한다."""
        from eai_api.services.sync_service import _config_tables_exist

        class _Stub:
            @property
            def engine(self) -> object:
                raise RuntimeError("접속 불가")

        assert _config_tables_exist(_Stub(), plan()) is True  # type: ignore[arg-type]

    def test_existence_query_targets_the_config_tables(self) -> None:
        sql, params = symmetric_config.config_tables_exist_sql(plan())
        assert "INFORMATION_SCHEMA.TABLES" in sql
        assert set(params.values()) == {"SYM_TRIGGER", "SYM_ROUTER", "SYM_NODE"}
