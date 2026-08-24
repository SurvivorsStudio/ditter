"""CDC 스트림 API (Phase 4b, 기획안 §6.1).

배치의 ``runs`` 라우터에 대응한다. 경로가 ``/pipelines/…`` · ``/connections/…`` · ``/streams/…``
세 접두에 걸쳐 있어 prefix 없이 전체 경로를 명시한다.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.rbac import Role, require_role
from ..db import get_db
from ..models import CdcStream
from ..schemas.stream import CdcStreamListItem, CdcStreamOut, PreflightOut
from ..services import cdc_service as svc
from ..services import sync_service

router = APIRouter(tags=["cdc"])

DbSession = Annotated[Session, Depends(get_db)]


def _to_out(stream: CdcStream) -> CdcStreamOut:
    return CdcStreamOut.model_validate(stream)


def _engine_of(db: Session, stream_id: str) -> str:
    """제어 요청이 어느 엔진으로 가야 하는지.

    분기를 서비스 안이 아니라 **라우터에** 두는 이유는 의존 방향이다 — cdc_service 가
    sync_service 를 부르면 (또는 그 반대면) 두 엔진이 서로를 임포트하게 된다.
    라우터는 원래 둘 다 알아도 되는 자리다.
    """
    return svc.get_stream(db, stream_id).engine


@router.post("/pipelines/{pipeline_id}/cdc/start", response_model=CdcStreamOut)
def start_stream(
    pipeline_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> CdcStreamOut:
    """CDC 파이프라인을 켜서 스트림을 시작한다 (Debezium 커넥터 등록)."""
    return _to_out(svc.start_stream(db, pipeline_id))


@router.post("/connections/{connection_id}/cdc/preflight", response_model=PreflightOut)
def preflight(
    connection_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> PreflightOut:
    """연결이 CDC 소스로 쓸 준비가 됐는지 점검한다."""
    return svc.preflight(db, connection_id)


@router.get("/streams", response_model=list[CdcStreamListItem])
def list_streams(
    db: DbSession,
    status: str | None = Query(default=None, description="상태 필터"),
    _: object = Depends(require_role(Role.VIEWER)),
) -> list[CdcStreamListItem]:
    return svc.list_streams(db, status=status)


@router.get("/streams/{stream_id}", response_model=CdcStreamOut)
def get_stream(
    stream_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> CdcStreamOut:
    """스트림 상태·지표. 활성 스트림이면 실제 엔진 상태와 맞춘다.

    Debezium 은 Kafka Connect REST 에, SymmetricDS 는 원본 DB 의 SYM_* 에 물어본다 —
    어느 쪽이든 진실의 원천은 우리 DB 가 아니다.
    """
    if _engine_of(db, stream_id) == "symmetricds":
        return _to_out(sync_service.refresh_status(db, stream_id))
    return _to_out(svc.refresh_status(db, stream_id))


@router.post("/streams/{stream_id}/pause", response_model=CdcStreamOut)
def pause_stream(
    stream_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> CdcStreamOut:
    if _engine_of(db, stream_id) == "symmetricds":
        return _to_out(sync_service.pause_stream(db, stream_id))
    return _to_out(svc.pause_stream(db, stream_id))


@router.post("/streams/{stream_id}/resume", response_model=CdcStreamOut)
def resume_stream(
    stream_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> CdcStreamOut:
    if _engine_of(db, stream_id) == "symmetricds":
        return _to_out(sync_service.resume_stream(db, stream_id))
    return _to_out(svc.resume_stream(db, stream_id))


@router.post("/streams/{stream_id}/stop", response_model=CdcStreamOut)
def stop_stream(
    stream_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> CdcStreamOut:
    if _engine_of(db, stream_id) == "symmetricds":
        return _to_out(sync_service.stop_stream(db, stream_id))
    return _to_out(svc.stop_stream(db, stream_id))


@router.delete("/streams/{stream_id}", status_code=204, response_model=None)
def delete_stream(
    stream_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> None:
    """중지·실패한 스트림 이력을 삭제한다 (활성 스트림은 409)."""
    svc.delete_stream(db, stream_id)
