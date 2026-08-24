"""BAPI 호출 — RETURN 메시지 판정과 결과 테이블 추출."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from eai_sap.backends.base import RfcBackend, SapCallError
from eai_sap.backends.mock import MockRfcBackend
from eai_sap.bapi import BapiMessage, call_bapi, parse_return, raise_on_error

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "sap_mock.json"


class StubBackend(RfcBackend):
    """지정한 응답을 그대로 돌려주는 최소 대역."""

    def __init__(self, response: dict[str, Any]) -> None:
        self.response = response
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def ping(self) -> dict[str, Any]:
        return {}

    def call(self, function_name: str, **params: Any) -> dict[str, Any]:
        self.calls.append((function_name, params))
        return self.response

    def close(self) -> None:
        return None


class TestParseReturn:
    def test_empty_return(self) -> None:
        assert parse_return(None) == []
        assert parse_return([]) == []

    def test_table_form(self) -> None:
        messages = parse_return([{"TYPE": "S", "ID": "M3", "NUMBER": "001", "MESSAGE": "성공"}])
        assert len(messages) == 1
        assert messages[0].type == "S"

    def test_single_structure_form(self) -> None:
        """RETURN 이 테이블이 아니라 단일 구조인 BAPI 도 있다."""
        messages = parse_return({"TYPE": "E", "MESSAGE": "오류"})
        assert len(messages) == 1
        assert messages[0].type == "E"

    def test_entries_without_type_are_skipped(self) -> None:
        # 빈 RETURN 행은 SAP 이 흔히 채워 보낸다 — 메시지로 세면 안 된다
        assert parse_return([{"TYPE": "", "MESSAGE": ""}]) == []

    def test_message_v1_fallback(self) -> None:
        messages = parse_return([{"TYPE": "E", "MESSAGE_V1": "대체 메시지"}])
        assert messages[0].message == "대체 메시지"


class TestRaiseOnError:
    def test_success_messages_pass(self) -> None:
        raise_on_error([BapiMessage(type="S", message="ok")], "BAPI_X")

    def test_warning_passes(self) -> None:
        raise_on_error([BapiMessage(type="W", message="주의")], "BAPI_X")

    def test_error_raises(self) -> None:
        with pytest.raises(SapCallError, match="자재가 없"):
            raise_on_error([BapiMessage(type="E", message="자재가 없습니다")], "BAPI_X")

    def test_abort_raises(self) -> None:
        with pytest.raises(SapCallError):
            raise_on_error([BapiMessage(type="A", message="중단")], "BAPI_X")

    def test_error_among_successes_still_raises(self) -> None:
        """성공 메시지에 묻힌 오류를 놓치면 실패를 성공으로 착각한다."""
        messages = [
            BapiMessage(type="S", message="1건 처리"),
            BapiMessage(type="E", message="2건 실패"),
        ]
        with pytest.raises(SapCallError, match="2건 실패"):
            raise_on_error(messages, "BAPI_X")


class TestCallBapi:
    def test_result_table_is_auto_detected(self) -> None:
        backend = StubBackend({"MATNRLIST": [{"MATERIAL": "M1"}], "RETURN": []})
        result = call_bapi(backend, function_name="BAPI_MATERIAL_GETLIST")
        assert result.table_name == "MATNRLIST"
        assert result.rows == [{"MATERIAL": "M1"}]

    def test_explicit_result_table_wins(self) -> None:
        backend = StubBackend(
            {"MATNRLIST": [{"MATERIAL": "M1"}], "OTHERLIST": [{"X": "1"}], "RETURN": []}
        )
        result = call_bapi(backend, function_name="B", result_table="OTHERLIST")
        assert result.table_name == "OTHERLIST"

    def test_ambiguous_result_table_is_reported(self) -> None:
        """후보가 여러 개일 때 아무거나 집으면 조용히 틀린 데이터를 싣는다."""
        backend = StubBackend({"A": [{"x": 1}], "B": [{"y": 2}], "RETURN": []})
        with pytest.raises(SapCallError, match="result_table"):
            call_bapi(backend, function_name="B")

    def test_missing_named_table_is_reported(self) -> None:
        backend = StubBackend({"MATNRLIST": [{"MATERIAL": "M1"}], "RETURN": []})
        with pytest.raises(SapCallError, match="NOPE"):
            call_bapi(backend, function_name="B", result_table="NOPE")

    def test_return_error_is_raised_before_reading_rows(self) -> None:
        backend = StubBackend(
            {"MATNRLIST": [], "RETURN": [{"TYPE": "E", "MESSAGE": "권한이 없습니다"}]}
        )
        with pytest.raises(SapCallError, match="권한이 없"):
            call_bapi(backend, function_name="BAPI_MATERIAL_GETLIST")

    def test_warnings_are_surfaced_not_raised(self) -> None:
        backend = StubBackend({"L": [{"a": "1"}], "RETURN": [{"TYPE": "W", "MESSAGE": "일부 누락"}]})
        result = call_bapi(backend, function_name="B")
        assert result.rows == [{"a": "1"}]
        assert any("일부 누락" in w for w in result.warnings)

    def test_string_values_are_stripped(self) -> None:
        backend = StubBackend({"L": [{"MATERIAL": "  M1  ", "QTY": 5}], "RETURN": []})
        result = call_bapi(backend, function_name="B")
        assert result.rows == [{"MATERIAL": "M1", "QTY": 5}]

    def test_parameters_are_passed_through(self) -> None:
        backend = StubBackend({"L": [{"a": "1"}], "RETURN": []})
        call_bapi(backend, function_name="BAPI_X", parameters={"MAXROWS": 10})
        assert backend.calls[0] == ("BAPI_X", {"MAXROWS": 10})


class TestAgainstMockFixture:
    @pytest.fixture
    def backend(self) -> MockRfcBackend:
        return MockRfcBackend(FIXTURE)

    def test_material_getlist(self, backend: MockRfcBackend) -> None:
        result = call_bapi(backend, function_name="BAPI_MATERIAL_GETLIST")
        assert len(result.rows) == 7
        assert result.rows[0]["MATERIAL"] == "MAT-0000000001"

    def test_error_response_is_raised(self, backend: MockRfcBackend) -> None:
        with pytest.raises(SapCallError, match="자재가 없"):
            call_bapi(backend, function_name="BAPI_MATERIAL_GETLIST", parameters={"MAXROWS": 0})

    def test_unknown_function(self, backend: MockRfcBackend) -> None:
        with pytest.raises(SapCallError, match="정의되지 않은"):
            call_bapi(backend, function_name="BAPI_DOES_NOT_EXIST")
