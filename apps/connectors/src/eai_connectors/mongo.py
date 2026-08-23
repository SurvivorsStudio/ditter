"""MongoDB 커넥터 (PyMongo).

SQL 커넥터와 달리 스키마가 없으므로 ``discover_schema`` 는 표본 문서에서 필드를 추론한다.
추론 결과는 UI 의 컬럼 선택을 돕기 위한 것이지 강제 계약이 아니다.

``ReadSpec`` 매핑:
- ``table``     → 컬렉션 이름
- ``namespace`` → 데이터베이스 (없으면 접속 시 지정한 기본 DB)
- ``query``     → JSON 필터 문서 문자열, 예: ``{"status": "active"}``
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator, Sequence
from typing import Any

from pymongo import ASCENDING, MongoClient, ReplaceOne
from pymongo.errors import PyMongoError

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
    WriteFailed,
)
from .retry import with_retry

logger = logging.getLogger(__name__)

#: 스키마 추론에 쓸 표본 문서 수. 늘리면 정확해지지만 UI 응답이 느려진다.
SCHEMA_SAMPLE_SIZE = 50

#: 내부 관리용 DB — 스키마 탐색 결과에서 제외한다
SYSTEM_DATABASES = frozenset({"admin", "local", "config"})


class MongoConnector:
    type = ConnectorType.MONGO

    def __init__(
        self,
        *,
        host: str = "localhost",
        port: int = 27017,
        database: str = "",
        user: str = "",
        password: str = "",
        uri: str | None = None,
        auth_source: str | None = None,
        replica_set: str | None = None,
        ssl: bool = False,
        connect_timeout: int = 10,
        pool_size: int = 5,
        write_spec: WriteSpec | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not uri and not host:
            raise ConfigurationError("host 또는 uri 가 필요합니다", connector=str(self.type))
        if not database:
            raise ConfigurationError("database 는 필수입니다", connector=str(self.type))

        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.uri = uri
        self.auth_source = auth_source
        self.replica_set = replica_set
        self.ssl = ssl
        self.connect_timeout = connect_timeout
        self.pool_size = pool_size
        self.write_spec = write_spec or WriteSpec()
        self.extra = extra or {}
        self._client: MongoClient[dict[str, Any]] | None = None

    # ------------------------------------------------------------- 커넥션

    @property
    def client(self) -> MongoClient[dict[str, Any]]:
        if self._client is None:
            options: dict[str, Any] = {
                "serverSelectionTimeoutMS": self.connect_timeout * 1000,
                "connectTimeoutMS": self.connect_timeout * 1000,
                "maxPoolSize": self.pool_size,
            }
            if self.replica_set:
                options["replicaSet"] = self.replica_set
            if self.ssl:
                options["tls"] = True

            try:
                if self.uri:
                    self._client = MongoClient(self.uri, **options)
                else:
                    if self.user:
                        options["username"] = self.user
                        options["password"] = self.password
                        options["authSource"] = self.auth_source or self.database
                    self._client = MongoClient(host=self.host, port=self.port, **options)
            except PyMongoError as exc:
                raise ConnectionFailed(str(exc), connector=str(self.type), cause=exc) from exc
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def __enter__(self) -> MongoConnector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ---------------------------------------------------------- 계약 구현

    @with_retry()
    def test_connection(self) -> HealthResult:
        started = time.perf_counter()
        try:
            info = self.client.server_info()
        except PyMongoError as exc:
            raise ConnectionFailed(str(exc), connector=str(self.type), cause=exc) from exc
        return HealthResult(
            status=HealthStatus.OK,
            message="연결 정상",
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            server_version=str(info.get("version", "")),
        )

    @with_retry()
    def discover_schema(
        self, table: str | None = None, *, include_pk: bool = True, include_columns: bool = True
    ) -> list[TableSchema]:
        """컬렉션 목록 + 표본 문서로 추론한 필드. ``table`` 을 주면 그 컬렉션만."""
        wanted = table.split(".")[-1] if table else None
        try:
            db_names = [
                name for name in self.client.list_database_names() if name not in SYSTEM_DATABASES
            ]
            # 접속 시 지정한 DB 를 먼저 보여준다 — 사용자가 가장 자주 찾는 것이다
            if self.database in db_names:
                db_names.remove(self.database)
                db_names.insert(0, self.database)

            tables: list[TableSchema] = []
            for db_name in db_names:
                db = self.client[db_name]
                for coll_name in db.list_collection_names():
                    if wanted and coll_name != wanted:
                        continue
                    # 이름만 원하면 컬렉션마다 표본 조회·문서수 추정을 건너뛴다 (트리 즉시 로드용)
                    if not include_columns:
                        tables.append(TableSchema(name=coll_name, namespace=db_name, columns=[]))
                        continue
                    sample = list(db[coll_name].find({}, limit=SCHEMA_SAMPLE_SIZE))
                    tables.append(
                        TableSchema(
                            name=coll_name,
                            namespace=db_name,
                            columns=_infer_columns(sample),
                            approx_rows=db[coll_name].estimated_document_count(),
                        )
                    )
        except PyMongoError as exc:
            raise SchemaDiscoveryFailed(str(exc), connector=str(self.type), cause=exc) from exc
        return tables

    def list_objects(self) -> list[DbObject]:
        """Mongo 는 SQL 객체(뷰·함수·시퀀스) 개념이 없다 — 컬렉션만 카테고리로 묶는다."""
        try:
            db_names = [
                name for name in self.client.list_database_names() if name not in SYSTEM_DATABASES
            ]
            if self.database in db_names:
                db_names.remove(self.database)
                db_names.insert(0, self.database)
            out: list[DbObject] = []
            for db_name in db_names:
                for coll_name in self.client[db_name].list_collection_names():
                    out.append(DbObject(name=coll_name, kind="collection", namespace=db_name))
        except PyMongoError as exc:
            raise SchemaDiscoveryFailed(str(exc), connector=str(self.type), cause=exc) from exc
        return out

    def object_detail(self, kind: str, schema: str | None, name: str) -> ObjectDetail:
        """컬렉션 상세 — 표본 문서로 추론한 필드 + 인덱스."""
        db_name = schema or self.database
        coll = self.client[db_name][name]
        try:
            sample = list(coll.find({}, limit=SCHEMA_SAMPLE_SIZE))
            columns = _infer_columns(sample)
            indexes: list[IndexInfo] = []
            for iname, spec in coll.index_information().items():
                keys = spec.get("key", [])
                cols = [k for k, _ in keys]
                indexes.append(
                    IndexInfo(
                        name=iname,
                        columns=cols,
                        unique=bool(spec.get("unique", False)),
                        primary=(iname == "_id_"),
                    )
                )
            info = {"문서 수(추정)": str(coll.estimated_document_count())}
        except PyMongoError as exc:
            raise SchemaDiscoveryFailed(str(exc), connector=str(self.type), cause=exc) from exc
        return ObjectDetail(
            kind=kind, name=name, namespace=db_name, columns=columns, indexes=indexes, info=info
        )

    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        """커서를 배치 단위로 흘린다. SQL 커넥터와 동일하게 마지막 배치에만 is_last 를 남긴다."""
        if not spec.table:
            raise ConfigurationError("Mongo 소스는 컬렉션(table) 지정이 필요합니다", connector=str(self.type))

        collection = self.client[spec.namespace or self.database][spec.table]
        query_filter = _parse_filter(spec.query)
        wm_col = spec.incremental_column
        if wm_col and spec.watermark is not None:
            query_filter = {**query_filter, wm_col: {"$gt": spec.watermark}}

        projection = {c: 1 for c in spec.columns} if spec.columns else None

        emitted = 0
        columns: list[str] = list(spec.columns) if spec.columns else []
        try:
            cursor = collection.find(query_filter, projection, batch_size=spec.batch_size)
            if wm_col:
                cursor = cursor.sort(wm_col, ASCENDING)  # 워터마크 단조 증가 보장
            if spec.limit is not None:
                cursor = cursor.limit(spec.limit)

            pending: RecordBatch | None = None
            buffer: list[dict[str, Any]] = []
            for document in cursor:
                buffer.append(_normalize(document))
                if len(buffer) < spec.batch_size:
                    continue
                emitted += len(buffer)
                if not columns:
                    columns = list(buffer[0].keys())
                batch = RecordBatch(
                    rows=buffer, columns=columns, max_watermark=_max_watermark(buffer, wm_col)
                )
                if pending is not None:
                    yield pending
                pending = batch
                buffer = []

            if buffer:
                emitted += len(buffer)
                if not columns:
                    columns = list(buffer[0].keys())
                if pending is not None:
                    yield pending
                pending = RecordBatch(
                    rows=buffer, columns=columns, max_watermark=_max_watermark(buffer, wm_col)
                )

            if pending is None:
                pending = RecordBatch(rows=[], columns=columns)
            pending.is_last = True
            yield pending
        except PyMongoError as exc:
            raise ReadFailed(str(exc), connector=str(self.type), cause=exc) from exc

        logger.debug("Mongo 읽기 완료: %s 건", emitted)

    def aggregate(
        self,
        collection: str,
        pipeline: list[dict[str, Any]],
        *,
        namespace: str | None = None,
        batch_size: int = 1_000,
    ) -> Iterator[dict[str, Any]]:
        """집계 파이프라인을 실행해 정규화된 문서를 하나씩 흘린다.

        페이지네이션(``$skip``/``$limit``)은 호출자가 파이프라인 뒤에 붙여 넘긴다 —
        여기서는 받은 파이프라인을 그대로 실행한다. read() 와 달리 배치로 안 묶고
        문서 단위로 내보낸다(집계 결과는 대개 크지 않다).
        """
        coll = self.client[namespace or self.database][collection]
        try:
            for document in coll.aggregate(pipeline, batchSize=batch_size):
                yield _normalize(document)
        except PyMongoError as exc:
            raise ReadFailed(str(exc), connector=str(self.type), cause=exc) from exc

    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult:
        spec = self.write_spec
        if not spec.table:
            raise ConfigurationError("타깃 컬렉션(table)이 지정되지 않았습니다", connector=str(self.type))
        if not batch.rows:
            return WriteResult(records_written=0, location=self._qualified(spec))
        if mode is WriteMode.UPSERT and not spec.key_columns:
            raise ConfigurationError("upsert 모드는 key_columns 가 필요합니다", connector=str(self.type))

        collection = self.client[spec.namespace or self.database][spec.table]
        try:
            if mode is WriteMode.OVERWRITE:
                collection.delete_many({})
                collection.insert_many(batch.rows, ordered=False)
            elif mode is WriteMode.UPSERT:
                operations = [
                    ReplaceOne({k: row.get(k) for k in spec.key_columns}, row, upsert=True)
                    for row in batch.rows
                ]
                collection.bulk_write(operations, ordered=False)
            else:
                collection.insert_many(batch.rows, ordered=False)
        except PyMongoError as exc:
            raise WriteFailed(str(exc), connector=str(self.type), cause=exc) from exc

        return WriteResult(
            records_written=len(batch.rows),
            location=self._qualified(spec),
            details={"mode": str(mode)},
        )

    def _qualified(self, spec: WriteSpec) -> str:
        return f"{spec.namespace or self.database}.{spec.table}"


# ------------------------------------------------------------------ 헬퍼


def _parse_filter(query: str | None) -> dict[str, Any]:
    """``query`` 를 Mongo 필터 문서로 해석한다. 비어 있으면 전체 조회."""
    if not query or not query.strip():
        return {}
    try:
        parsed = json.loads(query)
    except json.JSONDecodeError as exc:
        raise ConfigurationError(f"Mongo 필터는 JSON 이어야 합니다: {exc}", connector="mongo") from exc
    if not isinstance(parsed, dict):
        raise ConfigurationError("Mongo 필터는 JSON 객체여야 합니다", connector="mongo")
    return parsed


def _normalize(document: dict[str, Any]) -> dict[str, Any]:
    """BSON 전용 타입을 하위 타깃(Parquet·RDB)이 다룰 수 있는 값으로 바꾼다.

    ObjectId 를 그대로 두면 Parquet 직렬화와 DB 적재가 모두 깨진다.
    """
    from bson import ObjectId
    from bson.decimal128 import Decimal128

    out: dict[str, Any] = {}
    for key, value in document.items():
        if isinstance(value, ObjectId):
            out[key] = str(value)
        elif isinstance(value, Decimal128):
            out[key] = value.to_decimal()
        elif isinstance(value, dict):
            out[key] = _normalize(value)
        elif isinstance(value, list):
            out[key] = [_normalize(v) if isinstance(v, dict) else _scalar(v) for v in value]
        else:
            out[key] = value
    return out


def _scalar(value: Any) -> Any:
    from bson import ObjectId
    from bson.decimal128 import Decimal128

    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, Decimal128):
        return value.to_decimal()
    return value


def _max_watermark(rows: list[dict[str, Any]], column: str | None) -> Any:
    if not column:
        return None
    values = [r[column] for r in rows if r.get(column) is not None]
    return max(values) if values else None


def _infer_columns(sample: Sequence[dict[str, Any]]) -> list[ColumnSchema]:
    """표본에서 필드 이름과 타입을 추론한다.

    표본 전체에 등장한 필드만 non-nullable 로 본다 — 문서마다 필드가 다를 수 있기 때문이다.
    """
    if not sample:
        return []

    seen: dict[str, set[str]] = {}
    counts: dict[str, int] = {}
    for document in sample:
        for key, value in document.items():
            seen.setdefault(key, set()).add(type(value).__name__)
            counts[key] = counts.get(key, 0) + 1

    total = len(sample)
    return [
        ColumnSchema(
            name=name,
            data_type=" | ".join(sorted(types)),
            nullable=counts[name] < total,
            primary_key=name == "_id",
        )
        for name, types in sorted(seen.items())
    ]
