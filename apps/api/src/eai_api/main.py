"""앱 엔트리 — REST + WebSocket + MCP 마운트 (설계 문서 §3)."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from eai_connectors import ConnectorError
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .i18n import locale_from_header, set_locale
from .mcp_server import mcp
from .routers import ai, auth, connections, duck, health, hooks, pipelines, runs, streams, sync
from .services.errors import ServiceError


class _RequestIdFilter(logging.Filter):
    """모든 레코드에 request_id 를 보장한다 — extra 없이 찍힌 로그도 포맷을 깨지 않도록."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s",
)
for _handler in logging.getLogger().handlers:
    _handler.addFilter(_RequestIdFilter())

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logger.info("%s 기동 (env=%s)", settings.app_name, settings.environment)
    if not settings.auth_enabled:
        logger.warning("인증이 비활성화되어 있습니다 — 로컬 개발 전용 설정입니다")
    async with mcp_app.router.lifespan_context(app):
        yield
    logger.info("종료")


# FastMCP 앱은 자체 lifespan 을 요구한다. 위 lifespan 에서 감싸 함께 기동한다.
mcp_app = mcp.http_app(path="/mcp")

settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="자체 EAI 플랫폼 — 연결·파이프라인·실행 API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next: Callable[[Request], Awaitable[object]]) -> object:
    """요청 ID 부여 + 표시 언어 결정 + 처리시간 로깅 (감사 추적의 최소 단위)."""
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    # 표시 언어를 **모든 요청에서 무조건** 세팅한다. 조건부로 두면 "이전 요청의 값이
    # 남지 않는 이유"를 매번 증명해야 한다 — 무조건 쓰면 증명할 것이 없다.
    #
    # 여기서 세팅한 ContextVar 는 동기 def 라우터(스레드풀)와 예외 핸들러까지 전파된다.
    # 근거는 i18n/locale.py docstring 참조. 라우터가 세팅하고 여기서 읽는 것은 불가능하다
    # (컨텍스트 복사는 단방향이다).
    set_locale(locale_from_header(request.headers.get("Accept-Language")))
    started = time.perf_counter()

    response = await call_next(request)

    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "%s %s → %s (%.1fms)",
        request.method,
        request.url.path,
        getattr(response, "status_code", "-"),
        elapsed_ms,
        extra={"request_id": request_id},
    )
    if hasattr(response, "headers"):
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-ms"] = f"{elapsed_ms:.1f}"
        # 응답 본문이 언어를 타므로 캐시가 언어별로 갈라야 한다. 지금은 앞에 캐시 계층이
        # 없지만, ALB·CloudFront 가 서는 날 en 사용자의 응답이 ko 사용자에게 나간다.
        response.headers["Vary"] = "Accept-Language"
    return response


@app.exception_handler(ServiceError)
async def handle_service_error(request: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": str(exc), "request_id": getattr(request.state, "request_id", None)},
    )


@app.exception_handler(ConnectorError)
async def handle_connector_error(request: Request, exc: ConnectorError) -> JSONResponse:
    """드라이버 예외는 이미 도메인 예외로 래핑되어 올라온다 — 502 로 노출한다."""
    logger.warning("커넥터 오류: %s", exc)
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc), "request_id": getattr(request.state, "request_id", None)},
    )


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(connections.router)
app.include_router(duck.router)
app.include_router(pipelines.router)
app.include_router(runs.router)
app.include_router(hooks.router)
app.include_router(streams.router)
app.include_router(sync.router)
app.include_router(ai.router)

# LLM/에이전트용 MCP 엔드포인트 (Streamable HTTP)
app.mount("/mcp-server", mcp_app)


@app.get("/", tags=["health"])
def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "version": "0.1.0",
        "docs": "/docs",
        "mcp": "/mcp-server/mcp",
    }
