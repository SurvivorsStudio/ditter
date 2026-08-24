"""실행 이벤트 버스 (Redis Pub/Sub).

Worker 가 진행률·로그를 publish 하고, API 의 WebSocket 이 구독해 UI 로 push 한다
(설계 문서 §6). 이벤트는 **부가 채널**이다 — 진실의 원천은 언제나 메타DB이며,
구독자가 없어 이벤트를 놓쳐도 UI 는 REST 폴백으로 같은 상태를 복원할 수 있다.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import redis
import redis.asyncio as aioredis

from ..config import get_settings
from ..models import utcnow

logger = logging.getLogger(__name__)

CHANNEL_PREFIX = "eai:run:"

_sync_client: redis.Redis | None = None


def channel_for(run_id: str) -> str:
    return f"{CHANNEL_PREFIX}{run_id}"


def get_sync_client() -> redis.Redis:
    global _sync_client
    if _sync_client is None:
        _sync_client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _sync_client


def get_async_client() -> aioredis.Redis:
    client: aioredis.Redis = aioredis.Redis.from_url(get_settings().redis_url, decode_responses=True)
    return client


def publish(
    run_id: str, event_type: str, payload: dict[str, Any] | None = None, *, ts: datetime | None = None
) -> None:
    """이벤트 발행. 실패해도 실행 자체를 중단시키지 않는다."""
    event = {
        "type": event_type,
        "run_id": run_id,
        "payload": payload or {},
        "ts": (ts or utcnow()).isoformat(),
    }
    try:
        get_sync_client().publish(channel_for(run_id), json.dumps(event, ensure_ascii=False, default=str))
    except redis.RedisError:
        # 이벤트는 UI 편의 기능일 뿐 — 여기서 파이프라인을 죽이면 안 된다
        logger.warning("이벤트 발행 실패 (run=%s, type=%s)", run_id, event_type, exc_info=True)
