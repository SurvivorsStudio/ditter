"""노드 결과 참조 `${노드이름.컬럼}` 해석 (engine._resolve_node_refs).

데이터 흐름(엣지)과 **별개의 의존**이라는 점이 이 기능의 핵심이다. 참조된 노드는 값을
먼저 내야 하고, 그러려면 본 실행보다 앞서 한 번 돌아야 한다. 그 과정이 본 실행의 집계를
오염시키지 않는지(특히 워터마크)를 함께 지킨다.
"""

from __future__ import annotations

import pytest
from eai_api.schemas.dag import PipelineDefinition, PipelineEdge, PipelineNode
from eai_connectors.base import RecordBatch

from eai_worker import engine
from eai_worker.context import RunContext
from eai_worker.engine import ExecutionError, _apply_variables, _resolve_node_refs


class _QuietContext(RunContext):
    """로그·상태를 메모리에만 담는 컨텍스트 (메타DB·Redis 를 띄우지 않는다)."""

    def __init__(self, **kwargs: object) -> None:
        super().__init__(**kwargs)  # type: ignore[arg-type]
        self.messages: list[str] = []
        self.states: dict[str, dict[str, object]] = {}

    def log(self, message: str, *, node_id: str | None = None, level: str = "info") -> None:
        self.messages.append(message)

    def set_node(self, node_id: str, **changes: object) -> None:
        self.states.setdefault(node_id, {}).update(changes)

    def mark_node_done(self, node_id: str) -> None:
        self.completed_nodes += 1

    def add_records(self, node_id: str, count: int) -> None:
        self.node_state(node_id).records += count


def ctx(**variables: object) -> _QuietContext:
    return _QuietContext(run_id="r-1", pipeline_id="p-1", variables=dict(variables))


def node(nid: str, kind: str = "source.postgres", label: str = "", **params: object) -> PipelineNode:
    return PipelineNode(id=nid, kind=kind, label=label or nid, params=params)  # type: ignore[arg-type]


def definition(*nodes: PipelineNode, edges: list[tuple[str, str]] | None = None) -> PipelineDefinition:
    return PipelineDefinition(
        nodes=list(nodes),
        edges=[PipelineEdge(source=a, target=b) for a, b in (edges or [])],
    )


@pytest.fixture
def streams(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[RecordBatch]]:
    """노드 id → 그 노드가 내놓을 배치. 커넥터 없이 참조 해석만 검증한다."""
    canned: dict[str, list[RecordBatch]] = {}

    def fake_stream_of(n: PipelineNode, state: object) -> object:
        return iter(canned.get(n.id, []))

    monkeypatch.setattr(engine, "_stream_of", fake_stream_of)
    return canned


def batch(*rows: dict[str, object]) -> RecordBatch:
    return RecordBatch(rows=list(rows), columns=list(rows[0]) if rows else [])


