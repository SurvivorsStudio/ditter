"""AWS Bedrock AI 커넥터 — 네트워크 없이 되는 것만 검증한다.

실제 Bedrock 호출은 AWS 자격증명이 필요하니 통합 검증 몫이고, 여기서는:
 - 레지스트리 등록 · 키 필터링
 - 필수 자격증명 검증
 - converse 요청 조립(역할 매핑·system)과 응답 파싱
 - test_connection 의 정상/오류 매핑, 자격증명 마스킹
 - 데이터 소스/타깃이 아님(UnsupportedOperation)

boto3 클라이언트는 ``_client`` 를 가짜로 바꿔 대체한다 — 네트워크·SDK 초기화 없이.
"""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError

from eai_connectors import build, supported_types
from eai_connectors.base import ConnectorType, HealthStatus
from eai_connectors.bedrock import BedrockConnector
from eai_connectors.errors import ReadFailed, UnsupportedOperation


def _conn(**over: Any) -> BedrockConnector:
    cfg = {
        "access_key_id": "AKIA_x",
        "secret_access_key": "sekret",
        "region": "us-east-1",
        "model": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    }
    cfg.update(over)
    return BedrockConnector(**cfg)  # type: ignore[arg-type]


class _FakeRuntime:
    """converse 호출을 가로채 인자를 기록하고 정해진 응답을 돌려준다."""

    def __init__(self, response: dict) -> None:
        self.response = response
        self.last_kwargs: dict[str, Any] | None = None

    def converse(self, **kwargs: Any) -> dict:
        self.last_kwargs = kwargs
        return self.response


def test_registered_and_key_filtering() -> None:
    assert "bedrock" in supported_types()
    # pool_size 는 _BEDROCK_KEYS 밖이라 extra 로 흘러가고 생성은 성공한다
    conn = build(
        "bedrock",
        {"access_key_id": "a", "secret_access_key": "s", "region": "us-west-2", "pool_size": 5},
    )
    assert conn.type is ConnectorType.BEDROCK
    assert conn.region == "us-west-2"
    assert conn.extra.get("pool_size") == 5


def test_credentials_required() -> None:
    with pytest.raises(Exception):
        BedrockConnector(access_key_id="", secret_access_key="s")
    with pytest.raises(Exception):
        BedrockConnector(access_key_id="a", secret_access_key="")


def test_to_msg_role_mapping() -> None:
    assert BedrockConnector._to_msg({"role": "user", "content": "hi"}) == {
        "role": "user",
        "content": [{"text": "hi"}],
    }
    # 우리의 'assistant'/'model' 은 converse 의 'assistant' 로 간다
    assert BedrockConnector._to_msg({"role": "model", "content": "x"})["role"] == "assistant"
    assert BedrockConnector._to_msg({"role": "assistant", "content": "y"})["role"] == "assistant"


def test_generate_assembles_and_parses(monkeypatch) -> None:
    fake = _FakeRuntime(
        {
            "output": {"message": {"content": [{"text": "SELECT 1"}]}},
            "usage": {"inputTokens": 3, "outputTokens": 2},
            "stopReason": "end_turn",
        }
    )
    conn = _conn()
    monkeypatch.setattr(conn, "_client", lambda service: fake)
    out = conn.generate(
        [{"role": "user", "content": "1 을 select"}], system="너는 SQL 도우미", max_output_tokens=100
    )
    assert out.text == "SELECT 1"
    assert out.finish_reason == "end_turn"
    # 요청 조립 확인: modelId·system·inferenceConfig(maxTokens)
    kw = fake.last_kwargs
    assert kw is not None
    assert kw["modelId"] == conn.model
    assert kw["system"] == [{"text": "너는 SQL 도우미"}]
    assert kw["inferenceConfig"]["maxTokens"] == 100
    assert kw["messages"][0] == {"role": "user", "content": [{"text": "1 을 select"}]}


