"""Run 도메인 로직 — 큐 투입, 이력 조회, 대시보드 통계.

API 는 Worker 코드를 import 하지 않는다. Celery ``send_task`` 로 **이름만** 보내
두 서비스를 느슨하게 유지한다 (설계 문서 §6).
"""

from __future__ import annotations

import logging
import statistics
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from celery import Celery
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import TERMINAL_STATUSES, LogLevel, Pipeline, Run, RunLog, RunStatus, RunTrigger, utcnow
from ..schemas import variables as var_syntax
from ..schemas.dag import bind_variables
from ..schemas.run import DashboardStats, RunListItem
from ..schemas.variables import VariableError
from .errors import DependencyError, NotFoundError, ValidationError
from .pipeline_service import (
    assert_node_runnable,
    assert_runnable,
    get_pipeline,
    parse_definition,
)

logger = logging.getLogger(__name__)

RUN_TASK_NAME = "eai_worker.tasks.execute_pipeline"

_celery: Celery | None = None


def get_celery() -> Celery:
    global _celery
    if _celery is None:
        s = get_settings()
        _celery = Celery("eai-api", broker=s.redis_url, backend=s.redis_url)
    return _celery


# --------------------------------------------------------------------- 실행


def bind_run_variables(pipeline: Pipeline, supplied: dict[str, Any] | None) -> dict[str, Any]:
    """이 실행에 쓸 `$변수` 묶음을 만든다.

    선언은 파이프라인의 API 트리거 노드에 있다. 트리거가 없는데 값을 보냈다면 받을 곳이
    없다는 뜻이라 거절한다 — 조용히 버리면 "값을 넣었는데 왜 안 먹지"가 된다.

    검증을 여기서 하는 이유는 **실행 전에** 걸러야 하기 때문이다. 반쯤 적재하고 나서
    값이 틀린 걸 알면 되돌릴 방법이 없다.
    """
    definition = parse_definition(pipeline)
    declared = [spec for node in definition.nodes for spec in node.declared_variables()]

    if not declared and supplied:
        raise ValidationError(
            "이 파이프라인은 입력 변수를 받지 않습니다 — API 트리거 노드에 변수를 선언하세요"
        )

    try:
        values = bind_variables(declared, supplied)
        # SQL 로 조립되는 자리에 꽂힐 값은 여기서 미리 막는다. 치환 시점(엔진)에도 같은
        # 가드가 있지만, 그때는 Run 이 이미 만들어진 뒤라 실패한 실행이 이력에 남는다.
        # 값이 잘못됐다는 것은 받는 순간 알 수 있으므로 앞당긴다.
        for node in definition.nodes:
            for name in var_syntax.sql_context_names(node.params):
                if name in values:
                    var_syntax.assert_sql_safe(name, values[name])
        return values
    except VariableError as exc:
        raise ValidationError(str(exc)) from exc


#: 응답 노드가 있는 웹훅이 결과를 기다리는 최대 시간(초).
#: 넘으면 접수증만 돌려준다 — 실행은 계속되고 결과는 실행 상세에서 볼 수 있다.
RESPONSE_TIMEOUT_SECONDS = 60
#: 폴링 간격. Redis 이벤트를 구독하지 않고 DB 를 보는 이유는, 이벤트를 한 번 놓치면
#: 영영 깨어나지 못하기 때문이다 — 기다리는 쪽이 호출자라 그 실패가 곧 타임아웃이 된다.
_POLL_INTERVAL_SECONDS = 0.25


def expects_response(session: Session, pipeline: Pipeline) -> bool:
    """이 파이프라인이 호출자에게 돌려줄 것이 있는가 (응답 노드 보유 여부)."""
    definition = parse_definition(pipeline)
    return any(node.kind == "target.response" for node in definition.nodes)


def await_response(session: Session, run_id: str) -> Run:
    """실행이 끝나기를 기다렸다가 Run 을 돌려준다.

    타임아웃이 나도 예외를 던지지 않는다. 실행은 계속 도는 중이고 결과는 나중에 실행
    상세에서 볼 수 있으므로, 호출자에게는 "아직 도는 중"인 현재 상태를 그대로 준다.
    """
    deadline = time.monotonic() + RESPONSE_TIMEOUT_SECONDS
    while True:
        session.expire_all()  # 다른 커넥션(워커)이 쓴 값을 봐야 한다
        run = session.get(Run, run_id)
        if run is None:
            raise NotFoundError(f"실행을 찾을 수 없습니다: {run_id}")
        if run.status in TERMINAL_STATUSES:
            return run
        if time.monotonic() >= deadline:
            logger.warning(
                "웹훅 응답 대기 %d초 초과 — 접수증만 돌려준다 (run=%s)", RESPONSE_TIMEOUT_SECONDS, run_id
            )
            return run
        time.sleep(_POLL_INTERVAL_SECONDS)


