"""SAP RFC 커넥터 — 사이드카 HTTP 클라이언트 (Phase 3).

SAP 라이브러리 없이 검증한다. 그것이 사이드카로 격리한 이유이기도 하다.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from eai_connectors import ReadSpec, RecordBatch, SapRfcConnector, WriteMode
from eai_connectors.errors import ConfigurationError, ConnectionFailed, ReadFailed, UnsupportedOperation
from eai_connectors.sap_rfc import _build_where, _chunk, _max_watermark


class FakeResponse:
    def __init__(self, status: int, payload: Any) -> None:
        self.status = status
        self.data = json.dumps(payload).encode("utf-8")


class FakeHttp:
    """사이드카 응답을 흉내내는 대역. 호출 내역을 남긴다."""

    def __init__(self, responses: list[FakeResponse]) -> None:
        self._responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def request(self, method: str, url: str, body: bytes | None = None, headers: Any = None) -> FakeResponse:
        self.requests.append(
            {
                "method": method,
                "url": url,
                "body": json.loads(body) if body else None,
                "headers": dict(headers or {}),
            }
        )
        return self._responses.pop(0) if self._responses else FakeResponse(200, {})

    def clear(self) -> None:
        return None


def connector(responses: list[FakeResponse], **kwargs: Any) -> SapRfcConnector:
    conn = SapRfcConnector(sidecar_url="http://sap:8100", **kwargs)
    conn._http = FakeHttp(responses)  # type: ignore[assignment]
    return conn


class TestConstruction:
    def test_sidecar_url_required(self) -> None:
        with pytest.raises(ConfigurationError):
            SapRfcConnector(sidecar_url="")

    def test_trailing_slash_is_trimmed(self) -> None:
        assert SapRfcConnector(sidecar_url="http://sap:8100/").sidecar_url == "http://sap:8100"

    def test_no_sap_library_is_imported(self) -> None:
        """워커는 NW RFC SDK 를 갖지 않는다 — 이것이 사이드카 격리의 핵심이다."""
        import sys

        SapRfcConnector(sidecar_url="http://sap:8100")
        assert "pyrfc" not in sys.modules

    def test_only_provided_credentials_are_kept(self) -> None:
        """방안 A: 접속 정보를 연결에 저장하고 값 있는 것만 사이드카로 보낸다."""
        conn = SapRfcConnector(
            sidecar_url="http://sap:8100",
            ashost="sap-prd",
            client="100",
            user="EAI",
            passwd="pw",
        )
        assert conn.credentials == {
            "ashost": "sap-prd",
            "client": "100",
            "user": "EAI",
            "passwd": "pw",
        }
        assert "sysnr" not in conn.credentials  # 빈 값은 담지 않는다

    def test_no_credentials_means_empty_dict(self) -> None:
        """접속 정보 없이 만들면 빈 dict — 사이드카가 .env 폴백을 쓴다."""
        assert SapRfcConnector(sidecar_url="http://sap:8100").credentials == {}


class TestCredentialsAreSent:
    def test_credentials_ride_on_every_request(self) -> None:
        conn = connector(
            [FakeResponse(200, {"system_id": "PRD"})],
            ashost="sap-prd",
            client="100",
            user="EAI",
            passwd="pw",
        )
        conn.test_connection()
        body = conn._http.requests[0]["body"]  # type: ignore[union-attr]
        assert body["credentials"]["ashost"] == "sap-prd"
        assert body["credentials"]["passwd"] == "pw"

    def test_read_table_carries_credentials(self) -> None:
        conn = connector(
            [FakeResponse(200, {"rows": [], "columns": [], "truncated": False})],
            ashost="h",
            client="100",
            user="u",
            passwd="p",
        )
        list(conn.read(ReadSpec(table="MARA")))
        body = conn._http.requests[0]["body"]  # type: ignore[union-attr]
        assert body["credentials"]["client"] == "100"
        assert body["table"] == "MARA"  # 접속정보와 페이로드가 함께 실린다

    def test_empty_credentials_still_sent_as_empty(self) -> None:
        """폴백을 쓰는 경우 — credentials 키는 있되 비어 있다."""
        conn = connector([FakeResponse(200, {"system_id": "MOCK", "mock": True})])
        conn.test_connection()
        assert conn._http.requests[0]["body"]["credentials"] == {}  # type: ignore[union-attr]


class TestAuthHeader:
    def test_token_is_sent_when_configured(self) -> None:
        conn = connector([FakeResponse(200, {"system_id": "PRD"})], api_token="tok-123")
        conn.test_connection()
        assert conn._http.requests[0]["headers"]["X-Sap-Token"] == "tok-123"  # type: ignore[union-attr]

    def test_no_token_header_when_unset(self) -> None:
        conn = connector([FakeResponse(200, {"system_id": "PRD"})])
        conn.test_connection()
        assert "X-Sap-Token" not in conn._http.requests[0]["headers"]  # type: ignore[union-attr]


class TestTestConnection:
    def test_reports_system_info(self) -> None:
        conn = connector([FakeResponse(200, {"system_id": "PRD", "client": "100", "release": "755"})])
        result = conn.test_connection()
        assert result.healthy
        assert result.server_version == "PRD / 100 / 755"

    def test_mock_mode_is_called_out(self) -> None:
        """목 백엔드를 실제 SAP 으로 착각하면 안 된다."""
        conn = connector([FakeResponse(200, {"system_id": "MOCK", "mock": True})])
        assert "목 모드" in conn.test_connection().message


class TestErrorMapping:
    def test_retryable_error_becomes_connection_failed(self) -> None:
        """사이드카가 재시도 가치를 알려준다 — 통신 오류만 재시도한다."""
        conn = connector([FakeResponse(503, {"detail": "게이트웨이 응답 없음", "retryable": True})])
        with pytest.raises(ConnectionFailed, match="게이트웨이"):
            conn._request("/ping", {})

    def test_abap_error_becomes_read_failed(self) -> None:
        conn = connector([FakeResponse(502, {"detail": "권한이 없습니다", "retryable": False})])
        with pytest.raises(ReadFailed, match="권한이 없"):
            conn._request("/ping", {})


def schema_response(table: str = "MARA", *, requires_split: bool = False) -> FakeResponse:
    return FakeResponse(
        200,
        {
            "table": table,
            "fields": [{"name": "MATNR", "length": 18, "type": "CHAR", "text": "자재번호"}],
            "total_width": 18,
            "requires_split": requires_split,
        },
    )


class TestDiscoverSchema:
    def test_without_table_returns_nothing(self) -> None:
        """연결은 SAP 시스템만 가리킨다 — 테이블은 노드 설정에서 정한다.

        전체 열거는 불가능하므로(테이블 수만 개) 빈 목록을 돌려주고,
        노드 설정 UI 가 테이블명을 받아 다시 부르는 흐름을 전제한다.
        """
        conn = connector([])
        assert conn.discover_schema() == []
        assert conn._http.requests == []  # type: ignore[union-attr]  사이드카를 부르지도 않는다

    def test_describes_the_requested_table(self) -> None:
        conn = connector([schema_response("MARA")])
        tables = conn.discover_schema("MARA")
        assert len(tables) == 1
        assert tables[0].name == "MARA"
        assert tables[0].columns[0].data_type == "CHAR(18)"
        request = conn._http.requests[0]  # type: ignore[union-attr]
        assert request["url"].endswith("/schema")
        assert request["body"]["table"] == "MARA"

    def test_table_name_is_normalized(self) -> None:
        conn = connector([schema_response("CSKT")])
        conn.discover_schema("  cskt  ")
        assert conn._http.requests[0]["body"]["table"] == "CSKT"  # type: ignore[union-attr]

    def test_qualified_name_is_accepted(self) -> None:
        """UI 가 'SAPSR3.MARA' 처럼 넘겨도 테이블명만 쓴다."""
        conn = connector([schema_response("MARA")])
        conn.discover_schema("SAPSR3.MARA")
        assert conn._http.requests[0]["body"]["table"] == "MARA"  # type: ignore[union-attr]

    def test_blank_table_is_treated_as_absent(self) -> None:
        conn = connector([])
        assert conn.discover_schema("   ") == []

    def test_no_connection_level_table_config_is_needed(self) -> None:
        """연결 설정에 tables 가 없어도 동작해야 한다 — 그것이 이 설계의 요점이다."""
        conn = connector([schema_response("MARA")])
        assert conn.extra == {}
        assert conn.discover_schema("MARA")[0].name == "MARA"


class TestReadTableMode:
    def test_single_page(self) -> None:
        conn = connector(
            [
                FakeResponse(
                    200,
                    {
                        "rows": [{"MATNR": "M1", "LAEDA": "20260101"}],
                        "columns": ["MATNR", "LAEDA"],
                        "truncated": False,
                        "warnings": [],
                    },
                )
            ]
        )
        batches = list(conn.read(ReadSpec(table="MARA", batch_size=10)))
        assert [b.rows for b in batches] == [[{"MATNR": "M1", "LAEDA": "20260101"}]]
        assert batches[-1].is_last is True

    def test_paginates_until_not_truncated(self) -> None:
        conn = connector(
            [
                FakeResponse(200, {"rows": [{"MATNR": "M1"}], "columns": ["MATNR"], "truncated": True}),
                FakeResponse(200, {"rows": [{"MATNR": "M2"}], "columns": ["MATNR"], "truncated": False}),
            ]
        )
        rows = [r for b in conn.read(ReadSpec(table="MARA", batch_size=1)) for r in b.rows]
        assert rows == [{"MATNR": "M1"}, {"MATNR": "M2"}]
        # 두 번째 요청은 앞 페이지 만큼 건너뛰어야 한다
        assert conn._http.requests[1]["body"]["row_skips"] == 1  # type: ignore[union-attr]

    def test_empty_result_still_signals_end(self) -> None:
        conn = connector([FakeResponse(200, {"rows": [], "columns": [], "truncated": False})])
        batches = list(conn.read(ReadSpec(table="MARA")))
        assert len(batches) == 1
        assert batches[0].rows == [] and batches[0].is_last is True

    def test_requires_table(self) -> None:
        conn = connector([])
        with pytest.raises(ConfigurationError, match="table"):
            list(conn.read(ReadSpec(query="ignored", params={"mode": "read_table"})))

    def test_node_options_reach_the_sidecar(self) -> None:
        conn = connector([FakeResponse(200, {"rows": [], "columns": [], "truncated": False})])
        list(
            conn.read(
                ReadSpec(
                    table="MARA",
                    columns=["MATNR"],
                    params={"where": "MTART = 'FERT'", "delimiter": "#"},
                )
            )
        )
        body = conn._http.requests[0]["body"]  # type: ignore[union-attr]
        assert body["where"] == "MTART = 'FERT'"
        assert body["delimiter"] == "#"
        assert body["fields"] == ["MATNR"]


class TestBapiMode:
    def test_calls_bapi_endpoint(self) -> None:
        conn = connector(
            [FakeResponse(200, {"rows": [{"MATERIAL": "M1"}], "columns": ["MATERIAL"], "warnings": []})]
        )
        batches = list(
            conn.read(
                ReadSpec(
                    function="BAPI_MATERIAL_GETLIST",
                    params={"mode": "bapi", "result_table": "MATNRLIST"},
                    batch_size=10,
                )
            )
        )
        request = conn._http.requests[0]  # type: ignore[union-attr]
        assert request["url"].endswith("/bapi")
        assert request["body"]["function_name"] == "BAPI_MATERIAL_GETLIST"
        assert request["body"]["result_table"] == "MATNRLIST"
        assert batches[0].rows == [{"MATERIAL": "M1"}]

    def test_requires_function_name(self) -> None:
        conn = connector([])
        with pytest.raises(ConfigurationError, match="function_name"):
            list(conn.read(ReadSpec(table="X", params={"mode": "bapi"})))

    def test_result_is_chunked_to_batch_size(self) -> None:
        """BAPI 는 결과를 한 번에 준다 — 하위 노드가 감당하도록 쪼개 흘린다."""
        rows = [{"MATERIAL": f"M{i}"} for i in range(7)]
        conn = connector([FakeResponse(200, {"rows": rows, "columns": ["MATERIAL"], "warnings": []})])
        batches = list(
            conn.read(ReadSpec(function="BAPI_X", params={"mode": "bapi"}, batch_size=3))
        )
        assert [len(b) for b in batches] == [3, 3, 1]
        assert [b.is_last for b in batches] == [False, False, True]


class TestWriteIsUnsupported:
    def test_sap_is_source_only(self) -> None:
        conn = connector([])
        with pytest.raises(UnsupportedOperation, match="소스 전용"):
            conn.write(RecordBatch(rows=[{"a": 1}]), WriteMode.APPEND)


class TestBuildWhere:
    def test_empty(self) -> None:
        assert _build_where(ReadSpec(table="T")) == ""

    def test_base_condition_only(self) -> None:
        spec = ReadSpec(table="T", params={"where": "MTART = 'FERT'"})
        assert _build_where(spec) == "MTART = 'FERT'"

    def test_watermark_only(self) -> None:
        spec = ReadSpec(table="T", incremental_column="LAEDA", watermark="20260101")
        assert _build_where(spec) == "LAEDA > '20260101'"

    def test_base_and_watermark_are_combined(self) -> None:
        spec = ReadSpec(
            table="T",
            params={"where": "MTART = 'FERT'"},
            incremental_column="LAEDA",
            watermark="20260101",
        )
        assert _build_where(spec) == "MTART = 'FERT' AND LAEDA > '20260101'"

    def test_or_condition_is_parenthesized(self) -> None:
        """괄호가 없으면 AND 가 OR 보다 강하게 묶여 조건이 뒤집힌다."""
        spec = ReadSpec(
            table="T",
            params={"where": "MTART = 'FERT' OR MTART = 'HALB'"},
            incremental_column="LAEDA",
            watermark="20260101",
        )
        assert _build_where(spec) == "( MTART = 'FERT' OR MTART = 'HALB' ) AND LAEDA > '20260101'"

    def test_quotes_in_watermark_are_stripped(self) -> None:
        """워터마크 값이 따옴표를 품으면 WHERE 문법이 깨진다."""
        spec = ReadSpec(table="T", incremental_column="X", watermark="a'b")
        assert _build_where(spec) == "X > 'ab'"


class TestHelpers:
    def test_max_watermark_uses_uppercase_key(self) -> None:
        rows = [{"LAEDA": "20260101"}, {"LAEDA": "20260301"}]
        assert _max_watermark(rows, "laeda") == "20260301"

    def test_max_watermark_ignores_blanks(self) -> None:
        """SAP 은 빈 값을 NULL 이 아니라 공백으로 준다."""
        rows = [{"LAEDA": ""}, {"LAEDA": "20260301"}]
        assert _max_watermark(rows, "LAEDA") == "20260301"

    def test_chunk_marks_only_last_batch(self) -> None:
        batches = list(_chunk([{"a": i} for i in range(5)], ["a"], 2, None))
        assert [b.is_last for b in batches] == [False, False, True]

    def test_chunk_of_empty_rows_still_signals_end(self) -> None:
        batches = list(_chunk([], ["a"], 10, None))
        assert len(batches) == 1 and batches[0].is_last is True
