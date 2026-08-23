"""API 트리거로 들어온 `$변수` 를 노드 파라미터에 치환하는 단계 (engine._apply_variables).

치환이 실행의 첫 단계인 것이 중요하다. 라우터에서만 채우면 스케줄·재시도 경로가 값 없이
돌아 "화면에서는 되는데 스케줄로는 안 된다"가 난다.
"""

from __future__ import annotations

from itertools import pairwise

import pytest
from eai_api.schemas.dag import PipelineDefinition, PipelineEdge, PipelineNode
from eai_connectors.base import RecordBatch

from eai_worker.context import RunContext
from eai_worker.engine import (
    ExecutionError,
    _apply_variables,
    _check_api_trigger,
    _collect_response,
    _Exec,
)


class _QuietContext(RunContext):
    """로그를 메모리에 담는 컨텍스트.

    RunContext.log 는 메타DB 와 Redis 로 나간다. 치환 규칙만 보는 테스트에서 그걸 띄울
    이유가 없어 가로챈다 — 대신 무엇을 남겼는지는 확인할 수 있게 모아 둔다.
    """

    def __init__(self, **kwargs: object) -> None:
        super().__init__(**kwargs)  # type: ignore[arg-type]
        self.messages: list[str] = []
        self.states: dict[str, dict[str, object]] = {}
        self.response: dict | None = None

    def log(self, message: str, *, node_id: str | None = None, level: str = "info") -> None:
        self.messages.append(message)

    # set_node / mark_node_done 도 Redis·메타DB 로 나간다. 상태 전이는 여기서 검증할 대상이
    # 아니므로(엔진 전반의 공통 경로다) 마지막 상태만 기억해 둔다.
    def set_node(self, node_id: str, **changes: object) -> None:
        self.states.setdefault(node_id, {}).update(changes)

    def mark_node_done(self, node_id: str) -> None:
        self.completed_nodes += 1

    def set_response(self, payload: dict) -> None:
        self.response = payload

    def add_records(self, node_id: str, count: int) -> None:
        pass


def ctx(**variables: object) -> _QuietContext:
    return _QuietContext(run_id="r-1", pipeline_id="p-1", variables=dict(variables))


def definition(*nodes: PipelineNode) -> PipelineDefinition:
    edges = [PipelineEdge(source=a.id, target=b.id) for a, b in pairwise(nodes)]
    return PipelineDefinition(nodes=list(nodes), edges=edges)


def node(nid: str, kind: str = "source.postgres", **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, params=params)  # type: ignore[arg-type]


class TestSubstitution:
    def test_replaces_in_node_params(self) -> None:
        d = definition(node("src", where="dt >= $since"))
        out = _apply_variables(d, ctx(since="2026-08-01"))
        assert out.node_map()["src"].params["where"] == "dt >= 2026-08-01"

    def test_replaces_in_nested_params(self) -> None:
        d = definition(node("src", options={"prefix": "raw_$env"}))
        out = _apply_variables(d, ctx(env="prd"))
        assert out.node_map()["src"].params["options"]["prefix"] == "raw_prd"

    def test_same_variable_in_several_nodes(self) -> None:
        d = definition(node("src", table="t_$env"), node("tgt", "target.s3", prefix="$env/"))
        out = _apply_variables(d, ctx(env="kr"))
        assert out.node_map()["src"].params["table"] == "t_kr"
        assert out.node_map()["tgt"].params["prefix"] == "kr/"

    def test_definition_without_variables_is_returned_as_is(self) -> None:
        d = definition(node("src", table="orders"))
        assert _apply_variables(d, ctx()) is d


