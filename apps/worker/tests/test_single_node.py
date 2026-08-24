"""단일 노드 실행의 상류 스코프 계산 (_ancestor_ids) 과 결과 샘플러."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from eai_connectors.base import RecordBatch

from eai_worker.engine import _ancestor_ids, _json_safe, _Sampler


def test_source_has_only_itself() -> None:
    upstream = {"src": [], "tgt": ["src"]}
    assert _ancestor_ids(upstream, "src") == {"src"}


def test_target_pulls_full_upstream_chain() -> None:
    # trg → src → map → tgt
    upstream = {"trg": [], "src": ["trg"], "map": ["src"], "tgt": ["map"]}
    assert _ancestor_ids(upstream, "tgt") == {"tgt", "map", "src", "trg"}


def test_diamond_collects_all_ancestors_once() -> None:
    #   a
    #  / \
    # b   c
    #  \ /
    #   d
    upstream = {"a": [], "b": ["a"], "c": ["a"], "d": ["b", "c"]}
    assert _ancestor_ids(upstream, "d") == {"a", "b", "c", "d"}


def test_sibling_branch_is_excluded() -> None:
    # src → t1 ; src → t2 : t1 스코프에 t2 는 없다
    upstream = {"src": [], "t1": ["src"], "t2": ["src"]}
    assert _ancestor_ids(upstream, "t1") == {"t1", "src"}


def _batch(rows, columns=None):
    return RecordBatch(rows=rows, columns=columns or [])


class TestSampler:
    def test_passes_batches_through_unchanged(self):
        s = _Sampler(cap=10)
        rows = [{"id": 1}, {"id": 2}]
        out = list(s.wrap(iter([_batch(rows, ["id"])])))
        assert [b.rows for b in out] == [rows]  # 통과 (스트림 소비 안 막음)

    def test_captures_up_to_cap_and_marks_truncated(self):
        s = _Sampler(cap=2)
        total = [{"id": i} for i in range(5)]
        # 두 배치로 나눠 흘려보낸다
        list(s.wrap(iter([_batch(total[:3], ["id"]), _batch(total[3:], ["id"])])))
        d = s.as_dict()
        assert d["columns"] == ["id"]
        assert len(d["rows"]) == 2  # cap 까지만
        assert d["truncated"] is True  # 5 > 2
        assert s.total == 5

    def test_not_truncated_when_under_cap(self):
        s = _Sampler(cap=10)
        list(s.wrap(iter([_batch([{"a": 1}], ["a"])])))
        assert s.as_dict()["truncated"] is False

    def test_columns_inferred_from_rows_when_absent(self):
        s = _Sampler(cap=10)
        list(s.wrap(iter([_batch([{"x": 1, "y": 2}])])))  # columns 비어 있음
        assert set(s.as_dict()["columns"]) == {"x", "y"}


class TestJsonSafe:
    def test_datetime_and_decimal_become_serializable(self):
        row = _json_safe({"ts": datetime(2026, 7, 1, 9, 30), "amt": Decimal("12.50")})
        assert row["ts"] == "2026-07-01T09:30:00"
        assert row["amt"] == 12.5

    def test_bytes_decoded(self):
        assert _json_safe(b"hi") == "hi"

    def test_nested_structures(self):
        assert _json_safe({"a": [Decimal("1")]}) == {"a": [1.0]}

    def test_unknown_object_falls_back_to_str(self):
        class X:
            def __str__(self):
                return "X!"

        assert _json_safe(X()) == "X!"

    def test_primitives_pass_through(self):
        assert _json_safe(None) is None
        assert _json_safe(5) == 5
        assert _json_safe("s") == "s"
        assert _json_safe(True) is True
