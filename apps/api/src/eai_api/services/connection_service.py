"""Connection 도메인 로직 — 시크릿 분리, 연결 테스트, 스키마 탐색."""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from eai_connectors import (
    BaseConnector,
    ConnectorError,
    HealthResult,
    HealthStatus,
    ReadSpec,
    build,
    supported_types,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Connection, Pipeline, utcnow
from ..schemas.connection import SECRET_KEYS, ConnectionCreate, ConnectionUpdate
from .errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from .secrets import get_secret_store

logger = logging.getLogger(__name__)


def split_secrets(config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """config 를 (공개 설정, 시크릿) 으로 가른다."""
    public = {k: v for k, v in config.items() if k not in SECRET_KEYS}
    secret = {k: v for k, v in config.items() if k in SECRET_KEYS and v not in (None, "")}
    return public, secret


def validated_config(config: dict[str, Any]) -> dict[str, Any]:
    """저장 전에 손봐야 하는 config 항목을 정리한다.

    지금은 허용 명령(``allowed_statements``) 하나다 — 저장 시점에 거부하지 않으면
    실행 시점에야 드러나고, 그때는 "왜 안 되지"부터 시작해야 한다.
    """
    if "allowed_statements" not in config:
        return config
    out = dict(config)
    out["allowed_statements"] = list(normalize_statements(out["allowed_statements"]))
    return out


def list_connections(session: Session, *, type_filter: str | None = None) -> list[Connection]:
    stmt = select(Connection).order_by(Connection.created_at.desc())
    if type_filter:
        stmt = stmt.where(Connection.type == type_filter)
    return list(session.execute(stmt).scalars())


def get_connection(session: Session, connection_id: str) -> Connection:
    conn = session.get(Connection, connection_id)
    if conn is None:
        raise NotFoundError(f"연결을 찾을 수 없습니다: {connection_id}")
    return conn


def create_connection(session: Session, payload: ConnectionCreate) -> Connection:
    if payload.type not in supported_types():
        raise ValidationError(
            f"지원하지 않는 커넥터 타입: {payload.type} (가능: {', '.join(supported_types())})"
        )
    exists = session.execute(select(Connection).where(Connection.name == payload.name)).scalar_one_or_none()
    if exists is not None:
        raise ConflictError(f"이미 존재하는 연결 이름입니다: {payload.name}")

    public, secret = split_secrets(validated_config(payload.config))
    secret_ref = get_secret_store(session).put(secret) if secret else None

    conn = Connection(
        name=payload.name,
        type=payload.type,
        description=payload.description,
        config=public,
        secret_ref=secret_ref,
        pool_size=payload.pool_size,
        ssl=payload.ssl,
        cdc_enabled=payload.cdc_enabled,
    )
    session.add(conn)
    session.flush()
    return conn


def update_connection(session: Session, connection_id: str, payload: ConnectionUpdate) -> Connection:
    conn = get_connection(session, connection_id)

    if payload.name and payload.name != conn.name:
        clash = session.execute(
            select(Connection).where(Connection.name == payload.name)
        ).scalar_one_or_none()
        if clash is not None:
            raise ConflictError(f"이미 존재하는 연결 이름입니다: {payload.name}")
        conn.name = payload.name

    if payload.config is not None:
        public, secret = split_secrets(validated_config(payload.config))
        conn.config = public
        if secret:
            # 시크릿을 함께 보냈을 때만 교체한다. 안 보내면 기존 값을 유지.
            conn.secret_ref = get_secret_store(session).put(secret, ref=conn.secret_ref)

    for field in ("description", "pool_size", "ssl", "cdc_enabled"):
        value = getattr(payload, field)
        if value is not None:
            setattr(conn, field, value)

    session.flush()
    evict_connector(connection_id)  # config/시크릿이 바뀌었을 수 있으니 캐시 폐기
    return conn


@dataclass(frozen=True, slots=True)
class ConnectionUsage:
    """이 연결을 참조하는 파이프라인 하나."""

    pipeline_id: str
    pipeline_name: str
    pipeline_status: str
    #: 참조하는 노드 id 들 (한 파이프라인이 같은 연결을 여러 노드에서 쓸 수 있다)
    node_ids: list[str]


def find_usages(session: Session, connection_id: str) -> list[ConnectionUsage]:
    """이 연결을 쓰는 파이프라인을 찾는다.

    DAG 는 JSONB 라 PostgreSQL 의 containment(``@>``)로 한 번에 거른 뒤,
    어느 노드인지는 파이썬에서 뽑는다 — 후보가 이미 좁아졌으므로 싸다.
    """
    stmt = select(Pipeline).where(
        Pipeline.definition.contains({"nodes": [{"params": {"connection_id": connection_id}}]})
    )
    usages: list[ConnectionUsage] = []
    for pipeline in session.execute(stmt).scalars():
        node_ids = nodes_using(pipeline.definition, connection_id)
        if node_ids:
            usages.append(
                ConnectionUsage(
                    pipeline_id=pipeline.id,
                    pipeline_name=pipeline.name,
                    pipeline_status=pipeline.status,
                    node_ids=node_ids,
                )
            )
    return sorted(usages, key=lambda u: u.pipeline_name)


def nodes_using(definition: dict[str, Any] | None, connection_id: str) -> list[str]:
    """DAG 정의에서 이 연결을 참조하는 노드 id 를 뽑는다 (정렬).

    JSONB containment 로 후보를 좁힌 뒤 실제 노드를 확정하는 순수 함수 —
    DB 없이 검증할 수 있도록 분리했다.
    """
    return sorted(
        str(node.get("id", "?"))
        for node in (definition or {}).get("nodes", [])
        if isinstance(node, dict)
        and str((node.get("params") or {}).get("connection_id", "")) == connection_id
    )


def delete_connection(session: Session, connection_id: str, *, force: bool = False) -> list[str]:
    """연결을 지운다. 사용 중이면 ``force`` 없이는 거부한다.

    사용 중인 연결을 말없이 지우면 해당 파이프라인은 **실행 시점에야** 깨진다.
    지운 뒤 손봐야 할 파이프라인 이름을 돌려줘 호출자가 알릴 수 있게 한다.
    """
    conn = get_connection(session, connection_id)
    usages = find_usages(session, connection_id)

    if usages and not force:
        where = ", ".join(f"{u.pipeline_name}({', '.join(u.node_ids)})" for u in usages[:5])
        more = f" 외 {len(usages) - 5}건" if len(usages) > 5 else ""
        raise ConflictError(
            f"'{conn.name}' 은(는) 파이프라인 {len(usages)}개에서 사용 중입니다 — {where}{more}. "
            "그래도 지우려면 force 를 지정하세요."
        )

    get_secret_store(session).delete(conn.secret_ref)
    session.delete(conn)
    evict_connector(connection_id)  # 캐시된 커넥터도 폐기
    return [u.pipeline_name for u in usages]


def resolve_config(session: Session, conn: Connection) -> dict[str, Any]:
    """공개 설정 + 복호화된 시크릿 + 연결 옵션을 합쳐 커넥터 인자로 만든다."""
    merged = dict(conn.config)
    merged.update(get_secret_store(session).get(conn.secret_ref))
    merged.setdefault("pool_size", conn.pool_size)
    merged.setdefault("ssl", conn.ssl)
    # 허용 명령은 접속 정보가 아니라 편집기 정책이다 — 커넥터에 넘기지 않는다.
    merged.pop("allowed_statements", None)

    # SAP 연결이 사이드카 주소를 비워두면 시스템 기본값을 채운다.
    # 연결에 저장하지 않으므로, 운영이 나중에 기본값을 바꾸면 자동으로 따라간다.
    if conn.type == "sap_rfc" and not merged.get("sidecar_url"):
        merged["sidecar_url"] = get_settings().sap_default_sidecar_url

    # 로컬 파일 타깃의 격리 루트는 항상 서버 설정이 정한다 — 연결이 뭘 담았든 덮어쓴다.
    # 이게 보안 경계라, 사용자가 연결 config 로 임의 경로를 주입하지 못하게 한다.
    if conn.type == "local_file":
        merged["root"] = get_settings().local_file_root

    return merged


def open_connector(session: Session, conn: Connection, **kwargs: Any) -> BaseConnector:
    return build(conn.type, resolve_config(session, conn), **kwargs)


# 대화형 읽기(스키마 탐색·쿼리 테스트)용 커넥터 캐시.
# 커넥터마다 엔진/클라이언트(연결 풀)를 요청마다 새로 열고 버리면 원격 DB 재연결
# 핸드셰이크(수백 ms~초)를 매번 낸다. 연결별로 캐시해 재사용하면 첫 요청만 연결 비용을 낸다.
# SQL 엔진은 pool_pre_ping+pool_recycle 이라 유휴로 끊겨도 안전하게 되살린다.
_CONNECTOR_CACHE: dict[str, tuple[str, BaseConnector]] = {}
_CACHE_LOCK = threading.Lock()


def _config_fingerprint(conn_type: str, cfg: dict[str, Any]) -> str:
    """config·시크릿이 바뀌면 지문이 달라져 캐시를 새로 만들게 한다."""
    return f"{conn_type}|" + json.dumps(cfg, sort_keys=True, default=str)


def open_cached_connector(session: Session, conn: Connection) -> BaseConnector:
    """연결별로 커넥터(엔진/클라이언트)를 캐시·재사용한다 — 재연결 핸드셰이크 제거.
    config/시크릿이 바뀌면 새로 만들고, 연결 수정/삭제 시 :func:`evict_connector` 로 비운다.
    **절대 close 하지 말 것** — 캐시가 수명을 소유한다."""
    cfg = resolve_config(session, conn)
    fp = _config_fingerprint(conn.type, cfg)
    stale: BaseConnector | None = None
    with _CACHE_LOCK:
        cached = _CONNECTOR_CACHE.get(conn.id)
        if cached and cached[0] == fp:
            return cached[1]
        if cached:  # config 바뀜 → 옛 커넥터는 락 밖에서 정리
            stale = cached[1]
        connector = build(conn.type, cfg)  # build 는 지연 연결이라 가볍다
        _CONNECTOR_CACHE[conn.id] = (fp, connector)
    if stale is not None:
        try:
            stale.close()
        except Exception:  # noqa: BLE001 - 정리 실패는 삼킨다
            logger.warning("이전 커넥터 정리 실패: %s", conn.id, exc_info=True)
    return connector


def evict_connector(connection_id: str) -> None:
    """연결이 수정/삭제되면 캐시된 커넥터를 폐기한다 (다음 요청에서 새 config 로 재생성)."""
    # DuckDB 연합 조회도 이 연결로 카탈로그를 붙여 두었을 수 있다.
    # 임포트를 함수 안에 두는 이유는 순환 참조다 — duck_service 가 이 모듈을 쓴다.
    from .duck_service import detach_connection

    detach_connection(connection_id)

    with _CACHE_LOCK:
        cached = _CONNECTOR_CACHE.pop(connection_id, None)
    if cached:
        try:
            cached[1].close()
        except Exception:  # noqa: BLE001
            logger.warning("커넥터 evict 실패: %s", connection_id, exc_info=True)


def test_connection(session: Session, connection_id: str) -> HealthResult:
    """연결을 실제로 열어보고 결과를 Connection 에 기록한다."""
    conn = get_connection(session, connection_id)
    try:
        connector = open_connector(session, conn)
    except ConnectorError as exc:
        result = HealthResult(status=HealthStatus.ERROR, message=str(exc))
    else:
        try:
            result = connector.test_connection()
        except ConnectorError as exc:
            result = HealthResult(status=HealthStatus.ERROR, message=str(exc))
        finally:
            connector.close()

    conn.health_status = str(result.status)
    conn.health_message = result.message
    conn.last_tested_at = utcnow()
    session.flush()
    return result


def discover_schema(
    session: Session,
    connection_id: str,
    table: str | None = None,
    include_pk: bool = True,
    include_columns: bool = True,
) -> list[Any]:
    """스키마 탐색. ``table`` 을 주면 그것만 조회한다.

    SAP 처럼 테이블이 수만 개인 소스는 ``table`` 이 사실상 필수다 — 연결은 시스템만
    가리키고 어느 테이블을 볼지는 노드 설정에서 정하기 때문이다.

    ``include_pk=False`` 면 PK 조회를 건너뛴다 — SQL 편집기 트리·자동완성처럼 PK 가 필요 없는
    벌크 로드에서 느린 information_schema 조인을 피한다 (대형 DW 에서 수 초 단축).
    """
    conn = get_connection(session, connection_id)
    connector = open_cached_connector(session, conn)  # 캐시 재사용 — close 하지 않는다
    return connector.discover_schema(
        table, include_pk=include_pk, include_columns=include_columns
    )


def list_objects(session: Session, connection_id: str) -> list[Any]:
    """DBeaver 식 카테고리 트리를 위한 객체 목록(테이블·뷰·함수·프로시저·시퀀스 등).

    커넥터가 ``list_objects`` 를 구현하지 않으면(S3·SAP 등) 빈 목록을 돌려준다 —
    트리는 이 커넥터 종류에서 카테고리를 그리지 않고 기존 방식으로 폴백한다.
    """
    conn = get_connection(session, connection_id)
    connector = open_cached_connector(session, conn)  # 캐시 재사용 — close 하지 않는다
    fn = getattr(connector, "list_objects", None)
    if fn is None:
        return []
    return fn()


def object_detail(session: Session, connection_id: str, kind: str, schema: str | None, name: str) -> Any:
    """우클릭 → 상세 보기. 커넥터가 object_detail 을 구현하지 않으면 None."""
    conn = get_connection(session, connection_id)
    connector = open_cached_connector(session, conn)
    fn = getattr(connector, "object_detail", None)
    if fn is None:
        return None
    return fn(kind, schema, name)


def preview_rows(
    session: Session,
    connection_id: str,
    *,
    table: str | None = None,
    namespace: str | None = None,
    query: str | None = None,
    limit: int | None = None,
) -> tuple[list[str], list[dict[str, Any]], bool]:
    """소스 데이터 미리보기. 서버가 정한 상한을 넘길 수 없다."""
    cap = get_settings().preview_row_limit
    effective = min(limit or cap, cap)

    conn = get_connection(session, connection_id)
    connector = open_cached_connector(session, conn)  # 캐시 재사용 — close 하지 않는다
    spec = ReadSpec(
        table=table, namespace=namespace, query=query, limit=effective, batch_size=min(effective, 1000)
    )
    rows: list[dict[str, Any]] = []
    columns: list[str] = []
    for batch in connector.read(spec):
        columns = list(batch.columns) or columns
        rows.extend(batch.rows)
        if len(rows) >= effective:
            break

    rows = rows[:effective]
    if not columns and rows:
        columns = list(rows[0].keys())
    return columns, rows, len(rows) >= effective


#: 커스텀 SQL 쿼리 테스트를 허용하는 커넥터 타입 (SQL 방언을 쓰는 RDB 만)
_SQL_QUERY_TYPES = frozenset({"mysql", "postgres", "mssql"})

#: 연결마다 체크박스로 켜고 끄는 SQL 명령 (표시 순서를 겸한다).
#: 프론트 `api/statements.ts` 의 `SQL_STATEMENTS` 와 **반드시 같아야 한다** —
#: 한쪽만 늘리면 화면에는 보이는데 저장이 거부된다 (`DUCK_TYPES` 와 같은 주의).
SQL_STATEMENTS: tuple[str, ...] = (
    "select",
    "insert",
    "update",
    "delete",
    "merge",
    "create",
    "alter",
    "drop",
    "truncate",
)

#: 허용 목록이 없는 연결(이 기능 이전에 만들어진 것 포함)의 기본값 — 읽기 전용.
#: 켜 준 적 없는 연결이 쓰기를 받아들이는 쪽으로 실패하지 않게 한다.
DEFAULT_STATEMENTS: tuple[str, ...] = ("select",)

#: 스키마를 바꾸는 명령. 연결에서 켜 두었더라도 **실행하는 사람**이 편집 권한(EDITOR)
#: 이어야 하고, 나머지 쓰기(DML)는 실행 권한(OPERATOR)이 필요하다.
#: 허용 목록은 "이 연결에서 무엇을 할 수 있는가", 역할은 "누가 할 수 있는가"다.
DDL_STATEMENTS = frozenset({"create", "alter", "drop", "truncate"})

#: 체크박스로도 켤 수 없는 것 — 권한 변경은 이 편집기가 할 일이 아니다.
_FORBIDDEN_KEYWORDS = re.compile(r"\b(grant|revoke)\b", re.IGNORECASE)

#: 문장 **안**에 섞여 있어도 허용 목록을 통과해야 하는 키워드.
#: PostgreSQL 의 데이터 변경 CTE(``WITH d AS (DELETE ... RETURNING *) SELECT``)처럼
#: 선두 동사만 보면 읽기로 보이는 문장이 실제로는 쓰기인 경우를 잡는다.
_WRITE_KEYWORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|merge)\b", re.IGNORECASE
)