def enqueue_run(
    session: Session,
    pipeline_id: str,
    *,
    trigger: str = RunTrigger.MANUAL,
    full_refresh: bool = False,
    only_node: str | None = None,
    variables: dict[str, Any] | None = None,
) -> Run:
    """Run 레코드를 만들고 큐에 넣는다.

    Run 을 먼저 커밋해야 워커가 그것을 조회할 수 있다. 큐 투입이 실패하면
    Run 을 ``failed`` 로 남겨 유령 레코드를 만들지 않는다.

    ``only_node`` 가 있으면 그 노드만 독립 실행한다 — 전체 파이프라인이 아니라
    그 노드까지 필요한 상류만. 전체 실행 관문(assert_runnable)은 파이프라인 전체를
    보므로 단일 노드 실행에는 적용하지 않고, 그 노드가 실행 가능한지만 가볍게 본다.
    """
    pipeline = get_pipeline(session, pipeline_id)
    if only_node is not None:
        assert_node_runnable(pipeline, only_node)
    else:
        assert_runnable(pipeline)

    bound = bind_run_variables(pipeline, variables)

    run = Run(
        pipeline_id=pipeline.id,
        pipeline_version=pipeline.version,
        status=RunStatus.PENDING,
        trigger=trigger,
        node_states={},
        variables=bound,
    )
    session.add(run)
    session.flush()
    session.commit()  # 워커가 즉시 읽을 수 있도록 가시화

    try:
        async_result = get_celery().send_task(
            RUN_TASK_NAME,
            kwargs={"run_id": run.id, "full_refresh": full_refresh, "only_node": only_node},
            queue=get_settings().celery_queue,
        )
    except Exception as exc:  # broker 다운 등
        run.status = RunStatus.FAILED
        run.error = f"큐 투입 실패: {exc}"
        run.finished_at = utcnow()
        session.commit()
        logger.exception("Run %s 큐 투입 실패", run.id)
        raise DependencyError(f"작업 큐에 넣지 못했습니다: {exc}") from exc

    run.celery_task_id = async_result.id
    session.commit()
    logger.info("Run %s 큐 투입 (task=%s, trigger=%s)", run.id, async_result.id, trigger)
    return run


def cancel_run(session: Session, run_id: str) -> Run:
    run = get_run(session, run_id)
    if run.status in {RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.CANCELLED}:
        return run
    if run.celery_task_id:
        try:
            get_celery().control.revoke(run.celery_task_id, terminate=True)
        except Exception:
            logger.warning("Celery revoke 실패 (run=%s) — 상태만 변경합니다", run.id, exc_info=True)
    run.status = RunStatus.CANCELLED
    run.finished_at = utcnow()
    session.flush()
    return run


# --------------------------------------------------------------------- 조회


def get_run(session: Session, run_id: str) -> Run:
    run = session.get(Run, run_id)
    if run is None:
        raise NotFoundError(f"실행 이력을 찾을 수 없습니다: {run_id}")
    return run


def _run_filters(
    stmt: Select[Any],
    *,
    pipeline_id: str | None,
    status: str | None,
    since: datetime | None,
) -> Select[Any]:
    if pipeline_id:
        stmt = stmt.where(Run.pipeline_id == pipeline_id)
    if status:
        stmt = stmt.where(Run.status == status)
    if since:
        stmt = stmt.where(Run.created_at >= since)
    return stmt


