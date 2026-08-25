"""AI 어시스턴트 API 스키마 (설계 문서 §6.1)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AiChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AiChatRequest(BaseModel):
    ai_connection_id: str
    messages: list[AiChatMessage] = Field(min_length=1)
    intent: Literal["sql.generate", "sql.tune"] = "sql.generate"
    #: 대상 DB (스키마 문맥·방언). 없으면 일반 SQL 로 생성.
    db_connection_id: str | None = None
    #: 튜닝 대상 쿼리 (intent=sql.tune)
    sql: str | None = None
    #: 방금 실패한 오류 메시지 (선택)
    error: str | None = None
    #: 언급된 테이블의 예시 행을 프롬프트에 넣어 값→컬럼 매핑 정확도를 높인다.
    #: 실제 데이터가 AI 프로바이더로 전송되므로 기본은 꺼짐 — 프론트가 토글로 켠다.
    include_samples: bool = False


class AiChatResponse(BaseModel):
    message: AiChatMessage
    #: 응답에서 추출한 첫 SQL 블록 (없으면 null — 설명형 답변)
    sql: str | None = None
    dialect: str | None = None
    #: 스키마를 못 읽었거나 일부만 넣었을 때의 안내
    schema_note: str | None = None
    usage: dict[str, Any] | None = None