class TestApiTriggerCheck:
    """트리거 단독 실행 — 데이터를 옮기지 않고 "값이 어떻게 꽂히는가"만 보여준다.

    하류 노드의 연결·테이블 설정을 요구하지 않는 것이 핵심이다. 아직 소스도 안 고른
    상태에서 payload 를 확인하려고 누르는 버튼이기 때문이다.
    """

    def state(self, *nodes: PipelineNode, c: _QuietContext) -> _Exec:
        d = definition(*nodes)
        downstream: dict[str, list[str]] = {n.id: [] for n in d.nodes}
        for e in d.edges:
            downstream[e.source].append(e.target)
        return _Exec(
            node_map=d.node_map(),
            upstream=d.upstream_map(),
            downstream=downstream,
            in_edges={},
            ctx=c,
        )

    def test_reports_how_values_land_downstream(self) -> None:
        c = ctx(since="2026-08-01")
        st = self.state(node("trg", "trigger.api"), node("src", where="dt >= $since"), c=c)
        result = _check_api_trigger(st.node_map["trg"], st)
        assert result["applied"]["src"]["where"] == "dt >= 2026-08-01"

    def test_unconfigured_downstream_does_not_block(self) -> None:
        """연결도 테이블도 없는 소스여도 값 확인은 돌아야 한다."""
        c = ctx(since="2026-08-01")
        st = self.state(node("trg", "trigger.api"), node("src", "source.mysql"), c=c)
        result = _check_api_trigger(st.node_map["trg"], st)
        assert result["applied"] == {}
        assert st.ctx.states["trg"]["status"] == "success"

    def test_records_the_values_received(self) -> None:
        c = ctx(since="2026-08-01", env="prd")
        st = self.state(node("trg", "trigger.api"), node("src", table="t_$env"), c=c)
        result = _check_api_trigger(st.node_map["trg"], st)
        assert result["variables"] == {"since": "2026-08-01", "env": "prd"}

    def test_handed_lands_on_state_for_the_edge_chip(self) -> None:
        c = ctx(since="kim")
        st = self.state(node("trg", "trigger.api"), node("src", where="name = '$since'"), c=c)
        _check_api_trigger(st.node_map["trg"], st)
        assert c.states["trg"]["handed"] == {"since": "kim"}

    def test_warns_when_nothing_uses_the_values(self) -> None:
        c = ctx(since="2026-08-01")
        st = self.state(node("trg", "trigger.api"), node("src", table="orders"), c=c)
        _check_api_trigger(st.node_map["trg"], st)
        assert any("쓰는 곳이 없습니다" in m for m in c.messages)

    def test_unchanged_params_are_not_reported(self) -> None:
        """`$` 가 없는 설정까지 나열하면 무엇이 바뀌었는지 안 보인다."""
        c = ctx(env="prd")
        st = self.state(node("trg", "trigger.api"), node("src", table="t_$env", batch_size=5000), c=c)
        result = _check_api_trigger(st.node_map["trg"], st)
        assert result["applied"]["src"] == {"table": "t_prd"}

    def test_injection_guard_still_applies(self) -> None:
        c = ctx(who="o'brien")
        st = self.state(node("trg", "trigger.api"), node("src", where="name = $who"), c=c)
        with pytest.raises(ExecutionError):
            _check_api_trigger(st.node_map["trg"], st)
        assert c.states["trg"]["status"] == "failed"


class TestEdgeValues:
    """엣지 위에 "이 선으로 무엇이 넘어갔나"를 띄우기 위한 근거 데이터.

    트리거 노드는 실행 대상이 아니라 상태가 따로 생기지 않는다 — 치환 단계에서 만들어 준다.
    """

    def test_handed_carries_the_values_themselves(self) -> None:
        """엣지 칩에 뜨는 것은 치환 결과가 아니라 넘긴 값 그 자체다 — {"since": "kim"}."""
        c = ctx(since="kim")
        d = definition(node("trg", "trigger.api"), node("src", where="name = '$since'"))
        _apply_variables(d, c)
        assert c.states["trg"]["handed"] == {"since": "kim"}

    def test_handed_excludes_unused_values(self) -> None:
        """이 선으로 실제로 쓰인 값만 — 안 쓴 값까지 실으면 호출 본문 덤프가 된다."""
        c = ctx(since="kim", unused="x")
        d = definition(node("trg", "trigger.api"), node("src", where="name = '$since'"))
        _apply_variables(d, c)
        assert c.states["trg"]["handed"] == {"since": "kim"}

    def test_applied_lands_on_the_trigger_state(self) -> None:
        c = ctx(since="2026-08-01")
        d = definition(node("trg", "trigger.api"), node("src", where="dt >= $since"))
        _apply_variables(d, c)
        assert c.states["trg"]["applied"]["src"] == {"where": "dt >= 2026-08-01"}

    def test_only_changed_params_are_recorded(self) -> None:
        c = ctx(env="prd")
        d = definition(node("trg", "trigger.api"), node("src", table="t_$env", batch_size=5000))
        _apply_variables(d, c)
        assert c.states["trg"]["applied"]["src"] == {"table": "t_prd"}

    def test_no_trigger_means_no_state(self) -> None:
        c = ctx(since="2026-08-01")
        _apply_variables(definition(node("src", where="dt >= $since")), c)
        assert "trg" not in c.states