class TestResolution:
    def test_reads_first_row_of_the_referenced_node(self, streams) -> None:
        streams["agg"] = [batch({"max_dt": "2026-08-01"})]
        d = definition(node("agg", label="집계"), node("src", where="dt > '${집계.max_dt}'"))
        assert _resolve_node_refs(d, ctx()) == {"집계.max_dt": "2026-08-01"}

    def test_only_the_first_row_matters(self, streams) -> None:
        streams["agg"] = [batch({"v": 1}, {"v": 2})]
        d = definition(node("agg", label="집계"), node("src", table="t_${집계.v}"))
        assert _resolve_node_refs(d, ctx())["집계.v"] == 1

    def test_skips_leading_empty_batches(self, streams) -> None:
        """빈 배치가 앞에 와도 첫 '행'을 찾을 때까지 읽는다."""
        streams["agg"] = [batch(), batch({"v": 7})]
        d = definition(node("agg", label="집계"), node("src", table="t_${집계.v}"))
        assert _resolve_node_refs(d, ctx())["집계.v"] == 7

    def test_name_lookup_ignores_case_and_padding(self, streams) -> None:
        streams["agg"] = [batch({"v": 1})]
        d = definition(node("agg", label="Daily Agg"), node("src", table="t_${ daily agg . v }"))
        # 키는 공백을 턴 형태다 — 치환도 같은 정규식으로 키를 만드므로 서로 어긋나지 않는다
        assert _resolve_node_refs(d, ctx()) == {"daily agg.v": 1}

    def test_no_reference_means_no_work(self, streams) -> None:
        d = definition(node("src", table="orders"))
        assert _resolve_node_refs(d, ctx()) == {}

    def test_reference_needs_no_edge(self, streams) -> None:
        """참조는 데이터가 흐르지 않는 노드 사이에서도 성립한다 — 그게 이 기능의 쓸모다."""
        streams["agg"] = [batch({"v": 3})]
        d = definition(
            node("agg", label="집계"),
            node("src", label="소스", table="t_${집계.v}"),
            node("tgt", "target.s3", label="적재"),
            edges=[("src", "tgt")],
        )
        assert _resolve_node_refs(d, ctx())["집계.v"] == 3

    def test_chained_references_resolve_in_order(self, streams) -> None:
        """참조된 노드가 또 다른 노드를 참조하면 안쪽부터 풀려야 한다."""
        streams["a"] = [batch({"v": "가"})]
        streams["b"] = [batch({"w": "나"})]
        d = definition(
            node("a", label="A"),
            node("b", label="B", table="t_${A.v}"),
            node("c", label="C", table="t_${B.w}"),
        )
        assert _resolve_node_refs(d, ctx()) == {"A.v": "가", "B.w": "나"}

    def test_out_of_scope_reference_is_ignored(self, streams) -> None:
        """부분 실행에서 범위 밖 노드의 참조까지 풀면, 아직 그리는 중인 노드가 실행을 막는다."""
        d = definition(node("src", label="소스"), node("tgt", "target.s3", prefix="${없는노드.x}"))
        assert _resolve_node_refs(d, ctx(), scope={"src"}) == {}


class TestFailures:
    def test_unknown_node_name(self, streams) -> None:
        d = definition(node("src", where="dt > '${없는집계.max_dt}'"))
        with pytest.raises(ExecutionError, match="없는집계"):
            _resolve_node_refs(d, ctx())

    def test_self_reference(self, streams) -> None:
        d = definition(node("src", label="소스", table="t_${소스.v}"))
        with pytest.raises(ExecutionError, match="자기 자신"):
            _resolve_node_refs(d, ctx())

    def test_target_has_no_output(self, streams) -> None:
        d = definition(node("tgt", "target.s3", label="적재"), node("src", table="t_${적재.v}"))
        with pytest.raises(ExecutionError, match="결과를 내지 않는"):
            _resolve_node_refs(d, ctx())

    def test_trigger_has_no_output(self, streams) -> None:
        d = definition(node("trg", "trigger.api", label="웹훅"), node("src", table="t_${웹훅.v}"))
        with pytest.raises(ExecutionError, match="결과를 내지 않는"):
            _resolve_node_refs(d, ctx())

    def test_cycle_between_references(self, streams) -> None:
        d = definition(node("a", label="A", table="t_${B.v}"), node("b", label="B", table="t_${A.v}"))
        with pytest.raises(ExecutionError, match="순환"):
            _resolve_node_refs(d, ctx())

    def test_missing_column_lists_what_is_available(self, streams) -> None:
        streams["agg"] = [batch({"max_dt": "2026-08-01"})]
        d = definition(node("agg", label="집계"), node("src", table="t_${집계.없는컬럼}"))
        with pytest.raises(ExecutionError, match="max_dt"):
            _resolve_node_refs(d, ctx())

    def test_no_rows_fails_loudly(self, streams) -> None:
        """값을 비워 두면 `WHERE dt > ''` 가 되어 전체를 조용히 긁는다 — 시끄럽게 실패한다."""
        streams["agg"] = []
        d = definition(node("agg", label="집계"), node("src", where="dt > '${집계.max_dt}'"))
        with pytest.raises(ExecutionError, match="행을 내지 않아"):
            _resolve_node_refs(d, ctx())


