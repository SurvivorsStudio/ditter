"""요청 문맥에서 표시 언어가 실제로 전파되는지 — 설계 전체가 이 가정 위에 서 있다.

`ContextVar` 를 미들웨어에서 세팅하는데, 라우터는 **동기 `def`** 라 FastAPI 가 스레드풀에서
돌린다. 그 경계를 넘어 값이 보이지 않으면 설계가 통째로 성립하지 않는다. 그래서 이 파일은
"문구가 영어로 나오는지"보다 먼저 **전파 자체**를 못박는다.

기존 테스트는 `TestClient` 를 한 번도 쓰지 않아 미들웨어·예외 핸들러가 통째로 미검증이었다.
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from starlette.requests import Request

from eai_api import main
from eai_api.i18n import get_locale
from eai_api.services.errors import NotFoundError


def _dep() -> str:
    """동기 Depends — 라우터와 같은 스레드풀에서 돈다."""
    return get_locale()


@pytest.fixture(scope="module")
def client() -> TestClient:
    """운영 앱의 **그 미들웨어 함수**를 그대로 얹은 작은 앱.

    운영 앱에 시험용 라우트를 더하면 다른 테스트까지 그것을 들고 다니게 된다.
    미들웨어는 진짜를 쓰므로 검증 대상(로케일 판정·전파·Vary)은 그대로다.
    """
    app = FastAPI()
    app.middleware("http")(main.request_context)

    @app.exception_handler(NotFoundError)
    async def _handle(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"locale": get_locale()})

    @app.get("/sync")
    def sync_route(dep: str = Depends(_dep)) -> dict[str, str]:  # 동기 def — 스레드풀
        return {"endpoint": get_locale(), "depends": dep}

    @app.get("/async")
    async def async_route() -> dict[str, str]:  # 이벤트 루프
        return {"endpoint": get_locale()}

    @app.get("/boom")
    def boom() -> dict[str, str]:
        raise NotFoundError("없다")

    return TestClient(app)


def test_sync_route_and_depends_see_the_locale(client: TestClient) -> None:
    # 이 하나가 "미들웨어 → 스레드풀" 경계를 증명한다. 여기가 깨지면 설계를 바꿔야 한다.
    body = client.get("/sync", headers={"Accept-Language": "en"}).json()
    assert body == {"endpoint": "en", "depends": "en"}


def test_async_route_sees_the_locale(client: TestClient) -> None:
    assert client.get("/async", headers={"Accept-Language": "en"}).json() == {"endpoint": "en"}


def test_exception_handler_sees_the_locale(client: TestClient) -> None:
    # 핸들러는 BaseHTTPMiddleware 가 띄운 자식 태스크 안쪽이라 같은 복사본을 본다.
    res = client.get("/boom", headers={"Accept-Language": "en"})
    assert res.status_code == 404
    assert res.json() == {"locale": "en"}


def test_locale_does_not_leak_between_requests(client: TestClient) -> None:
    # 미들웨어가 모든 요청에서 무조건 set 하므로 앞 요청의 값이 남을 수 없다.
    assert client.get("/sync", headers={"Accept-Language": "en"}).json()["endpoint"] == "en"
    assert client.get("/sync").json()["endpoint"] == "ko"


@pytest.mark.parametrize("header", ["", "ko", "ko-KR,en;q=0.9", "*", "zz", "english"])
def test_unknown_or_korean_header_falls_back_to_ko(client: TestClient, header: str) -> None:
    assert client.get("/sync", headers={"Accept-Language": header}).json()["endpoint"] == "ko"


def test_vary_header_is_set(client: TestClient) -> None:
    # 응답 본문이 언어를 타므로 캐시가 언어별로 갈라야 한다.
    assert client.get("/sync").headers["Vary"] == "Accept-Language"


def test_middleware_is_registered_on_the_production_app() -> None:
    # 위 테스트들은 미들웨어 '함수' 를 검증한다 — 그것이 운영 앱에 실제로 붙어 있는지는 별개다.
    assert any(
        getattr(m, "kwargs", {}).get("dispatch") is main.request_context
        for m in main.app.user_middleware
    ), "request_context 가 운영 앱의 미들웨어 스택에 없다"