class TestPartialRunScope:
    """부분 실행은 도는 노드만 본다.

    저작 중인 파이프라인은 하류가 비어 있는 게 정상이다. 범위 밖 노드가 참조하는 변수까지
    요구하면 "값이 제대로 꽂히는지 보려는" 테스트 실행이 바로 막힌다.
    """

    def test_out_of_scope_missing_variable_is_ignored(self) -> None:
        d = definition(node("src", where="dt >= $since"), node("tgt", "target.s3", prefix="$env/"))
        out = _apply_variables(d, ctx(since="2026-08-01"), scope={"src"})
        assert out.node_map()["src"].params["where"] == "dt >= 2026-08-01"

    def test_out_of_scope_node_is_left_untouched(self) -> None:
        d = definition(node("src", where="dt >= $since"), node("tgt", "target.s3", prefix="$env/"))
        out = _apply_variables(d, ctx(since="2026-08-01", env="prd"), scope={"src"})
        assert out.node_map()["tgt"].params["prefix"] == "$env/"

    def test_in_scope_missing_variable_still_fails(self) -> None:
        d = definition(node("src", where="dt >= $since"))
        with pytest.raises(ExecutionError):
            _apply_variables(d, ctx(), scope={"src"})

    def test_scope_none_means_whole_pipeline(self) -> None:
        d = definition(node("src", where="dt >= $since"), node("tgt", "target.s3", prefix="$env/"))
        with pytest.raises(ExecutionError) as exc:
            _apply_variables(d, ctx(since="2026-08-01"), scope=None)
        assert "$env" in str(exc.value)


class TestRunLog:
    def test_logs_the_values_actually_used(self) -> None:
        """ "그때 어떤 값으로 돌았나"를 로그만 보고 재현할 수 있어야 한다."""
        d = definition(node("src", where="dt >= $since"))
        c = ctx(since="2026-08-01")
        _apply_variables(d, c)
        assert any("$since" in m and "2026-08-01" in m for m in c.messages)

    def test_unused_variables_are_not_logged(self) -> None:
        """쓰지 않은 값까지 남기면 로그가 호출 본문 덤프가 된다."""
        d = definition(node("src", where="dt >= $since"))
        c = ctx(since="2026-08-01", unused="비밀")
        _apply_variables(d, c)
        assert not any("비밀" in m for m in c.messages)

    def test_nothing_logged_when_no_variables(self) -> None:
        c = ctx()
        _apply_variables(definition(node("src", table="orders")), c)
        assert c.messages == []


class TestOriginalIsNotMutated:
    def test_source_definition_untouched(self) -> None:
        """정의는 재시도 때 다시 읽힌다 — 제자리에서 바꾸면 두 번째 실행이 어긋난다."""
        d = definition(node("src", where="dt >= $since"))
        _apply_variables(d, ctx(since="2026-08-01"))
        assert d.node_map()["src"].params["where"] == "dt >= $since"

    def test_reapplying_to_the_original_gives_the_same_result(self) -> None:
        d = definition(node("src", where="dt >= $since"))
        first = _apply_variables(d, ctx(since="2026-08-01"))
        second = _apply_variables(d, ctx(since="2026-08-01"))
        assert first.node_map()["src"].params == second.node_map()["src"].params


