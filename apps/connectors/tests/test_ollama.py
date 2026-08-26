"""Ollama 커넥터 — 네트워크 없이 되는 것만 검증한다.

실제 추론은 모델을 내려받아야 하니 통합 검증 몫이고, 여기서는:
 - 레지스트리 등록 · 키 필터링
 - test_connection 이 **모델 미보유를 잡아내는지** (서버만 보면 나중에 404 로 늦게 터진다)
 - generate 요청 조립 (system 을 첫 메시지로, 역할 매핑, stream=False)
 - <think> 블록 제거 · usage 키를 Gemini 모양으로 맞추는지
 - 빈 응답·오류를 조용히 넘기지 않는지
 - 데이터 소스/타깃이 아님(UnsupportedOperation)
"""

from __future__ import annotations

import pytest

import eai_connectors.ollama as ollama_mod
from eai_connectors import build, supported_types
from eai_connectors.base import ConnectorType, HealthStatus, ReadSpec, RecordBatch, WriteMode
from eai_connectors.errors import (
    ConfigurationError,
    ConnectionFailed,
    ReadFailed,
    UnsupportedOperation,
)
from eai_connectors.ollama import OllamaConnector


class _FakeResp:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def _tags(*names: str) -> dict:
    return {"models": [{"model": n, "name": n} for n in names]}


def test_registered_and_key_filtering() -> None:
    assert "ollama" in supported_types()
    # api_key 는 _OLLAMA_KEYS 밖이라 extra 로 흘러간다 (로컬 모델엔 자격증명이 없다)
    conn = build("ollama", {"model": "m", "endpoint": "http://h:1/", "api_key": "x"})
    assert conn.type is ConnectorType.OLLAMA
    assert conn.model == "m"
    assert conn.endpoint == "http://h:1"  # 끝의 / 는 떨어진다
    assert conn.extra.get("api_key") == "x"


def test_timeout_from_config_is_coerced() -> None:
    """폼에서 온 값은 문자열일 수 있다 — 여기서 못 막으면 httpx 가 뒤늦게 터진다."""
    assert build("ollama", {"model": "m", "timeout": "45"}).timeout == 45.0
    with pytest.raises(ConfigurationError):
        build("ollama", {"model": "m", "timeout": "빠르게"})


def test_defaults() -> None:
    conn = OllamaConnector()
    assert conn.endpoint == ollama_mod.DEFAULT_ENDPOINT
    assert conn.model == ollama_mod.DEFAULT_MODEL


def test_test_connection_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        ollama_mod.httpx, "get", lambda *a, **k: _FakeResp(200, _tags("qwen3:8b", "gemma3:4b"))
    )
    res = OllamaConnector(model="qwen3:8b").test_connection()
    assert res.status is HealthStatus.OK
    assert "qwen3:8b" in res.message


def test_test_connection_accepts_tag_omission(monkeypatch) -> None:
    """사용자가 태그를 생략하는 일이 잦다 — 그걸로 막지 않는다."""
    monkeypatch.setattr(ollama_mod.httpx, "get", lambda *a, **k: _FakeResp(200, _tags("qwen3:latest")))
    assert OllamaConnector(model="qwen3").test_connection().status is HealthStatus.OK


def test_test_connection_model_not_pulled(monkeypatch) -> None:
    """서버는 살아 있는데 모델이 없는 경우 — 여기서 잡지 않으면 생성 시점에 터진다."""
    monkeypatch.setattr(ollama_mod.httpx, "get", lambda *a, **k: _FakeResp(200, _tags("gemma3:4b")))
    res = OllamaConnector(model="qwen3:8b").test_connection()
    assert res.status is HealthStatus.ERROR
    assert "ollama pull qwen3:8b" in res.message


def test_test_connection_server_down(monkeypatch) -> None:
    def boom(*a, **k):
        raise ollama_mod.httpx.ConnectError("refused")

    monkeypatch.setattr(ollama_mod.httpx, "get", boom)
    with pytest.raises(ConnectionFailed):
        OllamaConnector().test_connection()