def strip_sql_noise(sql: str) -> str:
    """키워드 검사 전에 문자열 리터럴·주석을 지운다 — 리터럴 안의 단어를 오탐하지 않게."""
    s = re.sub(r"'(?:[^']|'')*'", "''", sql)  # 작은따옴표 리터럴
    s = re.sub(r"--[^\n]*", " ", s)  # 라인 주석
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.DOTALL)  # 블록 주석
    return s


def normalize_statements(raw: Any) -> tuple[str, ...]:
    """저장 요청의 ``allowed_statements`` 를 정규화한다 (소문자·중복 제거·표시 순서 고정).

    모르는 값은 조용히 버리지 않고 거부한다 — 오타(``selct``)를 흘려보내면 사용자가
    켰다고 믿는 명령이 실행되지 않는데 화면에는 아무 말도 뜨지 않는다.
    """
    if raw is None:
        return DEFAULT_STATEMENTS
    if isinstance(raw, str):  # "select,update" 같은 CSV 도 받아 준다
        items = [p for p in re.split(r"[,\s]+", raw) if p]
    elif isinstance(raw, (list, tuple)):
        items = [str(v) for v in raw]
    else:
        raise ValidationError("허용 명령(allowed_statements)은 명령어 목록이어야 합니다.")

    picked: set[str] = set()
    for item in items:
        v = item.strip().lower()
        if v not in SQL_STATEMENTS:
            raise ValidationError(
                f"허용 명령으로 쓸 수 없는 값입니다: {item} "
                f"(가능: {', '.join(s.upper() for s in SQL_STATEMENTS)})"
            )
        picked.add(v)
    if not picked:
        raise ValidationError("허용 명령을 하나 이상 선택해야 합니다.")
    return tuple(s for s in SQL_STATEMENTS if s in picked)  # 표시 순서로 고정