class _TempRejectingRuntime:
    """첫 converse 는 temperature 를 거부하고(신형 모델), 재시도(temperature 없음)는 성공한다."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def converse(self, **kwargs: Any) -> dict:
        import copy

        self.calls.append(copy.deepcopy(kwargs))  # 재시도가 같은 dict 를 in-place 로 고치므로 스냅샷
        if "temperature" in kwargs.get("inferenceConfig", {}):
            raise ClientError(
                {
                    "Error": {
                        "Code": "ValidationException",
                        "Message": "The model returned the following errors: `temperature` is deprecated for this model.",
                    }
                },
                "Converse",
            )
        return {"output": {"message": {"content": [{"text": "SELECT 1"}]}}, "stopReason": "end_turn"}


def test_generate_retries_without_temperature_when_deprecated(monkeypatch) -> None:
    """Sonnet 5 등은 temperature 를 거부한다 — 그 값만 빼고 한 번 재시도해 성공해야 한다."""
    fake = _TempRejectingRuntime()
    conn = _conn(model="us.anthropic.claude-sonnet-5")
    monkeypatch.setattr(conn, "_client", lambda service: fake)
    out = conn.generate([{"role": "user", "content": "1 을 select"}], max_output_tokens=100)
    assert out.text == "SELECT 1"
    # 두 번 불렀고, 재시도에는 temperature 가 없다
    assert len(fake.calls) == 2
    assert "temperature" in fake.calls[0]["inferenceConfig"]
    assert "temperature" not in fake.calls[1].get("inferenceConfig", {})
    # maxTokens 는 재시도에도 남아 있어야 한다
    assert fake.calls[1]["inferenceConfig"]["maxTokens"] == 100


def test_generate_other_validation_error_not_retried(monkeypatch) -> None:
    """temperature 와 무관한 ValidationException 은 재시도 없이 그대로 실패한다."""

    class _Boom:
        def __init__(self) -> None:
            self.n = 0

        def converse(self, **kwargs: Any) -> dict:
            self.n += 1
            raise ClientError(
                {"Error": {"Code": "ValidationException", "Message": "model not found"}}, "Converse"
            )

    boom = _Boom()
    conn = _conn()
    monkeypatch.setattr(conn, "_client", lambda service: boom)
    with pytest.raises(ReadFailed):
        conn.generate([{"role": "user", "content": "x"}])
    assert boom.n == 1  # 재시도하지 않는다


def test_generate_empty_response_raises(monkeypatch) -> None:
    conn = _conn()
    monkeypatch.setattr(conn, "_client", lambda service: _FakeRuntime({"output": {"message": {"content": []}}}))
    with pytest.raises(ReadFailed):
        conn.generate([{"role": "user", "content": "x"}])


def test_test_connection_ok(monkeypatch) -> None:
    class _FakeControl:
        def list_foundation_models(self) -> dict:
            return {"modelSummaries": [1, 2]}

    conn = _conn()
    monkeypatch.setattr(conn, "_client", lambda service: _FakeControl())
    result = conn.test_connection()
    assert result.status is HealthStatus.OK
    assert "2" in result.message


def test_test_connection_error_masks(monkeypatch) -> None:
    class _FakeControl:
        def list_foundation_models(self) -> dict:
            raise ClientError(
                {"Error": {"Code": "UnauthorizedException", "Message": "bad sekret creds"}},
                "ListFoundationModels",
            )

    conn = _conn()
    monkeypatch.setattr(conn, "_client", lambda service: _FakeControl())
    result = conn.test_connection()
    assert result.status is HealthStatus.ERROR
    # 자격증명이 메시지에 그대로 남지 않는다
    assert "sekret" not in result.message


def test_not_a_data_source_or_target() -> None:
    conn = _conn()
    with pytest.raises(UnsupportedOperation):
        list(conn.read(None))  # type: ignore[arg-type]
    with pytest.raises(UnsupportedOperation):
        conn.write(None, None)  # type: ignore[arg-type]
    assert conn.discover_schema() == []


def test_redact_masks_secret_and_token() -> None:
    conn = _conn(session_token="tok123")
    masked = conn._redact("err sekret and tok123 leaked")
    assert "sekret" not in masked
    assert "tok123" not in masked
