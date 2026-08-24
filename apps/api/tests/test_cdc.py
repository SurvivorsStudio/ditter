"""Phase 4a — CDC DAG 스펙·검증 규칙 (docs/PHASE4_CDC_기획안.md §5).

Kafka·Debezium 없이 순수하게 계약만 검증한다. 실행(Sink Worker)은 4c 에서 다룬다.
"""

from __future__ import annotations

from eai_api.schemas.dag import (
    CDC_SOURCE_KINDS,
    NODE_CONNECTOR_TYPE,
    NodeKind,
    PipelineDefinition,
    PipelineEdge,
    PipelineNode,
    validate_definition,
)

CONN = "conn-1"


def node(nid: str, kind: str, **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, params=params)  # type: ignore[arg-type]


def edge(source: str, target: str) -> PipelineEdge:
    return PipelineEdge(source=source, target=target)


def errors(d: PipelineDefinition) -> list[str]:
    return [i.message for i in validate_definition(d) if i.level == "error"]


def cdc_pipeline(**src_params: object) -> PipelineDefinition:
    """정상적인 CDC 트리거 → CDC 소스 → 타깃 파이프라인."""
    params: dict[str, object] = {"connection_id": CONN, "table": "orders"}
    params.update(src_params)
    return PipelineDefinition(
        nodes=[
            node("trg", "trigger.cdc"),
            node("src", "source.cdc.mysql", **params),
            node(
                "tgt", "target.db", connection_id=CONN, table="dw_orders", mode="upsert", key_columns=["id"]
            ),
        ],
        edges=[edge("trg", "src"), edge("src", "tgt")],
    )


class TestCdcNodeKinds:
    def test_cdc_sources_are_sources(self) -> None:
        for kind in CDC_SOURCE_KINDS:
            assert node("s", kind).is_source
            assert node("s", kind).is_cdc_source

    def test_cdc_trigger_is_trigger_but_not_batch(self) -> None:
        trg = node("t", "trigger.cdc")
        assert trg.is_trigger
        assert trg.is_cdc_trigger

    def test_cdc_sources_map_to_rdb_connector_types(self) -> None:
        assert NODE_CONNECTOR_TYPE[NodeKind.SOURCE_CDC_MYSQL] == "mysql"
        assert NODE_CONNECTOR_TYPE[NodeKind.SOURCE_CDC_POSTGRES] == "postgres"
        assert NODE_CONNECTOR_TYPE[NodeKind.SOURCE_CDC_MSSQL] == "mssql"

    def test_cdc_sources_excluded_from_execution_are_still_executable_nodes(self) -> None:
        # 소스이므로 executable_nodes 에는 포함되고(트리거·메모만 제외), 실행 경로 분기는 엔진(4c)이 맡는다
        d = cdc_pipeline()
        assert "src" in {n.id for n in d.executable_nodes()}


class TestCdcValidation:
    def test_valid_cdc_pipeline_has_no_errors(self) -> None:
        assert errors(cdc_pipeline()) == []

    def test_cdc_source_without_table_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("trg", "trigger.cdc"),
                node("src", "source.cdc.postgres", connection_id=CONN),
                node("tgt", "target.db", connection_id=CONN, table="t", mode="append"),
            ],
            edges=[edge("trg", "src"), edge("src", "tgt")],
        )
        assert any("캡처할 테이블" in m for m in errors(d))

    def test_cdc_source_accepts_tables_list(self) -> None:
        assert errors(cdc_pipeline(table=None, tables=["orders", "customers"])) == []

    def test_cdc_source_tables_must_be_a_list(self) -> None:
        d = cdc_pipeline(table=None, tables="orders")
        assert any("목록이어야" in m for m in errors(d))

    def test_invalid_delete_mode_is_an_error(self) -> None:
        assert any("삭제 처리" in m for m in errors(cdc_pipeline(delete_mode="purge")))

    def test_soft_delete_is_accepted(self) -> None:
        assert errors(cdc_pipeline(delete_mode="soft")) == []

    def test_invalid_snapshot_mode_is_an_error(self) -> None:
        assert any("스냅샷" in m for m in errors(cdc_pipeline(snapshot="always")))

    def test_cdc_source_without_connection_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("trg", "trigger.cdc"),
                node("src", "source.cdc.mysql", table="t"),
                node("tgt", "target.db", connection_id=CONN, table="t", mode="append"),
            ],
            edges=[edge("trg", "src"), edge("src", "tgt")],
        )
        assert any("connection_id" in m for m in errors(d))


class TestCdcBatchSeparation:
    def test_cannot_mix_cdc_and_batch_sources(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("trg", "trigger.cdc"),
                node("cdc", "source.cdc.mysql", connection_id=CONN, table="a"),
                node("batch", "source.postgres", connection_id=CONN, table="b"),
                node("tgt", "target.db", connection_id=CONN, table="t", mode="append"),
            ],
            edges=[edge("trg", "cdc"), edge("cdc", "tgt"), edge("batch", "tgt")],
        )
        assert any("섞을 수 없습니다" in m for m in errors(d))

    def test_batch_trigger_on_cdc_pipeline_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("trg", "trigger.schedule", cron="0 2 * * *"),
                node("src", "source.cdc.mysql", connection_id=CONN, table="a"),
                node("tgt", "target.db", connection_id=CONN, table="t", mode="append"),
            ],
            edges=[edge("trg", "src"), edge("src", "tgt")],
        )
        assert any("스케줄·수동 트리거" in m for m in errors(d))

    def test_cdc_source_without_cdc_trigger_only_warns(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.cdc.mysql", connection_id=CONN, table="a"),
                node("tgt", "target.db", connection_id=CONN, table="t", mode="append"),
            ],
            edges=[edge("src", "tgt")],
        )
        issues = validate_definition(d)
        assert [i for i in issues if i.level == "error"] == []
        assert any(i.level == "warning" and "CDC 트리거" in i.message for i in issues)

    def test_cdc_trigger_without_cdc_source_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("trg", "trigger.cdc"),
                node("src", "source.postgres", connection_id=CONN, table="a"),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("trg", "src"), edge("src", "tgt")],
        )
        assert any(i.node_id == "trg" and "CDC 소스가 있어야" in i.message for i in validate_definition(d))
