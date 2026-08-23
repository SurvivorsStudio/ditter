"""``/pipelines`` — 저장(버전)·검증·실행 (설계 문서 §7)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from ..auth.rbac import Role, require_role
from ..db import get_db
from ..models import Pipeline
from ..schemas.pipeline import (
    DeletionImpact,
    PipelineCreate,
    PipelineOut,
    PipelineSummary,
    PipelineUpdate,
    RunRequest,
    ValidationOut,
)
from ..schemas.run import RunOut
from ..schemas.trigger import TriggerCreate, TriggerCreated, TriggerOut, TriggerUpdate
from ..services import pipeline_service as svc
from ..services import run_service, trigger_service

router = APIRouter(prefix="/pipelines", tags=["pipelines"])

DbSession = Annotated[Session, Depends(get_db)]


def _to_out(pipeline: Pipeline) -> PipelineOut:
    return PipelineOut(
        id=pipeline.id,
        name=pipeline.name,
        description=pipeline.description,
        definition=svc.parse_definition(pipeline),
        schedule=pipeline.schedule,
        timezone=pipeline.timezone,
        schedule_enabled=pipeline.schedule_enabled,
        version=pipeline.version,
        status=pipeline.status,
        created_at=pipeline.created_at,
        updated_at=pipeline.updated_at,
    )


@router.get("", response_model=list[PipelineSummary])
def list_pipelines(
    db: DbSession,
    status_filter: str | None = Query(default=None, alias="status"),
    _: object = Depends(require_role(Role.VIEWER)),
) -> list[PipelineSummary]:
    return svc.summarize(db, svc.list_pipelines(db, status=status_filter))


@router.post("", response_model=PipelineOut, status_code=status.HTTP_201_CREATED)
def create_pipeline(
    payload: PipelineCreate,
    db: DbSession,
    _: object = Depends(require_role(Role.EDITOR)),
) -> PipelineOut:
    return _to_out(svc.create_pipeline(db, payload))


@router.get("/{pipeline_id}", response_model=PipelineOut)
def get_pipeline(
    pipeline_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> PipelineOut:
    return _to_out(svc.get_pipeline(db, pipeline_id))


@router.patch("/{pipeline_id}", response_model=PipelineOut)
def update_pipeline(
    pipeline_id: str,
    payload: PipelineUpdate,
    db: DbSession,
    _: object = Depends(require_role(Role.EDITOR)),
) -> PipelineOut:
    return _to_out(svc.update_pipeline(db, pipeline_id, payload))


@router.get("/{pipeline_id}/deletion-impact", response_model=DeletionImpact)
def pipeline_deletion_impact(
    pipeline_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> DeletionImpact:
    """지우면 무엇이 함께 사라지는지 — 확인 대화상자가 삭제 전에 부른다."""
    return svc.deletion_impact(db, pipeline_id)


@router.delete("/{pipeline_id}", response_model=DeletionImpact)
def delete_pipeline(
    pipeline_id: str,
    db: DbSession,
    force: bool = Query(
        default=False,
        description="진행 중인 실행이 있어도 삭제한다. 살아 있는 CDC 스트림은 이것으로도 못 넘긴다.",
    ),
    _: object = Depends(require_role(Role.EDITOR)),
) -> DeletionImpact:
    """파이프라인 삭제. 진행 중 실행·살아 있는 CDC 스트림이 있으면 409 로 거부한다.

    응답은 삭제 직전 스냅샷이라 호출자가 "실행 이력 12건도 함께 지워졌다"를 알릴 수 있다.
    """
    return svc.delete_pipeline(db, pipeline_id, force=force)


# ------------------------------------------------------------ 외부 호출 창구(웹훅)


@router.get("/{pipeline_id}/triggers", response_model=list[TriggerOut])
def list_triggers(
    pipeline_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> list[TriggerOut]:
    return [TriggerOut.model_validate(t) for t in trigger_service.list_triggers(db, pipeline_id)]


@router.post("/{pipeline_id}/triggers", response_model=TriggerCreated, status_code=status.HTTP_201_CREATED)
def create_trigger(
    pipeline_id: str,
    payload: TriggerCreate,
    db: DbSession,
    request: Request,
    user: object = Depends(require_role(Role.EDITOR)),
) -> TriggerCreated:
    """창구를 만들고 토큰을 돌려준다.

    **토큰 원문은 이 응답에만 나온다.** 저장하는 것은 해시라 서버도 다시 만들 수 없다.
    """
    trigger, token = trigger_service.create_trigger(
        db, pipeline_id, payload, created_by=getattr(user, "email", None)
    )
    base = str(request.base_url).rstrip("/")
    return TriggerCreated(
        **TriggerOut.model_validate(trigger).model_dump(),
        token=token,
        url=f"{base}/hooks/{token}",
    )


@router.patch("/{pipeline_id}/triggers/{trigger_id}", response_model=TriggerOut)
def update_trigger(
    pipeline_id: str,
    trigger_id: str,
    payload: TriggerUpdate,
    db: DbSession,
    _: object = Depends(require_role(Role.EDITOR)),
) -> TriggerOut:
    """지금은 사용 중지/재개만 있다. 이름 변경은 지우고 다시 발급하는 편이 명확하다."""
    trigger = trigger_service.set_enabled(db, pipeline_id, trigger_id, payload.enabled)
    return TriggerOut.model_validate(trigger)


@router.delete(
    "/{pipeline_id}/triggers/{trigger_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_trigger(
    pipeline_id: str,
    trigger_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.EDITOR)),
) -> None:
    trigger_service.delete_trigger(db, pipeline_id, trigger_id)


@router.post("/{pipeline_id}/validate", response_model=ValidationOut)
def validate_pipeline(
    pipeline_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> ValidationOut:
    return svc.validate_pipeline(svc.get_pipeline(db, pipeline_id))


@router.post("/{pipeline_id}/run", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def run_pipeline(
    pipeline_id: str,
    db: DbSession,
    payload: RunRequest | None = None,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> RunOut:
    request = payload or RunRequest()
    # 단일 노드 실행은 워터마크를 무시하고 신선하게 읽는다(테스트 목적).
    # 저장된 증분 상태는 엔진이 건드리지 않는다.
    full_refresh = request.full_refresh or bool(request.only_node)
    run = run_service.enqueue_run(
        db,
        pipeline_id,
        trigger=request.trigger,
        full_refresh=full_refresh,
        only_node=request.only_node,
        variables=request.variables,
    )
    return RunOut.model_validate(run)
