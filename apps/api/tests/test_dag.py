"""DAG 스펙 — 위상 정렬과 검증 규칙."""

from __future__ import annotations

import pytest
from pydantic import ValidationError as PydanticError

from eai_api.schemas.dag import (
    PipelineDefinition,
    PipelineEdge,
    PipelineNode,
    topological_order,
    validate_definition,
)


def node(nid: str, kind: str, **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, params=params)  # type: ignore[arg-type]


def edge(source: str, target: str) -> PipelineEdge:
    return PipelineEdge(source=source, target=target)


CONN = "conn-1"


def linear_pipeline() -> PipelineDefinition:
    """정상적인 소스 → 변환 → 타깃 파이프라인."""
    return PipelineDefinition(
        nodes=[
            node("trg", "trigger.schedule", cron="0 2 * * *"),
            node("src", "source.postgres", connection_id=CONN, table="customers"),
            node("map", "transform.map", mappings=[{"source": "a", "target": "b"}]),
            node("tgt", "target.s3", connection_id=CONN, path_prefix="raw"),
        ],
        edges=[edge("trg", "src"), edge("src", "map"), edge("map", "tgt")],
    )


class TestTopologicalOrder:
    def test_linear_chain(self) -> None:
        d = linear_pipeline()
        assert topological_order(d.nodes, d.edges) == ["trg", "src", "map", "tgt"]

    def test_detects_cycle(self) -> None:
        nodes = [node("a", "transform.map"), node("b", "transform.map")]
        with pytest.raises(ValueError, match="순환"):
            topological_order(nodes, [edge("a", "b"), edge("b", "a")])

    def test_order_is_deterministic_across_calls(self) -> None:
        """같은 DAG 는 항상 같은 실행 순서를 내야 재현 가능한 디버깅이 된다."""
        nodes = [node(x, "transform.map") for x in ("z", "m", "a")]
        edges = [edge("z", "m")]
        first = topological_order(nodes, edges)
        assert all(topological_order(nodes, edges) == first for _ in range(5))
        assert first.index("z") < first.index("m")

    def test_disconnected_nodes_included(self) -> None:
        nodes = [node("a", "transform.map"), node("b", "transform.map")]
        assert set(topological_order(nodes, [])) == {"a", "b"}


class TestDefinitionValidation:
    def test_duplicate_node_ids_rejected(self) -> None:
        with pytest.raises(PydanticError, match="중복된 노드 id"):
            PipelineDefinition(nodes=[node("x", "transform.map"), node("x", "transform.filter")])

    def test_edge_to_unknown_node_rejected(self) -> None:
        with pytest.raises(PydanticError, match="존재하지 않는 노드"):
            PipelineDefinition(nodes=[node("a", "transform.map")], edges=[edge("a", "ghost")])

    def test_self_loop_rejected(self) -> None:
        with pytest.raises(PydanticError, match="자기 자신"):
            PipelineDefinition(nodes=[node("a", "transform.map")], edges=[edge("a", "a")])

    def test_cycle_rejected_at_construction(self) -> None:
        with pytest.raises(PydanticError, match="순환"):
            PipelineDefinition(
                nodes=[node("a", "transform.map"), node("b", "transform.map")],
                edges=[edge("a", "b"), edge("b", "a")],
            )

    def test_edge_id_autofilled(self) -> None:
        d = PipelineDefinition(
            nodes=[node("a", "source.postgres"), node("b", "target.s3")], edges=[edge("a", "b")]
        )
        assert d.edges[0].id == "a->b"

    def test_unknown_field_rejected(self) -> None:
        with pytest.raises(PydanticError):
            PipelineNode.model_validate({"id": "a", "kind": "transform.map", "bogus": 1})


