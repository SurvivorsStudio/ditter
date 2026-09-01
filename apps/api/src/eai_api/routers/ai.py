"""``/ai`` — AI 어시스턴트 (자연어 SQL 생성·튜닝, 설계 문서 §6).

이 라우터는 얇다 — 스키마 조립·프롬프트·SQL 추출은 ai_service 몫이다(방식 B, 백엔드 오케스트레이션).
챗 사용은 인증된 사용자면 허용한다(비용은 사용자가 등록한 키에서 나간다).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth.rbac import Role, require_role
from ..db import get_db
from ..schemas.ai import AiChatMessage, AiChatRequest, AiChatResponse
from ..services import ai_service

router = APIRouter(prefix="/ai", tags=["ai"])

DbSession = Annotated[Session, Depends(get_db)]


@router.post("/chat", response_model=AiChatResponse)
def chat(
    payload: AiChatRequest,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> AiChatResponse:
    result = ai_service.chat(
        db,
        ai_connection_id=payload.ai_connection_id,
        messages=[m.model_dump() for m in payload.messages],
        intent=payload.intent,
        db_connection_id=payload.db_connection_id,
        sql=payload.sql,
        error=payload.error,
        explain=payload.explain,
        include_samples=payload.include_samples,
        locale=payload.locale,
    )
    return AiChatResponse(
        message=AiChatMessage(role="assistant", content=result.content),
        sql=result.sql,
        dialect=result.dialect,
        schema_note=result.schema_note,
        usage=result.usage,
    )
