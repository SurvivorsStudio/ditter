"""SAP 사이드카 기본 주소 (방안 1).

연결이 sidecar_url 을 비워두면 시스템 기본값을 쓴다 — 연결마다 반복 입력하지 않도록.
연결에 저장하지 않으므로, 운영이 기본값을 바꾸면 기존 연결도 자동으로 따라간다.
"""

from __future__ import annotations

from typing import Any

import pytest

from eai_api.services import connection_service as svc


class FakeConnection:
    def __init__(self, config: dict[str, Any], conn_type: str = "sap_rfc") -> None:
        self.config = config
        self.type = conn_type
        self.secret_ref = None
        self.pool_size = 5
        self.ssl = False


def _no_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Store:
        def get(self, ref: str | None) -> dict[str, Any]:
            return {}

    monkeypatch.setattr(svc, "get_secret_store", lambda session: _Store())


def _set_default(monkeypatch: pytest.MonkeyPatch, url: str) -> None:
    from eai_api.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "sap_default_sidecar_url", url)


class TestSidecarDefault:
    def test_empty_sidecar_url_gets_system_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _no_secrets(monkeypatch)
        _set_default(monkeypatch, "http://sap-connector:8100")
        conn = FakeConnection({"ashost": "sap-prd", "client": "100", "user": "EAI"})

        merged = svc.resolve_config(None, conn)  # type: ignore[arg-type]
        assert merged["sidecar_url"] == "http://sap-connector:8100"

    def test_explicit_sidecar_url_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """드물게 사이드카가 여러 개일 때 — 연결에 명시한 주소가 기본값을 이긴다."""
        _no_secrets(monkeypatch)
        _set_default(monkeypatch, "http://sap-connector:8100")
        conn = FakeConnection({"sidecar_url": "http://dmz-sidecar:8100", "ashost": "h"})

        merged = svc.resolve_config(None, conn)  # type: ignore[arg-type]
        assert merged["sidecar_url"] == "http://dmz-sidecar:8100"

    def test_changing_default_affects_connections_without_explicit_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """방안 1 의 핵심: 비워둔 연결은 운영이 기본값을 바꾸면 따라간다."""
        _no_secrets(monkeypatch)
        conn = FakeConnection({"ashost": "h"})

        _set_default(monkeypatch, "http://old-sidecar:8100")
        assert svc.resolve_config(None, conn)["sidecar_url"] == "http://old-sidecar:8100"  # type: ignore[arg-type]

        _set_default(monkeypatch, "http://new-sidecar:8100")
        assert svc.resolve_config(None, conn)["sidecar_url"] == "http://new-sidecar:8100"  # type: ignore[arg-type]

    def test_non_sap_connection_is_untouched(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _no_secrets(monkeypatch)
        _set_default(monkeypatch, "http://sap-connector:8100")
        conn = FakeConnection({"host": "db"}, conn_type="postgres")

        merged = svc.resolve_config(None, conn)  # type: ignore[arg-type]
        assert "sidecar_url" not in merged