class TestSemanticValidation:
    def test_valid_pipeline_has_no_errors(self) -> None:
        issues = validate_definition(linear_pipeline())
        assert [i for i in issues if i.level == "error"] == []

    def test_empty_definition_is_an_error(self) -> None:
        issues = validate_definition(PipelineDefinition())
        assert any(i.level == "error" and "노드가 없" in i.message for i in issues)

    def test_missing_source_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[node("tgt", "target.s3", connection_id=CONN)],
        )
        assert any("소스 노드가 최소" in i.message for i in validate_definition(d))

    def test_missing_target_is_an_error(self) -> None:
        d = PipelineDefinition(nodes=[node("src", "source.postgres", connection_id=CONN, table="t")])
        assert any("타깃 노드가 최소" in i.message for i in validate_definition(d))

    def test_source_without_connection_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[node("src", "source.postgres", table="t"), node("tgt", "target.s3", connection_id=CONN)],
            edges=[edge("src", "tgt")],
        )
        assert any(i.node_id == "src" and "connection_id" in i.message for i in validate_definition(d))

    def test_source_without_table_or_query_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "tgt")],
        )
        assert any(i.node_id == "src" and "table 또는 query" in i.message for i in validate_definition(d))

    def test_dangling_source_is_an_error(self) -> None:
        """어디에도 연결되지 않은 소스는 읽어도 갈 곳이 없다."""
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("src2", "source.postgres", connection_id=CONN, table="u"),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "tgt")],
        )
        assert any(i.node_id == "src2" and "연결되지" in i.message for i in validate_definition(d))

    def test_target_without_input_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.s3", connection_id=CONN),
                node("tgt2", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "tgt")],
        )
        assert any(i.node_id == "tgt2" and "입력이 없" in i.message for i in validate_definition(d))

    def test_upsert_without_key_columns_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.db", connection_id=CONN, table="dw", mode="upsert"),
            ],
            edges=[edge("src", "tgt")],
        )
        assert any(i.node_id == "tgt" and "key_columns" in i.message for i in validate_definition(d))

    def test_upsert_with_key_columns_is_fine(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.db", connection_id=CONN, table="dw", mode="upsert", key_columns=["id"]),
            ],
            edges=[edge("src", "tgt")],
        )
        assert [i for i in validate_definition(d) if i.level == "error"] == []

    def test_file_target_is_valid_without_table(self) -> None:
        """로컬 파일 타깃은 경로 기반이라 table 이 필요 없다 (S3 와 동일)."""
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.file", connection_id=CONN, path_prefix="dump", file_format="jsonl"),
            ],
            edges=[edge("src", "tgt")],
        )
        assert [i for i in validate_definition(d) if i.level == "error"] == []

    def test_file_target_upsert_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.file", connection_id=CONN, mode="upsert"),
            ],
            edges=[edge("src", "tgt")],
        )
        assert any(
            i.node_id == "tgt" and "upsert" in i.message for i in validate_definition(d)
        )

    def test_file_target_without_connection_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.file", path_prefix="dump"),
            ],
            edges=[edge("src", "tgt")],
        )
        assert any(i.node_id == "tgt" and "connection_id" in i.message for i in validate_definition(d))


