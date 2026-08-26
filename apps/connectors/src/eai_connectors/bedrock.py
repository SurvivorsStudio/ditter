"""AWS Bedrock 커넥터 (AI 모델).

Gemini 와 같은 ``generate()`` 계약을 공유한다(설계 §5.2). 전송은 boto3 의 bedrock-runtime
``converse`` API 를 쓴다 — 모델(Anthropic Claude·Llama·Titan 등)에 무관한 통일 인터페이스라
프로바이더별 요청 포맷을 우리가 몰라도 된다.

데이터 커넥터가 아니다: read/write/discover_schema 는 지원하지 않는다. 자격증명
(access_key_id / secret_access_key / region)은 연결 설정에 암호화 저장된다
(secret_access_key·session_token 은 SECRET_KEYS 라 평문 config 에 남지 않는다).
"""

from __future__ import annotations

import time
from collections.abc import Iterator, Sequence
from typing import Any

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from .base import (
    ConnectorType,
    HealthResult,
    HealthStatus,
    ReadSpec,
    RecordBatch,
    TableSchema,
    WriteMode,
    WriteResult,
)
from .errors import ConfigurationError, ReadFailed, UnsupportedOperation
from .gemini import GenerateResult  # 반환 타입은 프로바이더 공통

#: 리전·모델은 연결마다 config 로 지정한다. 아래 값은 새 연결의 기본값일 뿐이다.
DEFAULT_REGION = "us-east-1"
DEFAULT_MODEL = "anthropic.claude-3-5-sonnet-20241022-v2:0"


def _is_temperature_rejected(exc: ClientError) -> bool:
    """converse 가 temperature 를 거부한 ValidationException 인지 본다.

    신형 모델은 ``temperature`` 를 deprecated 처리하고 보내면 ValidationException 을
    던진다(메시지에 ``temperature`` 가 담긴다). 그 값만 빼고 재시도할지 판단하는 데 쓴다.
    """
    err = getattr(exc, "response", {}).get("Error", {})
    if err.get("Code") != "ValidationException":
        return False
    return "temperature" in str(err.get("Message", "")).lower()