class TestMissingValues:
    def test_missing_variable_fails_the_run(self) -> None:
        """빈 문자열로 때우면 `WHERE dt > ''` 가 되어 전체 재적재가 조용히 일어난다."""
        d = definition(node("src", where="dt >= $since"))
        with pytest.raises(ExecutionError) as exc:
            _apply_variables(d, ctx())
        assert "$since" in str(exc.value)

    def test_all_missing_names_reported_at_once(self) -> None:
        d = definition(node("src", where="dt >= $since", table="t_$env"))
        with pytest.raises(ExecutionError) as exc:
            _apply_variables(d, ctx())
        message = str(exc.value)
        assert "$since" in message and "$env" in message

    def test_partial_values_still_fail(self) -> None:
        d = definition(node("src", where="dt >= $since", table="t_$env"))
        with pytest.raises(ExecutionError):
            _apply_variables(d, ctx(since="2026-08-01"))


class TestInjectionGuard:
    def test_sql_context_rejects_quote(self) -> None:
        d = definition(node("src", where="name = $who"))
        with pytest.raises(ExecutionError) as exc:
            _apply_variables(d, ctx(who="o'brien"))
        assert exc.value.node_id == "src"

    def test_non_sql_context_allows_quote(self) -> None:
        d = definition(node("src", table="$who"))
        out = _apply_variables(d, ctx(who="o'brien"))
        assert out.node_map()["src"].params["table"] == "o'brien"


class TestResponseNode:
    """응답 노드가 모으는 결과 (engine._collect_response).

    스트리밍 원칙의 의도된 예외라 두 가지가 중요하다 — 상한을 지키는 것과,
    상한에 걸려도 상류를 끝까지 소비하는 것(스풀을 공유하는 다른 타깃 때문에).
    """

    def batches(self, *rows: dict[str, object]) -> list[RecordBatch]:
        return [RecordBatch(rows=list(rows), columns=list(rows[0].keys()) if rows else [])]

    def test_collects_rows(self) -> None:
        c = ctx()
        n = node("resp", "target.response", max_rows=10)
        out = _collect_response(n, iter(self.batches({"id": 1}, {"id": 2})), c)
        assert out["records"] == 2
        assert c.response["rows"] == [{"id": 1}, {"id": 2}]

    def test_picks_only_requested_columns(self) -> None:
        """외부에 무엇을 노출할지는 명시적으로 정하는 편이 안전하다."""
        c = ctx()
        n = node("resp", "target.response", max_rows=10, columns=["id"])
        _collect_response(n, iter(self.batches({"id": 1, "secret": "x"})), c)
        assert c.response["rows"] == [{"id": 1}]
        assert c.response["columns"] == ["id"]

    def test_empty_columns_returns_everything(self) -> None:
        c = ctx()
        n = node("resp", "target.response", max_rows=10)
        _collect_response(n, iter(self.batches({"id": 1, "name": "a"})), c)
        assert c.response["rows"] == [{"id": 1, "name": "a"}]

    def test_truncates_at_max_rows(self) -> None:
        c = ctx()
        n = node("resp", "target.response", max_rows=2)
        out = _collect_response(n, iter(self.batches({"id": 1}, {"id": 2}, {"id": 3})), c)
        assert out["records"] == 2
        assert c.response["truncated"] is True

    def test_consumes_upstream_fully_even_when_truncated(self) -> None:
        """중간에 끊으면 스풀을 함께 쓰는 다른 타깃이 반쪽 데이터를 받는다."""
        consumed = 0

        def counting() -> object:
            nonlocal consumed
            for i in range(5):
                consumed += 1
                yield RecordBatch(rows=[{"id": i}], columns=["id"])

        c = ctx()
        n = node("resp", "target.response", max_rows=1)
        _collect_response(n, counting(), c)  # type: ignore[arg-type]
        assert consumed == 5

    def test_warns_when_truncated(self) -> None:
        c = ctx()
        n = node("resp", "target.response", max_rows=1)
        _collect_response(n, iter(self.batches({"id": 1}, {"id": 2})), c)
        assert any("잘렸습니다" in m for m in c.messages)

    def test_response_saved_before_status_transition(self) -> None:
        """set_response 가 먼저 불려야 한다 — 뒤면 호출자가 빈손으로 깨어난다."""
        c = ctx()
        n = node("resp", "target.response", max_rows=10)
        _collect_response(n, iter(self.batches({"id": 1})), c)
        assert c.response is not None
