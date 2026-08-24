"""API 트리거 — 변수 선언·본문 바인딩·단독 실행 관문.

세 가지를 고정한다.
1. 저작 시점: 선언되지 않은 `$이름` 을 쓰면 저장이 막힌다 (실행할 때 알면 늦다).
2. 호출 시점: 본문이 선언과 맞는지 실행 **전에** 판정한다.
3. 실행 관문: 트리거 단독 실행은 하류 노드 설정을 요구하지 않는다.
"""

from __future__ import annotations

import pytest

from eai_api.models import Pipeline
from eai_api.schemas.dag import (
    RESPONSE_MAX_ROWS_CAP,
    PipelineDefinition,
    PipelineEdge,
    PipelineNode,
    TriggerVariable,
    bind_variables,
    validate_definition,
)
from eai_api.schemas.variables import VariableError
from eai_api.services.errors import ValidationError
from eai_api.services.pipeline_service import assert_node_runnable


def api_trigger(nid: str = "trg", *specs: dict[str, object]) -> PipelineNode:
    return PipelineNode(id=nid, kind="trigger.api", params={"variables": list(specs)})  # type: ignore[arg-type]


def node(nid: str, kind: str = "source.postgres", **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, params=params)  # type: ignore[arg-type]


def errors(*nodes: PipelineNode, edges: list[PipelineEdge] | None = None) -> list[str]:
    d = PipelineDefinition(nodes=list(nodes), edges=edges or [])
    return [i.message for i in validate_definition(d) if i.level == "error"]


class TestBindVariables:
    def test_binds_declared_values(self) -> None:
        declared = [TriggerVariable(name="since")]
        assert bind_variables(declared, {"since": "2026-08-01"}) == {"since": "2026-08-01"}

    def test_missing_required_is_rejected(self) -> None:
        with pytest.raises(VariableError, match="필수"):
            bind_variables([TriggerVariable(name="since")], {})

    def test_unknown_key_is_rejected(self) -> None:
        """조용히 무시하면 오타가 '값이 없다'는 엉뚱한 에러로 나타난다."""
        declared = [TriggerVariable(name="since")]
        with pytest.raises(VariableError, match="sinse"):
            bind_variables(declared, {"since": "x", "sinse": "오타"})

    def test_optional_falls_back_to_default(self) -> None:
        declared = [TriggerVariable(name="limit", type="number", required=False, default=100)]
        assert bind_variables(declared, {}) == {"limit": 100}

    def test_optional_without_default_is_rejected(self) -> None:
        declared = [TriggerVariable(name="limit", required=False)]
        with pytest.raises(VariableError, match="기본값"):
            bind_variables(declared, {})

    def test_numeric_string_is_coerced(self) -> None:
        declared = [TriggerVariable(name="limit", type="number")]
        assert bind_variables(declared, {"limit": "250"}) == {"limit": 250}

    def test_whole_float_becomes_int(self) -> None:
        """`LIMIT 10.0` 은 SQL 이 거부한다."""
        declared = [TriggerVariable(name="limit", type="number")]
        assert bind_variables(declared, {"limit": "10.0"}) == {"limit": 10}

    def test_non_numeric_is_rejected(self) -> None:
        declared = [TriggerVariable(name="limit", type="number")]
        with pytest.raises(VariableError, match="숫자"):
            bind_variables(declared, {"limit": "abc"})

    @pytest.mark.parametrize(("raw", "expected"), [("true", True), ("0", False), (True, True)])
    def test_boolean_forms(self, raw: object, expected: bool) -> None:
        declared = [TriggerVariable(name="dry", type="boolean")]
        assert bind_variables(declared, {"dry": raw}) == {"dry": expected}


class TestAuthoringValidation:
    def test_undeclared_variable_is_an_error(self) -> None:
        found = errors(api_trigger("trg"), node("src", where="dt >= $since"))
        assert any("$since" in m for m in found)

    def test_declared_variable_passes(self) -> None:
        found = errors(api_trigger("trg", {"name": "since"}), node("src", where="dt >= $since"))
        assert not any("$since" in m for m in found)

    def test_variable_without_api_trigger_is_an_error(self) -> None:
        found = errors(node("src", where="dt >= $since"))
        assert any("API 트리거 노드가 필요합니다" in m for m in found)

    def test_only_one_api_trigger_allowed(self) -> None:
        found = errors(api_trigger("a"), api_trigger("b"))
        assert any("하나만" in m for m in found)

    def test_duplicate_variable_names_rejected(self) -> None:
        found = errors(api_trigger("trg", {"name": "since"}, {"name": "since"}))
        assert any("중복" in m for m in found)


