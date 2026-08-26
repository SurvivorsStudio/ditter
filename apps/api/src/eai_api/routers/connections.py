"""``/connections`` — 연결 등록·테스트·스키마 탐색 (설계 문서 §7)."""

from __future__ import annotations

from typing import Annotated, Any

from eai_connectors import supported_types
from fastapi import APIRouter, Body, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth.rbac import Principal, Role, require_role
from ..config import get_settings
from ..db import get_db
from ..models import Connection
from ..schemas.connection import (
    ColumnOut,
    ConnectionCreate,
    ConnectionOut,
    ConnectionUpdate,
    DbObjectOut,
    DeleteResult,
    ExplainOut,
    IndexOut,
    ObjectDetailOut,
    ObjectsOut,
    PreviewOut,
    QueryResultOut,
    SchemaOut,
    TableOut,
    TestResult,
    UsageOut,
    UsagesOut,
)
from ..services import connection_service as svc

router = APIRouter(prefix="/connections", tags=["connections"])

DbSession = Annotated[Session, Depends(get_db)]


def _to_out(conn: Connection) -> ConnectionOut:
    """응답에는 시크릿이 절대 실리지 않는다 — config 는 이미 공개 항목만 담고 있다."""
    return ConnectionOut(
        id=conn.id,
        name=conn.name,
        type=conn.type,
        description=conn.description,
        config=conn.config,
        pool_size=conn.pool_size,
        ssl=conn.ssl,
        cdc_enabled=conn.cdc_enabled,
        has_secret=bool(conn.secret_ref),
        health_status=conn.health_status,
        health_message=conn.health_message,
        last_tested_at=conn.last_tested_at,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


@router.get("/types", response_model=list[str])
def list_types() -> list[str]:
    return supported_types()


@router.get("/defaults")
def connector_defaults(_: object = Depends(require_role(Role.VIEWER))) -> dict[str, object]:
    """UI 폼이 미리 채울 시스템 기본값 (SAP 사이드카 주소, 로컬 파일 루트).

    사이드카/파일 루트는 서버가 정하는 값이라, 연결마다 입력받지 않고
    폼에 안내로만 보여준다.
    """
    settings = get_settings()
    return {
        "sap": {"default_sidecar_url": settings.sap_default_sidecar_url},
        "local_file": {"root": settings.local_file_root},
    }


@router.get("", response_model=list[ConnectionOut])
def list_connections(
    db: DbSession,
    type: str | None = Query(default=None, description="커넥터 타입 필터"),
    _: object = Depends(require_role(Role.VIEWER)),
) -> list[ConnectionOut]:
    return [_to_out(c) for c in svc.list_connections(db, type_filter=type)]


@router.post("", response_model=ConnectionOut, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: ConnectionCreate,
    db: DbSession,
    _: object = Depends(require_role(Role.EDITOR)),
) -> ConnectionOut:
    return _to_out(svc.create_connection(db, payload))


@router.post("/bedrock/models")
def bedrock_models(
    config: Annotated[dict[str, Any], Body()],
    _: object = Depends(require_role(Role.EDITOR)),
) -> dict[str, list[dict[str, str]]]:
    """저장 전 자격증명으로 Bedrock 모델 목록을 조회한다 — 폼의 모델 드롭다운용.

    ``config`` 는 {access_key_id, secret_access_key, session_token?, region} 이다.
    연결을 저장하지 않고 임시 커넥터로 list_foundation_models 만 부른다.
    """
    from eai_connectors import build
    from eai_connectors.bedrock import BedrockConnector

    conn = build("bedrock", config)
    assert isinstance(conn, BedrockConnector)  # build("bedrock", ...) 는 항상 이 타입
    with conn:
        return {"models": conn.list_models()}


@router.get("/{connection_id}", response_model=ConnectionOut)
def get_connection(
    connection_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> ConnectionOut:
    return _to_out(svc.get_connection(db, connection_id))


@router.patch("/{connection_id}", response_model=ConnectionOut)
def update_connection(
    connection_id: str,
    payload: ConnectionUpdate,
    db: DbSession,
    _: object = Depends(require_role(Role.EDITOR)),
) -> ConnectionOut:
    return _to_out(svc.update_connection(db, connection_id, payload))


@router.get("/{connection_id}/usages", response_model=UsagesOut)
def get_usages(
    connection_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> UsagesOut:
    """이 연결을 쓰는 파이프라인 목록. 삭제 전에 무엇이 깨지는지 알려주기 위한 것이다."""
    conn = svc.get_connection(db, connection_id)
    usages = svc.find_usages(db, connection_id)
    return UsagesOut(
        connection_id=connection_id,
        connection_name=conn.name,
        in_use=bool(usages),
        usages=[
            UsageOut(
                pipeline_id=u.pipeline_id,
                pipeline_name=u.pipeline_name,
                pipeline_status=u.pipeline_status,
                node_ids=u.node_ids,
            )
            for u in usages
        ],
    )


@router.delete("/{connection_id}", response_model=DeleteResult)
def delete_connection(
    connection_id: str,
    db: DbSession,
    force: bool = Query(
        default=False,
        description="사용 중이어도 삭제한다. 해당 파이프라인은 손봐야 한다.",
    ),
    _: object = Depends(require_role(Role.EDITOR)),
) -> DeleteResult:
    """연결 삭제. 사용 중이면 force 없이는 409 로 거부한다."""
    affected = svc.delete_connection(db, connection_id, force=force)
    return DeleteResult(deleted=True, affected_pipelines=affected)


@router.post("/{connection_id}/test", response_model=TestResult)
def test_connection(
    connection_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.OPERATOR)),
) -> TestResult:
    result = svc.test_connection(db, connection_id)
    return TestResult(
        status=str(result.status),
        message=result.message,
        latency_ms=result.latency_ms,
        server_version=result.server_version,
    )


@router.get("/{connection_id}/schema", response_model=SchemaOut)
def get_schema(
    connection_id: str,
    db: DbSession,
    table: str | None = Query(
        default=None,
        max_length=64,
        description="특정 테이블만 조회. SAP 처럼 전체 열거가 불가능한 소스는 필수",
    ),
    pk: bool = Query(
        default=True,
        description="PK 정보 포함 여부. false 면 느린 PK 조회를 건너뛴다(트리·자동완성용).",
    ),
    columns: bool = Query(
        default=True,
        description="컬럼 포함 여부. false 면 테이블 이름만 빠르게 돌려준다(트리 즉시 로드용).",
    ),
    _: object = Depends(require_role(Role.VIEWER)),
) -> SchemaOut:
    tables = svc.discover_schema(
        db, connection_id, table, include_pk=pk, include_columns=columns
    )
    return SchemaOut(
        connection_id=connection_id,
        tables=[
            TableOut(
                name=t.name,
                namespace=t.namespace,
                qualified_name=t.qualified_name,
                columns=[
                    ColumnOut(
                        name=c.name,
                        data_type=c.data_type,
                        nullable=c.nullable,
                        primary_key=c.primary_key,
                    )
                    for c in t.columns
                ],
            )
            for t in tables
        ],
    )


@router.get("/{connection_id}/objects", response_model=ObjectsOut)
def get_objects(
    connection_id: str,
    db: DbSession,
    _: object = Depends(require_role(Role.VIEWER)),
) -> ObjectsOut:
    """DBeaver 식 카테고리 트리용 객체 목록 — 테이블·뷰·함수·프로시저·시퀀스(엔진별).

    이름만 빠르게 돌려준다(컬럼 없음). 테이블/뷰의 컬럼은 기존 ``/schema?table=`` 로 따로 받는다.
    """
    objects = svc.list_objects(db, connection_id)
    return ObjectsOut(
        connection_id=connection_id,
        objects=[
            DbObjectOut(
                name=o.name,
                kind=o.kind,
                namespace=o.namespace,
                qualified_name=o.qualified_name,
            )
            for o in objects
        ],
    )


@router.get("/{connection_id}/object", response_model=ObjectDetailOut)
def get_object_detail(
    connection_id: str,
    db: DbSession,
    kind: str = Query(description="table|view|materialized_view|function|procedure|sequence|…"),
    name: str = Query(max_length=128, description="객체 이름"),
    schema: str | None = Query(default=None, max_length=128, description="스키마(namespace)"),
    _: object = Depends(require_role(Role.VIEWER)),
) -> ObjectDetailOut:
    """우클릭 → 상세 보기. 테이블은 컬럼·PK·인덱스, 뷰·함수·프로시저는 정의(스크립트)."""
    detail = svc.object_detail(db, connection_id, kind, schema, name)
    if detail is None:
        return ObjectDetailOut(kind=kind, name=name, namespace=schema, qualified_name=name)
    return ObjectDetailOut(
        kind=detail.kind,
        name=detail.name,
        namespace=detail.namespace,
        qualified_name=detail.qualified_name,
        columns=[
            ColumnOut(
                name=c.name, data_type=c.data_type, nullable=c.nullable, primary_key=c.primary_key
            )
            for c in detail.columns
        ],
        indexes=[
            IndexOut(
                name=i.name,
                columns=list(i.columns),
                unique=i.unique,
                primary=i.primary,
                definition=i.definition,
            )
            for i in detail.indexes
        ],
        definition=detail.definition,
        info=dict(detail.info),
    )


@router.post("/{connection_id}/preview", response_model=PreviewOut)
def preview(
    connection_id: str,
    db: DbSession,
    table: Annotated[str | None, Body(embed=True)] = None,
    namespace: Annotated[str | None, Body(embed=True)] = None,
    query: Annotated[str | None, Body(embed=True)] = None,
    limit: Annotated[int | None, Body(embed=True)] = None,
    _: object = Depends(require_role(Role.VIEWER)),
) -> PreviewOut:
    columns, rows, truncated = svc.preview_rows(
        db, connection_id, table=table, namespace=namespace, query=query, limit=limit
    )
    return PreviewOut(columns=columns, rows=rows, truncated=truncated)


@router.post("/{connection_id}/query", response_model=QueryResultOut)
def run_query(
    connection_id: str,
    db: DbSession,
    query: Annotated[str, Body(embed=True)],
    limit: Annotated[int | None, Body(embed=True)] = None,
    offset: Annotated[int | None, Body(embed=True)] = None,
    sort_col: Annotated[str | None, Body(embed=True)] = None,
    sort_dir: Annotated[str, Body(embed=True)] = "asc",
    filters: Annotated[list[dict[str, Any]] | None, Body(embed=True)] = None,
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> QueryResultOut:
    """커스텀 SQL 을 소스에서 실제로 실행. DBeaver 식 쿼리 테스트.

    실행 가능한 명령은 연결의 **허용 명령**(「연결 관리」 체크박스)이 정하고, 기본은
    SELECT 뿐이다. 쓰기(DML)는 operator, 스키마 변경(DDL)은 editor 역할까지 있어야 한다.

    ``offset`` 을 주면 다음 페이지를 이어 받는다 (결과 그리드 무한 스크롤).
    ``sort_col``/``sort_dir``/``filters`` 로 전체 데이터셋 기준 정렬·컬럼 필터를 적용한다.
    """
    out = svc.run_query(
        db,
        connection_id,
        query=query,
        limit=limit,
        offset=offset or 0,
        sort_col=sort_col,
        sort_dir=sort_dir,
        filters=filters,
        can_write=principal.has(Role.OPERATOR),
        can_ddl=principal.has(Role.EDITOR),
    )
    return QueryResultOut(
        columns=out.columns,
        rows=out.rows,
        row_count=len(out.rows),
        truncated=out.has_more,
        elapsed_ms=out.elapsed_ms,
        total=out.total,
        statement=out.statement,
        affected_rows=out.affected_rows,
    )


@router.post("/{connection_id}/explain", response_model=ExplainOut)
def explain_query(
    connection_id: str,
    db: DbSession,
    query: Annotated[str, Body(embed=True)],
    analyze: Annotated[bool, Body(embed=True)] = False,
    principal: Principal = Depends(require_role(Role.VIEWER)),
) -> ExplainOut:
    """쿼리 실행 계획(EXPLAIN) / 성능 분석(EXPLAIN ANALYZE). PostgreSQL·MySQL.

    ANALYZE 는 실제로 쿼리를 실행하므로(커넥터가 롤백 트랜잭션으로 감싼다) 비SELECT 는
    쓰기/DDL 역할까지 있어야 한다. 허용 명령 밖의 문장은 EXPLAIN 도 거부된다.
    """
    plan = svc.explain_query(
        db,
        connection_id,
        query=query,
        analyze=analyze,
        can_write=principal.has(Role.OPERATOR),
        can_ddl=principal.has(Role.EDITOR),
    )
    return ExplainOut(plan=plan, analyzed=analyze)


@router.post("/{connection_id}/mongo", response_model=QueryResultOut)
def run_mongo(
    connection_id: str,
    db: DbSession,
    command: Annotated[str, Body(embed=True)],
    namespace: Annotated[str | None, Body(embed=True)] = None,
    limit: Annotated[int | None, Body(embed=True)] = None,
    offset: Annotated[int | None, Body(embed=True)] = None,
    sort_col: Annotated[str | None, Body(embed=True)] = None,
    sort_dir: Annotated[str, Body(embed=True)] = "asc",
    filters: Annotated[list[dict[str, Any]] | None, Body(embed=True)] = None,
    _: object = Depends(require_role(Role.VIEWER)),
) -> QueryResultOut:
    """MongoDB 조회 — ``컬렉션.find({필터})`` 또는 ``컬렉션.aggregate([파이프라인])``.

    ``offset`` 으로 다음 페이지를 이어 받는다 (결과 그리드 무한 스크롤).
    ``sort_col``/``sort_dir``/``filters`` 로 전체 컬렉션 기준 정렬·컬럼 필터를 적용한다.
    """
    columns, rows, has_more, elapsed_ms, total = svc.run_mongo(
        db,
        connection_id,
        command=command,
        namespace=namespace,
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


@router.post("/{connection_id}/export")
def export_result(
    connection_id: str,
    db: DbSession,
    mode: Annotated[str, Body(embed=True)] = "sql",
    format: Annotated[str, Body(embed=True)] = "csv",
    query: Annotated[str | None, Body(embed=True)] = None,
    command: Annotated[str | None, Body(embed=True)] = None,
    namespace: Annotated[str | None, Body(embed=True)] = None,
    sort_col: Annotated[str | None, Body(embed=True)] = None,
    sort_dir: Annotated[str, Body(embed=True)] = "asc",
    filters: Annotated[list[dict[str, Any]] | None, Body(embed=True)] = None,
    _: object = Depends(require_role(Role.VIEWER)),
) -> StreamingResponse:
    """조회 결과를 파일로 내려받는다 (전체 데이터셋, 현재 정렬·필터 반영).

    형식은 ``format`` 으로 고른다: ``csv``·``json``·``txt``(TSV).
    """
    filename, mime, stream = svc.export_rows(
        db,
        connection_id,
        mode=mode,
        fmt=format,
        query=query,
        command=command,
        namespace=namespace,
        sort_col=sort_col,
        sort_dir=sort_dir,
        filters=filters,
    )
    return StreamingResponse(
        stream,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
