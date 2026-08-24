"""팬아웃 스풀 — 한 번 읽어 여러 번 흘리기."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from eai_connectors import RecordBatch

from eai_worker.spool import SpooledStream


def source(batches: list[RecordBatch], counter: list[int]) -> Iterator[RecordBatch]:
    """소비될 때마다 counter 를 올려 실제 읽기 횟수를 센다."""
    counter[0] += 1
    yield from batches


def make_batches() -> list[RecordBatch]:
    return [
        RecordBatch(rows=[{"id": 1}, {"id": 2}], columns=["id"], max_watermark=2),
        RecordBatch(rows=[{"id": 3}], columns=["id"], max_watermark=3, is_last=True),
    ]


class TestReplay:
    def test_first_consumer_sees_everything(self) -> None:
        spool = SpooledStream(source(make_batches(), [0]))
        try:
            rows = [r for b in spool.tee() for r in b.rows]
            assert rows == [{"id": 1}, {"id": 2}, {"id": 3}]
        finally:
            spool.cleanup()

    def test_second_consumer_sees_the_same_rows(self) -> None:
        spool = SpooledStream(source(make_batches(), [0]))
        try:
            first = [r for b in spool.tee() for r in b.rows]
            second = [r for b in spool.tee() for r in b.rows]
            assert first == second
        finally:
            spool.cleanup()

    def test_source_is_read_exactly_once(self) -> None:
        """스풀의 존재 이유 — 분기해도 원격 소스 부하가 곱해지지 않아야 한다."""
        counter = [0]
        spool = SpooledStream(source(make_batches(), counter))
        try:
            list(spool.tee())
            list(spool.tee())
            list(spool.tee())
            assert counter[0] == 1
        finally:
            spool.cleanup()

    def test_batch_boundaries_are_preserved(self) -> None:
        spool = SpooledStream(source(make_batches(), [0]))
        try:
            list(spool.tee())
            replayed = list(spool.tee())
            assert [len(b) for b in replayed] == [2, 1]
            assert [b.is_last for b in replayed] == [False, True]
            assert [b.columns for b in replayed] == [["id"], ["id"]]
            assert [b.max_watermark for b in replayed] == [2, 3]
        finally:
            spool.cleanup()

    def test_empty_stream_replays_as_empty(self) -> None:
        spool = SpooledStream(source([RecordBatch(rows=[], columns=["id"], is_last=True)], [0]))
        try:
            list(spool.tee())
            replayed = list(spool.tee())
            assert len(replayed) == 1
            assert replayed[0].rows == []
            assert replayed[0].is_last is True
        finally:
            spool.cleanup()


class TestTypeRoundTrip:
    def test_datetime_decimal_and_bytes_survive(self) -> None:
        """JSON 이 모르는 타입이 재생 후에도 타입 그대로여야 한다.

        타입을 잃으면 하위 타깃의 적재나 워터마크 비교가 조용히 어긋난다.
        """
        original = {
            "ts": datetime(2026, 7, 5, 1, 0, tzinfo=UTC),
            "amount": Decimal("123.45"),
            "blob": b"\x00\x01\x02",
            "name": "김도영",
            "n": 42,
            "nothing": None,
        }
        spool = SpooledStream(source([RecordBatch(rows=[original], is_last=True)], [0]))
        try:
            list(spool.tee())
            row = next(iter(spool.tee())).rows[0]
        finally:
            spool.cleanup()

        assert row == original
        assert isinstance(row["ts"], datetime)
        assert isinstance(row["amount"], Decimal)
        assert isinstance(row["blob"], bytes)

    def test_nested_documents_survive(self) -> None:
        original = {"_id": "abc", "meta": {"created": datetime(2026, 1, 1, tzinfo=UTC)}, "tags": [1, 2]}
        spool = SpooledStream(source([RecordBatch(rows=[original], is_last=True)], [0]))
        try:
            list(spool.tee())
            row = next(iter(spool.tee())).rows[0]
        finally:
            spool.cleanup()
        assert row["meta"]["created"] == original["meta"]["created"]
        assert row["tags"] == [1, 2]


class TestFailure:
    def test_incomplete_spool_cannot_be_replayed(self) -> None:
        """도중에 끊긴 스풀을 재생하면 데이터가 잘린다 — 아예 막는다."""

        def broken() -> Iterator[RecordBatch]:
            yield RecordBatch(rows=[{"id": 1}])
            raise RuntimeError("소스 연결 끊김")

        spool = SpooledStream(broken())
        with pytest.raises(RuntimeError, match="소스 연결 끊김"):
            list(spool.tee())
        with pytest.raises(RuntimeError, match="완성되지 않"):
            list(spool._replay())

    def test_temp_file_is_removed_on_failure(self) -> None:
        def broken() -> Iterator[RecordBatch]:
            yield RecordBatch(rows=[{"id": 1}])
            raise RuntimeError("끊김")

        spool = SpooledStream(broken())
        with pytest.raises(RuntimeError):
            list(spool.tee())
        assert spool._path is None  # 정리되어 경로가 비어야 한다

    def test_cleanup_is_idempotent(self) -> None:
        spool = SpooledStream(source(make_batches(), [0]))
        list(spool.tee())
        spool.cleanup()
        spool.cleanup()  # 두 번 불러도 터지지 않아야 한다


def test_spool_file_is_deleted_after_cleanup() -> None:
    spool = SpooledStream(source(make_batches(), [0]))
    list(spool.tee())
    path = spool._path
    assert path is not None and os.path.exists(path)
    spool.cleanup()
    assert not os.path.exists(path)


def test_stats_report_what_was_spooled() -> None:
    spool = SpooledStream(source(make_batches(), [0]))
    try:
        list(spool.tee())
        assert spool.stats == {"batches": 2, "rows": 3}
    finally:
        spool.cleanup()
