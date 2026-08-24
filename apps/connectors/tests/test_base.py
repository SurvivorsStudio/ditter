"""ReadSpec / RecordBatch 계약 테스트."""

from __future__ import annotations

import pytest

from eai_connectors.base import ReadSpec, RecordBatch, WriteMode


class TestReadSpec:
    def test_some_source_designator_is_required(self) -> None:
        with pytest.raises(ValueError, match="table, query, function"):
            ReadSpec()

    def test_function_alone_is_valid(self) -> None:
        """SAP BAPI 처럼 테이블 개념이 없는 소스도 있다."""
        assert ReadSpec(function="BAPI_MATERIAL_GETLIST").function == "BAPI_MATERIAL_GETLIST"

    def test_incremental_with_function_is_allowed(self) -> None:
        spec = ReadSpec(function="BAPI_X", incremental_column="LAEDA")
        assert spec.incremental_column == "LAEDA"

    def test_table_only_is_valid(self) -> None:
        assert ReadSpec(table="customers").table == "customers"

    def test_query_only_is_valid(self) -> None:
        assert ReadSpec(query="SELECT 1").query == "SELECT 1"

    def test_incremental_with_query_only_is_rejected(self) -> None:
        # query 모드에서는 워터마크 WHERE 절을 안전하게 끼워 넣을 수 없다
        with pytest.raises(ValueError, match="증분 읽기는 table"):
            ReadSpec(query="SELECT 1", incremental_column="updated_at")

    @pytest.mark.parametrize("size", [0, -1])
    def test_batch_size_must_be_positive(self, size: int) -> None:
        with pytest.raises(ValueError, match="batch_size"):
            ReadSpec(table="t", batch_size=size)


class TestRecordBatch:
    def test_len_counts_rows(self) -> None:
        assert len(RecordBatch(rows=[{"a": 1}, {"a": 2}])) == 2

    def test_empty_batch_is_still_truthy(self) -> None:
        # 빈 마지막 배치가 종료 신호를 운반하므로 falsy 여선 안 된다
        assert bool(RecordBatch(rows=[], is_last=True)) is True


def test_write_mode_values() -> None:
    assert {str(m) for m in WriteMode} == {"append", "upsert", "overwrite"}
