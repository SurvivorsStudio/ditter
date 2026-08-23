"""RDB 커넥터 공통 구현 (SQLAlchemy 2.x).

MySQL / PostgreSQL / MSSQL 은 URL 조립·upsert 문법만 다르므로,
스트리밍 read, 스키마 탐색, 커넥션 풀, 재시도는 여기서 한 번만 구현한다.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Iterator, Sequence
from typing import Any

from sqlalchemy import Engine, MetaData, Table, bindparam, create_engine, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError

from .base import (
    ColumnSchema,
    ConnectorType,
    DbObject,
    HealthResult,
    HealthStatus,
    IndexInfo,
    ObjectDetail,
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
    SchemaDiscoveryFailed,
    UnsupportedOperation,
    WriteFailed,
)
from .retry import with_retry

logger = logging.getLogger(__name__)

#: 스키마 탐색에서 제외할 시스템 스키마
SYSTEM_SCHEMAS = frozenset(
    {"information_schema", "performance_schema", "mysql", "sys", "pg_catalog", "pg_toast"}
)


def _bind_declared(query: str, params: dict[str, Any]) -> Any:
    """커스텀 SQL 에 **그 SQL 이 실제로 선언한** 바인드 파라미터만 묶어 준다.

    ``ReadSpec.params`` 는 노드 파라미터를 통째로 담고 있다 — 커넥터별 옵션(SAP 의 mode,
    Mongo 의 필터 등)이 커넥터에 닿는 유일한 통로라 그렇게 설계되어 있다. 그래서 그 안에는
    ``query``·``connection_id``·``batch_size`` 처럼 SQL 의 바인드 파라미터가 **아닌** 것이
    섞여 있다.

    이걸 그대로 ``bindparams(**params)`` 에 넘기면 SQLAlchemy 가
    ``This text() construct doesn't define a bound parameter named 'query'`` 로 거부한다.
    그래서 SQL 이 `:이름` 으로 선언한 것만 골라낸다.
    """
    stmt = text(query)
    declared = set(stmt.compile().params)
    bound = {name: params[name] for name in declared if name in params}
    return stmt.bindparams(**bound) if bound else stmt


class SqlConnector(ABC):
    """RDB 커넥터 베이스. 서브클래스는 dialect 관련 훅만 채운다."""

    type: ConnectorType
    default_port: int

    def __init__(
        self,
        *,
        host: str,
        database: str,
        user: str,
        password: str,
        port: int | None = None,
        pool_size: int = 5,
        ssl: bool = False,
        connect_timeout: int = 10,
        write_spec: WriteSpec | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not host or not database:
            raise ConfigurationError("host 와 database 는 필수입니다", connector=str(self.type))
        self.host = host
        self.port = port or self.default_port
        self.database = database
        self.user = user
        self.password = password
        self.pool_size = pool_size
        self.ssl = ssl
        self.connect_timeout = connect_timeout
        self.write_spec = write_spec or WriteSpec()
        self.extra = extra or {}
        self._engine: Engine | None = None

    # ------------------------------------------------------------------ 훅

    @property
    @abstractmethod
    def drivername(self) -> str:
        """SQLAlchemy drivername, 예: ``mysql+pymysql``."""

    def connect_args(self) -> dict[str, Any]:
        """드라이버별 connect_args. 서브클래스에서 확장."""
        return {}

    def url_query(self) -> dict[str, str]:
        """URL 쿼리 파라미터. 서브클래스에서 확장."""
        return {}

    @abstractmethod
    def _upsert_sql(
        self, table: str, namespace: str | None, columns: Sequence[str], keys: Sequence[str]
    ) -> str:
        """dialect 별 upsert 문 (파라미터는 ``:col`` 바인딩)."""

    def version_sql(self) -> str:
        return "SELECT version()"

    # ------------------------------------------------------------- 엔진/풀

    @property
    def url(self) -> URL:
        return URL.create(
            drivername=self.drivername,
            username=self.user,
            password=self.password,
            host=self.host,
            port=self.port,
            database=self.database,
            query=self.url_query(),
        )

    @property
    def engine(self) -> Engine:
        """지연 생성 + 재사용되는 커넥션 풀."""
        if self._engine is None:
            try:
                self._engine = create_engine(
                    self.url,
                    pool_size=self.pool_size,
                    max_overflow=max(2, self.pool_size // 2),
                    pool_pre_ping=True,  # 끊긴 커넥션 자동 폐기
                    pool_recycle=1800,
                    connect_args=self.connect_args(),
                )
            except SQLAlchemyError as exc:
                raise ConnectionFailed(f"엔진 생성 실패: {exc}", connector=str(self.type), cause=exc) from exc
        return self._engine

    def close(self) -> None:
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None

    def __enter__(self) -> SqlConnector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------ 계약 구현

    @with_retry()
    def test_connection(self) -> HealthResult:
        started = time.perf_counter()
        try:
            with self.engine.connect() as conn:
                version = conn.execute(text(self.version_sql())).scalar_one_or_none()
        except SQLAlchemyError as exc:
            raise ConnectionFailed(str(exc), connector=str(self.type), cause=exc) from exc
        return HealthResult(
            status=HealthStatus.OK,
            message="연결 정상",
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            server_version=str(version) if version is not None else None,
        )

    @with_retry()
    def discover_schema(
        self,
        table: str | None = None,
        *,
        include_pk: bool = True,
        include_columns: bool = True,
    ) -> list[TableSchema]:
        """스키마 탐색. ``table`` 을 주면 그 테이블만 반영한다.

        테이블마다 왕복(get_columns·get_pk)하면 수백~수천 테이블인 DW 에서 왕복이 폭증해
        타임아웃 난다. 그래서 표준 ``information_schema`` 를 **한 번에** 조회한다 — 테이블 수와
        무관하게 쿼리 2개(컬럼·PK)로 끝난다. postgres/mysql/mssql 모두 같은 뷰를 갖는다.

        ``include_pk=False`` 면 PK 조회(``table_constraints``⋈``key_column_usage``)를 건너뛴다.
        이 뷰 조인은 대형 카탈로그에서 매우 느려서(수 초), PK 가 필요 없는 벌크 로드(트리·자동완성)
        에서는 끄는 게 좋다. 특정 테이블 조회(``table`` 지정)는 조건이 걸려 빠르므로 켜 둔다.

        ``include_columns=False`` 면 컬럼 없이 **테이블 이름만** 돌려준다
        (``information_schema.tables`` — 컬럼 조회보다 훨씬 가벼움). 트리를 먼저 즉시 띄우고
        컬럼은 백그라운드로 따로 받는 용도.
        """
        wanted = table.split(".")[-1].strip() if table else None
        sys_schemas = [s.lower() for s in SYSTEM_SCHEMAS]
        params: dict[str, Any] = {"sys": sys_schemas}
        table_filter = ""
        if wanted:
            params["wanted"] = wanted
            table_filter = " AND upper({col}) = upper(:wanted)"

        if not include_columns:
            names_sql = text(
                "SELECT table_schema, table_name FROM information_schema.tables"
                " WHERE lower(table_schema) NOT IN :sys"
                + table_filter.format(col="table_name")
                + " ORDER BY table_schema, table_name"
            ).bindparams(bindparam("sys", expanding=True))
            try:
                with self.engine.connect() as conn:
                    name_rows = conn.execute(names_sql, params).fetchall()
            except SQLAlchemyError as exc:
                raise SchemaDiscoveryFailed(str(exc), connector=str(self.type), cause=exc) from exc
            return [TableSchema(name=t, columns=[], namespace=s) for s, t in name_rows]

        col_sql = text(
            "SELECT table_schema, table_name, column_name, data_type, is_nullable, ordinal_position"
            " FROM information_schema.columns"
            " WHERE lower(table_schema) NOT IN :sys"
            + table_filter.format(col="table_name")
            + " ORDER BY table_schema, table_name, ordinal_position"
        ).bindparams(bindparam("sys", expanding=True))
        pk_sql = text(
            "SELECT tc.table_schema, tc.table_name, kcu.column_name"
            " FROM information_schema.table_constraints tc"
            " JOIN information_schema.key_column_usage kcu"
            "   ON tc.constraint_name = kcu.constraint_name"
            "  AND tc.table_schema = kcu.table_schema"
            " WHERE tc.constraint_type = 'PRIMARY KEY'"
            " AND lower(tc.table_schema) NOT IN :sys"
            + table_filter.format(col="tc.table_name")
        ).bindparams(bindparam("sys", expanding=True))

        try:
            with self.engine.connect() as conn:
                col_rows = conn.execute(col_sql, params).fetchall()
                pk_rows = conn.execute(pk_sql, params).fetchall() if include_pk else []
        except SQLAlchemyError as exc:
            raise SchemaDiscoveryFailed(str(exc), connector=str(self.type), cause=exc) from exc

        pks: dict[tuple[str, str], set[str]] = {}
        for ns, tname, col in pk_rows:
            pks.setdefault((ns, tname), set()).add(col)

        grouped: dict[tuple[str, str], list[ColumnSchema]] = {}
        order: list[tuple[str, str]] = []
        for ns, tname, cname, dtype, nullable, _pos in col_rows:
            key = (ns, tname)
            if key not in grouped:
                grouped[key] = []
                order.append(key)
            grouped[key].append(
                ColumnSchema(
                    name=cname,
                    data_type=str(dtype),
                    nullable=str(nullable).upper() != "NO",
                    primary_key=cname in pks.get(key, set()),
                )
            )
        return [TableSchema(name=t, columns=grouped[(s, t)], namespace=s) for s, t in order]

    def list_objects(self) -> list[DbObject]:
        """DBeaver 식 카테고리 트리를 위한 객체 목록 — 이름만 빠르게 (컬럼 없음).

        표준 ``information_schema`` 로 테이블·뷰·함수·프로시저를 가져오고, 시퀀스는
        엔진마다 위치가 달라(pg/mysql8 은 ``information_schema.sequences``, MSSQL 은
        ``sys.sequences``) dialect 로 분기한다. 한 카테고리 조회가 실패해도(권한·미지원)
        나머지는 살리려고 카테고리별로 감싼다 — 트리 전체가 빈 채로 뜨는 게 최악이다.
        """
        sys_schemas = [s.lower() for s in SYSTEM_SCHEMAS]
        params = {"sys": sys_schemas}
        dialect = self.engine.dialect.name  # 'postgresql' | 'mysql' | 'mssql'
        out: list[DbObject] = []

        tables_sql = text(
            "SELECT table_schema, table_name, table_type FROM information_schema.tables"
            " WHERE lower(table_schema) NOT IN :sys"
            " ORDER BY table_schema, table_name"
        ).bindparams(bindparam("sys", expanding=True))
        routines_sql = text(
            "SELECT routine_schema, routine_name, routine_type FROM information_schema.routines"
            " WHERE lower(routine_schema) NOT IN :sys"
            " ORDER BY routine_schema, routine_name"
        ).bindparams(bindparam("sys", expanding=True))
        # 시퀀스 — 엔진별로 소스가 다르다. MySQL 은 시퀀스가 없어 None.
        if dialect == "mssql":
            seq_sql: Any = text(
                "SELECT SCHEMA_NAME(schema_id) AS s, name FROM sys.sequences ORDER BY s, name"
            )
        elif dialect == "mysql":
            seq_sql = None
        else:  # postgresql (및 information_schema.sequences 를 갖는 엔진)
            seq_sql = text(
                "SELECT sequence_schema, sequence_name FROM information_schema.sequences"
                " WHERE lower(sequence_schema) NOT IN :sys"
                " ORDER BY sequence_schema, sequence_name"
            ).bindparams(bindparam("sys", expanding=True))

        with self.engine.connect() as conn:
            # 테이블 + 뷰 (table_type 으로 가른다)
            try:
                for ns, name, ttype in conn.execute(tables_sql, params).fetchall():
                    kind = "view" if "VIEW" in str(ttype).upper() else "table"
                    out.append(DbObject(name=name, kind=kind, namespace=ns))
            except SQLAlchemyError as exc:
                raise SchemaDiscoveryFailed(str(exc), connector=str(self.type), cause=exc) from exc
            # 함수 + 프로시저
            try:
                for ns, name, rtype in conn.execute(routines_sql, params).fetchall():
                    kind = "procedure" if str(rtype).upper() == "PROCEDURE" else "function"
                    out.append(DbObject(name=name, kind=kind, namespace=ns))
            except SQLAlchemyError:
                logger.info("routines 조회 건너뜀 (%s)", self.type)
            # 시퀀스
            if seq_sql is not None:
                try:
                    for ns, name in conn.execute(seq_sql, params).fetchall():
                        out.append(DbObject(name=name, kind="sequence", namespace=ns))
                except SQLAlchemyError:
                    logger.info("sequences 조회 건너뜀 (%s)", self.type)
            # PostgreSQL 전용 — 구체화 뷰(스키마 안) + DB 레벨 객체(스키마 없음)
            if dialect == "postgresql":
                matview_sql = text(
                    "SELECT schemaname, matviewname FROM pg_matviews"
                    " WHERE lower(schemaname) NOT IN :sys"
                    " ORDER BY schemaname, matviewname"
                ).bindparams(bindparam("sys", expanding=True))
                try:
                    for ns, name in conn.execute(matview_sql, params).fetchall():
                        out.append(DbObject(name=name, kind="materialized_view", namespace=ns))
                except SQLAlchemyError:
                    logger.info("matviews 조회 건너뜀 (%s)", self.type)
                # DB/클러스터 레벨 객체 — 스키마에 속하지 않는다(namespace 없음).
                db_level = [
                    ("extension", "SELECT extname FROM pg_extension ORDER BY extname"),
                    ("event_trigger", "SELECT evtname FROM pg_event_trigger ORDER BY evtname"),
                    ("tablespace", "SELECT spcname FROM pg_tablespace ORDER BY spcname"),
                    ("role", "SELECT rolname FROM pg_roles ORDER BY rolname"),
                ]
                for kind, q in db_level:
                    try:
                        for (name,) in conn.execute(text(q)).fetchall():
                            out.append(DbObject(name=name, kind=kind, namespace=None))
                    except SQLAlchemyError:
                        logger.info("%s 조회 건너뜀 (%s)", kind, self.type)
        return out

    def object_detail(self, kind: str, schema: str | None, name: str) -> ObjectDetail:
        """우클릭 → 상세 보기. kind 별로 컬럼·인덱스·정의(스크립트)를 채운다.

        엔진마다 카탈로그가 달라 dialect 로 분기하고, 각 부분을 try/except 로 감싸
        하나가 실패해도 나머지는 살린다(예: 인덱스 권한 없음).
        """
        dialect = self.engine.dialect.name
        columns: list[ColumnSchema] = []
        indexes: list[IndexInfo] = []
        definition: str | None = None
        info: dict[str, str] = {}
        with self.engine.connect() as conn:
            if kind in ("table", "view", "materialized_view"):
                columns = self._detail_columns(conn, schema, name)
            if kind == "table":
                indexes = self._detail_indexes(conn, dialect, schema, name)
            if kind in ("view", "materialized_view", "function", "procedure"):
                definition = self._detail_definition(conn, dialect, kind, schema, name)
            if kind == "sequence":
                info = self._detail_sequence(conn, dialect, schema, name)
            if kind in ("extension", "role", "tablespace") and dialect == "postgresql":
                info = self._detail_meta(conn, kind, name)
        return ObjectDetail(
            kind=kind,
            name=name,
            namespace=schema,
            columns=columns,
            indexes=indexes,
            definition=definition,
            info=info,
        )

    def _detail_columns(self, conn: Any, schema: str | None, name: str) -> list[ColumnSchema]:
        params: dict[str, Any] = {"t": name}
        sfilter = ""
        if schema:
            params["s"] = schema
            sfilter = " AND table_schema = :s"
        col_sql = text(
            "SELECT column_name, data_type, is_nullable, ordinal_position"
            " FROM information_schema.columns WHERE table_name = :t" + sfilter
            + " ORDER BY ordinal_position"
        )
        pk_sql = text(
            "SELECT kcu.column_name FROM information_schema.table_constraints tc"
            " JOIN information_schema.key_column_usage kcu"
            "   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema"
            " WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = :t"
            + (" AND tc.table_schema = :s" if schema else "")
        )
        try:
            pk = {r[0] for r in conn.execute(pk_sql, params).fetchall()}
        except SQLAlchemyError:
            pk = set()
        cols: list[ColumnSchema] = []
        for cname, dtype, nullable, _pos in conn.execute(col_sql, params).fetchall():
            cols.append(
                ColumnSchema(
                    name=cname,
                    data_type=str(dtype),
                    nullable=str(nullable).upper() != "NO",
                    primary_key=cname in pk,
                )
            )
        return cols

    @staticmethod
    def _index_cols(idef: str | None) -> list[str]:
        """``CREATE INDEX … ON t (a, b)`` 정의에서 컬럼 목록만 대략 뽑는다."""
        if not idef:
            return []
        i, j = idef.find("("), idef.rfind(")")
        if i < 0 or j < 0 or j <= i:
            return []
        inner = idef[i + 1 : j]
        return [c.strip().split()[0].strip('"') for c in inner.split(",") if c.strip()]

    def _detail_indexes(
        self, conn: Any, dialect: str, schema: str | None, name: str
    ) -> list[IndexInfo]:
        out: list[IndexInfo] = []
        try:
            if dialect == "postgresql":
                params: dict[str, Any] = {"t": name}
                sfilter = ""
                if schema:
                    params["s"] = schema
                    sfilter = " AND schemaname = :s"
                q = text(
                    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = :t"
                    + sfilter + " ORDER BY indexname"
                )
                for iname, idef in conn.execute(q, params).fetchall():
                    up = (idef or "").upper()
                    out.append(
                        IndexInfo(
                            name=iname,
                            columns=self._index_cols(idef),
                            unique="UNIQUE" in up,
                            primary=iname.endswith("_pkey"),
                            definition=idef,
                        )
                    )
            elif dialect == "mysql":
                params = {"t": name}
                sfilter = ""
                if schema:
                    params["s"] = schema
                    sfilter = " AND table_schema = :s"
                q = text(
                    "SELECT index_name, non_unique, column_name FROM information_schema.statistics"
                    " WHERE table_name = :t" + sfilter + " ORDER BY index_name, seq_in_index"
                )
                grouped: dict[str, dict[str, Any]] = {}
                for iname, nonuniq, col in conn.execute(q, params).fetchall():
                    g = grouped.setdefault(iname, {"cols": [], "unique": not int(nonuniq)})
                    g["cols"].append(col)
                for iname, g in grouped.items():
                    out.append(
                        IndexInfo(
                            name=iname,
                            columns=g["cols"],
                            unique=g["unique"],
                            primary=(iname == "PRIMARY"),
                        )
                    )
            elif dialect == "mssql":
                qn = f"{schema}.{name}" if schema else name
                q = text(
                    "SELECT i.name, i.is_unique, i.is_primary_key, c.name"
                    " FROM sys.indexes i"
                    " JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id"
                    " JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id"
                    " WHERE i.object_id = OBJECT_ID(:qn) AND i.name IS NOT NULL"
                    " ORDER BY i.name, ic.key_ordinal"
                )
                grouped = {}
                for iname, uniq, pk, col in conn.execute(q, {"qn": qn}).fetchall():
                    g = grouped.setdefault(iname, {"cols": [], "unique": bool(uniq), "pk": bool(pk)})
                    g["cols"].append(col)
                for iname, g in grouped.items():
                    out.append(
                        IndexInfo(name=iname, columns=g["cols"], unique=g["unique"], primary=g["pk"])
                    )
        except SQLAlchemyError:
            logger.info("indexes 조회 실패 (%s)", self.type)
        return out

    def _detail_definition(
        self, conn: Any, dialect: str, kind: str, schema: str | None, name: str
    ) -> str | None:
        try:
            if dialect == "postgresql":
                params: dict[str, Any] = {"t": name}
                sfilter = " AND n.nspname = :s" if schema else ""
                if schema:
                    params["s"] = schema
                if kind in ("view", "materialized_view"):
                    # pg_get_viewdef(oid) 는 소유자가 아니어도 읽힌다 (information_schema.views 는
                    # 비소유자에게 NULL 을 준다 — 그래서 카탈로그 OID 경로를 쓴다). matview 도 동일.
                    r = conn.execute(
                        text(
                            "SELECT pg_get_viewdef(c.oid, true) FROM pg_class c"
                            " JOIN pg_namespace n ON n.oid = c.relnamespace"
                            " WHERE c.relname = :t AND c.relkind IN ('v', 'm')" + sfilter
                        ),
                        params,
                    ).scalar()
                    if not r:
                        return None
                    head = (
                        "CREATE MATERIALIZED VIEW"
                        if kind == "materialized_view"
                        else "CREATE OR REPLACE VIEW"
                    )
                    prefix = f"{schema}." if schema else ""
                    return f"{head} {prefix}{name} AS\n{r}"
                if kind in ("function", "procedure"):
                    q = text(
                        "SELECT pg_get_functiondef(p.oid) FROM pg_proc p"
                        " JOIN pg_namespace n ON n.oid = p.pronamespace"
                        " WHERE p.proname = :t" + sfilter
                    )
                    defs = [row[0] for row in conn.execute(q, params).fetchall() if row[0]]
                    return "\n\n".join(defs) if defs else None
            elif dialect == "mysql":
                obj = {"view": "VIEW", "function": "FUNCTION", "procedure": "PROCEDURE"}.get(kind)
                if obj:
                    qn = f"`{schema}`.`{name}`" if schema else f"`{name}`"
                    row = conn.execute(text(f"SHOW CREATE {obj} {qn}")).fetchone()
                    if row:
                        return row[2] if len(row) > 2 else row[1]
            elif dialect == "mssql":
                qn = f"{schema}.{name}" if schema else name
                return conn.execute(
                    text("SELECT OBJECT_DEFINITION(OBJECT_ID(:qn))"), {"qn": qn}
                ).scalar()
        except SQLAlchemyError:
            logger.info("정의 조회 실패 (%s %s)", kind, self.type)
        return None

    def _detail_sequence(
        self, conn: Any, dialect: str, schema: str | None, name: str
    ) -> dict[str, str]:
        try:
            if dialect == "postgresql":
                params: dict[str, Any] = {"t": name}
                sfilter = " AND schemaname = :s" if schema else ""
                if schema:
                    params["s"] = schema
                row = conn.execute(
                    text(
                        "SELECT start_value, min_value, max_value, increment_by, cycle, last_value"
                        " FROM pg_sequences WHERE sequencename = :t" + sfilter
                    ),
                    params,
                ).fetchone()
                if row:
                    return {
                        "시작값": str(row[0]),
                        "증가": str(row[3]),
                        "최소": str(row[1]),
                        "최대": str(row[2]),
                        "순환": str(row[4]),
                        "현재값": str(row[5]),
                    }
            elif dialect == "mssql":
                row = conn.execute(
                    text(
                        "SELECT start_value, minimum_value, maximum_value, increment,"
                        " is_cycling, current_value FROM sys.sequences WHERE name = :t"
                    ),
                    {"t": name},
                ).fetchone()
                if row:
                    return {
                        "시작값": str(row[0]),
                        "증가": str(row[3]),
                        "최소": str(row[1]),
                        "최대": str(row[2]),
                        "순환": str(row[4]),
                        "현재값": str(row[5]),
                    }
        except SQLAlchemyError:
            logger.info("시퀀스 정보 조회 실패 (%s)", self.type)
        return {}

    def _detail_meta(self, conn: Any, kind: str, name: str) -> dict[str, str]:
        try:
            if kind == "extension":
                row = conn.execute(
                    text(
                        "SELECT e.extversion, n.nspname FROM pg_extension e"
                        " JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = :n"
                    ),
                    {"n": name},
                ).fetchone()
                if row:
                    return {"버전": str(row[0]), "스키마": str(row[1])}
            elif kind == "role":
                row = conn.execute(
                    text(
                        "SELECT rolsuper, rolcreatedb, rolcanlogin, rolreplication"
                        " FROM pg_roles WHERE rolname = :n"
                    ),
                    {"n": name},
                ).fetchone()
                if row:
                    return {
                        "슈퍼유저": str(row[0]),
                        "DB생성": str(row[1]),
                        "로그인": str(row[2]),
                        "복제": str(row[3]),
                    }
            elif kind == "tablespace":
                row = conn.execute(
                    text(
                        "SELECT pg_tablespace_location(oid), pg_get_userbyid(spcowner)"
                        " FROM pg_tablespace WHERE spcname = :n"
                    ),
                    {"n": name},
                ).fetchone()
                if row:
                    return {"위치": str(row[0]) or "(기본)", "소유자": str(row[1])}
        except SQLAlchemyError:
            logger.info("%s 정보 조회 실패 (%s)", kind, self.type)
        return {}

    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        """서버사이드 커서로 배치 스트리밍. 메모리는 batch_size 에 비례해 상수.

        마지막 배치에만 ``is_last=True`` 가 실린다. 소스가 비어 있어도
        빈 배치 하나를 ``is_last=True`` 로 흘려 하위 노드가 종료를 알 수 있게 한다.
        """
        stmt, watermark_col = self._build_select(spec)
        emitted = 0
        try:
            with self.engine.connect().execution_options(
                stream_results=True, yield_per=spec.batch_size
            ) as conn:
                result = conn.execute(stmt)
                columns = list(result.keys())
                pending: RecordBatch | None = None

                for chunk in result.partitions(spec.batch_size):
                    rows = [dict(row._mapping) for row in chunk]
                    if spec.limit is not None and emitted + len(rows) > spec.limit:
                        rows = rows[: spec.limit - emitted]
                    if not rows:
                        break
                    emitted += len(rows)
                    batch = RecordBatch(
                        rows=rows,
                        columns=columns,
                        max_watermark=self._max_watermark(rows, watermark_col),
                    )
                    # 한 배치 지연시켜 방출 → 마지막 배치에 is_last 를 정확히 표시
                    if pending is not None:
                        yield pending
                    pending = batch
                    if spec.limit is not None and emitted >= spec.limit:
                        break

                if pending is None:
                    pending = RecordBatch(rows=[], columns=columns)
                pending.is_last = True
                yield pending
        except SQLAlchemyError as exc:
            raise ReadFailed(str(exc), connector=str(self.type), cause=exc) from exc

    def execute(
        self, sql: str, params: dict[str, Any] | None = None, *, limit: int | None = None
    ) -> tuple[list[str], list[dict[str, Any]], int]:
        """임의의 한 문장을 실행하고 ``(컬럼, 행, 영향받은 행 수)`` 를 돌려준다.

        ``read`` 와 갈라 두는 이유는 트랜잭션이다 — ``read`` 는 커서를 열어 스트리밍하고
        커밋하지 않으므로 INSERT/UPDATE 를 태우면 **성공한 것처럼 보이고 롤백된다.**
        여기서는 ``engine.begin()`` 으로 감싸 블록을 벗어날 때 커밋한다.

        ``INSERT ... RETURNING`` 처럼 행을 돌려주는 문장도 있으므로 결과가 있으면
        ``limit`` 까지 읽어 함께 넘긴다. 쓰기 문장을 스트리밍할 이유는 없어 한 번에 읽는다.

        **무엇을 실행해도 되는지는 판단하지 않는다.** 그 결정은 연결의 허용 명령을 아는
        API 계층(``connection_service.ensure_statement_allowed``)에 있다.
        """
        try:
            with self.engine.begin() as conn:
                result = conn.execute(_bind_declared(sql, params or {}))
                rowcount = int(result.rowcount) if result.rowcount is not None else -1
                if not result.returns_rows:
                    return [], [], rowcount
                columns = list(result.keys())
                fetched = result.fetchmany(limit) if limit is not None else result.fetchall()
                rows = [dict(row._mapping) for row in fetched]
                # 행을 돌려주는 문장에서는 rowcount 가 방언마다 -1 이 되기도 한다
                return columns, rows, rowcount if rowcount >= 0 else len(rows)
        except SQLAlchemyError as exc:
            raise WriteFailed(str(exc), connector=str(self.type), cause=exc) from exc

    def explain(self, query: str, *, analyze: bool = False) -> str:
        """쿼리 실행 계획(EXPLAIN [ANALYZE]) 텍스트를 돌려준다.

        ANALYZE 는 **쿼리를 실제로 실행**한다 — 비SELECT 면 데이터가 바뀔 수 있으므로
        롤백 트랜잭션 안에서 돌려 부작용을 되돌린다(pgAdmin 과 같은 방식). 계획만 남는다.
        """
        dialect = self.engine.dialect.name
        if dialect == "postgresql":
            prefix = "EXPLAIN (ANALYZE, BUFFERS, VERBOSE) " if analyze else "EXPLAIN (VERBOSE) "
        elif dialect == "mysql":
            prefix = "EXPLAIN ANALYZE " if analyze else "EXPLAIN FORMAT=TREE "
        else:
            raise UnsupportedOperation(
                f"{dialect} 는 실행 계획(EXPLAIN) 조회를 지원하지 않습니다", connector=str(self.type)
            )
        stmt = text(prefix + query)
        try:
            with self.engine.connect() as conn:
                trans = conn.begin()
                try:
                    result = conn.execute(stmt)
                    rows = [str(r[0]) for r in result.fetchall()]
                finally:
                    trans.rollback()  # ANALYZE 의 부작용(DML)을 되돌린다
            return "\n".join(rows)
        except SQLAlchemyError as exc:
            raise ReadFailed(str(exc), connector=str(self.type), cause=exc) from exc

    def run_readonly(self, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
        """임의 문장을 **롤백 트랜잭션**에서 실행하고 ``(컬럼, 행)`` 을 돌려준다.

        사용자가 편집기에서 ``EXPLAIN [ANALYZE] …`` 를 직접 돌릴 때 쓴다 — ANALYZE 는
        안의 쿼리를 실제로 실행하므로, 롤백해서 DML 부작용을 남기지 않는다.
        """
        try:
            with self.engine.connect() as conn:
                trans = conn.begin()
                try:
                    result = conn.execute(text(sql))
                    columns = list(result.keys())
                    rows = [dict(row._mapping) for row in result.fetchall()]
                finally:
                    trans.rollback()
            return columns, rows
        except SQLAlchemyError as exc:
            raise ReadFailed(str(exc), connector=str(self.type), cause=exc) from exc

    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult:
        spec = self.write_spec
        if not spec.table:
            raise ConfigurationError("타깃 table 이 지정되지 않았습니다", connector=str(self.type))
        if not batch.rows:
            return WriteResult(records_written=0, location=self._qualified(spec.table, spec.namespace))
        if mode is WriteMode.UPSERT and not spec.key_columns:
            raise ConfigurationError("upsert 모드는 key_columns 가 필요합니다", connector=str(self.type))

        columns = list(batch.rows[0].keys())
        try:
            with self.engine.begin() as conn:
                if mode is WriteMode.OVERWRITE:
                    # 실행 단위 멱등성: 적재 전 대상 테이블 비움 (같은 트랜잭션)
                    conn.execute(text(f"DELETE FROM {self._qualified(spec.table, spec.namespace)}"))
                sql = (
                    self._upsert_sql(spec.table, spec.namespace, columns, spec.key_columns)
                    if mode is WriteMode.UPSERT
                    else self._insert_sql(spec.table, spec.namespace, columns)
                )
                conn.execute(text(sql), batch.rows)
        except SQLAlchemyError as exc:
            raise WriteFailed(str(exc), connector=str(self.type), cause=exc) from exc

        return WriteResult(
            records_written=len(batch.rows),
            location=self._qualified(spec.table, spec.namespace),
            details={"mode": str(mode)},
        )

    # -------------------------------------------------------------- 내부 헬퍼

    def _build_select(self, spec: ReadSpec) -> tuple[Any, str | None]:
        if spec.query:
            return _bind_declared(spec.query, spec.params), None

        assert spec.table  # ReadSpec.__post_init__ 이 보장
        metadata = MetaData()
        try:
            table = Table(spec.table, metadata, autoload_with=self.engine, schema=spec.namespace)
        except SQLAlchemyError as exc:
            raise ReadFailed(
                f"테이블 {self._qualified(spec.table, spec.namespace)} 반영 실패: {exc}",
                connector=str(self.type),
                cause=exc,
            ) from exc

        if spec.columns:
            missing = [c for c in spec.columns if c not in table.c]
            if missing:
                raise ConfigurationError(f"존재하지 않는 컬럼: {missing}", connector=str(self.type))
            stmt = select(*(table.c[c] for c in spec.columns))
        else:
            stmt = select(table)

        wm_col = spec.incremental_column
        if wm_col:
            if wm_col not in table.c:
                raise ConfigurationError(f"증분키 컬럼 없음: {wm_col}", connector=str(self.type))
            if spec.watermark is not None:
                stmt = stmt.where(table.c[wm_col] > spec.watermark)
            stmt = stmt.order_by(table.c[wm_col].asc())  # 워터마크 단조 증가 보장
        return stmt, wm_col

    @staticmethod
    def _max_watermark(rows: list[dict[str, Any]], column: str | None) -> Any:
        if not column:
            return None
        values = [r[column] for r in rows if r.get(column) is not None]
        return max(values) if values else None

    def _qualified(self, table: str, namespace: str | None) -> str:
        q = self.quote
        return f"{q(namespace)}.{q(table)}" if namespace else q(table)

    def quote(self, identifier: str) -> str:
        return self.engine.dialect.identifier_preparer.quote(identifier)

    def _insert_sql(self, table: str, namespace: str | None, columns: Sequence[str]) -> str:
        cols = ", ".join(self.quote(c) for c in columns)
        binds = ", ".join(f":{c}" for c in columns)
        return f"INSERT INTO {self._qualified(table, namespace)} ({cols}) VALUES ({binds})"
