"""실시간 DB 동기화(SymmetricDS) 도메인 로직 — 수명주기와 착수 게이트.

``cdc_service`` 와 같은 자리에 있지만 다루는 것이 다르다. Debezium 은 커넥터 설정을 REST 로
등록하면 끝이지만, SymmetricDS 의 설정은 **원본 DB 안의 SYM_* 테이블**이라 우리가 소스
연결로 직접 써 넣는다 (``symmetric_config`` 가 그 SQL 을 만든다).

그래서 이 모듈이 하는 일은 세 가지다.

1. **착수 게이트(preflight)** — 기획안 §1 이 "확정 전에 코드를 작성하면 재작업이 발생한다"고
   못 박은 항목들을 사람이 아니라 코드가 확인한다. 통과 못하면 ``start`` 가 막힌다.
2. **설정 심기/걷어내기** — SYM_TRIGGER·SYM_ROUTER·SYM_TRIGGER_ROUTER.
3. **지표** — 기획안 §7·§11 의 모니터링 쿼리를 그대로 돌려 ``metrics`` 에 담는다.

**원본은 운영 중인 시스템이다** (기획안 §0.3). 그래서 되돌릴 수 없는 일은 하지 않는다 —
우리가 넣은 설정만 지우고, 채널·노드 그룹처럼 공유되는 것은 건드리지 않는다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any

from eai_connectors import build
from eai_connectors.sql_base import SqlConnector
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import CDC_ACTIVE_STATUSES, CdcStream, CdcStreamStatus, StreamEngine
from ..schemas.dag import (
    DEFAULT_SYNC_CHANNEL,
    SYNC_TARGET_TYPES,
    PipelineDefinition,
    PipelineNode,
)
from ..schemas.stream import PreflightCheck, SyncPreflightOut, SyncTableCheck
from . import connection_service, pipeline_service, symmetric_config
from .errors import ConflictError, DependencyError, NotFoundError, ValidationError
from .symmetric_client import SymmetricUnavailableError, get_symmetric_client

logger = logging.getLogger(__name__)

#: 소스로 쓸 수 있는 연결 타입. 기획안이 WMS(SQL Server) → PostgreSQL 한 방향만 다루고,
#: 사이드카에 넣어 둔 JDBC 드라이버도 그 둘이다. 늘리려면 드라이버부터 넣어야 한다.
SYNC_SOURCE_TYPES = frozenset({"mssql"})

#: SQL Server 2016 미만이면 기획안 §13 을 안내한다 — 2016 SP1 부터 CDC 가 Standard 에서도
#: 정식 지원되므로, 업그레이드가 가능하면 트리거 우회 자체가 필요 없어진다.
_CDC_CAPABLE_MAJOR = 13


@dataclass(frozen=True, slots=True)
class SyncSpec:
    """DAG 에서 뽑아낸, 동기화 하나를 세우는 데 필요한 전부."""

    source_node_id: str
    source_connection_id: str
    source_namespace: str
    tables: list[symmetric_config.SyncTable]
    target_node_id: str
    target_connection_id: str
    #: 복제본의 최종 용도 (기획안 §1.3). 판정하지 않고 드러내기만 한다.
    purpose: str = "readonly"
    #: 부하 테스트를 마쳤다고 선언했는가 (기획안 §9 게이트).
    load_test_ack: bool = False
    #: 시작할 때 전량 덤프를 요청할지 (기획안 §8 Phase 2·4)
    initial_load: bool = True
    #: SYM_* 45개를 둘 **전용 데이터베이스**. 비우면 소스와 같은 DB 에 만든다(기존 동작).
    #:
    #: 업무 DB 에 SymmetricDS 테이블이 섞이는 것을 피하려는 것이다. 같은 인스턴스여야
    #: 한다 — 트리거가 같은 트랜잭션에서 그쪽 SYM_DATA 에 써야 하기 때문이다.
    #: 격리가 되는 것은 아니다: 이 DB 가 꽉 차면 업무 쓰기가 실패한다.
    sync_database: str = ""


# --------------------------------------------------------------------- DAG 해석


def _one(nodes: list[PipelineNode], what: str) -> PipelineNode:
    if not nodes:
        raise ValidationError(f"{what} 노드가 없습니다 — 이 파이프라인은 실시간 동기화가 아닙니다")
    if len(nodes) > 1:
        raise ValidationError(f"{what} 노드가 {len(nodes)}개입니다 — 하나만 지원합니다")
    return nodes[0]


def extract_sync_spec(definition: PipelineDefinition) -> SyncSpec:
    """DAG 에서 동기화 소스·타깃을 찾아 스펙으로 만든다.

    타깃 테이블명을 여기서 확정하는 것이 핵심이다. 비워 두면 SymmetricDS 가 소스 이름을
    그대로 쓰는데, PostgreSQL 은 인용하지 않은 식별자를 소문자로 접으므로 ``INVENTORY`` 가
    타깃에서 안 잡힌다 (기획안 §6). 매핑이 없으면 **소문자로 내려 확정하고**, 무엇으로
    등록했는지는 ``stream.config`` 에 남겨 화면에서 보이게 한다 — 조용히 바꾸지 않는다.
    """
    source = _one([n for n in definition.nodes if n.is_sync_source], "실시간 동기화 소스")
    target = _one([n for n in definition.nodes if n.is_sync_target], "실시간 동기화 타깃")

    source_conn = str(source.params.get("connection_id") or "")
    if not source_conn:
        raise ValidationError(f"동기화 소스 '{source.id}' 에 connection_id 가 없습니다")
    target_conn = str(target.params.get("connection_id") or "")
    if not target_conn:
        raise ValidationError(f"동기화 타깃 '{target.id}' 에 connection_id 가 없습니다")

    source_ns = str(source.params.get("namespace") or symmetric_config.DEFAULT_SOURCE_SCHEMA)
    target_ns = str(target.params.get("namespace") or "")

    # 소스 테이블명(대소문자 무시) → 타깃 매핑
    mappings: dict[str, dict[str, Any]] = {}
    for m in target.params.get("table_mappings") or []:
        if isinstance(m, dict) and str(m.get("source_table") or "").strip():
            mappings[str(m["source_table"]).strip().casefold()] = m

    raw_tables = source.params.get("tables")
    if not isinstance(raw_tables, list) or not raw_tables:
        raise ValidationError(f"동기화 소스 '{source.id}' 에 동기화할 테이블이 없습니다")

    tables: list[symmetric_config.SyncTable] = []
    for item in raw_tables:
        if not isinstance(item, dict):
            raise ValidationError("테이블 항목은 이름·채널을 담은 객체여야 합니다")
        name = str(item.get("name") or "").strip()
        if not name:
            raise ValidationError("테이블 이름이 비어 있습니다")
        mapping = mappings.get(name.casefold(), {})
        tables.append(
            symmetric_config.SyncTable(
                name=name,
                namespace=str(item.get("namespace") or source_ns),
                channel=str(item.get("channel") or DEFAULT_SYNC_CHANNEL),
                initial_load_order=int(item.get("initial_load_order") or 100),
                row_filter=str(item.get("row_filter") or ""),
                # 매핑이 없으면 소문자로 확정한다 (PostgreSQL 식별자 접힘)
                target_table=str(mapping.get("target_table") or "").strip() or name.lower(),
                target_namespace=str(mapping.get("target_namespace") or target_ns or ""),
            )
        )

    return SyncSpec(
        source_node_id=source.id,
        source_connection_id=source_conn,
        source_namespace=source_ns,
        tables=tables,
        target_node_id=target.id,
        target_connection_id=target_conn,
        purpose=str(source.params.get("purpose") or "readonly"),
        load_test_ack=bool(source.params.get("load_test_ack")),
        initial_load=bool(source.params.get("initial_load", True)),
        sync_database=str(source.params.get("sync_database") or "").strip(),
    )


def _with_catalog(spec: SyncSpec, source_database: str) -> SyncSpec:
    """업무 DB 이름을 테이블마다 실어 준다.

    이 값은 **연결**에 있지 노드에 있지 않다 (노드는 테이블만 고른다). 그래서 DAG 만 보는
    ``extract_sync_spec`` 이 아니라, 연결을 아는 호출부에서 채운다.

    SYM_* 를 전용 DB 에 둘 때만 채운다. 같은 DB 면 비워 두어야 기존 스트림의 동작이
    바뀌지 않는다 — NULL 은 "엔진이 붙은 DB" 라는 뜻이고, 그게 원래 동작이다.
    """
    if not spec.sync_database or not source_database:
        return spec
    return replace(
        spec, tables=[replace(t, catalog=source_database) for t in spec.tables]
    )


def _plan(stream_id: str, tables: list[symmetric_config.SyncTable]) -> symmetric_config.SyncPlan:
    settings = get_settings()
    return symmetric_config.SyncPlan(
        stream_id=stream_id,
        tables=tables,
        table_prefix=settings.symmetric_table_prefix,
    )


def _tables_from_config(stream: CdcStream) -> list[symmetric_config.SyncTable]:
    """정지·일시정지는 **등록 당시의** 테이블 목록으로 해야 한다.

    DAG 를 다시 읽으면 그 사이 파이프라인이 수정됐을 때 지우지 못한 트리거가 원본에 남는다 —
    아무도 모르는 채로 계속 도는 트리거가 이 기능에서 가장 나쁜 결과다.
    """
    raw = (stream.config or {}).get("tables") or []
    tables = [
        symmetric_config.SyncTable(
            name=str(t.get("name", "")),
            namespace=str(t.get("namespace", symmetric_config.DEFAULT_SOURCE_SCHEMA)),
            catalog=str(t.get("catalog", "")),
            channel=str(t.get("channel", DEFAULT_SYNC_CHANNEL)),
            initial_load_order=int(t.get("initial_load_order", 100)),
            row_filter=str(t.get("row_filter", "")),
            target_table=str(t.get("target_table", "")),
            target_namespace=str(t.get("target_namespace", "")),
        )
        for t in raw
        if isinstance(t, dict) and str(t.get("name", "")).strip()
    ]
    if not tables:
        raise ValidationError(
            "이 스트림에 등록된 테이블 정보가 없습니다 — 원본의 SYM_TRIGGER 를 직접 확인하세요"
        )
    return tables


# --------------------------------------------------------------------- SQL 실행


def _sql_connector(session: Session, connection_id: str) -> SqlConnector:
    """소스 연결 그대로. 업무 테이블 메타(존재·기본키·권한)를 볼 때 쓴다."""
    conn = connection_service.get_connection(session, connection_id)
    connector = connection_service.open_cached_connector(session, conn)
    if not isinstance(connector, SqlConnector):
        raise ValidationError(f"SQL 연결이 아닙니다: {conn.type}")
    return connector


def _config_connector(
    session: Session, connection_id: str, sync_database: str
) -> SqlConnector:
    """**SYM_* 가 사는 DB** 로 붙는다.

    같은 서버·같은 계정이고 데이터베이스만 다르다. 그래서 연결을 새로 만들게 하지 않고
    소스 연결의 접속 정보에서 ``database`` 만 갈아 끼운다 — 사용자가 같은 자격증명을
    두 번 입력하게 하는 것은 틀리기 쉽고, 두 값이 어긋나면 설정은 A 에 들어가고 복제는
    B 에서 일어난다.

    ``sync_database`` 가 비면 소스 연결을 그대로 쓴다 (기존 단일 DB 동작).
    캐시를 쓰지 않는 이유는 캐시 키가 연결 id 라서다 — 같은 연결로 DB 만 다른 커넥터가
    캐시를 서로 덮어쓴다.
    """
    if not sync_database:
        return _sql_connector(session, connection_id)

    conn = connection_service.get_connection(session, connection_id)
    config = dict(connection_service.resolve_config(session, conn))
    config["database"] = sync_database
    connector = build(conn.type, config)
    if not isinstance(connector, SqlConnector):
        raise ValidationError(f"SQL 연결이 아닙니다: {conn.type}")
    return connector


def _wrap(exc: SQLAlchemyError, what: str) -> DependencyError:
    """드라이버 예외를 도메인 예외로 바꾼다.

    이 계층은 SQLAlchemy 를 **직접** 쓰는 드문 자리다 (다른 경로는 커넥터가 이미 래핑해 준다).
    래핑하지 않으면 원시 예외가 그대로 올라가 *처리되지 않은* 500 이 되고, 그러면 CORS
    헤더가 붙지 않아 브라우저는 "서버에 연결할 수 없습니다"로 본다 — 서버는 멀쩡히 답했는데도.
    원인이 화면에 닿지 않는 것이 이 래핑이 막으려는 것이다.
    """
    detail = str(getattr(exc, "orig", exc)).splitlines()[0]
    return DependencyError(f"{what} 실패: {detail}")


def _release(connector: SqlConnector, sync_database: str) -> None:
    """설정 DB 커넥터만 닫는다.

    소스 연결은 **캐시가 수명을 소유**하므로 절대 닫으면 안 된다 (connection_service 규칙).
    설정 DB 커넥터는 우리가 직접 만든 것이라 우리가 닫아야 엔진이 새지 않는다.
    """
    if not sync_database:
        return
    try:
        connector.close()
    except Exception:
        logger.warning("설정 DB 커넥터 정리 실패", exc_info=True)


def _execute(connector: SqlConnector, statements: list[symmetric_config.Statement]) -> None:
    """설정 변경을 **한 트랜잭션**으로 넣는다.

    중간에 실패해 트리거만 절반 생기면, 어떤 테이블이 동기화되는지 아무도 모르는 상태가
    된다. 전부 아니면 전무여야 한다.
    """
    try:
        with connector.engine.begin() as db:
            for sql, params in statements:
                db.execute(text(sql), params)
    except SQLAlchemyError as exc:
        raise _wrap(exc, "SymmetricDS 설정 반영") from exc


def _fetch(
    connector: SqlConnector, statement: symmetric_config.Statement
) -> list[dict[str, Any]]:
    sql, params = statement
    try:
        with connector.engine.connect() as db:
            result = db.execute(text(sql), params)
            return [dict(row) for row in result.mappings()]
    except SQLAlchemyError as exc:
        raise _wrap(exc, "소스 조회") from exc


def _scalar(connector: SqlConnector, sql: str, params: dict[str, Any] | None = None) -> Any:
    try:
        with connector.engine.connect() as db:
            return db.execute(text(sql), params or {}).scalar()
    except SQLAlchemyError as exc:
        raise _wrap(exc, "소스 조회") from exc


# --------------------------------------------------------------------- preflight

_VERSION_SQL = """
SELECT @@VERSION AS full_version,
       CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS edition,
       CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(64)) AS product_version,
       CAST(SERVERPROPERTY('ProductLevel') AS NVARCHAR(64)) AS product_level