class TestMemoNote:
    def test_memo_node_needs_no_connection_or_edges(self) -> None:
        """메모는 주석일 뿐 — 연결도 엣지도 요구하지 않고, 검증 오류를 내지 않는다."""
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.file", connection_id=CONN, path_prefix="d"),
                node("memo", "note.memo", text="이 파이프라인은 매일 새벽 2시에 돕니다"),
            ],
            edges=[edge("src", "tgt")],
        )
        assert [i for i in validate_definition(d) if i.level == "error"] == []

    def test_memo_is_not_executable(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.file", connection_id=CONN),
                node("memo", "note.memo", text="hi"),
                node("trg", "trigger.manual"),
            ],
            edges=[edge("src", "tgt")],
        )
        ids = {n.id for n in d.executable_nodes()}
        assert ids == {"src", "tgt"}  # 트리거·메모 제외

    def test_memo_cannot_be_connected(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.file", connection_id=CONN),
                node("memo", "note.memo", text="hi"),
            ],
            edges=[edge("src", "tgt"), edge("memo", "tgt")],
        )
        assert any("메모 노드는" in i.message for i in validate_definition(d))

    def test_pipeline_of_only_a_memo_still_needs_source_and_target(self) -> None:
        d = PipelineDefinition(nodes=[node("memo", "note.memo", text="빈 파이프라인")])
        msgs = [i.message for i in validate_definition(d) if i.level == "error"]
        assert any("소스" in m for m in msgs)
        assert any("타깃" in m for m in msgs)

    def test_schedule_trigger_without_cron_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("trg", "trigger.schedule"),
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("trg", "src"), edge("src", "tgt")],
        )
        assert any(i.node_id == "trg" and "cron" in i.message for i in validate_definition(d))

    def test_no_trigger_is_only_a_warning(self) -> None:
        """트리거가 없어도 수동 실행은 가능하다 — 막을 이유가 없다."""
        d = PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "tgt")],
        )
        issues = validate_definition(d)
        assert [i for i in issues if i.level == "error"] == []
        assert any(i.level == "warning" and "트리거" in i.message for i in issues)

    def test_duplicate_label_warns_but_does_not_block(self) -> None:
        """이름 중복은 경고다 — 실행은 id 로 돌아가므로 이미 돌던 것을 세우지 않는다."""
        src = node("src", "source.postgres", connection_id=CONN, table="t")
        tgt = node("tgt", "target.s3", connection_id=CONN)
        src.label = "적재"
        tgt.label = " 적재 "  # 앞뒤 공백·대소문자만 다른 것도 같은 이름으로 본다
        d = PipelineDefinition(nodes=[src, tgt], edges=[edge("src", "tgt")])

        issues = validate_definition(d)
        assert [i for i in issues if i.level == "error"] == []
        assert any(
            i.level == "warning" and i.node_id == "tgt" and "겹칩니다" in i.message for i in issues
        )

    def test_blank_labels_are_not_duplicates(self) -> None:
        """이름을 비워 둔 노드끼리는 겹쳤다고 하지 않는다 — 기본 이름이 화면에서 채워진다."""
        d = linear_pipeline()
        assert not any("겹칩니다" in i.message for i in validate_definition(d))

    def test_incremental_with_query_warns(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node(
                    "src",
                    "source.postgres",
                    connection_id=CONN,
                    query="SELECT 1",
                    incremental_column="updated_at",
                ),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "tgt")],
        )
        assert any(i.level == "warning" and "증분키가 무시" in i.message for i in validate_definition(d))

    def _py_pipeline(self, code: str) -> PipelineDefinition:
        return PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("py", "transform.python", code=code),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "py"), edge("py", "tgt")],
        )

    def test_python_node_valid(self) -> None:
        d = self._py_pipeline("def transform(row):\n    return row")
        assert [i for i in validate_definition(d) if i.level == "error"] == []

    def test_python_node_empty_code_rejected(self) -> None:
        d = self._py_pipeline("   ")
        assert any(i.node_id == "py" and "비어" in i.message for i in validate_definition(d))

    def test_python_node_syntax_error_rejected(self) -> None:
        d = self._py_pipeline("def transform(row) return row")
        assert any(i.node_id == "py" and "구문 오류" in i.message for i in validate_definition(d))

    def test_python_node_requires_transform_function(self) -> None:
        d = self._py_pipeline("x = 1")
        assert any(i.node_id == "py" and "transform" in i.message for i in validate_definition(d))

    def test_python_node_batch_function_valid(self) -> None:
        d = self._py_pipeline("def transform_batch(df):\n    return df")
        assert [i for i in validate_definition(d) if i.level == "error"] == []

    def test_python_node_both_functions_rejected(self) -> None:
        d = self._py_pipeline("def transform(row):\n    return row\ndef transform_batch(df):\n    return df")
        assert any(i.node_id == "py" and "동시에" in i.message for i in validate_definition(d))

    def _switch_pipeline(self, **params: object) -> PipelineDefinition:
        return PipelineDefinition(
            nodes=[
                node("src", "source.postgres", connection_id=CONN, table="t"),
                node("sw", "logic.switch", **params),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "sw"), edge("sw", "tgt")],
        )

    def test_switch_valid(self) -> None:
        d = self._switch_pipeline(
            cases=[{"id": "c1", "conditions": [{"field": "grade", "op": "eq", "value": "VIP"}]}]
        )
        assert [i for i in validate_definition(d) if i.level == "error"] == []

    def test_switch_needs_cases(self) -> None:
        d = self._switch_pipeline(cases=[])
        assert any(i.node_id == "sw" and "case" in i.message for i in validate_definition(d))

    def test_switch_case_needs_conditions(self) -> None:
        d = self._switch_pipeline(cases=[{"id": "c1", "conditions": []}])
        assert any(i.node_id == "sw" and "조건이 없" in i.message for i in validate_definition(d))

    def test_switch_condition_needs_field(self) -> None:
        d = self._switch_pipeline(cases=[{"id": "c1", "conditions": [{"op": "eq", "value": "x"}]}])
        assert any(i.node_id == "sw" and "field" in i.message for i in validate_definition(d))


