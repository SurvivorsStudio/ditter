"""``/duckdb`` — 이기종 연합 조회 (여러 연결을 한 SQL 로).

`/connections/{id}/query` 와 짝이지만 **연결 하나에 매이지 않는다** — 그래서
경로에 connection_id 가 없다. 어느 연결을 쓸지는 SQL 안의 `연결이름.…` 참조가 정한다
(문법과 근거는 ``services/duck_service`` 도크스트링).

응답 모양은 단일 연결 조회와 같은 :class:`QueryResultOut` 이다. 결과 그리드가
같은 컴포넌트라 모양이 갈리면 프론트가 둘로 쪼개진다.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.rbac import Role, require_role
from ..db import get_db
from ..schemas.connection import QueryResultOut
from ..services import duck_service as svc

router = APIRouter(prefix="/duckdb", tags=["duckdb"])

DbSession = Annotated[Session, Depends(get_db)]


@router.post("/query", response_model=QueryResultOut)
def run_query(
    db: DbSession,
    query: Annotated[str, Body(embed=True)],
    limit: Annotated[int | None, Body(embed=True)] = None,
    offset: Annotated[int | None, Body(embed=True)] = None,
    sort_col: Annotated[str | None, Body(embed=True)] = None,
    sort_dir: Annotated[str, Body(embed=True)] = "asc",
    filters: Annotated[list[dict[str, Any]] | None, Body(embed=True)] = None,
    _: object = Depends(require_role(Role.VIEWER)),
) -> QueryResultOut:
    """여러 연결에 걸친 SELECT 를 실행한다 (읽기 전용).

    ``offset`` 으로 다음 페이지를 이어 받고, ``sort_col``/``sort_dir``/``filters`` 는
    전체 결과 기준으로 적용된다 — 단일 연결 조회와 같은 규칙이다.
    """
    columns, rows, has_more, elapsed_ms, total = svc.run_query(
        db,
        query=query,
        limit=limit,
        offset=offset or 0,
        sort_col=sort_col,
        sort_dir=sort_dir,
        filters=filters,
    )
    return QueryResultOut(
        columns=columns,
        rows=rows,
        row_count=len(rows),
        truncated=has_more,
        elapsed_ms=elapsed_ms,
        total=total,
    )


class ScriptOut(BaseModel):
    """조회를 그대로 재현하는 파이썬 스크립트."""

    filename: str
    code: str
    #: 돌리기 전에 채워야 하는 환경변수 (비밀번호는 코드에 넣지 않는다)
    password_envs: list[str]


@router.post("/script", response_model=ScriptOut)
def python_script(
    db: DbSession,
    query: Annotated[str, Body(embed=True)],
    _: object = Depends(require_role(Role.VIEWER)),
) -> ScriptOut:
    """지금 쓴 연합 쿼리를 붙여 넣고 바로 돌릴 수 있는 파이썬 코드로.

    편집기 문법은 EAI 안에서만 통하므로 SQL 도 DuckDB 가 아는 이름으로 바꿔 넣는다.
    비밀번호는 넣지 않고 환경변수 자리만 남긴다 — 코드는 복사되고 커밋된다.
    """
    code = svc.build_python_script(db, query=query)
    envs = sorted(set(re.findall(r"'(EAI_PW_[A-Z0-9_]+)'", code)))
    return ScriptOut(filename="federated_query.py", code=code, password_envs=envs)


@router.post("/export")
def export_result(
    db: DbSession,
    query: Annotated[str, Body(embed=True)],
    format: Annotated[str, Body(embed=True)] = "csv",
    sort_col: Annotated[str | None, Body(embed=True)] = None,
    sort_dir: Annotated[str, Body(embed=True)] = "asc",
    filters: Annotated[list[dict[str, Any]] | None, Body(embed=True)] = None,
    _: object = Depends(require_role(Role.VIEWER)),
) -> StreamingResponse:
    """연합 조회 결과를 파일로 내려받는다 (현재 정렬·필터 반영). csv·json·txt."""
    filename, mime, stream = svc.export_rows(
        db,
        query=query,
        fmt=format,
        sort_col=sort_col,
        sort_dir=sort_dir,
        filters=filters,
    )
    return StreamingResponse(
        stream,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