class BedrockConnector:
    """AWS Bedrock — 자연어 SQL 생성·튜닝용. BaseConnector 프로토콜의 부분 구현."""

    type = ConnectorType.BEDROCK

    def __init__(
        self,
        *,
        access_key_id: str,
        secret_access_key: str,
        region: str | None = None,
        model: str = DEFAULT_MODEL,
        session_token: str | None = None,
        timeout: float = 60.0,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not access_key_id or not secret_access_key:
            raise ConfigurationError(
                "access_key_id·secret_access_key 는 필수입니다", connector=str(self.type)
            )
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.session_token = session_token or None
        self.region = region or DEFAULT_REGION
        self.model = model or DEFAULT_MODEL
        self.timeout = timeout
        self.extra = extra or {}

    def close(self) -> None:  # 상시 커넥션을 잡지 않는다 (요청마다 client 생성)
        pass

    def __enter__(self) -> BedrockConnector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _client(self, service: str) -> Any:
        cfg = BotoConfig(
            connect_timeout=self.timeout,
            read_timeout=self.timeout,
            retries={"max_attempts": 2, "mode": "standard"},
        )
        return boto3.client(
            service,
            region_name=self.region,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            aws_session_token=self.session_token,
            config=cfg,
        )

    # ------------------------------------------------------------ 계약 구현

    def test_connection(self) -> HealthResult:
        """ListFoundationModels 로 자격증명·리전·Bedrock 접근을 확인한다 (토큰 소모 없음)."""
        started = time.perf_counter()
        try:
            resp = self._client("bedrock").list_foundation_models()
        except (ClientError, BotoCoreError) as exc:
            return HealthResult(
                status=HealthStatus.ERROR,
                message=self._redact(str(exc)),
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
        latency = round((time.perf_counter() - started) * 1000, 2)
        count = len(resp.get("modelSummaries", []))
        return HealthResult(
            status=HealthStatus.OK, message=f"연결 정상 · 모델 {count}개", latency_ms=latency
        )

    def list_models(self) -> list[dict[str, str]]:
        """converse 로 바로 쓸 만한 모델·프로파일 목록을 (id, name) 으로 돌려준다 — 드롭다운용.

        신형 모델(Claude Sonnet 4.5 등)은 **원본 모델 ID 로 온디맨드 호출이 안 되고**
        인퍼런스 프로파일 ID(예: ``us.anthropic.…``)로만 된다. 그래서 프로파일을 먼저,
        온디맨드 직접 호출되는 파운데이션 모델을 그다음으로 싣는다.
        """
        client = self._client("bedrock")
        out: list[dict[str, str]] = []
        seen: set[str] = set()

        # 1) 인퍼런스 프로파일 — 신형 모델은 이 ID 로만 호출된다
        try:
            prof = client.list_inference_profiles()
            for p in prof.get("inferenceProfileSummaries", []):
                pid = p.get("inferenceProfileId")
                if not pid or pid in seen:
                    continue
                seen.add(str(pid))
                name = p.get("inferenceProfileName") or pid
                out.append({"id": str(pid), "name": f"[프로파일] {name}"})
        except (ClientError, BotoCoreError):
            pass  # 권한 없음·리전 미지원이면 건너뛴다 (파운데이션 모델만이라도 싣는다)

        # 2) 온디맨드로 직접 호출되는 텍스트 생성 파운데이션 모델
        try:
            fm = client.list_foundation_models(byOutputModality="TEXT", byInferenceType="ON_DEMAND")
        except (ClientError, BotoCoreError) as exc:
            if not out:  # 프로파일도 못 가져왔으면 진짜 실패다
                raise ReadFailed(
                    f"모델 목록 조회 실패: {self._redact(str(exc))}",
                    connector=str(self.type),
                    cause=exc,
                ) from exc
            fm = {}
        for m in fm.get("modelSummaries", []):
            mid = m.get("modelId")
            if not mid or mid in seen:
                continue
            seen.add(str(mid))
            name = m.get("modelName") or mid
            provider = m.get("providerName")
            out.append({"id": str(mid), "name": f"{provider} · {name}" if provider else str(name)})

        out.sort(key=lambda x: x["name"].lower())
        return out

    def generate(
        self,
        messages: Sequence[dict[str, Any]],
        *,
        system: str | None = None,
        temperature: float = 0.2,
        max_output_tokens: int | None = None,
        response_schema: dict[str, Any] | None = None,
    ) -> GenerateResult:
        """대화를 이어 한 번 생성한다. ``messages`` 는 {role, content} 목록.

        ``response_schema`` 는 Bedrock converse 의 통일 인터페이스에서 모델별로 지원이 갈려
        여기서는 무시한다(파이프라인 JSON 생성 확장 때 도구 호출로 다룬다)."""
        conv = [self._to_msg(m) for m in messages]
        inference: dict[str, Any] = {"temperature": temperature}
        if max_output_tokens:
            inference["maxTokens"] = max_output_tokens
        kwargs: dict[str, Any] = {
            "modelId": self.model,
            "messages": conv,
            "inferenceConfig": inference,
        }
        if system:
            kwargs["system"] = [{"text": system}]
        client = self._client("bedrock-runtime")
        try:
            resp = client.converse(**kwargs)
        except ClientError as exc:
            # 신형 모델(Claude Sonnet 5 등)은 temperature 를 deprecated 처리해 거부한다.
            # 모델 목록을 하드코딩하는 대신, 그 값만 빼고 한 번 재시도한다.
            if "temperature" in inference and _is_temperature_rejected(exc):
                inference.pop("temperature", None)
                if not inference:
                    kwargs.pop("inferenceConfig", None)
                try:
                    resp = client.converse(**kwargs)
                except (ClientError, BotoCoreError) as exc2:
                    raise ReadFailed(
                        f"Bedrock 오류: {self._redact(str(exc2))}",
                        connector=str(self.type),
                        cause=exc2,
                    ) from exc2
            else:
                raise ReadFailed(
                    f"Bedrock 오류: {self._redact(str(exc))}", connector=str(self.type), cause=exc
                ) from exc
        except BotoCoreError as exc:
            raise ReadFailed(
                f"Bedrock 오류: {self._redact(str(exc))}", connector=str(self.type), cause=exc
            ) from exc
        return self._parse(resp)

    # 데이터 커넥터가 아니므로 지원하지 않는다 (gemini 와 동일)
    def discover_schema(
        self, table: str | None = None, *, include_pk: bool = True, include_columns: bool = True
    ) -> list[TableSchema]:
        return []

    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        raise UnsupportedOperation("AI 모델은 데이터 소스가 아닙니다", connector=str(self.type))

    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult:
        raise UnsupportedOperation("AI 모델은 데이터 타깃이 아닙니다", connector=str(self.type))

    # -------------------------------------------------------------- 내부 헬퍼

    @staticmethod
    def _to_msg(msg: dict[str, Any]) -> dict[str, Any]:
        # Bedrock converse 의 역할은 'user' / 'assistant'. 우리의 'model' 을 'assistant' 로 옮긴다.
        role = "assistant" if str(msg.get("role")) in ("assistant", "model") else "user"
        return {"role": role, "content": [{"text": str(msg.get("content", ""))}]}

    def _parse(self, resp: dict[str, Any]) -> GenerateResult:
        content = (((resp.get("output") or {}).get("message") or {}).get("content")) or []
        text = "".join(c.get("text", "") for c in content if isinstance(c, dict))
        if not text:
            raise ReadFailed("응답이 비었습니다", connector=str(self.type))
        return GenerateResult(
            text=text, usage=resp.get("usage"), finish_reason=resp.get("stopReason")
        )

    def _redact(self, text: str) -> str:
        # 예외 메시지에 자격증명이 섞여 나올 수 있어 가린다
        out = text
        for secret in (self.secret_access_key, self.session_token):
            if secret:
                out = out.replace(secret, "***")
        return out