def list_runs(
    session: Session,
    *,
    pipeline_id: str | None = None,
    status: str | None = None,
    hours: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[RunListItem], int]:
    since = utcnow() - timedelta(hours=hours) if hours else None

    total_stmt = _run_filters(select(func.count(Run.id)), pipeline_id=pipeline_id, status=status, since=since)
    total = int(session.execute(total_stmt).scalar_one())

    stmt = (
        _run_filters(
            select(Run, Pipeline.name).join(Pipeline, Pipeline.id == Run.pipeline_id),
            pipeline_id=pipeline_id,
            status=status,
            since=since,
        )
        .order_by(Run.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    items = [
        RunListItem(
            id=run.id,
            pipeline_id=run.pipeline_id,
            pipeline_name=name,
            status=run.status,
            trigger=run.trigger,
            records=run.records,
            progress=run.progress,
            duration_seconds=run.duration_seconds,
            started_at=run.started_at,
        )
        for run, name in session.execute(stmt).all()
    ]
    return items, total


def list_logs(
    session: Session,
    run_id: str,
    *,
    after_id: int | None = None,
    level: str | None = None,
    node_id: str | None = None,
    limit: int = 500,
) -> list[RunLog]:
    get_run(session, run_id)  # 존재 확인
    stmt = select(RunLog).where(RunLog.run_id == run_id)
    if after_id is not None:
        stmt = stmt.where(RunLog.id > after_id)
    if level:
        # 지정 레벨 "이상"만 — warning 을 고르면 error 도 함께 봐야 쓸모가 있다
        stmt = stmt.where(RunLog.level.in_(_levels_at_or_above(level)))
    if node_id:
        stmt = stmt.where(RunLog.node_id == node_id)
    stmt = stmt.order_by(RunLog.id).limit(limit)
    return list(session.execute(stmt).scalars())


#: 심각도 오름차순
_LEVEL_ORDER = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR]


def _levels_at_or_above(level: str) -> list[str]:
    try:
        index = _LEVEL_ORDER.index(LogLevel(level))
    except ValueError:
        return [level]
    return [str(lvl) for lvl in _LEVEL_ORDER[index:]]


def retry_run(session: Session, run_id: str, *, full_refresh: bool = False) -> Run:
    """실패한 실행을 같은 파이프라인으로 다시 돌린다.

    기존 Run 을 되살리지 않고 **새 Run** 을 만든다 — 이력이 덮어써지면
    무엇이 언제 실패했는지 추적할 수 없다. 체크포인트가 남아 있으므로
    증분 파이프라인은 실패 지점부터 이어서 처리된다.
    """
    original = get_run(session, run_id)
    if original.status in {RunStatus.PENDING, RunStatus.RUNNING}:
        raise ValidationError("아직 실행 중인 작업은 재실행할 수 없습니다")
    return enqueue_run(session, original.pipeline_id, trigger=original.trigger, full_refresh=full_refresh)


# ----------------------------------------------------------------- 대시보드


def dashboard_stats(session: Session) -> DashboardStats:
    now = utcnow()
    day_ago = now - timedelta(hours=24)
    today_start = datetime(now.year, now.month, now.day, tzinfo=UTC)

    pipelines_total = int(session.execute(select(func.count(Pipeline.id))).scalar_one())
    pipelines_active = int(
        session.execute(select(func.count(Pipeline.id)).where(Pipeline.status == "active")).scalar_one()
    )

    def _count_today(status: RunStatus) -> int:
        return int(
            session.execute(
                select(func.count(Run.id)).where(Run.created_at >= today_start, Run.status == status)
            ).scalar_one()
        )

    runs_24h = list(session.execute(select(Run).where(Run.created_at >= day_ago)).scalars())
    finished = [r for r in runs_24h if r.status in {RunStatus.SUCCESS, RunStatus.FAILED}]
    succeeded = [r for r in finished if r.status == RunStatus.SUCCESS]
    durations = [d for r in succeeded if (d := r.duration_seconds) is not None]

    return DashboardStats(
        pipelines_total=pipelines_total,
        pipelines_active=pipelines_active,
        pipelines_inactive=pipelines_total - pipelines_active,
        runs_success_today=_count_today(RunStatus.SUCCESS),
        runs_failed_today=_count_today(RunStatus.FAILED),
        runs_total_24h=len(runs_24h),
        runs_scheduled_24h=sum(1 for r in runs_24h if r.trigger == RunTrigger.SCHEDULE),
        runs_manual_24h=sum(1 for r in runs_24h if r.trigger == RunTrigger.MANUAL),
        records_24h=sum(r.records for r in runs_24h),
        success_rate_24h=round(len(succeeded) / len(finished) * 100, 1) if finished else 0.0,
        avg_duration_seconds=round(statistics.fmean(durations), 1) if durations else None,
        median_duration_seconds=round(statistics.median(durations), 1) if durations else None,
    )