"""

#: 기획안 §1 의 "PK 없는 테이블 탐지"를 그대로 옮긴 것. PK 가 없으면 SymmetricDS 가
#: 갱신·삭제를 어느 행에 적용할지 정할 수 없어 동기화 자체가 성립하지 않는다.
_TABLE_SQL = """
SELECT s.name AS schema_name,
       t.name AS table_name,
       CASE WHEN EXISTS (
           SELECT 1 FROM sys.indexes i
           WHERE i.object_id = t.object_id AND i.is_primary_key = 1
       ) THEN 1 ELSE 0 END AS has_pk
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
"""

_ALTER_PERM_SQL = "SELECT HAS_PERMS_BY_NAME(:obj, 'OBJECT', 'ALTER') AS can_alter"
_CREATE_TABLE_PERM_SQL = (
    "SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS can_create"
)

#: 대상 테이블에 유니코드 컬럼(nchar·nvarchar·ntext)이 있는지.
#: 있으면 캡처 경로가 유니코드여야 한다 — 아니면 한글이 글자마다 '?' 로 바뀐다.
_UNICODE_COLUMN_SQL = """
SELECT s.name AS schema_name, t.name AS table_name, COUNT(*) AS n_cols
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types  y ON y.user_type_id = c.user_type_id
WHERE y.name IN ('nchar', 'nvarchar', 'ntext')
GROUP BY s.name, t.name
"""

#: SymmetricDS 가 변경분을 담는 컬럼의 타입. varchar 면 유니코드가 여기서 죽는다.
#: SYM_DATA 는 SymmetricDS 가 처음 붙을 때 만들어지므로, 아직 없을 수도 있다.
_CAPTURE_TYPE_SQL = """
SELECT y.name AS type_name
FROM sys.columns c
JOIN sys.types  y ON y.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(:tbl) AND c.name = 'row_data'
"""


def _check(key: str, label: str, ok: bool, detail: str, level: str = "error") -> PreflightCheck:
    return PreflightCheck(key=key, label=label, ok=ok, detail=detail, level=level)


def _major_version(product_version: str) -> int:
    head = product_version.split(".", 1)[0]
    return int(head) if head.isdigit() else 0


def preflight(session: Session, pipeline_id: str) -> SyncPreflightOut:
    """착수 전 점검 (기획안 §1 미확정 항목 · §8 Phase 1).

    문서가 "다른 무엇보다 먼저 확인하라"고 한 TLS/드라이버 연결부터 본다. 소스에 닿지 못하면
    나머지 점검은 의미가 없으므로 거기서 멈춘다 — 못 한 점검을 통과로 보이게 하면 안 된다.
    """
    pipeline = pipeline_service.get_pipeline(session, pipeline_id)
    checks: list[PreflightCheck] = []
    tables_out: list[SyncTableCheck] = []
    out = SyncPreflightOut(pipeline_id=pipeline_id)

    try:
        spec = extract_sync_spec(pipeline_service.parse_definition(pipeline))
    except Exception as exc:
        out.checks = [_check("definition", "동기화 파이프라인 구조", False, str(exc))]
        return out

    out.source_connection_id = spec.source_connection_id
    out.target_connection_id = spec.target_connection_id
    checks.append(_check("definition", "동기화 파이프라인 구조", True, "소스·타깃 한 쌍 확인"))

    source_conn = connection_service.get_connection(session, spec.source_connection_id)
    target_conn = connection_service.get_connection(session, spec.target_connection_id)
    spec = _with_catalog(
        spec, str(connection_service.resolve_config(session, source_conn).get("database") or "")
    )
    out.source_connection_name = source_conn.name
    out.target_connection_name = target_conn.name

    checks.append(
        _check(
            "source_type",
            "소스 연결 타입",
            source_conn.type in SYNC_SOURCE_TYPES,
            f"{source_conn.type}"
            + ("" if source_conn.type in SYNC_SOURCE_TYPES else " — SQL Server 만 지원합니다"),
        )
    )
    checks.append(
        _check(
            "target_type",
            "타깃 연결 타입",
            target_conn.type in SYNC_TARGET_TYPES,
            f"{target_conn.type}"
            + (
                ""
                if target_conn.type in SYNC_TARGET_TYPES
                else f" — 지원: {', '.join(sorted(SYNC_TARGET_TYPES))}"
            ),
        )
    )

    # 기획안 §8: TLS/드라이버 연결이 구버전 SQL Server 연동의 가장 흔한 실패 지점이다.
    source_health = connection_service.test_connection(session, spec.source_connection_id)
    source_ok = str(source_health.status) == "ok"
    checks.append(
        _check(
            "source_reachable",
            "소스 접속 (TLS·드라이버)",
            source_ok,
            source_health.message or ("연결 정상" if source_ok else "접속 실패"),
        )
    )

    target_health = connection_service.test_connection(session, spec.target_connection_id)
    target_ok = str(target_health.status) == "ok"
    checks.append(
        _check(
            "target_reachable",
            "타깃 접속",
            target_ok,
            target_health.message or ("연결 정상" if target_ok else "접속 실패"),
        )
    )

    checks.extend(_sidecar_checks())
    checks.extend(_judgement_checks(spec))

    if source_ok and source_conn.type in SYNC_SOURCE_TYPES:
        connector = _sql_connector(session, spec.source_connection_id)
        version_checks, tables_out = _source_checks(connector, spec, out)
        checks.extend(version_checks)
        checks.append(_config_db_check(session, spec))
    else:
        checks.append(
            _check(
                "tables",
                "대상 테이블·기본키",
                False,
                "소스에 접속하지 못해 확인하지 못했습니다",
            )
        )
        tables_out = [
            SyncTableCheck(name=t.name, namespace=t.namespace, channel=t.channel)
            for t in spec.tables
        ]

    out.checks = checks
    out.tables = tables_out
    out.ready = all(c.ok for c in checks if c.level == "error")
    return out


def _sidecar_checks() -> list[PreflightCheck]:
    """사이드카가 살아 있고 **두 엔진이 실제로 등록되어 있는지.**

    엔진이 없으면 설정은 SYM_* 에 들어가는데 아무것도 복제되지 않는다 — 화면상 성공이고
    데이터만 안 오는, 이 저장소가 가장 싫어하는 종류다. 그래서 시작을 막는다.

    REST(``/api/version``)가 아니라 동기화 서블릿(``/sync/{engine}``)으로 확인한다.
    공식 이미지에 REST 모듈이 없어서이기도 하고, 데이터가 실제로 오갈 통로를 보는 편이
    맞아서이기도 하다.
    """
    settings = get_settings()
    client = get_symmetric_client()
    engines = [
        ("소스", settings.symmetric_source_engine),
        ("타깃", settings.symmetric_target_engine),
    ]

    found: list[str] = []
    missing: list[str] = []
    for label, name in engines:
        try:
            ok = client.probe_engine(name)
        except SymmetricUnavailableError as exc:
            return [
                _check("sidecar", "SymmetricDS 사이드카", False, str(exc)),
                _check(
                    "sidecar_engines",
                    "사이드카 엔진 등록",
                    False,
                    "사이드카에 닿지 못해 확인하지 못했습니다",
                ),
            ]
        (found if ok else missing).append(f"{label} {name}")

    checks = [_check("sidecar", "SymmetricDS 사이드카", True, "응답함")]
    checks.append(
        _check(
            "sidecar_engines",
            "사이드카 엔진 등록",
            not missing,
            f"{', '.join(found)} 확인"
            if not missing
            else f"등록되지 않은 엔진: {', '.join(missing)} "
            "— sync/symmetricds/engines/ 에 해당 이름의 .properties 를 만들었는지, "
            "그 안의 engine.name 이 같은지 확인하세요",
        )
    )
    return checks


def _judgement_checks(spec: SyncSpec) -> list[PreflightCheck]:
    """사람만 답할 수 있는 두 가지 (기획안 §1.3 · §9).

    코드가 판정할 수 없으므로 ``error`` 로 두지 않는다. 여기서 막으면 문서 §8 이 요구한
    파일럿 구축(부하 테스트를 하기 위한 전제)이 그 자체로 불가능해진다.
    """
    checks = []
    operational = spec.purpose == "operational"
    checks.append(
        _check(
            "purpose",
            "복제 데이터의 최종 용도",
            not operational,
            "조회/분석 용도"
            if not operational
            else "업무 판단 근거 — 복제본은 원본과 순간적으로 다를 수 있습니다. "
            "출고/재고 판단에 쓰면 이중 출고 같은 사고로 이어집니다 (원본 직접 조회·API 연동 검토)",
            level="warning",
        )
    )
    checks.append(
        _check(
            "load_test",
            "부하 테스트 (운영 적용 게이트)",
            spec.load_test_ack,
            "완료 표시됨"
            if spec.load_test_ack
            else "원본 테이블에 트리거가 생겨 쓰기 트랜잭션이 느려집니다. "
            "현장 스캔 응답이 0.3초 이상 느려지면 재검토 — 운영 적용 전 필수",
            level="warning",
        )
    )
    return checks


def _source_checks(
    connector: SqlConnector, spec: SyncSpec, out: SyncPreflightOut
) -> tuple[list[PreflightCheck], list[SyncTableCheck]]:
    """소스 DB 에 실제로 물어보는 점검 — 버전·권한·테이블·PK."""
    checks: list[PreflightCheck] = []

    rows = _fetch(connector, (_VERSION_SQL, {}))
    info = rows[0] if rows else {}
    out.server_version = str(info.get("full_version") or "").splitlines()[0]
    out.edition = str(info.get("edition") or "")
    product_version = str(info.get("product_version") or "")
    major = _major_version(product_version)
    checks.append(
        _check(
            "sql_server_version",
            "SQL Server 버전·에디션",
            True,
            f"{out.edition} / {product_version} {info.get('product_level') or ''}".strip(),
            level="info",
        )
    )
    if major and major >= _CDC_CAPABLE_MAJOR:
        checks.append(
            _check(
                "cdc_available",
                "CDC 사용 가능 여부",
                True,
                "2016 이상입니다 — CDC 가 Standard 에서도 정식 지원되므로, "
                "트리거 부하를 지지 않는 CDC 방식을 먼저 검토할 가치가 있습니다",
                level="warning",
            )
        )

    can_create = _scalar(connector, _CREATE_TABLE_PERM_SQL)
    checks.append(
        _check(
            "create_table_permission",
            "SYM_* 테이블 생성 권한",
            bool(can_create),
            "있음" if can_create else "없음 — SymmetricDS 가 설정 테이블을 만들지 못합니다",
        )
    )

    catalog = {
        (str(r["schema_name"]).casefold(), str(r["table_name"]).casefold()): bool(r["has_pk"])
        for r in _fetch(connector, (_TABLE_SQL, {}))
    }

    tables_out: list[SyncTableCheck] = []
    missing: list[str] = []
    no_pk: list[str] = []
    no_alter: list[str] = []
    for t in spec.tables:
        key = (t.namespace.casefold(), t.name.casefold())
        exists = key in catalog
        has_pk = catalog.get(key, False)
        if not exists:
            missing.append(f"{t.namespace}.{t.name}")
        elif not has_pk:
            no_pk.append(f"{t.namespace}.{t.name}")
        if exists:
            can_alter = _scalar(connector, _ALTER_PERM_SQL, {"obj": f"{t.namespace}.{t.name}"})
            if not can_alter:
                no_alter.append(f"{t.namespace}.{t.name}")
        tables_out.append(
            SyncTableCheck(
                name=t.name,
                namespace=t.namespace,
                exists=exists,
                has_primary_key=has_pk,
                channel=t.channel,
            )
        )

    checks.append(
        _check(
            "tables_exist",
            "대상 테이블 존재",
            not missing,
            f"{len(spec.tables)}개 확인" if not missing else f"없는 테이블: {', '.join(missing)}",
        )
    )
    # PK 가 없으면 갱신·삭제를 어느 행에 적용할지 정할 수 없다 — 동기화가 성립하지 않는다.
    checks.append(
        _check(
            "primary_keys",
            "대상 테이블 기본키",
            not no_pk,
            "모두 있음"
            if not no_pk
            else f"PK 없음: {', '.join(no_pk)} — PK 를 추가하거나 대상에서 빼세요",
        )
    )
    # 트리거 생성에는 대상 테이블의 ALTER 권한이 필요하다 (기획안 §1.2 — 불가하면 방식 자체가 탈락).
    checks.append(
        _check(
            "trigger_permission",
            "원본 트리거 생성 권한",
            not no_alter,
            "있음" if not no_alter else f"ALTER 권한 없음: {', '.join(no_alter)}",
        )
    )
    checks.append(_unicode_capture_check(connector, spec))
    return checks, tables_out


def _config_db_check(session: Session, spec: SyncSpec) -> PreflightCheck:
    """SYM_* 를 둘 전용 DB 에 붙을 수 있고 테이블을 만들 수 있는가.

    지정하지 않았으면 볼 것이 없다 — 소스 DB 에 만든다는 뜻이고, 그건 이미 위에서 봤다.
    지정했는데 권한이 없으면 SymmetricDS 가 기동조차 못 한다("Cannot open database").
    실제로 겪은 실패라 error 로 막는다.
    """
    if not spec.sync_database:
        return _check(
            "config_db",
            "SymmetricDS 설정 DB",
            True,
            "소스와 같은 DB 에 SYM_* 를 만듭니다",
            level="info",
        )
    try:
        connector = _config_connector(
            session, spec.source_connection_id, spec.sync_database
        )
    except Exception as exc:
        return _check("config_db", "SymmetricDS 설정 DB", False, str(exc))
    try:
        can_create = _scalar(connector, _CREATE_TABLE_PERM_SQL)
        return _check(
            "config_db",
            "SymmetricDS 설정 DB",
            bool(can_create),
            f"{spec.sync_database} 접속·테이블 생성 가능"
            if can_create
            else f"{spec.sync_database} 에 테이블 생성 권한이 없습니다",
        )
    except Exception as exc:
        return _check(
            "config_db",
            "SymmetricDS 설정 DB",
            False,
            f"{spec.sync_database} 에 붙지 못했습니다: {exc}",
        )
    finally:
        _release(connector, spec.sync_database)


def _unicode_capture_check(connector: SqlConnector, spec: SyncSpec) -> PreflightCheck:
    """한글이 캡처 단계에서 ``?`` 로 죽는지 본다.

    SymmetricDS 는 변경분을 ``SYM_DATA.row_data`` 에 **문자열로** 담는다. 그 컬럼이
    ``varchar`` 인데 DB 콜레이션이 유니코드가 아니면(예: SQL_Latin1_General_CP1_CI_AS),
    트리거가 ``nvarchar`` 한글을 담는 순간 글자마다 ``?`` 로 치환된다.

    **원본 DB 안에서 이미 손실되므로 타깃을 UTF-8 로 만들어도 되돌릴 수 없다.** 복제는
    성공한 것처럼 보이고 글자만 깨지는, 가장 늦게 발견되는 종류의 사고다. 실제로 겪었다.

    고치는 방법은 소스 엔진 properties 의 ``mssql.use.ntypes.for.sync=true`` 인데,
    이 값은 **SYM_* 를 처음 만들 때** 반영되므로 시작 전에 켜 두어야 한다.
    """
    unicode_tables = {
        (str(r["schema_name"]).casefold(), str(r["table_name"]).casefold())
        for r in _fetch(connector, (_UNICODE_COLUMN_SQL, {}))
    }
    at_risk = sorted(
        f"{t.namespace}.{t.name}"
        for t in spec.tables
        if (t.namespace.casefold(), t.name.casefold()) in unicode_tables
    )
    if not at_risk:
        return _check(
            "unicode_capture",
            "유니코드(한글) 캡처",
            True,
            "대상 테이블에 유니코드 컬럼이 없습니다",
            level="info",
        )

    prefix = get_settings().symmetric_table_prefix
    # SYM_DATA 는 **설정 DB** 에 있다. 소스에서 찾으면 전용 DB 를 쓸 때 항상 "없음" 이 되어
    # 경고만 내고 진짜 varchar 상태를 놓친다.
    tbl = f"{spec.sync_database}.dbo.{prefix}_DATA" if spec.sync_database else f"{prefix}_DATA"
    rows = _fetch(connector, (_CAPTURE_TYPE_SQL, {"tbl": tbl}))
    if not rows:
        # SYM_DATA 는 SymmetricDS 가 처음 붙을 때 생긴다 — 아직이면 판정할 수 없다.
        # 다만 지금 켜 두지 않으면 나중에 못 고치므로 미리 알린다.
        return _check(
            "unicode_capture",
            "유니코드(한글) 캡처",
            True,
            f"{', '.join(at_risk)} 에 유니코드 컬럼이 있습니다 — 소스 엔진 properties 에 "
            "mssql.use.ntypes.for.sync=true 가 켜져 있는지 확인하세요. "
            "이 값은 SYM_* 를 처음 만들 때 반영되므로 시작 전에 켜 두어야 합니다",
            level="warning",
        )

    capture_type = str(rows[0].get("type_name", "")).lower()
    ok = capture_type.startswith("n")  # nvarchar / ntext
    return _check(
        "unicode_capture",
        "유니코드(한글) 캡처",
        ok,
        f"{prefix}_DATA.row_data = {capture_type} (유니코드 보존)"
        if ok
        else f"{prefix}_DATA.row_data 가 {capture_type} 입니다 — {', '.join(at_risk)} 의 한글이 "
        "글자마다 '?' 로 손실됩니다. 소스 엔진에 mssql.use.ntypes.for.sync=true 를 켜고 "
        f"{prefix}_* 를 다시 만들어야 합니다",
    )


# --------------------------------------------------------------------- 조회


def get_stream(session: Session, stream_id: str) -> CdcStream:
    stream = session.get(CdcStream, stream_id)
    if stream is None:
        raise NotFoundError(f"동기화 스트림을 찾을 수 없습니다: {stream_id}")
    return stream


def _require_symmetricds(stream: CdcStream) -> CdcStream:
    if not stream.is_symmetricds:
        raise ValidationError(
            f"이 스트림은 {stream.engine} 엔진입니다 — 실시간 동기화 제어 대상이 아닙니다"
        )
    return stream


def _assert_no_table_conflict(session: Session, spec: SyncSpec, exclude_id: str = "") -> None:
    """같은 소스 테이블을 두 스트림이 잡으면 트리거가 겹쳐 등록이 깨진다.

    SymmetricDS 는 테이블 하나에 트리거를 여럿 걸 수 있지만, 그렇게 되면 어느 스트림을
    멈춰야 그 테이블이 멈추는지 알 수 없게 된다. 시작 시점에 막는다.
    """
    wanted = {f"{t.namespace}.{t.name}".casefold() for t in spec.tables}
    for other in session.query(CdcStream).filter(
        CdcStream.engine == StreamEngine.SYMMETRICDS,
        CdcStream.status.in_(sorted(str(s) for s in CDC_ACTIVE_STATUSES)),
    ):
        if other.id == exclude_id or other.source_connection_id != spec.source_connection_id:
            continue
        theirs = {
            f"{t.get('namespace', '')}.{t.get('name', '')}".casefold()
            for t in (other.config or {}).get("tables") or []
        }
        overlap = sorted(wanted & theirs)
        if overlap:
            raise ConflictError(
                f"같은 테이블을 이미 다른 동기화가 잡고 있습니다: {', '.join(overlap)} "
                f"(스트림 {other.id[:8]}) — 먼저 정지하세요"
            )


# --------------------------------------------------------------------- 수명주기


def _apply_now(engine_name: str, stream_id: str) -> str:
    """설정을 지금 반영하라고 사이드카에 알린다.

    실패해도 스트림을 죽이지 않는다 — SymmetricDS 의 sync-triggers 잡이 다음 주기에
    반영하므로 **늦어질 뿐 틀리지 않는다.** 대신 무슨 일이 있었는지는 남긴다.
    """
    try:
        get_symmetric_client().sync_triggers(engine_name)
    except SymmetricUnavailableError as exc:
        logger.warning("동기화 %s — 트리거 즉시 반영 실패: %s", stream_id, exc)
        return f"트리거 반영을 사이드카에 알리지 못했습니다({exc}) — 다음 sync-triggers 주기에 반영됩니다"
    return ""


def start_stream(session: Session, pipeline_id: str, *, skip_preflight: bool = False) -> CdcStream:
    """동기화를 켠다: 게이트 → 스트림 생성 → SYM_* 설정 심기 → 반영 → 초기 적재.

    ``skip_preflight`` 는 점검 자체가 실패하는 환경(사이드카 미기동 등)에서 강제로 밀어붙일
    때를 위한 것이고, 기본은 **막는 쪽**이다 (기획안 §0.2).
    """
    pipeline = pipeline_service.get_pipeline(session, pipeline_id)
    definition = pipeline_service.assert_runnable(pipeline)
    spec = extract_sync_spec(definition)

    # 업무 DB 이름은 연결에 있다 — 전용 설정 DB 를 쓸 때 트리거가 그 DB 를 가리켜야 한다.
    source_conn = connection_service.get_connection(session, spec.source_connection_id)
    source_db = str(
        connection_service.resolve_config(session, source_conn).get("database") or ""
    )
    spec = _with_catalog(spec, source_db)

    if active_stream_for(session, pipeline_id) is not None:
        raise ConflictError("이미 실행 중인 동기화가 있습니다 — 먼저 정지하세요")
    _assert_no_table_conflict(session, spec)

    if not skip_preflight:
        result = preflight(session, pipeline_id)
        if not result.ready:
            failed = [c.label for c in result.checks if c.level == "error" and not c.ok]
            raise ValidationError(
                "착수 점검을 통과하지 못했습니다: " + ", ".join(failed) + " (점검 결과를 확인하세요)"
            )

    settings = get_settings()
    stream = CdcStream(
        pipeline_id=pipeline.id,
        engine=StreamEngine.SYMMETRICDS,
        status=CdcStreamStatus.PROVISIONING,
        source_connection_id=spec.source_connection_id,
        target_connection_id=spec.target_connection_id,
    )
    session.add(stream)
    session.flush()  # id 확보 — 트리거/라우터 이름에 쓴다

    plan = _plan(stream.id, spec.tables)
    notes: list[str] = []
    # SYM_* 는 설정 DB 에 있다 (지정하지 않았으면 소스와 같은 DB).
    connector = _config_connector(session, spec.source_connection_id, spec.sync_database)
    try:
        try:
            _execute(connector, symmetric_config.build_setup_statements(plan))
        except Exception as exc:
            stream.status = CdcStreamStatus.FAILED
            stream.error = str(exc)[:2000]
            session.commit()  # 실패 상태를 남긴다 — 예외로 롤백되지 않도록
            logger.error("동기화 %s 설정 등록 실패: %s", stream.id, exc)
            raise

        warning = _apply_now(settings.symmetric_source_engine, stream.id)
        if warning:
            notes.append(warning)

        if spec.initial_load:
            try:
                _execute(connector, [symmetric_config.build_initial_load_statement(plan)])
            except Exception as exc:
                logger.warning("동기화 %s 초기 적재 요청 실패: %s", stream.id, exc)
                notes.append(f"초기 적재 요청 실패({exc}) — 타깃 노드 등록 후 다시 시도하세요")
    finally:
        _release(connector, spec.sync_database)

    stream.status = CdcStreamStatus.RUNNING
    stream.error = None
    stream.config = {
        "source_engine": settings.symmetric_source_engine,
        "target_engine": settings.symmetric_target_engine,
        "table_prefix": plan.table_prefix,
        # 정지·지표가 어느 DB 로 붙어야 하는지. 등록 당시 값으로 남긴다 —
        # 나중에 노드 설정이 바뀌어도 우리가 심은 곳을 정확히 찾아가야 한다.
        "sync_database": spec.sync_database,
        "source_node_id": spec.source_node_id,
        "target_node_id": spec.target_node_id,
        "purpose": spec.purpose,
        "initial_load": spec.initial_load,
        "notes": notes,
        "tables": [
            {
                "name": t.name,
                "namespace": t.namespace,
                "catalog": t.catalog,
                "channel": t.channel,
                "initial_load_order": t.initial_load_order,
                "row_filter": t.row_filter,
                "target_table": t.target_table,
                "target_namespace": t.target_namespace,
                "trigger_id": symmetric_config.trigger_id(stream.id, t.name),
                "router_id": symmetric_config.router_id(stream.id, t.name),
            }
            for t in spec.tables
        ],
    }
    session.flush()
    logger.info("동기화 %s 시작 (테이블 %d개)", stream.id, len(spec.tables))
    return stream


def active_stream_for(session: Session, pipeline_id: str) -> CdcStream | None:
    return (
        session.query(CdcStream)
        .filter(
            CdcStream.pipeline_id == pipeline_id,
            CdcStream.status.in_(sorted(str(s) for s in CDC_ACTIVE_STATUSES)),
        )
        .first()
    )


def _config_tables_exist(connector: SqlConnector, plan: symmetric_config.SyncPlan) -> bool:
    """SYM_* 가 실제로 있는가. 정지가 멱등이려면 먼저 물어봐야 한다."""
    try:
        rows = _fetch(connector, symmetric_config.config_tables_exist_sql(plan))
    except Exception:
        return True
    return bool(rows) and int(rows[0].get("cnt") or 0) > 0


def _sync_db_of(stream: CdcStream) -> str:
    """등록 당시의 설정 DB. 노드 설정을 다시 읽지 않는 이유는 §_tables_from_config 와 같다 —
    그 사이 바뀌었으면 우리가 심은 곳이 아니라 엉뚱한 DB 를 건드리게 된다."""
    return str((stream.config or {}).get("sync_database") or "")


def _set_enabled(session: Session, stream: CdcStream, *, enabled: bool) -> None:
    plan = _plan(stream.id, _tables_from_config(stream))
    sync_db = _sync_db_of(stream)
    connector = _config_connector(session, str(stream.source_connection_id), sync_db)
    try:
        _execute(connector, symmetric_config.build_enable_statements(plan, enabled=enabled))
    finally:
        _release(connector, sync_db)
    _apply_now(str((stream.config or {}).get("source_engine") or ""), stream.id)


def pause_stream(session: Session, stream_id: str) -> CdcStream:
    """일시정지 — 라우팅만 멈춘다. 변경은 SYM_DATA 에 계속 쌓여 재개하면 이어서 흘러간다.

    길어지면 원본 DB 용량이 늘어난다 (기획안 §3 · §12). 지표의 ``pending_rows`` 로 드러난다.
    """
    stream = _require_symmetricds(get_stream(session, stream_id))
    if stream.status != CdcStreamStatus.RUNNING:
        raise ValidationError(f"실행 중인 동기화만 일시정지할 수 있습니다 (현재: {stream.status})")
    _set_enabled(session, stream, enabled=False)
    stream.status = CdcStreamStatus.PAUSED
    session.flush()
    return stream


def resume_stream(session: Session, stream_id: str) -> CdcStream:
    stream = _require_symmetricds(get_stream(session, stream_id))
    if stream.status != CdcStreamStatus.PAUSED:
        raise ValidationError(f"일시정지된 동기화만 재개할 수 있습니다 (현재: {stream.status})")
    _set_enabled(session, stream, enabled=True)
    stream.status = CdcStreamStatus.RUNNING
    session.flush()
    return stream


def stop_stream(session: Session, stream_id: str) -> CdcStream:
    """정지 — 우리가 심은 트리거·라우터를 걷어낸다.

    채널·노드 그룹은 남긴다 (다른 스트림이 쓴다). 이미 stopped 면 아무것도 하지 않는다 —
    정지는 멱등이어야 한다. 설정을 지우면 sync-triggers 가 원본 테이블의 실제 트리거를 정리한다.
    """
    stream = _require_symmetricds(get_stream(session, stream_id))
    if stream.status == CdcStreamStatus.STOPPED:
        return stream

    try:
        plan = _plan(stream.id, _tables_from_config(stream))
        sync_db = _sync_db_of(stream)
        connector = _config_connector(session, str(stream.source_connection_id), sync_db)
        try:
            if _config_tables_exist(connector, plan):
                _execute(connector, symmetric_config.build_teardown_statements(plan))
                _apply_now(str((stream.config or {}).get("source_engine") or ""), stream.id)
            else:
                # SYM_* 자체가 없다 — 지울 것이 없으니 이미 내려간 것이다.
                # 여기서 실패시키면 정지도 시작도 못 하는 막다른 상태가 된다
                # (SymmetricDS 를 다른 DB 로 옮기거나 SYM_* 를 지우면 실제로 생긴다).
                logger.info("동기화 %s — 설정 테이블이 없어 정지할 것이 없습니다", stream.id)
        finally:
            _release(connector, sync_db)
    except Exception as exc:
        # 정지가 실패하면 상태만 어긋난 채 트리거가 남는다 — 무엇이 남았는지 남긴다.
        stream.status = CdcStreamStatus.FAILED
        stream.error = f"정지 실패 — 원본에 트리거가 남아 있을 수 있습니다: {exc}"[:2000]
        session.commit()
        logger.error("동기화 %s 정지 실패: %s", stream.id, exc)
        raise

    stream.status = CdcStreamStatus.STOPPED
    stream.error = None
    session.flush()
    logger.info("동기화 %s 정지", stream.id)
    return stream


# --------------------------------------------------------------------- 지표


def refresh_status(session: Session, stream_id: str) -> CdcStream:
    """소스 DB 의 SYM_* 를 읽어 지표를 갱신한다 (기획안 §7 · §11).

    REST 가 아니라 SQL 로 가져오는 것이 의도다 — 사이드카가 죽어도 "무엇이 밀려 있는지"는
    보여야 하고, 그 진실은 원본 DB 안에 있다. 조회 실패로 스트림을 죽이지는 않는다.
    """
    stream = get_stream(session, stream_id)
    if not stream.is_symmetricds or stream.status not in CDC_ACTIVE_STATUSES:
        return stream
    try:
        plan = _plan(stream.id, _tables_from_config(stream))
        sync_db = _sync_db_of(stream)
        connector = _config_connector(session, str(stream.source_connection_id), sync_db)
        try:
            pending = _fetch(connector, symmetric_config.pending_data_sql(plan))
            batches = _fetch(connector, symmetric_config.batch_summary_sql(plan))
            last = _fetch(connector, symmetric_config.last_capture_sql(plan))
            nodes = _fetch(connector, symmetric_config.registered_nodes_sql(plan))
        finally:
            _release(connector, sync_db)
    except Exception as exc:
        logger.warning("동기화 %s 지표 조회 실패: %s", stream.id, exc)
        return stream

    pending_rows = int((pending[0] if pending else {}).get("pending_rows") or 0)
    oldest = (pending[0] if pending else {}).get("oldest")
    by_status = {str(r.get("status")): int(r.get("cnt") or 0) for r in batches}
    error_batches = by_status.get("ER", 0)
    last_capture = (last[0] if last else {}).get("last_capture")

    metrics = dict(stream.metrics or {})
    metrics.update(
        {
            "pending_rows": pending_rows,
            "oldest_pending": oldest.isoformat() if isinstance(oldest, datetime) else None,
            "batches": by_status,
            "error_batches": error_batches,
            # 타깃 노드가 등록을 마쳐야 데이터가 간다. 등록 전에는 아무리 기다려도 안 온다.
            "registered_nodes": len(nodes),
            "subscribed": bool(nodes),
        }
    )
    if isinstance(last_capture, datetime):
        stream.last_event_at = last_capture
        metrics["lag_ms"] = max(
            0,
            int(
                (
                    datetime.now(UTC)
                    - (
                        last_capture
                        if last_capture.tzinfo
                        else last_capture.replace(tzinfo=UTC)
                    )
                ).total_seconds()
                * 1000
            ),
        )
    stream.metrics = metrics

    # 오류 배치가 쌓이면 데이터는 흐르지 않는데 상태만 running 인 상태가 된다 — 드러낸다.
    if error_batches and stream.status == CdcStreamStatus.RUNNING:
        stream.error = f"전송 실패 배치 {error_batches}건 — SYM_OUTGOING_BATCH 를 확인하세요"
    elif not error_batches and stream.status == CdcStreamStatus.RUNNING:
        stream.error = None
    session.flush()
    return stream


__all__ = [
    "SYNC_SOURCE_TYPES",
    "SyncSpec",
    "extract_sync_spec",
    "pause_stream",
    "preflight",
    "refresh_status",
    "resume_stream",
    "start_stream",
    "stop_stream",
]