class TestSingleNodeGate:
    """트리거 단독 실행은 하류 설정을 요구하지 않는다.

    아직 소스도 안 고른 상태에서 "이 payload 면 값이 이렇게 꽂힌다"를 먼저 보려고 누르는
    버튼이다. 하류 설정을 요구하면 그 목적이 사라진다.
    """

    def pipeline(self) -> Pipeline:
        # 하류 MySQL 소스는 연결·테이블이 비어 있다 — 저작 중의 정상적인 모습이다
        definition = PipelineDefinition(
            nodes=[api_trigger("trg", {"name": "since"}), node("mysql_1", "source.mysql")],
            edges=[PipelineEdge(source="trg", target="mysql_1")],
        )
        return Pipeline(id="p-1", name="p", definition=definition.model_dump(mode="json"))

    def test_api_trigger_runs_despite_unconfigured_downstream(self) -> None:
        assert_node_runnable(self.pipeline(), "trg")

    def test_downstream_node_still_requires_its_own_config(self) -> None:
        with pytest.raises(ValidationError, match="connection_id"):
            assert_node_runnable(self.pipeline(), "mysql_1")

    def test_other_trigger_kinds_remain_unrunnable(self) -> None:
        definition = PipelineDefinition(nodes=[node("trg", "trigger.manual")], edges=[])
        p = Pipeline(id="p-2", name="q", definition=definition.model_dump(mode="json"))
        with pytest.raises(ValidationError, match="실행할 수 없습니다"):
            assert_node_runnable(p, "trg")

    def test_api_trigger_with_bad_declaration_is_blocked(self) -> None:
        """트리거 자신의 오류는 막는다 — 그건 이 노드가 하는 일의 전제다."""
        definition = PipelineDefinition(
            nodes=[api_trigger("trg", {"name": "since"}, {"name": "since"})], edges=[]
        )
        p = Pipeline(id="p-3", name="r", definition=definition.model_dump(mode="json"))
        with pytest.raises(ValidationError, match="중복"):
            assert_node_runnable(p, "trg")


class TestResponseNode:
    """응답 노드 — 호출자에게 결과를 돌려주는 타깃.

    다른 타깃과 두 가지가 다르다. 연결이 없고(어디에도 적재하지 않는다), 행을 메모리에
    모은다(스트리밍 원칙의 의도된 예외). 후자 때문에 max_rows 상한이 필수다.
    """

    def response(self, **params: object) -> PipelineNode:
        return node("resp", "target.response", **params)

    def pipeline_errors(self, resp: PipelineNode) -> list[str]:
        return errors(
            api_trigger("trg", {"name": "since"}),
            node("src", "source.mysql", connection_id="c1", table="t", where="dt >= $since"),
            resp,
            edges=[
                PipelineEdge(source="trg", target="src"),
                PipelineEdge(source="src", target="resp"),
            ],
        )

    def test_needs_no_connection(self) -> None:
        """연결을 요구하면 이 노드를 쓸 수 없다 — 붙을 곳이 없는 타깃이다."""
        found = self.pipeline_errors(self.response(max_rows=100))
        assert not any("connection_id" in m for m in found)

    def test_default_max_rows_is_valid(self) -> None:
        assert self.pipeline_errors(self.response()) == []

    def test_max_rows_must_be_positive(self) -> None:
        found = self.pipeline_errors(self.response(max_rows=0))
        assert any("1 이상" in m for m in found)

    def test_max_rows_is_capped(self) -> None:
        """상한이 없으면 큰 테이블 하나가 워커를 통째로 삼킨다."""
        found = self.pipeline_errors(self.response(max_rows=RESPONSE_MAX_ROWS_CAP + 1))
        assert any("이하" in m for m in found)

    def test_max_rows_must_be_numeric(self) -> None:
        found = self.pipeline_errors(self.response(max_rows="많이"))
        assert any("숫자" in m for m in found)

    def test_columns_must_be_string_list(self) -> None:
        found = self.pipeline_errors(self.response(columns=[1, 2]))
        assert any("컬럼명 목록" in m for m in found)

    def test_duplicate_columns_rejected(self) -> None:
        found = self.pipeline_errors(self.response(columns=["a", "a"]))
        assert any("중복" in m for m in found)

    def test_empty_columns_means_all(self) -> None:
        """비워두면 전부 돌려준다 — 오류가 아니다."""
        assert self.pipeline_errors(self.response(columns=[])) == []

    def test_counts_as_a_target(self) -> None:
        """응답 노드만 있어도 '타깃이 없다' 로 막히면 안 된다."""
        found = self.pipeline_errors(self.response())
        assert not any("타깃 노드가 최소" in m for m in found)


