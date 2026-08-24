"""Celery 앱 설정.

워커는 **무상태**다 — 모든 상태는 메타DB(RDS)와 Redis 에 있으므로 수평 확장이 자유롭다
(설계 문서 §9).
"""

from __future__ import annotations

from celery import Celery
from eai_api.config import get_settings

settings = get_settings()

app = Celery("eai-worker", broker=settings.redis_url, backend=settings.redis_url)

app.conf.update(
    task_default_queue=settings.celery_queue,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Seoul",
    enable_utc=True,
    # 워커가 죽어도 잡을 잃지 않는다 — 다른 워커가 다시 집어간다
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # 파이프라인 잡은 무겁고 길다. 한 번에 하나씩만 선점해야 부하가 고르게 퍼진다.
    worker_prefetch_multiplier=1,
    result_expires=7 * 24 * 3600,
    broker_connection_retry_on_startup=True,
    task_track_started=True,
)

# 태스크 등록
app.autodiscover_tasks(["eai_worker"], related_name="tasks", force=True)
