"""변환 노드 — 필터와 필드 매핑."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from eai_api.schemas.dag import PipelineNode
from eai_connectors import RecordBatch
from eai_connectors.errors import ConfigurationError

from eai_worker.context import RunContext
from eai_worker.nodes.transform import ROUTE_KEY, transform


class FakeContext(RunContext):
    """DB·Redis 없이 노드를 돌리기 위한 대역."""

    def __init__(self) -> None:
        super().__init__(run_id="run-test", pipeline_id="pipe-test")
        self.messages: list[str] = []

    def log(self, message: str, *, node_id: str | None = None, level: str = "info") -> None:
        self.messages.append(message)

    def add_records(self, node_id: str, count: int) -> None:
        self.node_state(node_id).records += count

    def set_node(self, node_id: str, **changes: object) -> None:
        state = self.node_state(node_id)
        for key, value in changes.items():
            setattr(state, key, value)

    def observe_watermark(self, node_id: str, value: object) -> None:
        pass


@pytest.fixture
def ctx() -> FakeContext:
    return FakeContext()


def make_node(kind: str, **params: object) -> PipelineNode:
    return PipelineNode(id="n1", kind=kind, params=params)  # type: ignore[arg-type]


def stream(*batches: RecordBatch) -> Iterator[RecordBatch]:
    yield from batches


ROWS = [
    {"id": 1, "name": "김도영", "grade": "VIP", "amount": 100},
    {"id": 2, "name": "이서준", "grade": "GOLD", "amount": 50},
    {"id": 3, "name": "박하윤", "grade": "VIP", "amount": 300},
    {"id": 4, "name": None, "grade": "SILVER", "amount": None},
]


def collect(node: PipelineNode, ctx: FakeContext, *batches: RecordBatch) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for batch in transform(node, stream(*batches), ctx):
        out.extend(batch.rows)
    return out


class TestFilter:
    def test_equality(self, ctx: FakeContext) -> None:
        node = make_node("transform.filter", conditions=[{"field": "grade", "op": "eq", "value": "VIP"}])
        assert [r["id"] for r in collect(node, ctx, RecordBatch(rows=ROWS))] == [1, 3]

    def test_numeric_comparison(self, ctx: FakeContext) -> None:
        node = make_node("transform.filter", conditions=[{"field": "amount", "op": "gt", "value": 80}])
        assert [r["id"] for r in collect(node, ctx, RecordBatch(rows=ROWS))] == [1, 3]

    def test_and_combines_all_conditions(self, ctx: FakeContext) -> None:
        node = make_node(
            "transform.filter",
            match="all",
            conditions=[
                {"field": "grade", "op": "eq", "value": "VIP"},
                {"field": "amount", "op": "gt", "value": 200},
            ],
        )
        assert [r["id"] for r in collect(node, ctx, RecordBatch(rows=ROWS))] == [3]

    def test_or_combines_any_condition(self, ctx: FakeContext) -> None:
        node = make_node(
            "transform.filter",
            match="any",
            conditions=[
                {"field": "grade", "op": "eq", "value": "GOLD"},
                {"field": "grade", "op": "eq", "value": "SILVER"},
            ],
        )
        assert [r["id"] for r in collect(node, ctx, RecordBatch(rows=ROWS))] == [2, 4]

    def test_is_null(self, ctx: FakeContext) -> None:
        node = make_node("transform.filter", conditions=[{"field": "name", "op": "is_null"}])
        assert [r["id"] for r in collect(node, ctx, RecordBatch(rows=ROWS))] == [4]

    def test_in_operator(self, ctx: FakeContext) -> None:
        node = make_node(
            "transform.filter", conditions=[{"field": "grade", "op": "in", "value": ["GOLD", "SILVER"]}]
        )
        assert [r["id"] for r in collect(node, ctx, RecordBatch(rows=ROWS))] == [2, 4]

    def test_mismatched_types_drop_the_row_instead_of_crashing(self, ctx: FakeContext) -> None:
        """None > 80 은 TypeError 다. 여기서 실행 전체를 죽이면 안 된다."""
        node = make_node("transform.filter", conditions=[{"field": "amount", "op": "gt", "value": 80}])
        result = collect(node, ctx, RecordBatch(rows=ROWS))
        assert all(r["amount"] is not None for r in result)

    def test_no_conditions_passes_everything(self, ctx: FakeContext) -> None:
        node = make_node("transform.filter", conditions=[])
        assert len(collect(node, ctx, RecordBatch(rows=ROWS))) == 4

    def test_unknown_operator_rejected(self, ctx: FakeContext) -> None:
        node = make_node("transform.filter", conditions=[{"field": "a", "op": "sql_injection"}])
        with pytest.raises(ConfigurationError, match="필터 연산자"):
            collect(node, ctx, RecordBatch(rows=ROWS))

    def test_condition_without_field_rejected(self, ctx: FakeContext) -> None:
        node = make_node("transform.filter", conditions=[{"op": "eq", "value": 1}])
        with pytest.raises(ConfigurationError, match="field"):
            collect(node, ctx, RecordBatch(rows=ROWS))

    def test_is_last_flag_preserved(self, ctx: FakeContext) -> None:
        node = make_node("transform.filter", conditions=[])
        batches = list(
            transform(
                node,
                stream(RecordBatch(rows=ROWS[:2]), RecordBatch(rows=ROWS[2:], is_last=True)),
                ctx,
            )
        )
        assert [b.is_last for b in batches] == [False, True]


class TestMap:
    def test_renames_and_drops_unmapped(self, ctx: FakeContext) -> None:
        node = make_node(
            "transform.map",
            drop_unmapped=True,
            mappings=[{"source": "id", "target": "cust_id"}, {"source": "name", "target": "cust_name"}],
        )
        rows = collect(node, ctx, RecordBatch(rows=ROWS[:1]))
        assert rows == [{"cust_id": 1, "cust_name": "김도영"}]

    def test_keeps_unmapped_when_asked(self, ctx: FakeContext) -> None:
        node = make_node(
            "transform.map", drop_unmapped=False, mappings=[{"source": "id", "target": "cust_id"}]
        )
        row = collect(node, ctx, RecordBatch(rows=ROWS[:1]))[0]
        assert row["cust_id"] == 1
        assert row["grade"] == "VIP"  # 매핑에 없는 컬럼도 남는다
        assert "id" not in row  # 이름이 바뀐 원본 키는 제거된다

    def test_cast_int(self, ctx: FakeContext) -> None:
        node = make_node("transform.map", mappings=[{"source": "v", "target": "v", "cast": "int"}])
        rows = collect(node, ctx, RecordBatch(rows=[{"v": "42"}]))
        assert rows == [{"v": 42}]

    def test_cast_upper(self, ctx: FakeContext) -> None:
        node = make_node("transform.map", mappings=[{"source": "g", "target": "g", "cast": "upper"}])
        assert collect(node, ctx, RecordBatch(rows=[{"g": "vip"}])) == [{"g": "VIP"}]

    def test_failed_cast_falls_back_to_default(self, ctx: FakeContext) -> None:
        node = make_node(
            "transform.map", mappings=[{"source": "v", "target": "v", "cast": "int", "default": 0}]
        )
        assert collect(node, ctx, RecordBatch(rows=[{"v": "숫자아님"}])) == [{"v": 0}]

    def test_missing_source_uses_default(self, ctx: FakeContext) -> None:
        node = make_node("transform.map", mappings=[{"source": "없는컬럼", "target": "x", "default": "N/A"}])
        assert collect(node, ctx, RecordBatch(rows=[{"a": 1}])) == [{"x": "N/A"}]

    def test_null_stays_null_through_cast(self, ctx: FakeContext) -> None:
        node = make_node("transform.map", mappings=[{"source": "v", "target": "v", "cast": "str"}])
        assert collect(node, ctx, RecordBatch(rows=[{"v": None}])) == [{"v": None}]

    def test_mapping_requires_source_and_target(self, ctx: FakeContext) -> None:
        node = make_node("transform.map", mappings=[{"source": "a"}])
        with pytest.raises(ConfigurationError, match="source 와 target"):
            collect(node, ctx, RecordBatch(rows=ROWS))

    def test_unknown_cast_rejected(self, ctx: FakeContext) -> None:
        node = make_node("transform.map", mappings=[{"source": "a", "target": "b", "cast": "rocket"}])
        with pytest.raises(ConfigurationError, match="캐스트"):
            collect(node, ctx, RecordBatch(rows=ROWS))


def test_unknown_transform_kind_rejected(ctx: FakeContext) -> None:
    node = make_node("source.postgres")
    with pytest.raises(ConfigurationError, match="변환 노드"):
        list(transform(node, stream(RecordBatch(rows=[])), ctx))


class TestSwitch:
    """스위치(조건 분기) — 각 행에 라우팅 태그를 붙인다. 실제 분배는 엔진 몫."""

    def _routes(self, node: PipelineNode, ctx: FakeContext, *batches: RecordBatch) -> list[str]:
        out: list[str] = []
        for batch in transform(node, stream(*batches), ctx):
            out.extend(str(r[ROUTE_KEY]) for r in batch.rows)
        return out

    def test_tags_matching_case(self, ctx: FakeContext) -> None:
        node = make_node(
            "logic.switch",
            cases=[
                {"id": "vip", "conditions": [{"field": "grade", "op": "eq", "value": "VIP"}]},
                {"id": "gold", "conditions": [{"field": "grade", "op": "eq", "value": "GOLD"}]},
            ],
        )
        # ROWS: VIP, GOLD, VIP, SILVER
        assert self._routes(node, ctx, RecordBatch(rows=ROWS)) == ["vip", "gold", "vip", "__default__"]

    def test_first_match_wins(self, ctx: FakeContext) -> None:
        node = make_node(
            "logic.switch",
            cases=[
                {"id": "big", "conditions": [{"field": "amount", "op": "gte", "value": 100}]},
                {"id": "vip", "conditions": [{"field": "grade", "op": "eq", "value": "VIP"}]},
            ],
        )
        # id=1 VIP amount=100 → 'big'(먼저), id=3 VIP amount=300 → 'big'
        assert self._routes(node, ctx, RecordBatch(rows=ROWS)) == ["big", "__default__", "big", "__default__"]

    def test_unmatched_goes_default(self, ctx: FakeContext) -> None:
        node = make_node(
            "logic.switch",
            cases=[{"id": "none", "conditions": [{"field": "grade", "op": "eq", "value": "ZZZ"}]}],
        )
        assert set(self._routes(node, ctx, RecordBatch(rows=ROWS))) == {"__default__"}

    def test_original_columns_preserved(self, ctx: FakeContext) -> None:
        node = make_node(
            "logic.switch",
            cases=[{"id": "c", "conditions": [{"field": "grade", "op": "eq", "value": "VIP"}]}],
        )
        batches = list(transform(node, stream(RecordBatch(rows=ROWS, columns=["id", "grade"])), ctx))
        # 라우팅 태그는 columns 에 넣지 않는다 (다운스트림 컬럼 오염 방지)
        assert batches[0].columns == ["id", "grade"]

    def test_unknown_op_rejected(self, ctx: FakeContext) -> None:
        node = make_node(
            "logic.switch",
            cases=[{"id": "c", "conditions": [{"field": "grade", "op": "rocket", "value": "x"}]}],
        )
        with pytest.raises(ConfigurationError, match="연산자"):
            self._routes(node, ctx, RecordBatch(rows=ROWS))

    def test_missing_field_rejected(self, ctx: FakeContext) -> None:
        node = make_node(
            "logic.switch",
            cases=[{"id": "c", "conditions": [{"op": "eq", "value": "x"}]}],
        )
        with pytest.raises(ConfigurationError, match="field"):
            self._routes(node, ctx, RecordBatch(rows=ROWS))

    def test_empty_cases_rejected(self, ctx: FakeContext) -> None:
        node = make_node("logic.switch", cases=[])
        with pytest.raises(ConfigurationError, match="case"):
            self._routes(node, ctx, RecordBatch(rows=ROWS))


class TestPython:
    """Python 전처리 노드 — 격리 자식 프로세스에서 실제로 실행된다(통합).

    실제 subprocess 를 띄우므로 다른 변환 테스트보다 느리다.
    """

    def _node(self, code: str) -> PipelineNode:
        return make_node("transform.python", code=code)

    def test_passthrough(self, ctx: FakeContext) -> None:
        node = self._node("def transform(row):\n    return row")
        assert collect(node, ctx, RecordBatch(rows=ROWS)) == ROWS

    def test_mutate_and_add_field(self, ctx: FakeContext) -> None:
        node = self._node(
            "def transform(row):\n"
            "    row['amount_x2'] = (row['amount'] or 0) * 2\n"
            "    return row"
        )
        out = collect(node, ctx, RecordBatch(rows=[{"id": 1, "amount": 100}]))
        assert out == [{"id": 1, "amount": 100, "amount_x2": 200}]

    def test_none_drops_row(self, ctx: FakeContext) -> None:
        node = self._node(
            "def transform(row):\n    return None if row['grade'] == 'SILVER' else row"
        )
        out = collect(node, ctx, RecordBatch(rows=ROWS))
        assert [r["grade"] for r in out] == ["VIP", "GOLD", "VIP"]

    def test_columns_recomputed_from_output(self, ctx: FakeContext) -> None:
        node = self._node("def transform(row):\n    return {'only': row['id']}")
        batches = list(transform(node, stream(RecordBatch(rows=ROWS, columns=["id", "name"])), ctx))
        assert batches[0].columns == ["only"]

    def test_safe_module_import_works(self, ctx: FakeContext) -> None:
        node = self._node(
            "import hashlib\n"
            "def transform(row):\n"
            "    row['h'] = hashlib.md5(str(row['id']).encode()).hexdigest()\n"
            "    return row"
        )
        out = collect(node, ctx, RecordBatch(rows=[{"id": 1}]))
        assert out[0]["h"] == "c4ca4238a0b923820dcc509a6f75849b"

    def test_datetime_normalized_to_iso(self, ctx: FakeContext) -> None:
        import datetime as dt

        node = self._node("def transform(row):\n    return row")
        out = collect(node, ctx, RecordBatch(rows=[{"t": dt.datetime(2026, 8, 5, 9, 30)}]))
        assert out[0]["t"] == "2026-08-05T09:30:00"

    def test_blocked_import_fails(self, ctx: FakeContext) -> None:
        node = self._node("import os\ndef transform(row):\n    return row")
        with pytest.raises(ConfigurationError, match="os"):
            collect(node, ctx, RecordBatch(rows=ROWS))

    def test_runtime_error_reports_row_index(self, ctx: FakeContext) -> None:
        node = self._node("def transform(row):\n    return row['nope'] + 1")
        with pytest.raises(ConfigurationError, match="행 0"):
            collect(node, ctx, RecordBatch(rows=ROWS))

    def test_missing_transform_function_rejected(self, ctx: FakeContext) -> None:
        node = self._node("x = 1")
        with pytest.raises(ConfigurationError, match="transform"):
            collect(node, ctx, RecordBatch(rows=ROWS))

    def test_empty_code_rejected(self, ctx: FakeContext) -> None:
        node = self._node("   ")
        with pytest.raises(ConfigurationError, match="코드가 없습니다"):
            collect(node, ctx, RecordBatch(rows=ROWS))

    def test_print_captured_to_log_not_crash(self, ctx: FakeContext) -> None:
        # print 는 프로토콜을 깨지 않고 [print] 로그로 나와야 한다 (실사용 회귀).
        node = self._node("def transform(row):\n    print('hello', row['id'])\n    return row")
        out = collect(node, ctx, RecordBatch(rows=[{"id": 1}]))
        assert out == [{"id": 1}]
        assert any("[print] hello 1" in m for m in ctx.messages)

    def test_is_last_preserved(self, ctx: FakeContext) -> None:
        node = self._node("def transform(row):\n    return row")
        batches = list(
            transform(
                node,
                stream(
                    RecordBatch(rows=[{"id": 1}], is_last=False),
                    RecordBatch(rows=[{"id": 2}], is_last=True),
                ),
                ctx,
            )
        )
        assert [b.is_last for b in batches] == [False, True]

    def test_batch_mode_aggregates_across_upstream_batches(self, ctx: FakeContext) -> None:
        # transform_batch 는 여러 상류 배치를 전부 모아 한 번에 처리한다 (전체 데이터셋).
        pytest.importorskip("pandas")
        node = self._node(
            "def transform_batch(df):\n    return df.groupby('g', as_index=False)['v'].sum()"
        )
        out = collect(
            node,
            ctx,
            RecordBatch(rows=[{"g": "x", "v": 1}, {"g": "y", "v": 10}], is_last=False),
            RecordBatch(rows=[{"g": "x", "v": 2}], is_last=True),
        )
        assert sorted((r["g"], r["v"]) for r in out) == [("x", 3), ("y", 10)]

    def test_batch_mode_single_output_is_last(self, ctx: FakeContext) -> None:
        pytest.importorskip("pandas")
        node = self._node("def transform_batch(df):\n    return df")
        batches = list(
            transform(
                node,
                stream(
                    RecordBatch(rows=[{"id": 1}], is_last=False),
                    RecordBatch(rows=[{"id": 2}], is_last=True),
                ),
                ctx,
            )
        )
        assert len(batches) == 1
        assert batches[0].is_last is True
        assert [r["id"] for r in batches[0].rows] == [1, 2]
