"""Google Gemini 커넥터 (AI 모델).

설계 문서(AI_어시스턴트_설계.md) §5. 데이터 커넥터가 아니라 **AI 모델 자격증명 보관 +
헬스체크 + 텍스트 생성**만 한다. read/write/discover_schema 는 지원하지 않는다.

전송은 무거운 SDK 없이 **httpx 로 REST 직접 호출**(D8). 새 프로바이더(OpenAI·Anthropic·
Bedrock)는 각자 네이티브 방식으로 커넥터 하나씩 추가하되, `generate()` 계약은 공유한다(§5.2).

``ai_service`` 는 이 클래스의 벤더별 세부를 모른다 — 오직 ``test_connection()``·``generate()``.
"""

from __future__ import annotations

import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

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
from .errors import ConfigurationError, ConnectionFailed, ReadFailed, UnsupportedOperation

#: Gemini 는 순수 HTTP 라 별도 엔드포인트가 기본값이다. 프록시·리전용으로 config 에서 덮을 수 있다.
DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com"
DEFAULT_MODEL = "gemini-2.0-flash"


@dataclass(frozen=True, slots=True)
class GenerateResult:
    """generate() 반환. text 는 모델이 낸 최종 텍스트, usage 는 토큰 사용량(있으면)."""

    text: str
    usage: dict[str, Any] | None = None
    finish_reason: str | None = None


class GeminiConnector:
    """Google Gemini — 자연어 SQL 생성·튜닝용. BaseConnector 프로토콜의 부분 구현."""

    type = ConnectorType.GEMINI

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_MODEL,
        endpoint: str | None = None,
        timeout: float = 60.0,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not api_key:
            raise ConfigurationError("api_key 는 필수입니다", connector=str(self.type))
        self.api_key = api_key
        self.model = model or DEFAULT_MODEL
        self.endpoint = (endpoint or DEFAULT_ENDPOINT).rstrip("/")
        self.timeout = timeout
        self.extra = extra or {}

    def close(self) -> None:  # 상시 커넥션을 잡지 않는다 (요청마다 httpx 호출)
        pass

    def __enter__(self) -> GeminiConnector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------ 계약 구현

    def test_connection(self) -> HealthResult:
        """ListModels 로 키 유효성만 확인한다 (토큰 소모 없음)."""
        started = time.perf_counter()
        try:
            resp = httpx.get(
                f"{self.endpoint}/v1beta/models",
                params={"key": self.api_key},
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise ConnectionFailed(self._redact(str(exc)), connector=str(self.type), cause=exc) from exc

        latency = round((time.perf_counter() - started) * 1000, 2)
        if resp.status_code == 200:
            count = len(resp.json().get("models", []))
            return HealthResult(
                status=HealthStatus.OK, message=f"연결 정상 · 모델 {count}개", latency_ms=latency
            )
        if resp.status_code in (400, 401, 403):
            return HealthResult(
                status=HealthStatus.ERROR,
                message=f"API Key 가 유효하지 않습니다 ({self._error_message(resp)})",
                latency_ms=latency,
            )
        return HealthResult(
            status=HealthStatus.ERROR,
            message=f"예상치 못한 응답: HTTP {resp.status_code}",
            latency_ms=latency,
        )

    def generate(
        self,
        messages: Sequence[dict[str, Any]],
        *,
        system: str | None = None,
        temperature: float = 0.2,
        max_output_tokens: int | None = None,
        response_schema: dict[str, Any] | None = None,
    ) -> GenerateResult:
        """대화를 이어 한 번 생성한다.

        ``messages`` 는 ``{role: 'user'|'assistant', content: str}`` 목록.
        ``response_schema`` 를 주면 JSON 구조적 출력을 요구한다 (파이프라인 생성 확장용, §11).
        """
        url = f"{self.endpoint}/v1beta/models/{self.model}:generateContent"
        body: dict[str, Any] = {"contents": [self._to_content(m) for m in messages]}
        if system:
            body["system_instruction"] = {"parts": [{"text": system}]}
        gen_cfg: dict[str, Any] = {"temperature": temperature}
        if max_output_tokens:
            gen_cfg["maxOutputTokens"] = max_output_tokens
        if response_schema is not None:
            gen_cfg["responseMimeType"] = "application/json"
            gen_cfg["responseSchema"] = response_schema
        body["generationConfig"] = gen_cfg

        try:
            resp = httpx.post(
                url, params={"key": self.api_key}, json=body, timeout=self.timeout
            )
        except httpx.HTTPError as exc:
            raise ReadFailed(self._redact(str(exc)), connector=str(self.type), cause=exc) from exc

        if resp.status_code != 200:
            raise ReadFailed(
                f"Gemini 오류 HTTP {resp.status_code}: {self._error_message(resp)}",
                connector=str(self.type),
            )
        return self._parse(resp.json())

    # 아래 셋은 데이터 커넥터가 아니므로 지원하지 않는다 (s3 소스 read 와 같은 선례)
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
    def _to_content(msg: dict[str, Any]) -> dict[str, Any]:
        # Gemini 의 역할은 'user' / 'model' 이다. 우리의 'assistant' 를 'model' 로 옮긴다.
        role = "model" if str(msg.get("role")) in ("assistant", "model") else "user"
        return {"role": role, "parts": [{"text": str(msg.get("content", ""))}]}

    def _parse(self, data: dict[str, Any]) -> GenerateResult:
        candidates = data.get("candidates") or []
        if not candidates:
            # 후보가 없으면 대개 프롬프트가 안전필터에 걸린 것 — 조용히 빈 문자열로 넘기지 않는다
            reason = (data.get("promptFeedback") or {}).get("blockReason")
            raise ReadFailed(
                f"응답이 비었습니다{f' (차단: {reason})' if reason else ''}",
                connector=str(self.type),
            )
        first = candidates[0]
        parts = (first.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts)
        return GenerateResult(
            text=text,
            usage=data.get("usageMetadata"),
            finish_reason=first.get("finishReason"),
        )

    def _error_message(self, resp: httpx.Response) -> str:
        try:
            msg = (resp.json().get("error") or {}).get("message", "")
        except ValueError:
            msg = resp.text[:200]
        return self._redact(msg or "(본문 없음)")

    def _redact(self, text: str) -> str:
        # 예외·에러 메시지에 요청 URL(?key=...)이 섞여 나올 수 있어 키를 가린다
        return text.replace(self.api_key, "***") if self.api_key else text