def connection_statements(conn: Connection) -> frozenset[str]:
    """이 연결의 쿼리 편집기에서 실행할 수 있는 명령.

    설정이 없으면 읽기 전용(``DEFAULT_STATEMENTS``) — 이 기능 이전에 만들어진 연결이
    조용히 쓰기를 받아들이면 안 된다. 저장된 값이 깨져 있어도 같은 쪽으로 떨어진다.
    """
    raw = (conn.config or {}).get("allowed_statements")
    if raw is None:
        return frozenset(DEFAULT_STATEMENTS)
    try:
        return frozenset(normalize_statements(raw))
    except ValidationError:
        logger.warning(
            "연결 %s 의 허용 명령 설정이 올바르지 않아 읽기 전용으로 처리합니다", conn.id
        )
        return frozenset(DEFAULT_STATEMENTS)


def statement_verb(scan: str) -> str:
    """문장의 선두 명령. CTE(``WITH``)는 ``select`` 로 본다 —
    그 안에 쓰기가 섞여 있으면 아래 키워드 검사가 따로 잡는다."""
    m = re.match(r"^([a-z]+)\b", scan, re.IGNORECASE)
    verb = m.group(1).lower() if m else ""
    return "select" if verb == "with" else verb


def ensure_statement_allowed(sql: str, allowed: frozenset[str]) -> tuple[str, str]:
    """편집기에서 온 SQL 이 이 연결에서 실행해도 되는지 본다.

    반환은 ``(정리된 SQL, 선두 명령)``. 거부 사유는 넷이다 —
    빈 문장 · 다중문 · 우리가 다루지 않는 명령 · 허용 목록 밖.
    """
    q = (sql or "").strip().rstrip(";").strip()
    if not q:
        raise ValidationError("실행할 SQL 이 비어 있습니다.")
    # 주석·리터럴을 지운 뒤 남는 앞뒤 공백을 제거한다 —
    # 맨 앞 주석(/* */, --)이 있으면 그 자리가 공백으로 남아 선두 명령 판정이 어긋난다.
    scan = strip_sql_noise(q).strip()
    if not scan:
        raise ValidationError("실행할 SQL 이 비어 있습니다.")  # 주석만 있는 경우
    if ";" in scan:
        raise ValidationError("한 번에 하나의 문장만 실행할 수 있습니다.")
    if _FORBIDDEN_KEYWORDS.search(scan):
        raise ValidationError("권한 변경(GRANT/REVOKE)은 쿼리 편집기에서 실행할 수 없습니다.")

    names = ", ".join(s.upper() for s in SQL_STATEMENTS if s in allowed)
    verb = statement_verb(scan)
    # EXPLAIN 은 읽기 전용 메타 명령 — 허용 목록과 무관하게 편집기에서 직접 돌릴 수 있다.
    # 다만 EXPLAIN ANALYZE 는 안의 쿼리를 실제로 실행하므로, 문장 안 쓰기 키워드
    # (EXPLAIN ANALYZE UPDATE …)는 그 명령이 허용돼야 한다(_WRITE_KEYWORDS 스캔).
    if verb == "explain":
        for hit in _WRITE_KEYWORDS.findall(scan):
            if hit.lower() not in allowed:
                raise ValidationError(
                    f"EXPLAIN 안에 허용되지 않은 {hit.upper()} 가 있습니다 — 허용된 명령: {names}."
                )
        return q, "explain"
    if verb not in SQL_STATEMENTS:
        raise ValidationError(
            f"쿼리 편집기가 다루지 않는 명령입니다: {verb.upper() or '?'} (가능: {names})"
        )
    if verb not in allowed:
        raise ValidationError(
            f"이 연결에서는 {verb.upper()} 를 실행할 수 없습니다 — 허용된 명령: {names}. "
            "「연결 관리」에서 허용 명령을 바꿀 수 있습니다."
        )
    # 선두 명령만 보면 놓치는 것들: 데이터 변경 CTE, SELECT 안에 숨은 DDL.
    for hit in _WRITE_KEYWORDS.findall(scan):
        if hit.lower() not in allowed:
            raise ValidationError(
                f"문장 안에 허용되지 않은 {hit.upper()} 가 있습니다 — 허용된 명령: {names}."
            )
    return q, verb


