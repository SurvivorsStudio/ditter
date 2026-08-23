"""Cron 스케줄러.

파이프라인의 cron 은 DB 에 있고 UI 에서 언제든 바뀐다. Celery beat 의 정적 스케줄로는
이를 표현할 수 없으므로, 주기적으로 메타DB 를 훑어 "지금 떠야 할 것"을 큐에 넣는다.

중복 실행 방지:
- 발화 시각(fire slot)을 키로 Redis ``SETNX`` 를 건다. beat 를 여러 개 띄워도
  같은 슬롯은 한 번만 통과한다.
- 직전 실행이 아직 돌고 있으면 건너뛴다 — 배치가 겹쳐 소스를 두 번 읽는 일을 막는다.
"""

from __future__ import annotations

import logging
import signal
import time
import types
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import redis
from croniter import CroniterBadCronError, croniter
from eai_api.config import get_settings
from eai_api.db import session_scope
from eai_api.models import Pipeline, Run, RunStatus, RunTrigger, utcnow
from eai_api.services import run_service
from eai_api.services.errors import ServiceError
from eai_api.services.events import get_sync_client
from sqlalchemy import select

logger = logging.getLogger(__name__)

TICK_SECONDS = 30
#: 발화 슬롯 잠금 TTL. 틱 주기보다 충분히 길어야 중복을 막는다.
SLOT_TTL_SECONDS = 3600
#: 이 시간보다 오래된 발화는 무시한다 (스케줄러가 오래 죽어 있었던 경우 몰아치기 방지)
CATCHUP_GRACE = timedelta(minutes=10)

_running = True


def _handle_signal(signum: int, _frame: types.FrameType | None) -> None:
    global _running
    logger.info("종료 신호 수신 (%s) — 현재 틱을 마치고 종료합니다", signum)
    _running = False


def due_fire_time(cron_expr: str, tz_name: str, now: datetime) -> datetime | None:
    """``now`` 기준 직전 발화 시각. cron 이 잘못되었으면 None."""
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        logger.warning("알 수 없는 타임존 %s — Asia/Seoul 로 대체합니다", tz_name)
        tz = ZoneInfo("Asia/Seoul")

    local_now = now.astimezone(tz)
    try:
        fired: datetime = croniter(cron_expr, local_now).get_prev(datetime)
        return fired
    except (CroniterBadCronError, ValueError):
        logger.warning("잘못된 cron 식: %r", cron_expr)
        return None


def has_active_run(session_pipeline_id: str) -> bool:
    with session_scope() as session:
        stmt = select(Run.id).where(
            Run.pipeline_id == session_pipeline_id,
            Run.status.in_([RunStatus.PENDING, RunStatus.RUNNING]),
        )
        return session.execute(stmt).first() is not None


def claim_slot(client: redis.Redis, pipeline_id: str, fire_time: datetime) -> bool:
    """이 발화 슬롯을 이 프로세스가 맡는다고 선언한다. 이미 누가 맡았으면 False."""
    key = f"eai:sched:{pipeline_id}:{fire_time.isoformat()}"
    try:
        return bool(client.set(key, "1", nx=True, ex=SLOT_TTL_SECONDS))
    except redis.RedisError:
        logger.exception("스케줄 슬롯 잠금 실패 — 이번 발화는 건너뜁니다 (%s)", pipeline_id)
        return False


def tick(client: redis.Redis, now: datetime | None = None) -> int:
    """한 번의 스케줄 점검. 큐에 넣은 개수를 돌려준다."""
    now = now or utcnow()
    enqueued = 0

    with session_scope() as session:
        pipelines = list(
            session.execute(
                select(Pipeline).where(
                    Pipeline.schedule_enabled.is_(True),
                    Pipeline.status == "active",
                    Pipeline.schedule.is_not(None),
                )
            ).scalars()
        )
        candidates = [(p.id, p.name, p.schedule or "", p.timezone) for p in pipelines]

    for pipeline_id, name, cron_expr, tz_name in candidates:
        fire_time = due_fire_time(cron_expr, tz_name, now)
        if fire_time is None:
            continue
        if now - fire_time.astimezone(now.tzinfo) > CATCHUP_GRACE:
            continue  # 너무 오래된 발화 — 몰아서 실행하지 않는다
        if not claim_slot(client, pipeline_id, fire_time):
            continue
        if has_active_run(pipeline_id):
            logger.info("'%s' 는 아직 실행 중이라 이번 발화(%s)를 건너뜁니다", name, fire_time)
            continue

        try:
            with session_scope() as session:
                run = run_service.enqueue_run(session, pipeline_id, trigger=RunTrigger.SCHEDULE)
            logger.info("스케줄 실행: '%s' (fire=%s, run=%s)", name, fire_time, run.id)
            enqueued += 1
        except ServiceError as exc:
            logger.error("'%s' 스케줄 실행 실패: %s", name, exc)

    return enqueued


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    settings = get_settings()
    logger.info("스케줄러 기동 (tick=%ss, redis=%s)", TICK_SECONDS, settings.redis_url)
    client = get_sync_client()

    while _running:
        started = time.monotonic()
        try:
            count = tick(client)
            if count:
                logger.info("이번 틱에서 %d건을 큐에 넣었습니다", count)
        except Exception:
            logger.exception("스케줄 틱 실패 — 다음 틱에서 계속합니다")

        elapsed = time.monotonic() - started
        # 남은 시간을 잘게 나눠 자면 종료 신호에 빠르게 반응한다
        remaining = max(0.0, TICK_SECONDS - elapsed)
        while remaining > 0 and _running:
            nap = min(1.0, remaining)
            time.sleep(nap)
            remaining -= nap

    logger.info("스케줄러 종료")


if __name__ == "__main__":
    main()
