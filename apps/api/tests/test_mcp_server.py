"""MCP 표면이 실제로 사는지 확인한다.

이 파일 이전에는 ``eai_api.main`` 도 ``mcp`` 도 테스트에 단 한 번도 등장하지
않았다 — ``mcp_server.py``·``main.py`` 의 MCP 배선(생성자, 데코레이터, ``http_app``,
lifespan)은 어떤 테스트도 태우지 않았다는 뜻이다. fastmcp 를 올릴 때 CI 가 초록불이어도
그건 "락이 풀리고 무관한 테스트가 통과했다"만 증명할 뿐, MCP 서버가 실제로 뜨는지는
증명하지 못한다. 이 테스트가 그 구멍을 메운다.

특히 ``main.py`` 의 ``mcp_app.router.lifespan_context(app)`` 는 공식 가이드가 다루지
않는 경로라 fastmcp 버전을 올릴 때마다 여기서만 조용히 깨질 수 있다 — 그래서 반드시
``with TestClient(app):`` 로 lifespan 을 실제로 태워야 한다.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_mcp_tools_are_registered() -> None:
    """도구 목록이 비어 있지 않고, 알려진 도구 이름 몇 개가 실제로 등록되어 있다.

    개수를 하드코딩하지 않는다 — 도구가 늘 때마다 깨지는 테스트는 가치가 없다.
    """
    import asyncio

    from eai_api.mcp_server import mcp

    tools = asyncio.run(mcp.list_tools())
    names = {t.name for t in tools}

    assert names, "MCP 서버에 등록된 도구가 하나도 없다"
    for expected in {"list_connections", "test_connection", "run_pipeline", "get_run_status"}:
        assert expected in names, f"{expected} 가 MCP 도구 목록에 없다"


def test_app_boots_and_mounts_mcp() -> None:
    """앱 임포트 → lifespan 기동 → /mcp-server 마운트가 실제로 성립한다.

    ``with TestClient(app):`` 로 감싸야 FastAPI/Starlette 의 lifespan 이 실행된다.
    ``mcp_app.router.lifespan_context(app)`` 경로가 fastmcp 3.x 에서 깨졌다면
    이 블록에 진입하는 순간(startup) 예외가 나서 여기서 바로 잡힌다.
    """
    from eai_api.main import app

    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        body = response.json()
        assert body["mcp"] == "/mcp-server/mcp"

        # 마운트된 MCP 서브앱이 실제로 그 경로에 붙어 있는지 — 인증/세션 헤더가 없어
        # 프로토콜 자체는 오류를 낼 수 있지만, 404(마운트 없음)만 아니면 붙어 있는 것이다.
        mcp_response = client.post("/mcp-server/mcp", json={})
        assert mcp_response.status_code != 404