def ensure_select_only(sql: str) -> str:
    """읽기 전용 경로(내보내기·소스 프리뷰·연합 조회)의 가드 — 단일 SELECT/WITH 만.

    연결의 허용 명령과 무관하게 늘 SELECT 만 통과한다. 이 경로들은 결과를 다시 읽거나
    (내보내기·프리뷰) READ_ONLY 로 붙은 카탈로그를 보므로(연합 조회) 쓰기가 성립하지 않는다.
    """
    return ensure_statement_allowed(sql, frozenset({"select"}))[0]


def _federation_hint(session: Session, query: str) -> str:
    """실패한 SQL 이 **연합 조회 표기**처럼 보이면 그 사실을 덧붙인다.

    `"src-shop".shop.customers` 를 일반 쿼리 탭에 붙여 넣으면 SQL 이 그대로 그 연결로
    나가고, 엔진은 `Invalid object name` 이라고만 답한다 — 무엇이 잘못됐는지 알 방법이
    없다. 표기가 같아서 생기는 혼동이라 원인을 짚어 준다.

    **이미 실패한 쿼리에만** 붙는다. 미리 막지 않는 이유는 오탐 때문이다 —
    연결 이름과 같은 이름의 데이터베이스가 실제로 있을 수 있고, 그때 멀쩡한 쿼리를
    세우는 것이 훨씬 나쁘다.
    """
    try:
        # 임포트를 함수 안에 두는 이유는 순환 참조다 — duck_service 가 이 모듈을 쓴다.
        from .duck_service import federation_reference_hint

        return federation_reference_hint(session, query)
    except Exception:  # 힌트는 부가 정보다 — 여기서 터지면 원래 오류를 가린다
        logger.debug("연합 조회 힌트 생성 실패 (무시)", exc_info=True)
        return ""


def _count_total_sql(
    connector: BaseConnector, base_query: str, params: dict[str, Any] | None = None
) -> int | None:
    """``base_query`` 의 전체 행 수를 센다 (``SELECT COUNT(*) FROM (<query>) t``).

    ORDER BY 등으로 방언에 따라 서브쿼리가 거부될 수 있으므로 실패하면 조용히 ``None``
    (전체 건수 표시를 생략할 뿐 조회 자체는 영향 없음)."""
    wrapped = f"SELECT COUNT(*) AS _eai_total FROM (\n{base_query}\n) AS _eai_count_sub"
    try:
        for batch in connector.read(ReadSpec(query=wrapped, params=params or {}, limit=1, batch_size=1)):
            if batch.rows:
                val = next(iter(batch.rows[0].values()))
                return int(val) if val is not None else None
    except Exception:  # noqa: BLE001 - 카운트는 부가 정보라 실패해도 무시
        logger.debug("전체 건수 COUNT 실패 (무시)", exc_info=True)
    return None


def _escape_like(v: str) -> str:
    """LIKE 패턴의 특수문자(``\\`` ``%`` ``_``)를 이스케이프 — 사용자 값이 와일드카드로
    해석되지 않게. ``ESCAPE '\\'`` 와 함께 쓴다."""
    return v.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


#: 방언별 텍스트 캐스트 타입 (LIKE 비교 전에 어떤 컬럼이든 문자열로)
_TEXT_CAST = {"postgres": "TEXT", "mysql": "CHAR", "mssql": "NVARCHAR(MAX)"}


def _apply_sort_filter(
    connector: BaseConnector,
    conn_type: str,
    base_query: str,
    sort_col: str | None,
    sort_dir: str,
    filters: list[dict[str, Any]] | None,
) -> tuple[str, str, dict[str, Any]]:
    """정렬·컬럼필터를 사용자 쿼리 바깥에 감싼 (실행쿼리, 카운트쿼리, 바인드파라미터).

    - 필터: ``WHERE LOWER(CAST(col AS text)) LIKE :p ESCAPE '\\'`` (대소문자 무시 부분일치).
      값은 바인드 파라미터로 넘겨 SQL 인젝션을 막는다.
    - 정렬: ``ORDER BY "col" ASC|DESC``. 정렬은 건수에 영향이 없어 카운트쿼리엔 붙이지 않는다.
    - 컬럼명은 방언별 식별자 quoting 으로 감싼다.
    필터·정렬이 모두 없으면 원본 쿼리를 그대로 돌려준다."""
    if not sort_col and not filters:
        return base_query, base_query, {}
    quote = connector.quote  # type: ignore[attr-defined]  # SqlConnector.quote (방언별)
    inner = f"SELECT * FROM (\n{base_query}\n) AS _eai_wrap"
    params: dict[str, Any] = {}
    where = ""
    if filters:
        cast_t = _TEXT_CAST.get(conn_type, "CHAR")
        conds: list[str] = []
        for i, f in enumerate(filters):
            col = str(f.get("col") or "")
            val = str(f.get("value") if f.get("value") is not None else "")
            if not col or val == "":
                continue
            key = f"_eai_f{i}"
            conds.append(f"LOWER(CAST({quote(col)} AS {cast_t})) LIKE :{key} ESCAPE '\\'")
            params[key] = f"%{_escape_like(val.lower())}%"
        if conds:
            where = " WHERE " + " AND ".join(conds)
    filtered = inner + where
    exec_query = filtered
    if sort_col:
        direction = "DESC" if str(sort_dir).lower() == "desc" else "ASC"
        exec_query = f"{filtered}\nORDER BY {quote(sort_col)} {direction}"
    return exec_query, filtered, params


