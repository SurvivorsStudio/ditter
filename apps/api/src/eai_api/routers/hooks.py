"""``/hooks`` — 외부 시스템이 파이프라인을 부르는 **공개** 엔드포인트.

이 라우터에는 ``require_role`` 이 없다. 의도한 것이다 — 로그인 세션이 없는 외부
시스템이 부르는 창구이고, **토큰 자체가 자격증명**이다.

토큰을 URL 경로가 아니라 헤더로도 받는다. 경로에 넣으면 액세스 로그·프록시·브라우저
히스토리에 그대로 남기 때문이다. 둘 다 받되 헤더를 권장한다.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header, Request, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.run import RunOut
from ..schemas.trigger import HookAccepted
from ..services import run_service, trigger_service
from ..services.errors import NotFoundError

router = APIRouter(prefix="/hooks", tags=["hooks"])

DbSession = Annotated[Session, Depends(get_db)]


@router.post("", response_model=HookAccepted, status_code=status.HTTP_202_ACCEPTED)
def run_by_header_token(
    db: DbSession,
    request: Request,
    body: Annotated[dict[str, Any] | None, Body()] = None,
    x_eai_token: Annotated[str | None, Header(alias="X-EAI-Token")] = None,
) -> HookAccepted:
    """`POST /hooks` + `X-EAI-Token` 헤더. 토큰이 로그에 남지 않는 쪽이라 이걸 권장한다."""
    if not x_eai_token:
        raise NotFoundError("유효하지 않은 토큰입니다")
    return _dispatch(db, x_eai_token, body, request)


@router.post("/{token}", response_model=HookAccepted, status_code=status.HTTP_202_ACCEPTED)
def run_by_path_token(
    token: str,
    db: DbSession,
    request: Request,
    body: Annotated[dict[str, Any] | None, Body()] = None,
) -> HookAccepted:
    """`POST /hooks/{token}`. 헤더를 붙이기 어려운 도구(단순 웹훅 설정)를 위한 통로다.

    토큰이 URL 에 남는다는 점을 감수한 것이라, 가능하면 헤더 쪽을 쓰는 편이 낫다.
    """
    return _dispatch(db, token, body, request)


def _dispatch(db: Session, token: str, body: dict[str, Any] | None, request: Request) -> HookAccepted:
    trigger, pipeline = trigger_service.resolve_token(db, token)

    # 호출 흔적은 실행 성공 여부와 무관하게 남긴다 — 토큰이 살아 있는지, 누가 언제
    # 두드렸는지는 실행 결과와 별개로 알아야 한다.
    trigger_service.record_call(db, trigger)
    db.commit()

    run = run_service.enqueue_run(
        db,
        pipeline.id,
        trigger="api",
        variables=body or {},
    )
    out = RunOut.model_validate(run)

    # 응답 노드가 있으면 결과가 나올 때까지 기다렸다 돌려준다. 없으면 접수증만 준다.
    if run_service.expects_response(db, pipeline):
        finished = run_service.await_response(db, out.id)
        return HookAccepted(
            run_id=out.id,
            pipeline_id=out.pipeline_id,
            status=finished.status,
            variables=out.variables,
            error=finished.error,
            data=finished.response,
        )

    return HookAccepted(
        run_id=out.id,
        pipeline_id=out.pipeline_id,
        status=out.status,
        variables=out.variables,
    )
