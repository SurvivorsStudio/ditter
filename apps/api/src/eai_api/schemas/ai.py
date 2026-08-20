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


class AiChatResponse(BaseModel):
    message: AiChatMessage
    #: 응답에서 추출한 첫 SQL 블록 (없으면 null — 설명형 답변)
    sql: str | None = None
    dialect: str | None = None
    #: 스키마를 못 읽었거나 일부만 넣었을 때의 안내
    schema_note: str | None = None
    usage: dict[str, Any] | None = None