@dataclass(frozen=True, slots=True)
class QueryOutcome:
    """쿼리 편집기 한 번의 실행 결과.

    SELECT 와 쓰기 문장이 같은 자리로 돌아온다 — 화면은 하나이고, 무엇을 실행했는지는
    ``statement`` 로 갈린다. 쓰기 문장은 ``affected_rows`` 로만 결과를 말한다
    (``RETURNING``/``OUTPUT`` 이 있으면 행도 함께 온다).
    """

    columns: list[str]
    rows: list[dict[str, Any]]
    has_more: bool
    elapsed_ms: int
    total: int | None
    #: 실행된 선두 명령 (select·insert·update…)
    statement: str = "select"
    #: 쓰기 문장이 바꾼 행 수. SELECT 이거나 방언이 알려주지 않으면 None.
    affected_rows: int | None = None


def _ensure_role_for(verb: str, *, can_write: bool, can_ddl: bool) -> None:
    """허용 명령을 통과한 쓰기 문장에 역할까지 있는지 본다.

    허용 목록은 "이 연결에서 무엇이 가능한가"이고 역할은 "누가 할 수 있는가"다.
    둘을 겹쳐 두는 이유는, 연결을 한 번 열어 두면 그 연결을 볼 수 있는 모든 사람이
    쓰기를 하게 되기 때문이다 — 뷰어는 여전히 읽기만 한다.
    """
    if verb in DDL_STATEMENTS:
        if not can_ddl:
            raise PermissionDeniedError(
                f"{verb.upper()} 실행에는 편집(editor) 권한이 필요합니다."
            )
        return
    if not can_write:
        raise PermissionDeniedError(f"{verb.upper()} 실행에는 실행(operator) 권한이 필요합니다.")


def _run_statement(session: Session, conn: Connection, q: str, verb: str) -> QueryOutcome:
    """SELECT 가 아닌 문장을 실행한다 (트랜잭션 커밋은 커넥터가 한다)."""
    cap = get_settings().query_row_limit
    connector = open_cached_connector(session, conn)
    started = time.perf_counter()
    try:
        columns, rows, affected = connector.execute(q, limit=cap)  # type: ignore[attr-defined]
    except ConnectorError as exc:
        raise ValidationError(f"{verb.upper()} 실행 실패: {str(exc).splitlines()[0]}") from exc
    except Exception as exc:  # 문법 오류·제약 위반 등 — 그대로 보여준다
        raise ValidationError(f"{verb.upper()} 실행 실패: {str(exc).splitlines()[0]}") from exc
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "쿼리 편집기 쓰기 실행: connection=%s statement=%s affected=%s", conn.id, verb, affected
    )
    return QueryOutcome(
        columns=columns,
        rows=rows,
        has_more=False,  # 쓰기 결과는 페이지를 이어 받지 않는다 (재실행하면 또 쓰게 된다)
        elapsed_ms=elapsed_ms,
        total=len(rows) if columns else None,
        statement=verb,
        affected_rows=affected if affected >= 0 else None,
    )


def run_query(
    session: Session,
    connection_id: str,
    *,
    query: str,
    limit: int | None = None,
    offset: int = 0,
    sort_col: str | None = None,
    sort_dir: str = "asc",
    filters: list[dict[str, Any]] | None = None,
    can_write: bool = False,
    can_ddl: bool = False,
) -> QueryOutcome:
    """커스텀 SQL 을 소스에서 실제로 실행해 결과를 돌려준다 (DBeaver 식 쿼리 테스트).

    실행할 수 있는 명령은 **연결마다 다르다** — 「연결 관리」의 허용 명령 체크박스가
    정하고, 기본은 SELECT 뿐이다. SELECT 가 아닌 문장은 ``can_write``/``can_ddl``
    (호출자가 역할에서 계산)까지 통과해야 실행된다.

    SELECT 는 한 번에 서버 상한(``query_row_limit``)만큼만 돌려주되,
    ``offset`` 으로 다음 페이지를 이어 받을 수 있다(스크롤 무한 로딩용).

    임의 SQL 을 LIMIT/OFFSET 으로 재작성하면 방언·중복 컬럼·기존 ORDER BY 와 충돌하므로,
    **커넥터 스트림에서 offset 만큼 건너뛰고 page 만큼 취하는** 방식으로 처리한다 —
    쿼리를 손대지 않아 모든 방언에서 안전하다. 대신 페이지마다 처음부터 다시 읽으므로
    깊은 오프셋은 비용이 커진다(프리뷰 규모에서는 문제 없다).

    ``has_more`` 는 다음 페이지가 있을 수 있음을, ``total`` 은 전체 행 수(첫 페이지에서만 계산,
    이후 페이지는 None)를 뜻한다.
    """
    conn = get_connection(session, connection_id)
    if conn.type not in _SQL_QUERY_TYPES:
        raise ValidationError(
            f"SQL 쿼리 실행은 RDB 연결(mysql·postgres·mssql)에서만 됩니다 — 현재 '{conn.type}'."
        )
    q, verb = ensure_statement_allowed(query, connection_statements(conn))
    if verb == "explain":
        # 사용자가 직접 EXPLAIN 을 돌리면 계획을 결과 그리드에 그대로 보여준다.
        # 안에 쓰기가 있고 ANALYZE 라 실제로 실행되면 역할까지 요구한다.
        if _WRITE_KEYWORDS.search(strip_sql_noise(q)) and "analyze" in q.lower():
            for hit in _WRITE_KEYWORDS.findall(strip_sql_noise(q)):
                _ensure_role_for(hit.lower(), can_write=can_write, can_ddl=can_ddl)
        return _run_explain_statement(session, conn, q)
    if verb != "select":
        _ensure_role_for(verb, can_write=can_write, can_ddl=can_ddl)
        return _run_statement(session, conn, q, verb)

    cap = get_settings().query_row_limit
    page = min(limit or cap, cap)
    offset = max(0, offset)
    need = offset + page  # DB 에서 여기까지 읽고 앞 offset 개는 버린다
    connector = open_cached_connector(session, conn)  # 캐시 재사용 — close 하지 않는다
    exec_query, count_query, params = _apply_sort_filter(
        connector, conn.type, q, sort_col, sort_dir, filters
    )
    spec = ReadSpec(query=exec_query, params=params, limit=need, batch_size=min(need, 1000))
    collected: list[dict[str, Any]] = []
    columns: list[str] = []
    started = time.perf_counter()
    try:
        for batch in connector.read(spec):
            columns = list(batch.columns) or columns
            collected.extend(batch.rows)
            if len(collected) >= need:
                break
    except ConnectorError as exc:
        hint = _federation_hint(session, q)
        if hint:
            raise ValidationError(f"{exc}{hint}") from exc
        raise
    except Exception as exc:  # DB 문법 오류 등 — 사용자에게 그대로 보여준다
        raise ValidationError(
            f"쿼리 실행 실패: {str(exc).splitlines()[0]}{_federation_hint(session, q)}"
        ) from exc
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    has_more = len(collected) >= need  # 정확히 need 만큼 읽었으면 더 있을 수 있다
    rows = collected[offset:need]
    if not columns and rows:
        columns = list(rows[0].keys())

    # 전체 건수는 첫 페이지에서만 계산한다. 결과가 한 페이지에 다 담겼으면(더 없음)
    # 로드된 수가 곧 전체라 COUNT 를 돌릴 필요가 없다.
    total: int | None = None
    if offset == 0:
        total = _count_total_sql(connector, count_query, params) if has_more else len(rows)
    return QueryOutcome(
        columns=columns,
        rows=rows,
        has_more=has_more,
        elapsed_ms=elapsed_ms,
        total=total,
        statement="select",
    )


