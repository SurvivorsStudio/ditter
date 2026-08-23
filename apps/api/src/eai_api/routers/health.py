"""``/health`` — 컨테이너 헬스체크 / ALB 타깃그룹용."""

from __future__ import annotations

import redis
from fastapi import APIRouter, Response, status
from sqlalchemy import text

from ..config import get_settings
from ..db import get_engine
from ..services.events import get_sync_client

router = APIRouter(tags=["health"])


@router.get("/health")
def liveness() -> dict[str, str]:
    """프로세스가 살아 있는지만 본다 — 의존 서비스는 확인하지 않는다."""
    return {"status": "ok", "app": get_settings().app_name}


@router.get("/health/ready")
def readiness(response: Response) -> dict[str, object]:
    """메타DB·Redis 가 실제로 응답하는지 확인한다."""
    checks: dict[str, str] = {}

    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"

    try:
        get_sync_client().ping()
        checks["redis"] = "ok"
    except redis.RedisError as exc:
        checks["redis"] = f"error: {exc}"

    ready = all(v == "ok" for v in checks.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"ready": ready, "checks": checks}
