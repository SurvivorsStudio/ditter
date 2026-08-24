"""SAP 사이드카 HTTP API.

워커·API 컨테이너는 NW RFC SDK 를 갖지 않고 이 서비스와 HTTP 로만 이야기한다.
SAP 자격증명도 SDK 도 이 컨테이너 경계 안에 머문다 (설계 문서 §2, §3).

내부망 전용이지만 무인증으로 두지 않는다 — ``EAI_SAP_API_TOKEN`` 공유 토큰을 요구한다.
"""

from __future__ import annotations

import logging
import secrets
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .backends import reset_backends, resolve_backend
from .backends.base import SapCallError, SapConnectionError, SapError
from .bapi import call_bapi
from .config import Settings, get_settings
from .credentials import SapCredentials
from .read_table import DEFAULT_PAGE_SIZE, describe_table, read_table

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="EAI SAP Connector",
    version="0.1.0",
    description="NW RFC SDK 를 격리하는 사이드카. RFC_READ_TABLE 과 BAPI 를 HTTP 로 노출한다.",
)


# --------------------------------------------------------------------- 인증


def require_token(
    settings: Annotated[Settings, Depends(get_settings)],
    x_sap_token: Annotated[str | None, Header()] = None,
) -> None:
    expected = settings.api_token
    if not expected:
        # 토큰을 안 정했으면 검사하지 않는다 — 로컬 개발 편의. 운영에서는 반드시 설정한다.
        return
    if not x_sap_token or not secrets.compare_digest(x_sap_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "사이드카 토큰이 올바르지 않습니다")


Auth = Depends(require_token)
Config = Annotated[Settings, Depends(get_settings)]


# --------------------------------------------------------------------- 스키마


class CredentialedRequest(BaseModel):
    """모든 SAP 호출의 공통 부분 — 접속 정보를 요청마다 실어 보낸다 (방안 A).

    비어 있으면 사이드카 .env 폴백을 쓴다.
    """

    credentials: SapCredentials = Field(default_factory=SapCredentials)


class PingRequest(CredentialedRequest):
    pass


class SchemaRequest(CredentialedRequest):
    table: str = Field(min_length=1, max_length=30)


class ReadTableRequest(CredentialedRequest):
    table: str = Field(min_length=1, max_length=30)
    fields: list[str] | None = None
    where: str = ""
    delimiter: str = "|"
    row_skips: int = Field(default=0, ge=0)
    row_count: int = Field(default=DEFAULT_PAGE_SIZE, ge=0, le=100_000)


class BapiRequest(CredentialedRequest):
    function_name: str = Field(min_length=1, max_length=30)
    parameters: dict[str, Any] = Field(default_factory=dict)
    result_table: str | None = None


class TableRowsResponse(BaseModel):
    rows: list[dict[str, Any]]
    columns: list[str]
    field_groups: int = 1
    truncated: bool = False
    warnings: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------- 오류


@app.exception_handler(SapError)
async def handle_sap_error(_: object, exc: SapError) -> JSONResponse:
    """SAP 오류를 HTTP 로 옮긴다.

    재시도 가치가 있는 통신 오류는 503, ABAP 이 거부한 것은 502 로 구분한다 —
    호출자(커넥터)가 재시도 여부를 판단할 수 있어야 한다.
    """
    retryable = getattr(exc, "retryable", False)
    return JSONResponse(
        status_code=503 if retryable else 502,
        content={"detail": str(exc), "code": exc.code, "retryable": retryable},
    )


# --------------------------------------------------------------------- 엔드포인트


@app.get("/health")
def health(settings: Config) -> dict[str, Any]:
    """프로세스 생존만 본다. SAP 왕복은 하지 않는다."""
    return {"status": "ok", "backend": str(settings.backend)}


@app.post("/ping", dependencies=[Auth])
def ping(payload: PingRequest, settings: Config) -> dict[str, Any]:
    """SAP 에 실제로 붙어 시스템 정보를 확인한다. 접속 정보는 요청 body 로 온다."""
    return resolve_backend(settings, payload.credentials).ping()


@app.post("/schema", dependencies=[Auth])
def table_schema(payload: SchemaRequest, settings: Config) -> dict[str, Any]:
    """지정 테이블의 필드 메타. 512자 초과 여부를 미리 알려준다."""
    backend = resolve_backend(settings, payload.credentials)
    fields = describe_table(backend, payload.table)
    total = sum(f.length for f in fields)
    return {
        "table": payload.table.upper(),
        "fields": [
            {"name": f.name, "length": f.length, "type": f.type, "text": f.text} for f in fields
        ],
        "total_width": total,
        # UI 가 "이 테이블은 나눠 읽어야 한다"를 미리 보여줄 수 있게 알린다
        "requires_split": total > 512,
    }


@app.post("/read-table", dependencies=[Auth], response_model=TableRowsResponse)
def read_table_endpoint(payload: ReadTableRequest, settings: Config) -> TableRowsResponse:
    result = read_table(
        resolve_backend(settings, payload.credentials),
        table=payload.table,
        fields=payload.fields,
        where=payload.where,
        delimiter=payload.delimiter,
        row_skips=payload.row_skips,
        row_count=payload.row_count or settings.page_size,
    )
    return TableRowsResponse(
        rows=result.rows,
        columns=[f.name for f in result.fields],
        field_groups=result.field_groups,
        truncated=result.truncated,
        warnings=result.warnings,
    )


@app.post("/bapi", dependencies=[Auth], response_model=TableRowsResponse)
def bapi_endpoint(payload: BapiRequest, settings: Config) -> TableRowsResponse:
    result = call_bapi(
        resolve_backend(settings, payload.credentials),
        function_name=payload.function_name,
        parameters=payload.parameters,
        result_table=payload.result_table,
    )
    columns = list(result.rows[0].keys()) if result.rows else []
    return TableRowsResponse(
        rows=result.rows, columns=columns, truncated=False, warnings=result.warnings
    )


@app.post("/reset", dependencies=[Auth])
def reset() -> dict[str, str]:
    """모든 커넥션을 버린다. SAP 쪽에서 세션이 끊겼을 때 복구용."""
    reset_backends()
    return {"status": "reset"}


__all__ = ["SapCallError", "SapConnectionError", "app"]