def explain_query(
    session: Session,
    connection_id: str,
    *,
    query: str,
    analyze: bool = False,
    can_write: bool = False,
    can_ddl: bool = False,
) -> str:
    """쿼리 실행 계획(EXPLAIN [ANALYZE]) 텍스트를 돌려준다 (PostgreSQL·MySQL).

    허용 명령 가드는 그대로 적용된다 — 연결이 SELECT 만 허용하면 SELECT 만 EXPLAIN 할 수 있다.
    EXPLAIN ANALYZE 는 실제로 실행되므로(롤백은 커넥터가 하지만) 비SELECT 는 역할까지 요구한다.
    """
    conn = get_connection(session, connection_id)
    if conn.type not in _SQL_QUERY_TYPES:
        raise ValidationError(
            f"실행 계획(EXPLAIN)은 RDB 연결(mysql·postgres·mssql)에서만 됩니다 — 현재 '{conn.type}'."
        )
    q, verb = ensure_statement_allowed(query, connection_statements(conn))
    if analyze and verb != "select":
        _ensure_role_for(verb, can_write=can_write, can_ddl=can_ddl)
    connector = open_cached_connector(session, conn)  # 캐시 재사용 — close 하지 않는다
    fn = getattr(connector, "explain", None)
    if fn is None:
        raise ValidationError("이 연결 종류는 실행 계획 조회를 지원하지 않습니다.")
    return str(fn(q, analyze=analyze))


def _run_explain_statement(session: Session, conn: Connection, q: str) -> QueryOutcome:
    """편집기에서 직접 돌린 ``EXPLAIN [ANALYZE] …`` 를 실행해 계획을 결과 그리드로 돌려준다.

    롤백 트랜잭션에서 실행해 ANALYZE 의 부작용(DML)을 되돌린다. 결과는 DB 가 돌려주는
    ``QUERY PLAN`` 컬럼 그대로라 일반 결과 그리드에 바로 뜬다.
    """
    connector = open_cached_connector(session, conn)
    fn = getattr(connector, "run_readonly", None)
    if fn is None:
        raise ValidationError("이 연결 종류는 EXPLAIN 을 지원하지 않습니다.")
    started = time.perf_counter()
    try:
        columns, rows = fn(q)
    except ConnectorError as exc:
        raise ValidationError(f"EXPLAIN 실행 실패: {str(exc).splitlines()[0]}") from exc
    return QueryOutcome(
        columns=columns,
        rows=rows,
        has_more=False,
        elapsed_ms=int((time.perf_counter() - started) * 1000),
        total=len(rows),
        statement="explain",
    )


def _extract_balanced(s: str, open_idx: int) -> tuple[str, int]:
    """``s[open_idx] == '('`` 에서 짝이 맞는 ``)`` 까지의 내부 텍스트와 ``)`` 다음 인덱스를 돌려준다.
    문자열 리터럴(``'...'``/``"..."``) 안의 괄호는 무시한다."""
    depth = 0
    i = open_idx
    quote: str | None = None
    esc = False
    while i < len(s):
        c = s[i]
        if quote is not None:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return s[open_idx + 1 : i], i + 1
        i += 1
    raise ValidationError("괄호가 닫히지 않았습니다.")


def _relax_json(text: str) -> str:
    """Mongo 셸식 완화 JSON → 표준 JSON: 홑따옴표 문자열 → 겹따옴표, 따옴표 없는 키에 따옴표."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':  # 겹따옴표 문자열은 그대로 복사
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(text[i : j + 1])
            i = j + 1
        elif c == "'":  # 홑따옴표 문자열 → 겹따옴표
            j = i + 1
            buf: list[str] = []
            while j < n and text[j] != "'":
                if text[j] == "\\":
                    buf.append(text[j : j + 2])
                    j += 2
                    continue
                buf.append('\\"' if text[j] == '"' else text[j])
                j += 1
            out.append('"' + "".join(buf) + '"')
            i = j + 1
        else:
            out.append(c)
            i += 1
    joined = "".join(out)
    # 따옴표 없는 키:  { key:  /  , key:  →  "key":
    return re.sub(r'([{,]\s*)([A-Za-z_$][\w$]*)\s*:', r'\1"\2":', joined)


def _loads_relaxed(text: str, label: str) -> Any:
    """표준 JSON 우선, 실패하면 Mongo 셸식(홑따옴표·따옴표 없는 키)으로 한 번 더 시도."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        try:
            return json.loads(_relax_json(text))
        except json.JSONDecodeError as exc:
            raise ValidationError(f"{label} JSON 파싱 실패: {exc.msg}") from exc


def _mongo_int(text: str, label: str) -> int:
    try:
        return int(text.strip())
    except ValueError as exc:
        raise ValidationError(f"{label}() 인자는 정수여야 합니다.") from exc


def _split_top_args(s: str) -> list[str]:
    """최상위 콤마로 인자를 나눈다 (중첩 {}·[]·()·문자열 안의 콤마는 무시).
    ``find(필터, 프로젝션)`` 처럼 인자가 여럿인 경우를 위해."""
    parts: list[str] = []
    depth = 0
    quote: str | None = None
    esc = False
    start = 0
    for i, c in enumerate(s):
        if quote is not None:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(s[start:i])
            start = i + 1
    parts.append(s[start:])
    return [p.strip() for p in parts]


def _parse_mongo_command(command: str) -> tuple[str, str, str, dict[str, str]]:
    """``컬렉션.find({...})`` / ``컬렉션.aggregate([...])`` 를 파싱한다.
    find 뒤에는 ``.sort()/.skip()/.limit()`` 체이닝을 허용한다.
    반환: (collection, method, arg_text, modifiers)."""
    s = (command or "").strip().rstrip(";").strip()
    m = re.match(r"^([A-Za-z0-9_.$-]+)\.(find|aggregate)\s*\(", s)
    if not m:
        raise ValidationError(
            "형식: 컬렉션.find({ ... }) 또는 컬렉션.aggregate([ ... ]) 로 작성하세요."
        )
    coll, method = m.group(1), m.group(2)
    arg, i = _extract_balanced(s, m.end() - 1)
    modifiers: dict[str, str] = {}
    rest = s[i:].strip()
    while rest:
        mm = re.match(r"^\.\s*(sort|skip|limit)\s*\(", rest)
        if not mm:
            raise ValidationError(
                f"지원하지 않는 표현입니다: '{rest[:24]}' — find 뒤에는 .sort()/.skip()/.limit() 만 됩니다."
            )
        marg, j = _extract_balanced(rest, mm.end() - 1)
        modifiers[mm.group(1)] = marg.strip()
        rest = rest[j:].strip()
    return coll, method, arg.strip(), modifiers