class TestEdgeSourceHandle:
    def test_source_handle_defaults_none_and_id_plain(self) -> None:
        e = edge("a", "b")
        assert e.source_handle is None
        assert e.id == "a->b"

    def test_source_handle_included_in_generated_id(self) -> None:
        from eai_api.schemas.dag import PipelineEdge

        e = PipelineEdge(source="sw", target="t", source_handle="case_1")
        assert e.source_handle == "case_1"
        assert e.id == "sw:case_1->t"


class TestHelpers:
    def test_executable_nodes_excludes_triggers(self) -> None:
        assert [n.id for n in linear_pipeline().executable_nodes()] == ["src", "map", "tgt"]

    def test_upstream_map(self) -> None:
        assert linear_pipeline().upstream_map() == {"trg": [], "src": ["trg"], "map": ["src"], "tgt": ["map"]}


class TestNodeReferences:
    """`${노드이름.컬럼}` — 데이터 흐름과 별개로 생기는 실행 순서 의존."""

    def _pipeline(self, *nodes: PipelineNode, edges: list[tuple[str, str]] | None = None):
        return PipelineDefinition(
            nodes=list(nodes),
            edges=[edge(a, b) for a, b in (edges or [])],
        )

    def _named(self, nid: str, kind: str, label: str, **params: object) -> PipelineNode:
        return PipelineNode(id=nid, kind=kind, label=label, params=params)  # type: ignore[arg-type]

    def test_valid_reference_passes(self) -> None:
        d = self._pipeline(
            self._named("agg", "source.postgres", "집계", connection_id=CONN, table="a"),
            self._named(
                "src", "source.postgres", "소스", connection_id=CONN, table="t", where="dt > ${집계.dt}"
            ),
            self._named("tgt", "target.s3", "적재", connection_id=CONN),
            edges=[("src", "tgt"), ("agg", "tgt")],
        )
        assert [i for i in validate_definition(d) if i.level == "error"] == []

    def test_unknown_name_is_an_error(self) -> None:
        d = self._pipeline(
            self._named("src", "source.postgres", "소스", connection_id=CONN, table="t_${없는것.v}"),
            self._named("tgt", "target.s3", "적재", connection_id=CONN),
            edges=[("src", "tgt")],
        )
        assert any(i.level == "error" and "없는것" in i.message for i in validate_definition(d))

    def test_self_reference_is_an_error(self) -> None:
        d = self._pipeline(
            self._named("src", "source.postgres", "소스", connection_id=CONN, table="t_${소스.v}"),
            self._named("tgt", "target.s3", "적재", connection_id=CONN),
            edges=[("src", "tgt")],
        )
        assert any(i.level == "error" and "자기 자신" in i.message for i in validate_definition(d))

    def test_target_reference_is_an_error(self) -> None:
        """타깃은 입력만 있고 출력이 없다."""
        d = self._pipeline(
            self._named("src", "source.postgres", "소스", connection_id=CONN, table="t_${적재.v}"),
            self._named("tgt", "target.s3", "적재", connection_id=CONN),
            edges=[("src", "tgt")],
        )
        assert any(i.level == "error" and "출력이 없습니다" in i.message for i in validate_definition(d))

    def test_trigger_reference_is_an_error(self) -> None:
        d = self._pipeline(
            self._named("trg", "trigger.manual", "수동"),
            self._named("src", "source.postgres", "소스", connection_id=CONN, table="t_${수동.v}"),
            self._named("tgt", "target.s3", "적재", connection_id=CONN),
            edges=[("trg", "src"), ("src", "tgt")],
        )
        assert any(i.level == "error" and "결과를 내지 않습니다" in i.message for i in validate_definition(d))

    def test_cycle_between_references_is_an_error(self) -> None:
        """A 가 B 를, B 가 A 를 참조하면 어느 쪽도 먼저 돌 수 없다 (엣지는 없어도 순환이다)."""
        d = self._pipeline(
            self._named("a", "source.postgres", "A", connection_id=CONN, table="t_${B.v}"),
            self._named("b", "source.postgres", "B", connection_id=CONN, table="t_${A.v}"),
            self._named("tgt", "target.s3", "적재", connection_id=CONN),
            edges=[("a", "tgt"), ("b", "tgt")],
        )
        assert any(i.level == "error" and "순환" in i.message for i in validate_definition(d))

    def test_malformed_placeholder_warns(self) -> None:
        d = self._pipeline(
            self._named("src", "source.postgres", "소스", connection_id=CONN, table="t_${소스.}"),
            self._named("tgt", "target.s3", "적재", connection_id=CONN),
            edges=[("src", "tgt")],
        )
        issues = validate_definition(d)
        assert [i for i in issues if i.level == "error"] == []
        assert any(i.level == "warning" and "글자 그대로" in i.message for i in issues)

    def test_dependencies_are_reported_by_id(self) -> None:
        d = self._pipeline(
            self._named("agg", "source.postgres", "집계", connection_id=CONN, table="a"),
            self._named("src", "source.postgres", "소스", connection_id=CONN, where="dt > ${집계.dt}"),
        )
        assert d.node_ref_dependencies() == {"src": {"agg"}}

    def test_name_lookup_ignores_case_and_padding(self) -> None:
        d = self._pipeline(self._named("agg", "source.postgres", " Daily Agg "))
        assert d.node_by_label("daily agg") is not None
        assert d.node_by_label("") is None


