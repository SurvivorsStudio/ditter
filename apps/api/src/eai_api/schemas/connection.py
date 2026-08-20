"""Connection API 스키마. 시크릿은 들어오기만 하고 절대 나가지 않는다."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

#: 요청 config 에 섞여 들어오면 시크릿 저장소로 분리해야 하는 키들
SECRET_KEYS = frozenset(
    {
        "password",
        "secret_access_key",
        "session_token",
        "private_key",
        "passphrase",
        # SAP 사이드카 공유 토큰 — 이걸 빠뜨리면 평문 config 에 그대로 남는다
        "api_token",
        # SAP 접속 비밀번호 (방안 A: 연결에 저장)
        "passwd",
        # AI 모델(Gemini 등) API Key — 이게 없으면 평문 config 에 키가 남는다
        "api_key",
    }
)


class ConnectionBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: str = Field(min_length=1, max_length=32)
    description: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    pool_size: int = Field(default=5, ge=1, le=100)
    ssl: bool = False
    cdc_enabled: bool = False


class ConnectionCreate(ConnectionBase):
    """``config`` 안에 시크릿을 함께 보내면 서버가 분리해 암호화 저장한다."""

    @field_validator("config")
    @classmethod
    def _reject_empty(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not v:
            raise ValueError("config 가 비어 있습니다")
        return v


class ConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    config: dict[str, Any] | None = None
    pool_size: int | None = Field(default=None, ge=1, le=100)
    ssl: bool | None = None
    cdc_enabled: bool | None = None


class ConnectionOut(ConnectionBase):
    """``config`` 는 시크릿이 제거된 상태로만 나간다 (service 계층이 보장)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    has_secret: bool = False
    health_status: str = "unknown"
    health_message: str | None = None
    last_tested_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class TestResult(BaseModel):
    status: str
    message: str = ""
    latency_ms: float | None = None
    server_version: str | None = None


class ColumnOut(BaseModel):
    name: str
    data_type: str
    nullable: bool = True
    primary_key: bool = False


class TableOut(BaseModel):
    name: str
    namespace: str | None = None
    qualified_name: str
    columns: list[ColumnOut] = Field(default_factory=list)


class SchemaOut(BaseModel):
    connection_id: str
    tables: list[TableOut]


class DbObjectOut(BaseModel):
    """DBeaver 식 카테고리 트리의 객체 한 개.

    kind: table | view | function | procedure | sequence | collection
    """

    name: str
    kind: str
    namespace: str | None = None
    qualified_name: str


class ObjectsOut(BaseModel):
    connection_id: str
    objects: list[DbObjectOut]


class IndexOut(BaseModel):
    name: str
    columns: list[str] = Field(default_factory=list)
    unique: bool = False
    primary: bool = False
    definition: str | None = None


class ObjectDetailOut(BaseModel):
    """우클릭 → 상세 보기 결과. kind 에 따라 채워지는 필드가 다르다."""

    kind: str
    name: str
    namespace: str | None = None
    qualified_name: str
    columns: list[ColumnOut] = Field(default_factory=list)
    indexes: list[IndexOut] = Field(default_factory=list)
    definition: str | None = None
    info: dict[str, str] = Field(default_factory=dict)


class PreviewOut(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    truncated: bool = False


class QueryResultOut(BaseModel):
    """커스텀 SQL 쿼리 테스트 결과 (DBeaver 식 결과 그리드용)."""

    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool = False
    elapsed_ms: int
    #: 전체 행 수 (첫 페이지에서만 계산; 방언·오류로 못 세면 None)
    total: int | None = None
    #: 실행된 선두 명령 (select·insert·update…). 화면이 결과 표시를 가른다.
    statement: str = "select"
    #: 쓰기 문장이 바꾼 행 수. SELECT 이거나 방언이 알려주지 않으면 None.
    affected_rows: int | None = None


class ExplainOut(BaseModel):
    """쿼리 실행 계획(EXPLAIN [ANALYZE]) 결과."""

    plan: str
    analyzed: bool = False


class UsageOut(BaseModel):
    """이 연결을 참조하는 파이프라인."""

    pipeline_id: str
    pipeline_name: str
    pipeline_status: str
    node_ids: list[str]


class UsagesOut(BaseModel):
    connection_id: str
    connection_name: str
    in_use: bool
    usages: list[UsageOut] = Field(default_factory=list)


class DeleteResult(BaseModel):
    deleted: bool
    #: 강제 삭제로 인해 손봐야 하는 파이프라인들
    affected_pipelines: list[str] = Field(default_factory=list)
