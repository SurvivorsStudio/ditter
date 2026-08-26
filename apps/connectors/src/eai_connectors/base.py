"""커넥터 공통 계약.

설계 문서 §5. 신규 소스/타깃은 이 프로토콜 구현체만 추가하면 확장된다.
``read`` 는 반드시 제너레이터여야 한다 — 대용량에서 메모리를 상수로 유지하기 위해서다.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable


class ConnectorType(StrEnum):
    MYSQL = "mysql"
    POSTGRES = "postgres"
    MSSQL = "mssql"
    MONGO = "mongo"
    SAP_RFC = "sap_rfc"
    S3 = "s3"
    LOCAL_FILE = "local_file"
    #: AI 모델 (자연어 SQL 생성·튜닝). 데이터 커넥터가 아니라 test_connection+generate 만 구현.
    GEMINI = "gemini"
    BEDROCK = "bedrock"


class WriteMode(StrEnum):
    APPEND = "append"
    UPSERT = "upsert"
    OVERWRITE = "overwrite"


class HealthStatus(StrEnum):
    OK = "ok"
    WARN = "warn"
    ERROR = "error"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class HealthResult:
    status: HealthStatus
    message: str = ""
    latency_ms: float | None = None
    server_version: str | None = None

    @property
    def healthy(self) -> bool:
        return self.status is HealthStatus.OK


@dataclass(frozen=True, slots=True)
class ColumnSchema:
    name: str
    data_type: str
    nullable: bool = True
    primary_key: bool = False


@dataclass(frozen=True, slots=True)
class TableSchema:
    name: str
    columns: Sequence[ColumnSchema]
    namespace: str | None = None  # schema / database / bucket prefix
    approx_rows: int | None = None

    @property
    def qualified_name(self) -> str:
        return f"{self.namespace}.{self.name}" if self.namespace else self.name


#: DB 객체 종류 — DBeaver 식 카테고리 트리에서 폴더로 묶인다.
#: table · view · function · procedure · sequence · collection(Mongo)
@dataclass(frozen=True, slots=True)
class DbObject:
    name: str
    kind: str
    namespace: str | None = None  # schema / database

    @property
    def qualified_name(self) -> str:
        return f"{self.namespace}.{self.name}" if self.namespace else self.name


@dataclass(frozen=True, slots=True)
class IndexInfo:
    name: str
    columns: Sequence[str]
    unique: bool = False
    primary: bool = False
    definition: str | None = None


@dataclass(frozen=True, slots=True)
class ObjectDetail:
    """우클릭 → 상세 보기. kind 에 따라 채워지는 필드가 다르다.

    - table: columns(+PK) · indexes
    - view / materialized_view: columns · definition(스크립트)
    - function / procedure / sequence: definition
    - extension / tablespace / role / collection: info(부가 정보) [· columns(Mongo 표본 필드)]
    """

    kind: str
    name: str
    namespace: str | None = None
    columns: Sequence[ColumnSchema] = ()
    indexes: Sequence[IndexInfo] = ()
    definition: str | None = None
    info: Mapping[str, str] = field(default_factory=dict)

    @property
    def qualified_name(self) -> str:
        return f"{self.namespace}.{self.name}" if self.namespace else self.name


@dataclass(frozen=True, slots=True)
class ReadSpec:
    """소스 읽기 요청.

    소스를 가리키는 방법은 세 가지이고, 셋 중 **하나는 반드시** 있어야 한다:
    - ``table``    : 테이블/컬렉션 (대부분의 소스)
    - ``query``    : SQL 또는 문서 필터
    - ``function`` : 원격 함수 호출 (SAP BAPI 처럼 테이블 개념이 없는 소스)

    증분 적재는 ``incremental_column`` + ``watermark`` 로 표현한다 —
    커넥터는 ``incremental_column > watermark`` 인 행만 돌려주고,
    호출자는 배치의 ``max_watermark`` 를 체크포인트에 기록한다.
    """

    table: str | None = None
    namespace: str | None = None
    query: str | None = None
    #: 함수 호출형 소스 (SAP BAPI 등). table/query 와 배타적이다.
    function: str | None = None
    columns: Sequence[str] | None = None
    incremental_column: str | None = None
    watermark: Any = None
    batch_size: int = 5_000
    limit: int | None = None
    params: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.table and not self.query and not self.function:
            raise ValueError("ReadSpec 은 table, query, function 중 하나가 필요합니다")
        # 함수 호출은 반환 구조를 커넥터가 정하므로 증분키 위치를 여기서 강제하지 않는다
        if self.incremental_column and not (self.table or self.function):
            raise ValueError("증분 읽기는 table 또는 function 지정이 필요합니다 (query 모드 미지원)")
        if self.batch_size < 1:
            raise ValueError("batch_size 는 1 이상이어야 합니다")


@dataclass(slots=True)
class RecordBatch:
    """한 번에 흘려보내는 레코드 묶음."""

    rows: list[dict[str, Any]]
    columns: Sequence[str] = field(default_factory=list)
    max_watermark: Any = None
    is_last: bool = False

    def __len__(self) -> int:
        return len(self.rows)

    def __bool__(self) -> bool:  # 빈 배치도 "존재"로 취급 (is_last 신호 운반)
        return True


@dataclass(frozen=True, slots=True)
class WriteResult:
    records_written: int
    location: str | None = None  # s3://... 또는 schema.table
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class WriteSpec:
    """타깃 쓰기 대상 지정. ``write`` 호출 전에 커넥터에 바인딩된다."""

    table: str | None = None
    namespace: str | None = None
    key_columns: Sequence[str] = field(default_factory=tuple)
    path_prefix: str | None = None  # S3 등 오브젝트 타깃
    file_format: str = "parquet"
    partition_by: Sequence[str] = field(default_factory=tuple)
    run_id: str | None = None  # 실행 단위 경로 분리 → 멱등성


@runtime_checkable
class BaseConnector(Protocol):
    """모든 커넥터가 만족해야 하는 계약 (설계 문서 §5)."""

    type: ConnectorType

    def test_connection(self) -> HealthResult: ...

    def discover_schema(
        self, table: str | None = None, *, include_pk: bool = True, include_columns: bool = True
    ) -> list[TableSchema]:
        """스키마 탐색. ``table`` 을 주면 그것만 조회한다.

        SAP 처럼 테이블이 수만 개라 전체 열거가 불가능한 소스는 ``table`` 이 **필수**다.
        RDB 는 지정 시 반영 비용을 아끼는 최적화가 된다.
        """
        ...

    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]: ...

    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult: ...

    def close(self) -> None: ...
