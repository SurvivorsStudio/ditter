"""``/runs`` — 실행 이력, 로그, 실시간 스트림 (설계 문서 §7)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from ..auth.rbac import Principal, Role, require_role
from ..auth.tokens import TokenError, decode_access_token
from ..config import get_settings
from ..db import get_db, session_scope
from ..models import TERMINAL_STATUSES
from ..schemas.run import DashboardStats, Page, RunListItem, RunLogOut, RunOut
from ..services import events
from ..services import run_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["runs"])

DbSession = Annotated[Session, Depends(get_db)]

#: 이벤트를 놓쳤을 때를 대비한 폴백 폴링 주기(초). WS 는 어디까지나 부가 채널이다.
FALLBACK_POLL_SECONDS = 3.0


@router.get("/runs", response_model=Page[RunListItem])
def list_runs(
    db: DbSession,
    pipeline_id: str | None = None,
    status: str | None = Query(default=None, pattern="^(pending|running|success|failed|cancelled)$"),
    hours: int | None = Query(default=None, ge=1, le=24 * 30, description="최근 N시간"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: object = Depends(require_role(Role.VIEWER)),
) -> Page[RunListItem]:
    items, total = svc.list_runs(
        db, pipeline_id=pipeline_id, status=status, hours=hours, limit=limit, offset=offset
    )
    return Page[RunListItem](items=items, total=total, limit=limit, offset=offset)


@router.get("/runs/stats", response_model=DashboardStats)
def get_stats(db: DbSession, _: object = Depends(require_role(Role.VIEWER))) -> DashboardStats:
    return svc.dashboard_stats(db)


@router.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: str, db: DbSession, _: object = Depends(require_role(Role.VIEWER))) -> RunOut:
    return RunOut.model_validate(svc.get_run(db, run_id))


@router.get("/runs/{run_id}/logs", response_model=list[RunLogOut])
def get_logs(
    run_id: str,
    db: DbSession,
    after_id: int | None = Query(default=None, description="이 id 이후의 로그만"),
    level: str | None = Query(default=None, pattern="^(debug|info|warning|error)$"),
    node_id: str | None = Query(default=None, description="특정 노드의 로그만"),
    limit: int = Query(default=500, ge=1, le=5000),
    _: object = Depends(require_role(Role.VIEWER)),
) -> list[RunLogOut]:
    logs = svc.list_logs(db, run_id, after_id=after_id, level=level, node_id=node_id, limit=limit)
    return [RunLogOut.model_validate(log) for log in logs]


@router.post("/runs/{run_id}/cancel", response_model=RunOut)
def cancel_run(run_id: str, db: DbSession, _: object = Depends(require_role(Role.OPERATOR))) -> RunOut:
    return RunOut.model_validate(svc.cancel_run(db, run_id))


@router.post("/runs/{run_id}/retry", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def retry_run(
    run_id: str,
    db: DbSession,
    full_refresh: bool = Query(default=False, description="워터마크를 무시하고 전체 재적재"),
    _: object = Depends(require_role(Role.OPERATOR)),
) -> RunOut:
    """실패한 실행을 다시 돌린다. 원본 이력은 그대로 두고 새 Run 을 만든다."""
    return RunOut.model_validate(svc.retry_run(db, run_id, full_refresh=full_refresh))


@router.websocket("/runs/{run_id}/stream")
async def stream_run(websocket: WebSocket, run_id: str, token: str | None = Query(default=None)) -> None:
    """실행 진행률·로그 실시간 스트림.

    Redis Pub/Sub 이벤트를 그대로 흘리되, 이벤트를 놓쳤을 경우를 위해
    주기적으로 메타DB 상태를 스냅샷으로 함께 보낸다. Run 이 종단 상태에
    도달하면 마지막 스냅샷을 보내고 정상 종료한다.

    인증: 브라우저 WebSocket 은 Authorization 헤더를 붙일 수 없어 토큰을 쿼리로 받는다.
    실행 로그에는 테이블·건수 등 업무 정보가 실리므로 REST 와 같은 수준으로 막는다.
    """
    if not _ws_authorized(token):
        # accept 전에 닫으면 브라우저에 403 으로 전달된다
        await websocket.close(code=4401, reason="unauthorized")
        return

    await websocket.accept()

    snapshot = await asyncio.to_thread(_run_snapshot, run_id)
    if snapshot is None:
        await websocket.close(code=4404, reason="run not found")
        return
    await websocket.send_json({"type": "snapshot", "run_id": run_id, "payload": snapshot})
    if snapshot["status"] in TERMINAL_STATUSES:
        await websocket.close()
        return

    client = events.get_async_client()
    pubsub = client.pubsub()
    await pubsub.subscribe(events.channel_for(run_id))

    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=FALLBACK_POLL_SECONDS)
            if message is not None:
                with contextlib.suppress(json.JSONDecodeError, TypeError):
                    await websocket.send_json(json.loads(message["data"]))

            # 이벤트 유무와 무관하게 주기적으로 DB 진실을 재확인한다
            snapshot = await asyncio.to_thread(_run_snapshot, run_id)
            if snapshot is None:
                break
            if snapshot["status"] in TERMINAL_STATUSES:
                await websocket.send_json({"type": "snapshot", "run_id": run_id, "payload": snapshot})
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Run %s 스트림 오류", run_id)
    finally:
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(events.channel_for(run_id))
            # redis-py 의 PubSub.aclose 에는 아직 타입이 없다 — 구독을 반드시 정리해야
            # 커넥션이 새지 않으므로 여기서만 무시한다
            await pubsub.aclose()  # type: ignore[no-untyped-call]
            await client.aclose()
        with contextlib.suppress(Exception):
            await websocket.close()


def _ws_authorized(token: str | None) -> bool:
    """WebSocket 구독 권한 확인. viewer 이상이면 허용한다."""
    if not get_settings().auth_enabled:
        return True
    if not token:
        return False
    try:
        claims = decode_access_token(token)
    except TokenError:
        return False

    roles: set[Role] = set()
    for raw in claims.get("roles", []):
        try:
            roles.add(Role(raw))
        except ValueError:
            continue
    return Principal(subject=str(claims.get("sub", "")), roles=frozenset(roles)).has(Role.VIEWER)


def _run_snapshot(run_id: str) -> dict[str, object] | None:
    """WS 워커 스레드에서 호출되는 동기 조회."""
    from ..services.errors import NotFoundError

    try:
        with session_scope() as session:
            run = svc.get_run(session, run_id)
            return {
                "status": run.status,
                "progress": run.progress,
                "records": run.records,
                "error": run.error,
                "node_states": run.node_states,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            }
    except NotFoundError:
        return None