def _mongo_columns(rows: list[dict[str, Any]]) -> list[str]:
    """문서마다 필드가 달라 페이지 전체 키의 합집합을 컬럼으로 삼는다 (_id 를 맨 앞에)."""
    columns: list[str] = []
    seen: set[str] = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                columns.append(k)
    if "_id" in seen:
        columns = ["_id", *[c for c in columns if c != "_id"]]
    return columns


def _count_total_mongo(
    connector: BaseConnector,
    coll: str,
    base_pipeline: list[dict[str, Any]],
    namespace: str | None,
) -> int | None:
    """``base_pipeline`` 결과의 전체 문서 수 (뒤에 ``$count`` 스테이지). 실패하면 ``None``."""
    try:
        res = list(
            connector.aggregate(  # type: ignore[attr-defined]
                coll, [*base_pipeline, {"$count": "_eai_total"}], namespace=namespace or None
            )
        )
        return int(next(iter(res[0].values()))) if res else 0
    except Exception:  # noqa: BLE001 - 카운트는 부가 정보라 실패해도 무시
        logger.debug("Mongo 전체 건수 계산 실패 (무시)", exc_info=True)
        return None


def _mongo_col_match(filters: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """컬럼 필터 → ``$match``. 어떤 타입이든 문자열로 캐스트해 대소문자 무시 부분일치."""
    if not filters:
        return None
    ands: list[dict[str, Any]] = []
    for f in filters:
        col = str(f.get("col") or "")
        val = f.get("value")
        if not col or val is None or str(val) == "":
            continue
        ands.append(
            {
                "$expr": {
                    "$regexMatch": {
                        "input": {"$toString": f"${col}"},
                        "regex": re.escape(str(val)),
                        "options": "i",
                    }
                }
            }
        )
    return {"$and": ands} if ands else None


def run_mongo(
    session: Session,
    connection_id: str,
    *,
    command: str,
    namespace: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    sort_col: str | None = None,
    sort_dir: str = "asc",
    filters: list[dict[str, Any]] | None = None,
) -> tuple[list[str], list[dict[str, Any]], bool, int, int | None]:
    """MongoDB 를 셸처럼 조회한다.

    - ``컬렉션.find({필터})`` — 뒤에 ``.sort({...})``·``.skip(n)``·``.limit(n)`` 체이닝 가능
    - ``컬렉션.aggregate([파이프라인])``

    인자 JSON 은 표준 JSON 우선이되 Mongo 셸식(홑따옴표·따옴표 없는 키)도 받아준다.
    페이지네이션은 순수 find 는 스트림 offset 스킵, aggregate·modifier 붙은 find 는
    파이프라인 뒤에 ``$skip``/``$limit`` 를 붙여 처리한다.
    반환: (columns, rows, has_more, elapsed_ms).
    """
    conn = get_connection(session, connection_id)
    if conn.type != "mongo":
        raise ValidationError(f"문서 조회는 MongoDB 연결에서만 됩니다 — 현재 '{conn.type}'.")
    coll, method, arg, mods = _parse_mongo_command(command or "")

    # find 는 (필터, 프로젝션) 2개 인자를 받는다 — 프로젝션은 select 할 필드 지정
    filt_text = arg
    proj_text: str | None = None
    if method == "find":
        args = _split_top_args(arg) if arg.strip() else [""]
        if len(args) > 2:
            raise ValidationError("find() 는 인자를 2개(필터, 프로젝션)까지만 받습니다.")
        filt_text = args[0] or "{}"
        if len(args) == 2 and args[1]:
            proj_text = args[1]

    cap = get_settings().mongo_find_limit
    page = min(limit or cap, cap)
    offset = max(0, offset)
    connector = open_cached_connector(session, conn)  # 캐시 재사용 — close 하지 않는다
    rows: list[dict[str, Any]] = []
    count_pipeline: list[dict[str, Any]] | None = None  # 전체 건수용(그리드 페이지네이션 제외)
    # 그리드 컬럼 필터·정렬 (전체 데이터셋 기준). 있으면 스트림 대신 파이프라인 경로로 처리한다.
    col_match = _mongo_col_match(filters)
    grid_sort = {sort_col: (-1 if str(sort_dir).lower() == "desc" else 1)} if sort_col else None
    started = time.perf_counter()
    try:
        if method == "find" and not mods and not proj_text and not col_match and not grid_sort:
            # 순수 find (필터만) — 스트림 경로 (offset 스킵)
            filt = _loads_relaxed(filt_text or "{}", "find 필터")
            if not isinstance(filt, dict):
                raise ValidationError('find 필터는 JSON 객체여야 합니다 (예: { "status": "active" }).')
            need = offset + page
            spec = ReadSpec(
                table=coll,
                namespace=namespace or None,
                query=json.dumps(filt),  # 완화 JSON 을 표준 JSON 으로 정규화해 넘긴다
                limit=need,
                batch_size=min(need, 1000),
            )
            collected: list[dict[str, Any]] = []
            for batch in connector.read(spec):
                collected.extend(batch.rows)
                if len(collected) >= need:
                    break
            has_more = len(collected) >= need
            rows = collected[offset:need]
            count_pipeline = [{"$match": filt}]  # 전체 건수는 필터 매칭 수
        else:
            # aggregate, 또는 프로젝션·sort/skip/limit 붙은 find → 파이프라인으로
            if method == "find":
                filt = _loads_relaxed(filt_text or "{}", "find 필터")
                if not isinstance(filt, dict):
                    raise ValidationError("find 필터는 JSON 객체여야 합니다.")
                # Mongo 실행 순서(match→sort→skip→limit→project)대로 스테이지를 쌓는다
                pipeline: list[dict[str, Any]] = [{"$match": filt}]
                if "sort" in mods:
                    sort_doc = _loads_relaxed(mods["sort"], "sort")
                    if not isinstance(sort_doc, dict):
                        raise ValidationError('sort() 인자는 JSON 객체여야 합니다 (예: { "eventdtm": -1 }).')
                    pipeline.append({"$sort": sort_doc})
                if "skip" in mods:
                    pipeline.append({"$skip": _mongo_int(mods["skip"], "skip")})
                if "limit" in mods:
                    pipeline.append({"$limit": _mongo_int(mods["limit"], "limit")})
                if proj_text:  # 프로젝션(select)은 정렬 뒤에 적용해야 정렬 필드가 안 잘린다
                    proj = _loads_relaxed(proj_text, "프로젝션(select)")
                    if not isinstance(proj, dict):
                        raise ValidationError(
                            'find() 두 번째 인자(프로젝션)는 JSON 객체여야 합니다 (예: { "plant_cd": 1 }).'
                        )
                    pipeline.append({"$project": proj})
            else:  # aggregate
                if mods:
                    raise ValidationError(
                        "aggregate 에는 .sort()/.limit() 를 체이닝할 수 없습니다 — "
                        "파이프라인 스테이지($sort/$limit)로 쓰세요."
                    )
                pipeline = _loads_relaxed(arg or "[]", "aggregate 파이프라인")
                if not isinstance(pipeline, list):
                    raise ValidationError("aggregate 인자는 JSON 배열(파이프라인)이어야 합니다.")
            # 그리드 컬럼 필터를 사용자 파이프라인 뒤에 붙인다 (건수에도 반영되도록 정렬/페이지 앞)
            if col_match:
                pipeline = [*pipeline, {"$match": col_match}]
            count_pipeline = pipeline  # 사용자 파이프라인+필터(정렬·페이지네이션 제외)의 결과 수
            # 그리드 정렬 → 페이지네이션 → 실행
            data_pipeline = [*pipeline, {"$sort": grid_sort}] if grid_sort else pipeline
            paged = [*data_pipeline, {"$skip": offset}, {"$limit": page}]
            rows = list(
                connector.aggregate(coll, paged, namespace=namespace or None)  # type: ignore[attr-defined]
            )
            has_more = len(rows) >= page
    except ConnectorError:
        raise
    except ValidationError:
        raise
    except Exception as exc:  # 필터·파이프라인 문법, 서버 오류 등
        raise ValidationError(f"조회 실패: {str(exc).splitlines()[0]}") from exc
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    # 전체 건수는 첫 페이지에서만. 한 페이지에 다 담겼으면 로드 수가 곧 전체.
    total: int | None = None
    if offset == 0:
        if not has_more:
            total = len(rows)
        elif count_pipeline is not None:
            total = _count_total_mongo(connector, coll, count_pipeline, namespace or None)
    return _mongo_columns(rows), rows, has_more, elapsed_ms, total


# ------------------------------------------------------------------ 결과 내보내기

#: 저장 가능한 파일 형식 → (확장자, MIME)
EXPORT_FORMATS = {
    "csv": ("csv", "text/csv"),
    "json": ("json", "application/json"),
    "txt": ("txt", "text/plain"),  # 탭 구분(TSV)
}


def _export_value(v: Any) -> str:
    """셀 값을 텍스트로. None→빈칸, 중첩 객체/배열→JSON 문자열."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)


def iter_delimited(
    columns: list[str], rows: Iterator[dict[str, Any]], delimiter: str
) -> Iterator[bytes]:
    """CSV/TSV 스트림. 첫 청크에 UTF-8 BOM 을 실어 Excel 한글 깨짐을 막는다."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=delimiter, lineterminator="\n")
    writer.writerow(columns)
    yield b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")  # BOM + 헤더
    buf.seek(0)
    buf.truncate(0)
    for row in rows:
        writer.writerow([_export_value(row.get(c)) for c in columns])
        yield buf.getvalue().encode("utf-8")
        buf.seek(0)
        buf.truncate(0)


def iter_json(rows: Iterator[dict[str, Any]]) -> Iterator[bytes]:
    """JSON 배열 스트림 (행마다 한 줄)."""
    yield b"[\n"
    first = True
    for row in rows:
        chunk = json.dumps(row, ensure_ascii=False, default=str)
        yield (b"" if first else b",\n") + chunk.encode("utf-8")
        first = False
    yield b"\n]\n"


def _sql_export_rows(
    connector: BaseConnector,
    conn_type: str,
    query: str,
    sort_col: str | None,
    sort_dir: str,
    filters: list[dict[str, Any]] | None,
    cap: int,
) -> tuple[list[str], Iterator[dict[str, Any]]]:
    """정렬·필터를 적용한 SQL 결과를 한 번에 스트리밍 (메모리 상수). 컬럼은 첫 배치에서 얻는다."""
    exec_query, _count, params = _apply_sort_filter(
        connector, conn_type, query, sort_col, sort_dir, filters
    )
    spec = ReadSpec(query=exec_query, params=params, limit=cap, batch_size=2000)
    batches = iter(connector.read(spec))
    first = next(batches, None)
    columns = list(first.columns) if first is not None else []

    def gen() -> Iterator[dict[str, Any]]:
        if first is not None:
            yield from first.rows
        for b in batches:
            yield from b.rows

    return columns, gen()


def _mongo_export_rows(
    session: Session,
    connection_id: str,
    command: str,
    namespace: str | None,
    sort_col: str | None,
    sort_dir: str,
    filters: list[dict[str, Any]] | None,
    cap: int,
) -> tuple[list[str], Iterator[dict[str, Any]]]:
    """Mongo 결과 전체를 페이지네이션으로 모아 반환 (run_mongo 로직 재사용, cap 까지)."""
    all_rows: list[dict[str, Any]] = []
    offset = 0
    while len(all_rows) < cap:
        _cols, batch, has_more, _e, _t = run_mongo(
            session,
            connection_id,
            command=command,
            namespace=namespace,
            offset=offset,
            sort_col=sort_col,
            sort_dir=sort_dir,
            filters=filters,
        )
        if not batch:
            break
        all_rows.extend(batch)
        offset += len(batch)
        if not has_more:
            break
    all_rows = all_rows[:cap]
    return _mongo_columns(all_rows), iter(all_rows)


def export_rows(
    session: Session,
    connection_id: str,
    *,
    mode: str,
    fmt: str,
    query: str | None = None,
    command: str | None = None,
    namespace: str | None = None,
    sort_col: str | None = None,
    sort_dir: str = "asc",
    filters: list[dict[str, Any]] | None = None,
) -> tuple[str, str, Iterator[bytes]]:
    """조회 결과를 파일로 내보낸다 (전체 데이터셋, 현재 정렬·필터 반영).

    반환: (파일명, MIME, 바이트 스트림).
    """
    fmt = (fmt or "csv").lower()
    if fmt not in EXPORT_FORMATS:
        raise ValidationError(f"지원하지 않는 형식입니다: {fmt} (csv·json·txt 만 됩니다).")
    ext, mime = EXPORT_FORMATS[fmt]
    conn = get_connection(session, connection_id)
    cap = get_settings().export_row_limit
    connector = open_cached_connector(session, conn)

    if mode == "mongo":
        if conn.type != "mongo":
            raise ValidationError(f"문서 조회는 MongoDB 연결에서만 됩니다 — 현재 '{conn.type}'.")
        columns, rows = _mongo_export_rows(
            session, connection_id, command or "", namespace, sort_col, sort_dir, filters, cap
        )
    else:
        if conn.type not in _SQL_QUERY_TYPES:
            raise ValidationError(
                f"SQL 내보내기는 RDB 연결에서만 됩니다 — 현재 '{conn.type}'."
            )
        q = ensure_select_only(query or "")
        columns, rows = _sql_export_rows(
            connector, conn.type, q, sort_col, sort_dir, filters, cap
        )

    if fmt == "json":
        stream = iter_json(rows)
    elif fmt == "txt":
        stream = iter_delimited(columns, rows, "\t")
    else:
        stream = iter_delimited(columns, rows, ",")
    return f"query_result.{ext}", mime, stream
