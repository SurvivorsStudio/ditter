"""외부 호출 창구(웹훅) 도메인 로직 — 토큰 발급·검증·호출 기록."""

from __future__ import annotations

import hashlib
import logging
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Pipeline, PipelineTrigger, utcnow
from ..schemas.trigger import TriggerCreate
from .errors import NotFoundError, ValidationError
from .pipeline_service import get_pipeline, parse_definition

logger = logging.getLogger(__name__)

#: 토큰 바이트 수. 32바이트(256비트) 난수는 사전 공격 대상이 아니라서, 사람이 고른
#: 비밀번호와 달리 느린 해시(Argon2)로 감쌀 이유가 없다.
TOKEN_BYTES = 32

#: 목록에 보여줄 앞자리 길이 — 어느 토큰인지 구분만 되면 된다
PREFIX_LEN = 8


def hash_token(token: str) -> str:
    """토큰 → 저장·조회용 해시. 이 함수 하나만 쓰도록 해서 발급과 검증이 갈리지 않게 한다."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def list_triggers(session: Session, pipeline_id: str) -> list[PipelineTrigger]:
    get_pipeline(session, pipeline_id)  # 없는 파이프라인이면 404
    stmt = (
        select(PipelineTrigger)
        .where(PipelineTrigger.pipeline_id == pipeline_id)
        .order_by(PipelineTrigger.created_at.desc())
    )
    return list(session.execute(stmt).scalars())


def create_trigger(
    session: Session, pipeline_id: str, payload: TriggerCreate, *, created_by: str | None = None
) -> tuple[PipelineTrigger, str]:
    """창구를 만들고 ``(레코드, 토큰 원문)`` 을 돌려준다.

    토큰 원문을 돌려주는 것은 이때뿐이다. 저장하는 것은 해시라 서버도 다시 만들어낼 수
    없다 — 호출자가 놓치면 재발급 외에는 방법이 없고, 그게 의도한 성질이다.
    """
    pipeline = get_pipeline(session, pipeline_id)

    # 받을 변수가 없는 파이프라인에 창구를 열 수는 있다(값 없이 실행만 시키는 용도).
    # 다만 API 트리거 노드가 아예 없으면 들어온 값을 꽂을 곳이 없으므로 막는다.
    definition = parse_definition(pipeline)
    if not any(node.is_api_trigger for node in definition.nodes):
        raise ValidationError(
            "API 트리거 노드가 없는 파이프라인입니다 — 캔버스에서 [트리거 > API 호출] 을 먼저 추가하세요"
        )

    token = secrets.token_urlsafe(TOKEN_BYTES)
    trigger = PipelineTrigger(
        pipeline_id=pipeline.id,
        name=payload.name,
        token_hash=hash_token(token),
        token_prefix=token[:PREFIX_LEN],
        created_by=created_by,
    )
    session.add(trigger)
    session.flush()
    logger.info("웹훅 창구 발급: %s (%s) — 파이프라인 %s", trigger.name, trigger.token_prefix, pipeline.id)
    return trigger, token


def set_enabled(session: Session, pipeline_id: str, trigger_id: str, enabled: bool) -> PipelineTrigger:
    trigger = _get_own(session, pipeline_id, trigger_id)
    trigger.enabled = enabled
    session.flush()
    return trigger


def delete_trigger(session: Session, pipeline_id: str, trigger_id: str) -> None:
    session.delete(_get_own(session, pipeline_id, trigger_id))


def resolve_token(session: Session, token: str) -> tuple[PipelineTrigger, Pipeline]:
    """토큰으로 창구와 파이프라인을 찾는다. 못 찾거나 꺼져 있으면 ``NotFoundError``.

    **없는 토큰과 꺼진 토큰을 같은 오류로 돌려준다.** 구분해서 알려주면 유효한 토큰의
    존재 여부가 새어나간다 — 공개 엔드포인트라 누구나 두드릴 수 있다.
    """
    stmt = select(PipelineTrigger).where(PipelineTrigger.token_hash == hash_token(token))
    trigger = session.execute(stmt).scalars().first()
    if trigger is None or not trigger.enabled:
        raise NotFoundError("유효하지 않은 토큰입니다")

    pipeline = session.get(Pipeline, trigger.pipeline_id)
    if pipeline is None:  # FK cascade 가 있어 정상 경로에서는 나오지 않는다
        raise NotFoundError("유효하지 않은 토큰입니다")
    return trigger, pipeline


def record_call(session: Session, trigger: PipelineTrigger) -> None:
    """호출 흔적을 남긴다.

    실행이 성공했는지와 무관하게 **호출됐다는 사실**을 남긴다. 토큰이 살아 있는지,
    누가 언제 두드렸는지는 실행 결과와 별개로 알아야 한다.
    """
    trigger.call_count += 1
    trigger.last_called_at = utcnow()
    session.flush()


def _get_own(session: Session, pipeline_id: str, trigger_id: str) -> PipelineTrigger:
    trigger = session.get(PipelineTrigger, trigger_id)
    if trigger is None or trigger.pipeline_id != pipeline_id:
        raise NotFoundError(f"창구를 찾을 수 없습니다: {trigger_id}")
    return trigger