class TestIsolationFromTheMainRun:
    """참조 해석은 본 실행보다 **먼저 한 번 더** 읽는다 — 그 흔적이 남으면 안 된다."""

    def test_watermark_observed_while_peeking_is_discarded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """첫 배치만 보고 얻은 부분 최대값이 체크포인트로 올라가면 다음 실행이 구간을 건너뛴다."""

        def fake_stream_of(n: PipelineNode, state: object) -> object:
            state.ctx.observe_watermark(n.id, "2026-08-01")  # type: ignore[attr-defined]
            return iter([batch({"v": 1})])

        monkeypatch.setattr(engine, "_stream_of", fake_stream_of)
        c = ctx()
        d = definition(node("agg", label="집계"), node("src", table="t_${집계.v}"))
        _resolve_node_refs(d, c)
        assert c.watermarks == {}

    def test_records_counted_while_peeking_are_discarded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fake_stream_of(n: PipelineNode, state: object) -> object:
            state.ctx.add_records(n.id, 5)  # type: ignore[attr-defined]
            return iter([batch({"v": 1})])

        monkeypatch.setattr(engine, "_stream_of", fake_stream_of)
        c = ctx()
        d = definition(node("agg", label="집계"), node("src", table="t_${집계.v}"))
        _resolve_node_refs(d, c)
        assert c.node_state("agg").records == 0


class TestSubstitutionIntoParams:
    """해석된 값이 실제 노드 설정에 꽂히는 마지막 단계."""

    def test_value_lands_in_the_referencing_node(self, streams) -> None:
        streams["agg"] = [batch({"max_dt": "2026-08-01"})]
        d = definition(node("agg", label="집계"), node("src", where="dt > '${집계.max_dt}'"))
        c = ctx()
        out = _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})
        assert out.node_map()["src"].params["where"] == "dt > '2026-08-01'"

    def test_trigger_variables_and_node_refs_mix(self, streams) -> None:
        streams["agg"] = [batch({"max_dt": "2026-08-01"})]
        d = definition(node("agg", label="집계"), node("src", where="dt > '${집계.max_dt}' AND env = $env"))
        c = ctx(env="prd")
        out = _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})
        assert out.node_map()["src"].params["where"] == "dt > '2026-08-01' AND env = prd"

    def test_injection_guard_applies_to_node_results(self, streams) -> None:
        """노드 결과는 원격 데이터에서 온다 — 호출 본문보다 오히려 더 못 믿을 값이다."""
        streams["agg"] = [batch({"name": "o'brien"})]
        d = definition(node("agg", label="집계"), node("src", where="name = ${집계.name}"))
        c = ctx()
        with pytest.raises(ExecutionError):
            _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})

    def test_non_sql_context_allows_quotes(self, streams) -> None:
        streams["agg"] = [batch({"name": "o'brien"})]
        d = definition(node("agg", label="집계"), node("src", table="${집계.name}"))
        c = ctx()
        out = _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})
        assert out.node_map()["src"].params["table"] == "o'brien"