def test_generate_request_and_parse(monkeypatch) -> None:
    seen: dict = {}

    def fake_post(url, json=None, timeout=None):
        seen["url"] = url
        seen["body"] = json
        return _FakeResp(
            200,
            {
                "message": {"role": "assistant", "content": "<think>고민</think>\nSELECT 1"},
                "done_reason": "stop",
                "prompt_eval_count": 11,
                "eval_count": 4,
            },
        )

    monkeypatch.setattr(ollama_mod.httpx, "post", fake_post)
    res = OllamaConnector(model="qwen3:8b").generate(
        [{"role": "user", "content": "안녕"}, {"role": "model", "content": "네"}],
        system="너는 SQL 도우미다",
    )

    assert seen["url"].endswith("/api/chat")
    body = seen["body"]
    assert body["stream"] is False
    # 사고 과정은 화면에 쓸모가 없는데 로컬 CPU 에서 시간을 몇 배로 늘린다
    assert body["think"] is False
    assert body["messages"][0] == {"role": "system", "content": "너는 SQL 도우미다"}
    # 우리의 'model' 역할은 Ollama 의 'assistant' 로 옮겨진다
    assert [m["role"] for m in body["messages"]] == ["system", "user", "assistant"]

    assert res.text == "SELECT 1"  # <think> 블록은 걷어낸다
    assert res.finish_reason == "stop"
    assert res.usage == {
        "promptTokenCount": 11,
        "candidatesTokenCount": 4,
        "totalTokenCount": 15,
    }


def test_generate_passes_response_schema(monkeypatch) -> None:
    seen: dict = {}

    def fake_post(url, json=None, timeout=None):
        seen["body"] = json
        return _FakeResp(200, {"message": {"content": "{}"}})

    monkeypatch.setattr(ollama_mod.httpx, "post", fake_post)
    schema = {"type": "object"}
    OllamaConnector().generate([{"role": "user", "content": "x"}], response_schema=schema)
    assert seen["body"]["format"] == schema


def test_generate_retries_without_think(monkeypatch) -> None:
    """사고를 지원하지 않는 모델은 think 필드를 거부한다 — 그때만 빼고 한 번 더 부른다."""
    calls: list[dict] = []

    def fake_post(url, json=None, timeout=None):
        calls.append(json)
        if "think" in json:
            return _FakeResp(400, {"error": "model does not support thinking"})
        return _FakeResp(200, {"message": {"content": "SELECT 1"}})

    monkeypatch.setattr(ollama_mod.httpx, "post", fake_post)
    res = OllamaConnector().generate([{"role": "user", "content": "x"}])
    assert res.text == "SELECT 1"
    assert len(calls) == 2 and "think" not in calls[1]


def test_generate_error_unrelated_to_think_is_not_retried(monkeypatch) -> None:
    calls: list[dict] = []

    def fake_post(url, json=None, timeout=None):
        calls.append(json)
        return _FakeResp(500, {"error": "out of memory"})

    monkeypatch.setattr(ollama_mod.httpx, "post", fake_post)
    with pytest.raises(ReadFailed, match="out of memory"):
        OllamaConnector().generate([{"role": "user", "content": "x"}])
    assert len(calls) == 1


def test_generate_http_error(monkeypatch) -> None:
    monkeypatch.setattr(
        ollama_mod.httpx, "post", lambda *a, **k: _FakeResp(404, {"error": "model not found"})
    )
    with pytest.raises(ReadFailed, match="model not found"):
        OllamaConnector().generate([{"role": "user", "content": "x"}])


def test_generate_empty_is_loud(monkeypatch) -> None:
    """빈 응답을 조용히 넘기면 'AI 가 아무 말도 안 한다'로만 보인다."""
    monkeypatch.setattr(
        ollama_mod.httpx, "post", lambda *a, **k: _FakeResp(200, {"message": {"content": "  "}})
    )
    with pytest.raises(ReadFailed):
        OllamaConnector().generate([{"role": "user", "content": "x"}])


def test_not_a_data_connector() -> None:
    conn = OllamaConnector()
    assert conn.discover_schema() == []
    with pytest.raises(UnsupportedOperation):
        next(conn.read(ReadSpec(table="t")))
    with pytest.raises(UnsupportedOperation):
        conn.write(RecordBatch(rows=[]), WriteMode.APPEND)