class TestSourceHasNoInput:
    """소스는 스스로 읽어 온다 — 트리거 말고는 앞에 아무것도 둘 수 없다.

    엔진의 `_stream_of` 가 소스를 만나면 상류를 조립하지 않고 곧장 read() 하므로,
    소스로 들어오는 엣지는 그려지긴 해도 데이터가 닿지 않는다. 화면에는 이어져 보이고
    실행도 성공하는데 상류 데이터만 사라지는, 가장 찾기 어려운 종류의 사고다.
    """

    def test_source_to_source_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("b", "source.mysql", connection_id=CONN, table="t1"),
                node("c", "source.mysql", connection_id=CONN, table="t2"),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("b", "c"), edge("c", "tgt")],
        )
        issues = validate_definition(d)
        assert any(i.level == "error" and i.node_id == "c" and "소스 앞에는" in i.message for i in issues)

    def test_transform_to_source_is_an_error(self) -> None:
        d = PipelineDefinition(
            nodes=[
                node("src", "source.mysql", connection_id=CONN, table="t1"),
                node("map", "transform.map", mappings=[{"source": "a", "target": "b"}]),
                node("src2", "source.mysql", connection_id=CONN, table="t2"),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("src", "map"), edge("map", "src2"), edge("src2", "tgt")],
        )
        assert any(i.level == "error" and "소스 앞에는" in i.message for i in validate_definition(d))

    def test_trigger_to_source_is_fine(self) -> None:
        """트리거는 예외다 — 데이터를 주는 게 아니라 언제 도는지를 정해 준다."""
        assert [i for i in validate_definition(linear_pipeline()) if i.level == "error"] == []

    def test_two_sources_into_one_transform_is_fine(self) -> None:
        """나란히 두고 한 노드로 모으는 것은 정상이다 (순차 concat)."""
        d = PipelineDefinition(
            nodes=[
                node("b", "source.mysql", connection_id=CONN, table="t1"),
                node("c", "source.mysql", connection_id=CONN, table="t2"),
                node("py", "transform.python", code="def transform(row):\n    return row"),
                node("tgt", "target.s3", connection_id=CONN),
            ],
            edges=[edge("b", "py"), edge("c", "py"), edge("py", "tgt")],
        )
        assert [i for i in validate_definition(d) if i.level == "error"] == []
