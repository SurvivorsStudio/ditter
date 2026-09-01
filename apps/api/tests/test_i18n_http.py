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


# ---------------------------------------------------------------- 운영 앱의 실제 응답


class _FakeSession:
    """`session.get(Pipeline, pk)` 만 하는 최소 스텁.

    운영 코드가 DB 를 요구해서 지금까지 아무도 `TestClient` 를 쓰지 않았다. 그런데
    이 배치의 핵심 주장("문구의 절반 이상이 예외가 아니라 200 응답 본문이다")은
    **응답 본문을 실제로 봐야** 증명된다. 스텁 몇 줄이면 그 증명이 선다.

    (모델이 JSONB 를 쓰므로 SQLite `create_all` 로는 안 되고, 스텁이 맞다.)
    """

    def __init__(self, pipeline: object | None) -> None:
        self._pipeline = pipeline

    def get(self, _model: object, _pk: str) -> object | None:
        return self._pipeline


def _app_with(pipeline: object | None) -> TestClient:
    from eai_api.db import get_db

    main.app.dependency_overrides[get_db] = lambda: _FakeSession(pipeline)
    return TestClient(main.app)


def _empty_pipeline() -> object:
    from eai_api.models import Pipeline

    return Pipeline(id="p1", name="p", definition={"nodes": [], "edges": [], "variables": {}})


@pytest.fixture
def app_client():
    client = _app_with(_empty_pipeline())
    yield client
    main.app.dependency_overrides.clear()


def test_validate_body_is_translated(app_client: TestClient) -> None:
    """**200 응답 본문**이 언어를 따라온다 — 예외 핸들러만 번역했다면 여기는 한국어다.

    이 테스트가 "발생 시점에 번역한다"는 설계 결정의 존재 이유다.
    """
    ko = app_client.post("/pipelines/p1/validate").json()
    assert ko["issues"][0]["message"] == "노드가 없습니다"

    en = app_client.post("/pipelines/p1/validate", headers={"Accept-Language": "en"}).json()
    assert en["issues"][0]["message"] == "There are no nodes"
    # 코드는 언어를 타지 않는다 — 코드로 분기하는 쪽이 안전한 이유다.
    assert en["issues"][0]["code"] == ko["issues"][0]["code"] == "dag.graph.empty"


def test_no_header_keeps_todays_korean(app_client: TestClient) -> None:
    # 헤더를 안 보내는 기존 클라이언트는 오늘과 바이트 동일한 응답을 받는다.
    body = app_client.post("/pipelines/p1/validate").json()
    assert body["issues"][0]["message"] == "노드가 없습니다"


def test_service_error_detail_is_translated() -> None:
    """예외 경로 — 아직 이 문구는 사전에 없어 두 언어가 같다.

    지금 확인하는 것은 **`detail` 이 그대로 나온다는 것**(회귀 방지)이고,
    이 문구가 옮겨지면 여기서 영어가 되어야 한다.
    """
    client = _app_with(None)
    try:
        res = client.post("/pipelines/ghost/validate", headers={"Accept-Language": "en"})
        assert res.status_code == 404
        assert "ghost" in res.json()["detail"]
    finally:
        main.app.dependency_overrides.clear()


def test_gate_wrapper_and_inner_rules_speak_one_language() -> None:
    """en 에서 `실행할 수 없는 파이프라인입니다 — A target table is required` 가 나오면 안 된다.

    래퍼(`pipeline_service`)와 그 안에 이어 붙는 규칙 문구(`schemas/dag.py`)가 서로 다른
    커밋에서 옮겨지므로, 한쪽만 옮긴 상태가 실제로 생길 수 있다. 그때 화면에는 한국어
    껍데기에 영어 속이 뜬다 — 눈으로만 보이는 종류라 여기서 못박는다.
    """
    from eai_api.i18n.locale import _locale
    from eai_api.services.errors import ValidationError
    from eai_api.services.pipeline_service import assert_runnable

    def _has_hangul(s: str) -> bool:
        return any("가" <= c <= "힣" for c in s)

    empty = _empty_pipeline()
    token = _locale.set("en")
    try:
        with pytest.raises(ValidationError) as exc:
            assert_runnable(empty)
        assert not _has_hangul(str(exc.value)), f"en 응답에 한국어가 섞였다: {exc.value}"
    finally:
        _locale.reset(token)

    # ko 는 반대로 영어 문장이 섞이지 않아야 한다 (규칙 이름·식별자는 예외).
    with pytest.raises(ValidationError) as exc_ko:
        assert_runnable(empty)
    assert _has_hangul(str(exc_ko.value))


def test_vary_keeps_origin_from_cors() -> None:
    """`Vary` 를 덮어쓰지 않고 덧붙이는지.

    `headers["Vary"] = ...` 는 같은 키를 전부 지운다. 이 미들웨어가 CORSMiddleware 보다
    바깥이라, 덮어쓰면 CORS 가 붙인 `Vary: Origin` 이 사라진다 — `allow_credentials=True`
    에 오리진이 구체 목록이라 응답마다 Access-Control-Allow-Origin 이 다른데 캐시가
    Origin 으로 갈리지 않게 된다. 앞에 캐시 계층이 서는 날 조용히 터지는 종류다.
    """
    client = TestClient(main.app)
    origin = {"Origin": "http://localhost:5173"}

    simple = client.get("/", headers=origin)
    assert "Origin" in simple.headers["Vary"]
    assert "Accept-Language" in simple.headers["Vary"]

    preflight = client.options(
        "/pipelines",
        headers={**origin, "Access-Control-Request-Method": "POST"},
    )
    assert "Origin" in preflight.headers["Vary"]