class TestListReference:
    """`${이름.컬럼[]}` — 모든 행의 그 컬럼. `IN (...)` 을 위한 것이다."""

    def test_collects_every_row(self, streams) -> None:
        streams["src"] = [batch({"id": 1}, {"id": 2}), batch({"id": 3})]
        d = definition(node("src", label="소스"), node("t", table="x_${소스.id[]}"))
        assert _resolve_node_refs(d, ctx()) == {"소스.id[]": [1, 2, 3]}

    def test_scalar_and_list_of_the_same_column_coexist(self, streams) -> None:
        """키가 갈려 있어야 `${소스.id}` 와 `${소스.id[]}` 를 한 파이프라인에서 쓸 수 있다."""
        streams["src"] = [batch({"id": 1}, {"id": 2})]
        d = definition(node("src", label="소스"), node("t", where="a = ${소스.id} OR b IN (${소스.id[]})"))
        assert _resolve_node_refs(d, ctx()) == {"소스.id": 1, "소스.id[]": [1, 2]}

    def test_scalar_reference_stops_at_the_first_row(self, streams) -> None:
        """낱값만 참조하면 두 번째 배치는 건드리지 않는다 — 상한까지 읽을 이유가 없다."""
        pulled = []

        def counted():
            for i, b in enumerate([batch({"id": 1}), batch({"id": 2})]):
                pulled.append(i)
                yield b

        streams["src"] = counted()
        d = definition(node("src", label="소스"), node("t", table="x_${소스.id}"))
        _resolve_node_refs(d, ctx())
        assert pulled == [0]

    def test_missing_values_in_later_rows_become_null(self, streams) -> None:
        streams["src"] = [batch({"id": 1}, {"other": 2})]
        d = definition(node("src", label="소스"), node("t", table="x_${소스.id[]}"))
        assert _resolve_node_refs(d, ctx())["소스.id[]"] == [1, None]

    def test_too_many_rows_fails_instead_of_truncating(self, streams, monkeypatch) -> None:
        """잘린 IN 목록은 문법도 맞고 실행도 되는데 결과만 조용히 빠진다."""
        monkeypatch.setattr(engine, "NODE_REF_LIST_CAP", 3)
        streams["src"] = [batch(*[{"id": i} for i in range(5)])]
        d = definition(node("src", label="소스"), node("t", table="x_${소스.id[]}"))
        with pytest.raises(ExecutionError, match="너무 큽니다"):
            _resolve_node_refs(d, ctx())

    def test_no_rows_fails(self, streams) -> None:
        streams["src"] = []
        d = definition(node("src", label="소스"), node("t", where="id IN (${소스.id[]})"))
        with pytest.raises(ExecutionError, match="행을 내지 않아"):
            _resolve_node_refs(d, ctx())

    def test_numbers_are_not_quoted(self, streams) -> None:
        streams["src"] = [batch({"id": 1}, {"id": 2})]
        d = definition(node("src", label="소스"), node("t", where="id IN (${소스.id[]})"))
        c = ctx()
        out = _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})
        assert out.node_map()["t"].params["where"] == "id IN (1, 2)"

    def test_strings_are_quoted_for_us(self, streams) -> None:
        """낱값과 달리 원소마다 따옴표를 손으로 붙일 방법이 없다 — 우리가 붙인다."""
        streams["src"] = [batch({"name": "Kim"}, {"name": "Lee"})]
        d = definition(node("src", label="소스"), node("t", where="name IN (${소스.name[]})"))
        c = ctx()
        out = _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})
        assert out.node_map()["t"].params["where"] == "name IN ('Kim', 'Lee')"

    def test_injection_guard_runs_before_quoting(self, streams) -> None:
        """순서가 뒤집히면 우리가 붙인 따옴표가 그대로 주입 통로가 된다."""
        streams["src"] = [batch({"name": "o'brien"})]
        d = definition(node("src", label="소스"), node("t", where="name IN (${소스.name[]})"))
        c = ctx()
        with pytest.raises(ExecutionError):
            _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})


class TestPythonNode:
    """Python 노드는 **데이터는 엣지로** 받고, 코드에는 설정값만 꽂힌다.

    코드 자리는 SQL 이 아니라 Python 이라 리터럴 표기가 달라야 한다 — 목록에 따옴표가
    없으면 이름으로 읽혀 NameError 이고, `true`/`null` 도 마찬가지다.
    """

    def _run(self, code: str, streams) -> str:
        d = definition(
            node("agg", label="집계"),
            node("py", "transform.python", label="전처리", code=code),
        )
        c = ctx()
        out = _apply_variables(d, c, values={**c.variables, **_resolve_node_refs(d, c)})
        return str(out.node_map()["py"].params["code"])

    def test_number_list_lands_as_a_python_list(self, streams) -> None:
        streams["agg"] = [batch({"id": 1}, {"id": 2})]
        assert self._run("ALLOWED = [${집계.id[]}]", streams) == "ALLOWED = [1, 2]"

    def test_string_list_is_quoted(self, streams) -> None:
        streams["agg"] = [batch({"name": "Kim"}, {"name": "Lee"})]
        assert self._run("NAMES = [${집계.name[]}]", streams) == "NAMES = ['Kim', 'Lee']"

    def test_scalar_string_keeps_the_users_quotes(self, streams) -> None:
        streams["agg"] = [batch({"dt": "2026-08-01"})]
        assert self._run('CUTOFF = "${집계.dt}"', streams) == 'CUTOFF = "2026-08-01"'

    def test_quotes_are_allowed_in_code(self, streams) -> None:
        """SQL 과 달리 주입 가드를 걸지 않는다 — 샌드박스에서 도는 코드다."""
        streams["agg"] = [batch({"name": "O'Brien"})]
        assert self._run("N = [${집계.name[]}]", streams) == 'N = ["O\'Brien"]'
