"""Gemini AI 커넥터 — 네트워크 없이 되는 것만 검증한다.

실제 Gemini 호출은 사용자 키가 필요하니 통합 검증 몫이고, 여기서는:
 - 레지스트리 등록 · 키 필터링
 - test_connection 응답 코드 → HealthStatus 매핑
 - generate 요청 조립(역할 매핑·system·response_schema)과 응답 파싱
 - 오류·차단을 조용히 넘기지 않고 키를 가리는지
 - 데이터 소스/타깃이 아님(UnsupportedOperation)
"""

from __future__ import annotations

from typing import ClassVar

import pytest

import eai_connectors.gemini as gemini_mod
from eai_connectors import build, supported_types
from eai_connectors.base import ConnectorType, HealthStatus
from eai_connectors.errors import ConfigurationError, ReadFailed, UnsupportedOperation
from eai_connectors.gemini import GeminiConnector


class _FakeResp:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def test_registered_and_key_filtering() -> None:
    assert "gemini" in supported_types()
    # pool_size 는 _GEMINI_KEYS 밖이라 extra 로 흘러가고 생성은 성공한다
    conn = build("gemini", {"api_key": "k", "model": "m", "pool_size": 5})
    assert conn.type is ConnectorType.GEMINI
    assert conn.model == "m"
    assert conn.extra.get("pool_size") == 5


def test_api_key_required() -> None:
    with pytest.raises(ConfigurationError):
        GeminiConnector(api_key="")


def test_test_connection_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        gemini_mod.httpx, "get", lambda *a, **k: _FakeResp(200, {"models": [1, 2, 3]})
    )
    res = GeminiConnector(api_key="k").test_connection()
    assert res.status is HealthStatus.OK
    assert "3" in res.message


def test_test_connection_bad_key(monkeypatch) -> None:
    monkeypatch.setattr(
        gemini_mod.httpx,
        "get",
        lambda *a, **k: _FakeResp(403, {"error": {"message": "API key not valid"}}),
    )
    res = GeminiConnector(api_key="k").test_connection()
    assert res.status is HealthStatus.ERROR
    assert "유효" in res.message


def test_generate_builds_request_and_parses(monkeypatch) -> None:
    captured: dict = {}

    def fake_post(url, *, params, json, timeout):
        captured["url"] = url
        captured["params"] = params
        captured["json"] = json
        return _FakeResp(
            200,
            {
                "candidates": [{"content": {"parts": [{"text": "SELECT 1"}]}, "finishReason": "STOP"}],
                "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 2},
            },
        )

    monkeypatch.setattr(gemini_mod.httpx, "post", fake_post)
    conn = GeminiConnector(api_key="secret", model="gemini-2.0-flash")
    out = conn.generate(
        [{"role": "user", "content": "3개 뽑아줘"}, {"role": "assistant", "content": "이전"}],
        system="너는 SQL 도우미다",
        response_schema={"type": "object"},
    )
    assert out.text == "SELECT 1"
    assert out.usage["promptTokenCount"] == 5
    # 역할 매핑: assistant → model
    roles = [c["role"] for c in captured["json"]["contents"]]
    assert roles == ["user", "model"]
    # system_instruction 과 구조적 출력이 요청에 실린다
    assert captured["json"]["system_instruction"]["parts"][0]["text"] == "너는 SQL 도우미다"
    assert captured["json"]["generationConfig"]["responseMimeType"] == "application/json"
    assert "gemini-2.0-flash:generateContent" in captured["url"]
    assert captured["params"]["key"] == "secret"


def test_generate_http_error_redacts_key(monkeypatch) -> None:
    monkeypatch.setattr(
        gemini_mod.httpx,
        "post",
        lambda *a, **k: _FakeResp(429, {"error": {"message": "quota for key secret exceeded"}}),
    )
    conn = GeminiConnector(api_key="secret")
    with pytest.raises(ReadFailed) as ei:
        conn.generate([{"role": "user", "content": "x"}])
    assert "secret" not in str(ei.value)  # 키가 메시지에 새면 안 된다
    assert "***" in str(ei.value)


def test_generate_blocked_is_loud(monkeypatch) -> None:
    monkeypatch.setattr(
        gemini_mod.httpx,
        "post",
        lambda *a, **k: _FakeResp(200, {"promptFeedback": {"blockReason": "SAFETY"}}),
    )
    with pytest.raises(ReadFailed):
        GeminiConnector(api_key="k").generate([{"role": "user", "content": "x"}])


def test_not_a_data_connector() -> None:
    conn = GeminiConnector(api_key="k")
    assert conn.discover_schema() == []
    with pytest.raises(UnsupportedOperation):
        list(conn.read(_DummySpec()))  # type: ignore[arg-type]
    with pytest.raises(UnsupportedOperation):
        conn.write(_DummyBatch(), None)  # type: ignore[arg-type]


class _DummySpec:
    pass


class _DummyBatch:
    rows: ClassVar[list] = []