class TestTargetIsTerminal:
    """타깃은 흐름의 끝 — 뒤에 노드를 이을 수 없다.

    캔버스는 타깃에 출구를 그리지 않지만, 예전에 그려둔 엣지나 API 로 직접 저장한 정의에는
    남을 수 있다. 엔진은 타깃을 종점으로 보므로 그런 엣지는 실행 시점에 엉뚱하게 깨진다.
    """

    def chain(self, last_kind: str) -> list[str]:
        return errors(
            api_trigger("trg", {"name": "since"}),
            node("src", "source.mysql", connection_id="c1", table="t", where="dt >= $since"),
            node("tgt", "target.db", connection_id="c2", table="out", mode="append"),
            node("after", last_kind, connection_id="c3", table="t2", mode="append"),
            edges=[
                PipelineEdge(source="trg", target="src"),
                PipelineEdge(source="src", target="tgt"),
                PipelineEdge(source="tgt", target="after"),
            ],
        )

    def test_edge_out_of_target_is_rejected(self) -> None:
        assert any("타깃 뒤에는" in m for m in self.chain("target.db"))

    def test_response_node_is_also_terminal(self) -> None:
        """응답 노드도 타깃이다 — 출구를 이을 수 있으면 안 된다."""
        found = errors(
            api_trigger("trg", {"name": "since"}),
            node("src", "source.mysql", connection_id="c1", table="t", where="dt >= $since"),
            node("resp", "target.response", max_rows=10),
            node("after", "target.db", connection_id="c2", table="out", mode="append"),
            edges=[
                PipelineEdge(source="trg", target="src"),
                PipelineEdge(source="src", target="resp"),
                PipelineEdge(source="resp", target="after"),
            ],
        )
        assert any("타깃 뒤에는" in m for m in found)

    def test_normal_chain_is_fine(self) -> None:
        """소스 → 타깃까지는 당연히 정상이다 — 규칙이 과하게 걸리면 안 된다."""
        found = errors(
            api_trigger("trg", {"name": "since"}),
            node("src", "source.mysql", connection_id="c1", table="t", where="dt >= $since"),
            node("tgt", "target.db", connection_id="c2", table="out", mode="append"),
            edges=[
                PipelineEdge(source="trg", target="src"),
                PipelineEdge(source="src", target="tgt"),
            ],
        )
        assert not any("타깃 뒤에는" in m for m in found)

    def test_two_targets_from_one_source_is_fine(self) -> None:
        """팬아웃은 타깃 뒤가 아니다 — 소스에서 갈라지는 것이라 막으면 안 된다."""
        found = errors(
            api_trigger("trg", {"name": "since"}),
            node("src", "source.mysql", connection_id="c1", table="t", where="dt >= $since"),
            node("a", "target.db", connection_id="c2", table="out_a", mode="append"),
            node("b", "target.db", connection_id="c3", table="out_b", mode="append"),
            edges=[
                PipelineEdge(source="trg", target="src"),
                PipelineEdge(source="src", target="a"),
                PipelineEdge(source="src", target="b"),
            ],
        )
        assert not any("타깃 뒤에는" in m for m in found)


class TestTriggerIsEntry:
    """트리거는 흐름의 시작 — 앞에 노드를 둘 수 없다.

    타깃에 출구가 없는 것과 짝을 이루는 규칙이다. 들어오는 엣지가 있어도 엔진은 트리거를
    실행 대상으로 보지 않아 데이터가 조용히 사라진다.
    """

    def test_edge_into_trigger_is_rejected(self) -> None:
        # 순환이 되지 않게 별도 노드에서 트리거로 들어오는 엣지를 만든다
        # (순환은 PipelineDefinition 이 더 앞에서 거절한다)
        found = errors(
            node("up", "source.postgres", connection_id="c0", table="t0"),
            api_trigger("trg", {"name": "since"}),
            node("src", "source.mysql", connection_id="c1", table="t", where="dt >= $since"),
            node("tgt", "target.db", connection_id="c2", table="out", mode="append"),
            edges=[
                PipelineEdge(source="up", target="trg"),
                PipelineEdge(source="trg", target="src"),
                PipelineEdge(source="src", target="tgt"),
            ],
        )
        assert any("트리거 앞에는" in m for m in found)

    def test_normal_trigger_to_source_is_fine(self) -> None:
        found = errors(
            api_trigger("trg", {"name": "since"}),
            node("src", "source.mysql", connection_id="c1", table="t", where="dt >= $since"),
            node("tgt", "target.db", connection_id="c2", table="out", mode="append"),
            edges=[
                PipelineEdge(source="trg", target="src"),
                PipelineEdge(source="src", target="tgt"),
            ],
        )
        assert not any("트리거 앞에는" in m for m in found)
