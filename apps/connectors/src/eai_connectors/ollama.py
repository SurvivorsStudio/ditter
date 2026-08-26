"""Ollama 커넥터 (로컬 오픈웨이트 AI 모델).

Gemini·Bedrock 과 같은 `generate()` 계약을 구현하되, **상용 API 없이** 자기 장비에서
도는 경로다. `ai_service` 는 여전히 벤더를 모른다 — `test_connection()`·`generate()` 뿐이다.

왜 이 커넥터가 필요한가 (오픈소스 개발자대회 운영규정 제9조 · [별표 2]):
상용 API 호출로만 작동하는 출품작은 '독립 구동 가능성'을 충족하지 못한다. 오픈웨이트
모델을 직접 구동하는 경로를 함께 갖추면 제한 대상이 아니되, **그 경로가 실제로 동작한다는
점을 소스코드와 실행 방법으로 보여야 한다.** 이 파일과 `docker compose --profile ai` 가 그것이다.

전송은 Gemini 와 같은 이유로 SDK 없이 httpx 직접 호출이다.
"""

from __future__ import annotations

import re
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

#: compose 의 `ollama` 서비스 기준. 호스트에서 직접 돌릴 때(맥의 GPU 등)는
#: http://host.docker.internal:11434 로 덮는다.
DEFAULT_ENDPOINT = "http://ollama:11434"
#: Apache-2.0 로 배포되는 오픈웨이트 모델. 라이선스 제약이 가장 적어 기본값으로 둔다.
#: 장비가 작으면 더 작은 모델로 바꾼다 — 연결 설정에서 고르면 된다.
DEFAULT_MODEL = "qwen3:8b"
#: 로컬 CPU 추론은 상용 API 보다 훨씬 느리다. 장비가 느리면 연결 설정에서 늘린다.
DEFAULT_TIMEOUT = 180.0

