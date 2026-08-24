"""SAP RFC 커넥터 — 사이드카 HTTP 클라이언트.

설계 문서 §2·§3: NW RFC SDK 는 **전용 컨테이너로 격리**한다. 그래서 이 클래스는
SAP 라이브러리를 전혀 임포트하지 않는다. 워커·API 는 SDK 도 SAP 자격증명도 갖지 않고
사이드카(`apps/sap-connector`)와 HTTP 로만 이야기한다.

Connection.config 에 담기는 것은 SAP 접속 정보가 아니라 **사이드카 주소**다.
SAP 자격증명은 사이드카 컨테이너의 환경변수에만 존재한다.

읽기 모드 두 가지 (설계 문서 §5 — 가능하면 BAPI 우선):
- ``mode="bapi"``       : BAPI 호출. 512자 제약이 없고 결과가 구조화되어 있다.
- ``mode="read_table"`` : RFC_READ_TABLE. 사이드카가 512자 분할을 알아서 처리한다.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Any

import urllib3

from .base import (
    ColumnSchema,
    ConnectorType,
    HealthResult,
    HealthStatus,
    ReadSpec,
    RecordBatch,
    TableSchema,
    WriteMode,
    WriteResult,
    WriteSpec,
)
from .errors import (
    ConfigurationError,
    ConnectionFailed,
    ReadFailed,
    UnsupportedOperation,
)
from .retry import with_retry

logger = logging.getLogger(__name__)

#: 사이드카가 재시도 가치가 있다고 알려주는 상태코드 (통신 계층 오류)
RETRYABLE_STATUS = frozenset({502, 503, 504})

DEFAULT_PAGE_SIZE = 2000


class SapRfcConnector:
    """SAP 소스. 타깃으로는 쓰지 않는다 — EAI 는 SAP 에서 읽어오는 방향이다."""

    type = ConnectorType.SAP_RFC

    def __init__(
        self,
        *,
        sidecar_url: str = "http://sap-connector:8100",
        api_token: str = "",
        timeout: int = 300,
        page_size: int = DEFAULT_PAGE_SIZE,
        verify_tls: bool = True,
        # ── SAP 접속 정보 (방안 A: 연결에 저장, 요청 body 로 사이드카에 전달) ──
        # 워커는 SDK 를 갖지 않고, 이 값들을 사이드카로 넘기기만 한다.
        ashost: str = "",
        sysnr: str = "",
        client: str = "",
        user: str = "",
        passwd: str = "",
        lang: str = "",
        mshost: str = "",
        group: str = "",
        sysid: str = "",
        snc_qop: str = "",
        snc_myname: str = "",
        snc_partnername: str = "",
        snc_lib: str = "",
        write_spec: WriteSpec | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not sidecar_url:
            raise ConfigurationError("sidecar_url 이 필요합니다", connector=str(self.type))
        self.sidecar_url = sidecar_url.rstrip("/")
        self.api_token = api_token
        self.timeout = timeout
        self.page_size = page_size
        self.verify_tls = verify_tls
        # 값이 있는 접속 항목만 모은다. 비면 사이드카가 .env 폴백을 쓴다.
        self.credentials = {
            k: v
            for k, v in {
                "ashost": ashost,
                "sysnr": sysnr,
                "client": client,
                "user": user,
                "passwd": passwd,
                "lang": lang,
                "mshost": mshost,
                "group": group,
                "sysid": sysid,
                "snc_qop": snc_qop,
                "snc_myname": snc_myname,
                "snc_partnername": snc_partnername,
                "snc_lib": snc_lib,
            }.items()
            if v
        }
        self.write_spec = write_spec or WriteSpec()
        self.extra = extra or {}
        self._http: urllib3.PoolManager | None = None

    # ------------------------------------------------------------ HTTP

    @property
    def http(self) -> urllib3.PoolManager:
        if self._http is None:
            self._http = urllib3.PoolManager(
                retries=False,  # 재시도는 with_retry 가 관장한다 (백오프를 통일하기 위해)
                timeout=urllib3.Timeout(connect=10, read=self.timeout),
                cert_reqs="CERT_REQUIRED" if self.verify_tls else "CERT_NONE",
            )
        return self._http

    def close(self) -> None:
        if self._http is not None:
            self._http.clear()
            self._http = None

    def __enter__(self) -> SapRfcConnector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _request(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """사이드카에 POST 한다. 접속 정보(credentials)를 body 에 실어 보낸다 (방안 A)."""
        import json

        headers = {"Content-Type": "application/json"}
        if self.api_token:
            headers["X-Sap-Token"] = self.api_token

        # 접속 정보를 매 요청 body 에 얹는다. 사이드카가 이걸로 그때그때 SAP 에 붙는다.
        payload_body = {**body, "credentials": self.credentials}

        try:
            response = self.http.request(
                "POST",
                f"{self.sidecar_url}{path}",
                body=json.dumps(payload_body).encode("utf-8"),
                headers=headers,
            )
        except urllib3.exceptions.HTTPError as exc:
            raise ConnectionFailed(
                f"SAP 사이드카에 연결할 수 없습니다 ({self.sidecar_url}): {exc}",
                connector=str(self.type),
                cause=exc,
            ) from exc

        payload: dict[str, Any] = {}
        if response.data:
            try:
                payload = json.loads(response.data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                payload = {"detail": response.data[:500].decode("utf-8", "replace")}

        if response.status >= 400:
            detail = str(payload.get("detail", f"사이드카 오류 {response.status}"))
            # 사이드카가 재시도 가능 여부를 알려준다 — 통신 오류만 재시도한다
            if payload.get("retryable") or response.status in {503, 504}:
                raise ConnectionFailed(detail, connector=str(self.type))
            raise ReadFailed(detail, connector=str(self.type))
        return payload

    # ------------------------------------------------------------ 계약 구현

    @with_retry()
    def test_connection(self) -> HealthResult:
        started = time.perf_counter()
        info = self._request("/ping", {})
        parts = [str(info.get(k, "")) for k in ("system_id", "client", "release") if info.get(k)]
        return HealthResult(
            status=HealthStatus.OK,
            message=("목 모드 — 실제 SAP 아님" if info.get("mock") else "연결 정상"),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            server_version=" / ".join(parts) or None,
        )

    @with_retry()
    def discover_schema(
        self, table: str | None = None, *, include_pk: bool = True, include_columns: bool = True
    ) -> list[TableSchema]:
        """지정한 테이블 하나의 필드를 조회한다.

        SAP 은 테이블이 수만 개라 목록을 열거하지 않는다. **연결은 SAP 시스템만 가리키고,
        어느 테이블을 볼지는 노드 설정에서 정한다** — 그래야 테이블마다 연결을 만들지 않는다.

        ``table`` 없이 부르면 빈 목록을 돌려준다. 호출자(노드 설정 UI)가 테이블명을
        받아 다시 부르는 흐름을 전제한다.
        """
        if not table:
            logger.debug("SAP 스키마 조회에 테이블이 지정되지 않았습니다 — 빈 목록을 돌려줍니다")
            return []

        name = table.split(".")[-1].strip().upper()
        if not name:
            return []

        info = self._request("/schema", {"table": name})
        if info.get("requires_split"):
            logger.warning(
                "%s 는 전체 폭 %s자로 512자를 넘습니다 — 필드를 줄이거나 BAPI 를 쓰세요",
                info["table"],
                info.get("total_width"),
            )
        return [
            TableSchema(
                name=info["table"],
                namespace=None,
                columns=[
                    ColumnSchema(
                        name=f["name"],
                        data_type=f"{f['type']}({f['length']})",
                        nullable=True,
                        primary_key=False,
                    )
                    for f in info.get("fields", [])
                ],
            )
        ]

    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        """SAP 에서 배치를 스트리밍한다.

        ``params['mode']`` 가 ``bapi`` 면 BAPI 를, 아니면 RFC_READ_TABLE 을 쓴다.
        RFC_READ_TABLE 은 ROWSKIPS/ROWCOUNT 로 페이지를 넘기며 읽는다.
        """
        mode = str(spec.params.get("mode", "read_table")).lower()
        if mode == "bapi":
            yield from self._read_bapi(spec)
        else:
            yield from self._read_table(spec)

    def _read_bapi(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        function_name = spec.function or spec.params.get("function_name")
        if not function_name:
            raise ConfigurationError("BAPI 모드는 function_name 이 필요합니다", connector=str(self.type))

        payload = {
            "function_name": function_name,
            "parameters": spec.params.get("bapi_parameters") or {},
            "result_table": spec.params.get("result_table"),
        }
        result = self._request("/bapi", payload)
        rows = result.get("rows") or []
        for warning in result.get("warnings") or []:
            logger.warning("BAPI 경고: %s", warning)

        # BAPI 는 한 번에 결과를 다 준다 — 하위 노드가 감당하도록 배치로 쪼개 흘린다
        yield from _chunk(rows, result.get("columns") or [], spec.batch_size, spec.incremental_column)

    def _read_table(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        if not spec.table:
            raise ConfigurationError("RFC_READ_TABLE 모드는 table 이 필요합니다", connector=str(self.type))

        where = _build_where(spec)
        page_size = min(spec.batch_size, self.page_size) or self.page_size
        skips = 0
        emitted = 0
        pending: RecordBatch | None = None

        while True:
            result = self._request(
                "/read-table",
                {
                    "table": spec.table,
                    "fields": list(spec.columns) if spec.columns else None,
                    "where": where,
                    "delimiter": str(spec.params.get("delimiter", "|")),
                    "row_skips": skips,
                    "row_count": page_size,
                },
            )
            rows = result.get("rows") or []
            columns = result.get("columns") or []
            for warning in result.get("warnings") or []:
                logger.warning("%s: %s", spec.table, warning)

            if not rows:
                break

            if spec.limit is not None and emitted + len(rows) > spec.limit:
                rows = rows[: spec.limit - emitted]
            emitted += len(rows)

            batch = RecordBatch(
                rows=rows,
                columns=columns,
                max_watermark=_max_watermark(rows, spec.incremental_column),
            )
            if pending is not None:
                yield pending
            pending = batch

            if spec.limit is not None and emitted >= spec.limit:
                break
            if not result.get("truncated"):
                break  # 마지막 페이지
            skips += len(rows)

        if pending is None:
            pending = RecordBatch(rows=[], columns=[])
        pending.is_last = True
        yield pending

    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult:
        raise UnsupportedOperation(
            "SAP 은 소스 전용입니다 — SAP 으로 쓰는 것은 이 플랫폼의 범위가 아닙니다",
            connector=str(self.type),
        )


# ------------------------------------------------------------------ 헬퍼


def _build_where(spec: ReadSpec) -> str:
    """노드 설정의 WHERE 와 증분 조건을 합친다.

    SAP 날짜는 ``YYYYMMDD`` 문자열이라 사전순 비교가 곧 크기순 비교다.
    """
    clauses = []
    base = str(spec.params.get("where", "") or "").strip()
    if base:
        clauses.append(f"( {base} )" if " OR " in base.upper() else base)

    if spec.incremental_column and spec.watermark is not None:
        value = str(spec.watermark).strip().replace("'", "")
        clauses.append(f"{spec.incremental_column.upper()} > '{value}'")

    return " AND ".join(clauses)


def _max_watermark(rows: list[dict[str, Any]], column: str | None) -> Any:
    if not column:
        return None
    key = column.upper()
    values = [r[key] for r in rows if r.get(key) not in (None, "")]
    return max(values) if values else None


def _chunk(
    rows: list[dict[str, Any]], columns: list[str], size: int, watermark_column: str | None
) -> Iterator[RecordBatch]:
    """행 목록을 배치로 쪼갠다. 마지막 배치에만 is_last 를 남긴다."""
    if not rows:
        yield RecordBatch(rows=[], columns=columns, is_last=True)
        return
    for start in range(0, len(rows), size):
        window = rows[start : start + size]
        yield RecordBatch(
            rows=window,
            columns=columns,
            max_watermark=_max_watermark(window, watermark_column),
            is_last=start + size >= len(rows),
        )
