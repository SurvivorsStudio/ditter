"""사이드카 HTTP API — 목 백엔드로 전체 경로를 통과시킨다."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from eai_sap.backends import reset_backends
from eai_sap.config import Settings, get_settings
from eai_sap.main import app

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "sap_mock.json"


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_settings] = lambda: Settings(
        backend="mock", mock_fixture=str(FIXTURE), api_token=""
    )
    reset_backends()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    reset_backends()


@pytest.fixture
def secured_client() -> Iterator[TestClient]:
    app.dependency_overrides[get_settings] = lambda: Settings(
        backend="mock", mock_fixture=str(FIXTURE), api_token="s3cr3t-token"
    )
    reset_backends()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    reset_backends()


class TestHealthAndPing:
    def test_health_does_not_touch_sap(self, client: TestClient) -> None:
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert body["backend"] == "mock"

    def test_ping_returns_system_info(self, client: TestClient) -> None:
        body = client.post("/ping", json={}).json()
        assert body["system_id"] == "PRD"
        assert body["mock"] is True


class TestAuth:
    def test_token_required_when_configured(self, secured_client: TestClient) -> None:
        assert secured_client.post("/ping", json={}).status_code == 401

    def test_wrong_token_rejected(self, secured_client: TestClient) -> None:
        response = secured_client.post("/ping", json={}, headers={"X-Sap-Token": "wrong"})
        assert response.status_code == 401

    def test_correct_token_accepted(self, secured_client: TestClient) -> None:
        response = secured_client.post("/ping", json={}, headers={"X-Sap-Token": "s3cr3t-token"})
        assert response.status_code == 200

    def test_health_is_open(self, secured_client: TestClient) -> None:
        """헬스체크는 토큰 없이도 통해야 컨테이너 오케스트레이터가 쓸 수 있다."""
        assert secured_client.get("/health").status_code == 200


class TestSchema:
    def test_reports_fields_and_width(self, client: TestClient) -> None:
        body = client.post("/schema", json={"table": "MARA"}).json()
        assert body["table"] == "MARA"
        assert len(body["fields"]) == 54
        assert body["total_width"] == 599

    def test_flags_tables_needing_split(self, client: TestClient) -> None:
        """UI 가 '이 테이블은 나눠 읽어야 한다'를 미리 알려줄 수 있어야 한다."""
        assert client.post("/schema", json={"table": "MARA"}).json()["requires_split"] is True

    def test_unknown_table_is_a_bad_gateway(self, client: TestClient) -> None:
        response = client.post("/schema", json={"table": "NOSUCHTABLE"})
        assert response.status_code == 502
        assert response.json()["retryable"] is False


class TestReadTable:
    def test_narrow_selection_needs_no_split(self, client: TestClient) -> None:
        body = client.post(
            "/read-table", json={"table": "MARA", "fields": ["MATNR", "MTART", "LAEDA"]}
        ).json()
        assert body["field_groups"] == 1
        assert len(body["rows"]) == 7
        assert body["columns"] == ["MATNR", "MTART", "LAEDA"]

    def test_full_table_triggers_split_and_merges_back(self, client: TestClient) -> None:
        """599자 테이블 전체를 요청해도 호출자는 분할을 몰라도 된다."""
        body = client.post("/read-table", json={"table": "MARA"}).json()
        assert body["field_groups"] > 1
        assert len(body["columns"]) == 54
        assert all(len(row) == 54 for row in body["rows"])
        assert body["warnings"]

    def test_split_merge_keeps_values_aligned(self, client: TestClient) -> None:
        body = client.post("/read-table", json={"table": "MARA"}).json()
        row = next(r for r in body["rows"] if r["MATNR"] == "MAT-0000000003")
        # 서로 다른 그룹에 속한 필드들이 같은 행에 제대로 모였는지
        assert row["MTART"] == "HALB"
        assert row["WRKST"] == "MDF"
        assert row["MEABM"] == "MM"

    def test_where_clause_filters(self, client: TestClient) -> None:
        body = client.post(
            "/read-table",
            json={"table": "MARA", "fields": ["MATNR", "LAEDA"], "where": "LAEDA > '20260710'"},
        ).json()
        assert len(body["rows"]) == 4
        assert all(r["LAEDA"] > "20260710" for r in body["rows"])

    def test_pagination_does_not_overlap(self, client: TestClient) -> None:
        first = client.post(
            "/read-table", json={"table": "MARA", "fields": ["MATNR"], "row_count": 3}
        ).json()
        second = client.post(
            "/read-table",
            json={"table": "MARA", "fields": ["MATNR"], "row_skips": 3, "row_count": 3},
        ).json()
        assert first["truncated"] is True
        ids_first = {r["MATNR"] for r in first["rows"]}
        ids_second = {r["MATNR"] for r in second["rows"]}
        assert not ids_first & ids_second

    def test_unknown_field_is_reported(self, client: TestClient) -> None:
        response = client.post("/read-table", json={"table": "MARA", "fields": ["NOPE"]})
        assert response.status_code == 502
        assert "NOPE" in response.json()["detail"]

    def test_korean_values_round_trip(self, client: TestClient) -> None:
        body = client.post("/read-table", json={"table": "MARA", "fields": ["MATNR", "WRKST"]}).json()
        assert any("펄프" in r["WRKST"] for r in body["rows"])


class TestBapi:
    def test_material_getlist(self, client: TestClient) -> None:
        body = client.post("/bapi", json={"function_name": "BAPI_MATERIAL_GETLIST"}).json()
        assert len(body["rows"]) == 7
        assert "MATERIAL" in body["columns"]

    def test_return_error_becomes_bad_gateway(self, client: TestClient) -> None:
        response = client.post(
            "/bapi", json={"function_name": "BAPI_MATERIAL_GETLIST", "parameters": {"MAXROWS": 0}}
        )
        assert response.status_code == 502
        assert "자재가 없" in response.json()["detail"]

    def test_unknown_function(self, client: TestClient) -> None:
        response = client.post("/bapi", json={"function_name": "BAPI_NOPE"})
        assert response.status_code == 502


def test_reset_clears_the_connection(client: TestClient) -> None:
    assert client.post("/ping", json={}).status_code == 200
    assert client.post("/reset").json()["status"] == "reset"
    assert client.post("/ping", json={}).status_code == 200