#: 사고 과정을 본문에 <think>…</think> 로 섞어 내보내는 모델이 있다(구형 빌드·일부 파인튜닝).
#: 요즘 Ollama 는 `thinking` 필드로 갈라 주지만 그렇지 않은 경우를 대비해 본문에서도 걷어낸다.
#: 그대로 두면 SQL 앞에 장문의 독백이 붙어 화면이 못 쓰게 된다.
_THINK_BLOCK = re.compile(r"<think>.*?</think>\s*", re.DOTALL | re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class GenerateResult:
    """generate() 반환. gemini.GenerateResult 와 같은 모양이다 (호출부가 구분하지 않는다)."""

    text: str
    usage: dict[str, Any] | None = None
    finish_reason: str | None = None


class OllamaConnector:
    """Ollama — 로컬에서 구동하는 오픈웨이트 모델. BaseConnector 프로토콜의 부분 구현."""

    type = ConnectorType.OLLAMA

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        model: str = DEFAULT_MODEL,
        timeout: float | str = DEFAULT_TIMEOUT,  # 로컬 CPU 추론은 상용 API 보다 훨씬 느리다
        extra: dict[str, Any] | None = None,
    ) -> None:
        self.endpoint = (endpoint or DEFAULT_ENDPOINT).rstrip("/")
        self.model = model or DEFAULT_MODEL
        if not self.model:
            raise ConfigurationError("model 은 필수입니다", connector=str(self.type))
        # 연결 설정에서 온 값은 문자열일 수 있다 — 여기서 못 막으면 httpx 가 뒤늦게 터진다
        try:
            self.timeout = float(timeout) if timeout else DEFAULT_TIMEOUT
        except (TypeError, ValueError) as exc:
            raise ConfigurationError(
                f"timeout 이 숫자가 아닙니다: {timeout!r}", connector=str(self.type)
            ) from exc
        self.extra = extra or {}

    def close(self) -> None:  # 상시 커넥션을 잡지 않는다 (요청마다 httpx 호출)
        pass

    def __enter__(self) -> OllamaConnector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------ 계약 구현

    def test_connection(self) -> HealthResult:
        """서버 접속과 **모델이 실제로 내려받아져 있는지**를 함께 본다.

        서버만 확인하고 넘어가면 나중에 생성 시점에 404 로 실패한다 — 그때는 "AI 가
        안 된다"로만 보여 원인을 찾기 어렵다. 여기서 `ollama pull` 을 하라고 알려 준다.
        """
        started = time.perf_counter()
        try:
            resp = httpx.get(f"{self.endpoint}/api/tags", timeout=min(self.timeout, 15.0))
        except httpx.HTTPError as exc:
            raise ConnectionFailed(
                f"Ollama 에 연결할 수 없습니다 ({self.endpoint}): {exc}",
                connector=str(self.type),
                cause=exc,
            ) from exc

        latency = round((time.perf_counter() - started) * 1000, 2)
        if resp.status_code != 200:
            return HealthResult(
                status=HealthStatus.ERROR,
                message=f"예상치 못한 응답: HTTP {resp.status_code}",
                latency_ms=latency,
            )

        installed = self._installed_models(resp)
        if not self._has_model(installed):
            hint = f"`ollama pull {self.model}` 로 먼저 내려받으세요"
            have = f" · 보유: {', '.join(sorted(installed)[:5])}" if installed else " · 보유 모델 없음"
            return HealthResult(
                status=HealthStatus.ERROR,
                message=f"모델 '{self.model}' 이 없습니다 — {hint}{have}",
                latency_ms=latency,
            )
        return HealthResult(
            status=HealthStatus.OK,
            message=f"연결 정상 · 모델 {len(installed)}개 (사용: {self.model})",
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
        """대화를 이어 한 번 생성한다. 인자는 Gemini 커넥터와 같다."""
        chat: list[dict[str, Any]] = []
        if system:
            # Ollama 는 system 을 별도 필드가 아니라 messages 의 첫 항목으로 받는다.
            chat.append({"role": "system", "content": system})
        chat.extend(self._to_message(m) for m in messages)

        options: dict[str, Any] = {"temperature": temperature}
        if max_output_tokens:
            options["num_predict"] = max_output_tokens
        body: dict[str, Any] = {
            "model": self.model,
            "messages": chat,
            "stream": False,  # 스트리밍을 켜면 줄 단위 JSON 이라 파싱 경로가 갈린다
            "options": options,
        }
        if response_schema is not None:
            body["format"] = response_schema
        # 사고 과정은 우리 화면에 쓸모가 없는데 **시간을 몇 배로 늘린다** — 로컬 CPU 에서는
        # 이것 하나로 타임아웃이 갈렸다(qwen3:0.6b 실측: 180초 초과 → 37초).
        #
        # Ollama 0.33 은 사고를 못 하는 모델에 이 필드가 와도 200 으로 무시한다(qwen2.5 로 확인).
        # 다만 그렇지 않은 빌드가 있어, 오류에 'think' 가 보이면 그때만 빼고 한 번 더 부른다.
        # 모델 목록을 들고 다니며 분기하지 않으려는 것이다 — 그 목록은 반드시 낡는다.
        body["think"] = False

        resp = self._post(body)
        if resp.status_code != 200 and "think" in self._error_message(resp).lower():
            body.pop("think", None)
            resp = self._post(body)

        if resp.status_code != 200:
            raise ReadFailed(
                f"Ollama 오류 HTTP {resp.status_code}: {self._error_message(resp)}",
                connector=str(self.type),
            )
        return self._parse(resp.json())

    def _post(self, body: dict[str, Any]) -> httpx.Response:
        try:
            return httpx.post(f"{self.endpoint}/api/chat", json=body, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise ReadFailed(
                f"Ollama 호출 실패 ({self.endpoint}): {exc}", connector=str(self.type), cause=exc
            ) from exc

    # 아래 셋은 데이터 커넥터가 아니므로 지원하지 않는다 (gemini 와 같은 선례)
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
    def _to_message(msg: dict[str, Any]) -> dict[str, Any]:
        # Ollama 의 역할은 system / user / assistant 다. 우리의 'model' 을 assistant 로 옮긴다.
        role = "assistant" if str(msg.get("role")) in ("assistant", "model") else "user"
        return {"role": role, "content": str(msg.get("content", ""))}

    @staticmethod
    def _installed_models(resp: httpx.Response) -> set[str]:
        try:
            models = resp.json().get("models") or []
        except ValueError:
            return set()
        names: set[str] = set()
        for m in models:
            for key in ("model", "name"):
                v = m.get(key)
                if isinstance(v, str) and v:
                    names.add(v)
        return names

    def _has_model(self, installed: set[str]) -> bool:
        if self.model in installed:
            return True
        # 사용자가 태그를 생략하는 일이 잦다 ('qwen3' ↔ 'qwen3:latest'). 그걸로 막지 않는다.
        base = self.model.split(":", 1)[0]
        return any(name.split(":", 1)[0] == base for name in installed)

    def _parse(self, data: dict[str, Any]) -> GenerateResult:
        text = str((data.get("message") or {}).get("content", ""))
        text = _THINK_BLOCK.sub("", text).strip()
        if not text:
            # 빈 응답을 조용히 넘기면 "AI 가 아무 말도 안 한다"로만 보인다 (gemini 와 같은 규칙)
            raise ReadFailed(
                f"응답이 비었습니다 (모델: {self.model})", connector=str(self.type)
            )
        prompt_tokens = data.get("prompt_eval_count")
        output_tokens = data.get("eval_count")
        usage: dict[str, Any] | None = None
        if prompt_tokens is not None or output_tokens is not None:
            # 키 이름을 Gemini 의 usageMetadata 에 맞춘다 — 화면이 한 가지 모양만 알면 된다.
            usage = {
                "promptTokenCount": prompt_tokens,
                "candidatesTokenCount": output_tokens,
                "totalTokenCount": (prompt_tokens or 0) + (output_tokens or 0),
            }
        return GenerateResult(
            text=text, usage=usage, finish_reason=data.get("done_reason")
        )

    @staticmethod
    def _error_message(resp: httpx.Response) -> str:
        try:
            msg = str(resp.json().get("error", ""))
        except ValueError:
            msg = resp.text[:200]
        return msg or "(본문 없음)"
