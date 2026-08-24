"""권한이 좁은 RFC 계정 대응.

현장 확인 사항: SAP 의 RFC 전용 서비스 계정은 ``RFC_READ_TABLE`` 권한만 받고
``DDIF_FIELDINFO_GET`` 은 막혀 있는 경우가 흔하다. 메타를 못 읽어도 읽기는 되어야 한다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from eai_sap.backends.base import RfcBackend, SapCallError
from eai_sap.backends.mock import MockRfcBackend
from eai_sap.read_table import read_table

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "sap_mock.json"


class NarrowAuthBackend(RfcBackend):
    """DDIF_FIELDINFO_GET 만 거부하는 백엔드 — 권한이 좁은 계정을 흉내낸다."""

    def __init__(self, inner: MockRfcBackend) -> None:
        self.inner = inner
        self.calls: list[str] = []

    def ping(self) -> dict[str, Any]:
        return self.inner.ping()

    def call(self, function_name: str, **params: Any) -> dict[str, Any]:
        self.calls.append(function_name.upper())
        if function_name.upper() == "DDIF_FIELDINFO_GET":
            raise SapCallError("권한이 없습니다", code="NOT_AUTHORIZED")
        return self.inner.call(function_name, **params)

    def close(self) -> None:
        return None


@pytest.fixture
def narrow() -> NarrowAuthBackend:
    return NarrowAuthBackend(MockRfcBackend(FIXTURE))


class TestFallbackWhenMetaIsForbidden:
    def test_read_still_works(self, narrow: NarrowAuthBackend) -> None:
        result = read_table(narrow, table="CSKT", row_count=100)
        assert len(result.rows) == 7
        assert result.field_groups == 1

    def test_columns_come_from_sap_response(self, narrow: NarrowAuthBackend) -> None:
        """SAP 이 응답에 실어주는 FIELDS 메타로 컬럼을 잡는다."""
        result = read_table(narrow, table="CSKT", row_count=100)
        names = [f.name for f in result.fields]
        assert "KOSTL" in names and "KTEXT" in names

    def test_values_are_parsed_correctly(self, narrow: NarrowAuthBackend) -> None:
        result = read_table(narrow, table="CSKT", row_count=100)
        row = next(r for r in result.rows if r["KOSTL"] == "0000010100" and r["SPRAS"] == "3")
        assert row["KTEXT"] == "생산1팀"
        assert row["KOKRS"] == "1000"

    def test_warning_explains_the_degradation(self, narrow: NarrowAuthBackend) -> None:
        result = read_table(narrow, table="CSKT", row_count=100)
        assert any("권한" in w for w in result.warnings)

    def test_explicit_fields_are_honoured(self, narrow: NarrowAuthBackend) -> None:
        result = read_table(narrow, table="CSKT", fields=["KOSTL", "KTEXT"], row_count=100)
        assert [f.name for f in result.fields] == ["KOSTL", "KTEXT"]
        assert set(result.rows[0]) == {"KOSTL", "KTEXT"}

    def test_where_clause_still_applies(self, narrow: NarrowAuthBackend) -> None:
        result = read_table(narrow, table="CSKT", where="SPRAS = 'E'", row_count=100)
        assert len(result.rows) == 2
        assert all(r["SPRAS"] == "E" for r in result.rows)

    def test_wide_table_reports_actionable_error(self, narrow: NarrowAuthBackend) -> None:
        """분할할 근거가 없으니 조용히 실패하지 말고 해법을 알려야 한다."""
        with pytest.raises(SapCallError, match="필드만 지정하거나 BAPI"):
            read_table(narrow, table="MARA", row_count=100)

    def test_meta_call_is_attempted_first(self, narrow: NarrowAuthBackend) -> None:
        """권한이 있는 계정에서는 정밀 분할을 쓰도록 메타를 먼저 시도한다."""
        read_table(narrow, table="CSKT", row_count=100)
        assert narrow.calls[0] == "DDIF_FIELDINFO_GET"


class TestNormalAuthStillSplits:
    def test_wide_table_splits_when_meta_is_available(self) -> None:
        backend = MockRfcBackend(FIXTURE)
        result = read_table(backend, table="MARA", row_count=100)
        assert result.field_groups > 1
        assert len(result.rows) == 7


class TestCsktMatchesFieldOrder:
    def test_all_fields_returned_in_ddic_order(self) -> None:
        backend = MockRfcBackend(FIXTURE)
        result = read_table(backend, table="CSKT", row_count=100)
        assert [f.name for f in result.fields][:5] == ["MANDT", "SPRAS", "KOKRS", "KOSTL", "DATBI"]

    def test_narrow_table_needs_no_split(self) -> None:
        backend = MockRfcBackend(FIXTURE)
        result = read_table(backend, table="CSKT", row_count=100)
        assert result.field_groups == 1
        assert result.warnings == []
