"""Celery 태스크 — 파이프라인 실행 진입점."""

from __future__ import annotations

import logging
from typing import Any

from celery import Task
from eai_api.db import session_scope
from eai_api.models import LogLevel, Pipeline, Run, RunStatus, utcnow
from eai_api.schemas.dag import PipelineDefinition
from eai_api.services import events
from eai_connectors import ConnectorError

from .celery_app import app
from .context import RunContext
from .engine import ExecutionError, execute

logger = logging.getLogger(__name__)

#: 커넥터 계층에서 이미 재시도했는데도 실패한 경우의 태스크 레벨 재시도
MAX_TASK_RETRIES = 2
RETRY_BACKOFF_SECONDS = 30


@app.task(
    bind=True,
    name="eai_worker.tasks.execute_pipeline",
    max_retries=MAX_TASK_RETRIES,
    acks_late=True,
)
def execute_pipeline(
    self: Task[..., object],
    run_id: str,
    full_refresh: bool = False,
    only_node: str | None = None,
) -> dict[str, Any]:
    """Run 하나를 처음부터 끝까지 실행한다.

    Run 레코드는 API 가 이미 만들어 두었다. 여기서는 상태 전이만 책임진다:
    pending → running → success|failed
    """
    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is None:
            logger.error("Run 을 찾을 수 없습니다: %s", run_id)
            return {"ok": False, "error": "run not found"}
        if run.status == RunStatus.CANCELLED:
            logger.info("Run %s 은 취소된 상태입니다 — 실행하지 않습니다", run_id)
            return {"ok": False, "error": "cancelled"}

        pipeline = session.get(Pipeline, run.pipeline_id)
        if pipeline is None:
            run.status = RunStatus.FAILED
            run.error = "파이프라인이 삭제되었습니다"
            run.finished_at = utcnow()
            return {"ok": False, "error": run.error}

        raw_definition = pipeline.definition
        pipeline_id = pipeline.id
        pipeline_name = pipeline.name
        # API 트리거로 들어온 값. Run 에 박제돼 있어 재시도해도 같은 값으로 돈다.
        run_variables = dict(run.variables or {})

        run.status = RunStatus.RUNNING
        run.started_at = utcnow()
        run.error = None
        run.celery_task_id = self.request.id or run.celery_task_id

    events.publish(run_id, "status", {"status": RunStatus.RUNNING})

    ctx = RunContext(
        run_id=run_id,
        pipeline_id=pipeline_id,
        full_refresh=full_refresh,
        variables=run_variables,
    )
    if only_node:
        ctx.log(f"파이프라인 '{pipeline_name}' — 단일 노드 실행: {only_node}")
    else:
        ctx.log(f"파이프라인 '{pipeline_name}' 실행 시작 (full_refresh={full_refresh})")

    try:
        definition = PipelineDefinition.model_validate(raw_definition or {})
        results = execute(definition, ctx, only_node=only_node)
    except (ExecutionError, ConnectorError) as exc:
        return _handle_failure(self, run_id, ctx, str(exc), retryable=isinstance(exc, ConnectorError))
    except Exception as exc:
        logger.exception("Run %s 예상치 못한 실패", run_id)
        return _handle_failure(self, run_id, ctx, f"예상치 못한 오류: {exc}", retryable=False)

    total = sum(int(r.get("records", 0)) for r in results.values())
    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is not None:
            run.status = RunStatus.SUCCESS
            run.finished_at = utcnow()
            run.progress = 100
            run.records = total
            run.node_states = {nid: s.to_dict() for nid, s in ctx.node_states.items()}

    if only_node:
        preview = any(r.get("preview") for r in results.values())
        verb = "읽음 (미리보기)" if preview else "적재"
        ctx.log(f"단일 노드 실행 완료 — {total:,}건 {verb}")
    else:
        ctx.log(f"실행 완료 — 총 {total:,}건 적재")
    events.publish(run_id, "status", {"status": RunStatus.SUCCESS, "records": total, "progress": 100})
    return {"ok": True, "run_id": run_id, "records": total, "results": results}


def _handle_failure(
    task: Task[..., object], run_id: str, ctx: RunContext, message: str, *, retryable: bool
) -> dict[str, Any]:
    """실패를 기록하고, 일시적 오류로 보이면 백오프 후 재시도한다."""
    attempt = task.request.retries
    can_retry = retryable and attempt < MAX_TASK_RETRIES

    ctx.log(
        f"실행 실패 ({attempt + 1}/{MAX_TASK_RETRIES + 1}): {message}",
        level=LogLevel.ERROR,
    )

    if can_retry:
        delay = RETRY_BACKOFF_SECONDS * (2**attempt)
        ctx.log(f"{delay}초 후 재시도합니다", level=LogLevel.WARNING)
        # 재시도 예정이므로 Run 은 running 으로 남긴다 — failed 로 찍으면 UI 가 오해한다
        raise task.retry(countdown=delay, exc=RuntimeError(message))

    with session_scope() as session:
        run = session.get(Run, run_id)
        if run is not None and run.status != RunStatus.CANCELLED:
            run.status = RunStatus.FAILED
            run.error = message[:2000]
            run.finished_at = utcnow()
            run.node_states = {nid: s.to_dict() for nid, s in ctx.node_states.items()}

    events.publish(run_id, "status", {"status": RunStatus.FAILED, "error": message})
    return {"ok": False, "run_id": run_id, "error": message}
