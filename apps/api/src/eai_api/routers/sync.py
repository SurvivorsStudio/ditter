"""실시간 DB 동기화(SymmetricDS) API.

``streams`` 라우터와 짝이다 — 시작·점검은 여기, 시작한 뒤의 제어(일시정지·재개·정지·삭제)는
엔진과 무관하게 ``/streams/…`` 하나로 다룬다. 사용자에게 "실행 중인 실시간 스트림"은 한
목록이어야지, 엔진마다 다른 화면을 봐야 할 이유가 없다.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.rbac import Role, require_role
from ..db import get_db
from ..models import CdcStream
from ..schemas.stream import CdcStreamOut, SyncPreflightOut
from ..services import sync_service as svc

router = APIRouter(tags=["sync"])

DbSession = Annotated[Session, Depends(get_db)]


def _to_out(stream: CdcStream) -> CdcStreamOut:
    return CdcStreamOut.model_validate(stream)


@router.post("/pipelines/{pipeline_id}/sync/preflight", response_model=SyncPreflightOut)
def preflight(
    pipeline_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> SyncPreflightOut:
    """착수 전 점검 (기획안 §1 · §8 Phase 1).

    원본이 운영 중인 시스템이라 **읽기만 한다** — 버전·권한·테이블·기본키를 조회할 뿐
    아무것도 바꾸지 않는다. 그래서 몇 번을 눌러도 안전하다.
    """
    return svc.preflight(db, pipeline_id)


@router.post("/pipelines/{pipeline_id}/sync/start", response_model=CdcStreamOut)
def start_stream(
    pipeline_id: str,
    db: DbSession,
    skip_preflight: bool = Query(
        default=False,
        description="착수 점검을 건너뛰고 강제로 시작한다 (사이드카 미기동 등 예외 상황용)",
    ),
    _: object = Depends(require_role(Role.OPERATOR)),
) -> CdcStreamOut:
    """동기화를 켠다. 기본은 점검을 통과해야 시작된다 (기획안 §0.2 게이트)."""
    return _to_out(svc.start_stream(db, pipeline_id, skip_preflight=skip_preflight))
