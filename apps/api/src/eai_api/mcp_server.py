"""FastMCP 도구 정의.

설계 문서 §7: 기능은 MCP tool 로 노출하고 UI(REST/WS)와 LLM/에이전트가 **같은 도구를 재사용**한다.
그래서 여기 있는 함수는 REST 라우터와 동일한 서비스 계층만 호출한다 — 로직을 복제하지 않는다.
전송은 Streamable HTTP 이며 ``/mcp`` 에 마운트된다.
"""

from __future__ import annotations

import logging
from typing import Any

from fastmcp import FastMCP

from .db import session_scope
from .schemas.pipeline import PipelineCreate
from .services import (
    cdc_service,
    connection_service,
    pipeline_service,
    run_service,
    sync_service,
)
from .services.errors import ServiceError

logger = logging.getLogger(__name__)

mcp: FastMCP[Any] = FastMCP(
    name="eai-platform",
    instructions=(
        "자체 EAI 플랫폼의 연결·파이프라인·실행을 다루는 도구 모음입니다. "
        "데이터를 실제로 옮기기 전에 반드시 validate_pipeline 으로 DAG 를 검증하세요."
    ),
)


@mcp.tool
def list_connections(type: str | None = None) -> list[dict[str, Any]]:
    """등록된 연결 목록을 돌려준다. 시크릿은 포함되지 않는다."""
    with session_scope() as session:
        return [
            {
                "id": c.id,
                "name": c.name,
                "type": c.type,
                "health_status": c.health_status,
                "config": c.config,
            }
            for c in connection_service.list_connections(session, type_filter=type)
        ]


@mcp.tool
def test_connection(connection_id: str) -> dict[str, Any]:
    """연결을 실제로 열어 상태를 확인하고 결과를 저장한다."""
    with session_scope() as session:
        result = connection_service.test_connection(session, connection_id)
        return {
            "status": str(result.status),
            "message": result.message,
            "latency_ms": result.latency_ms,
            "server_version": result.server_version,
        }


@mcp.tool
def discover_schema(connection_id: str) -> list[dict[str, Any]]:
    """소스의 테이블·컬럼 스키마를 탐색한다."""
    with session_scope() as session:
        return [
            {
                "qualified_name": t.qualified_name,
                "namespace": t.namespace,
                "name": t.name,
                "columns": [
                    {"name": c.name, "type": c.data_type, "nullable": c.nullable, "pk": c.primary_key}
                    for c in t.columns
                ],
            }
            for t in connection_service.discover_schema(session, connection_id)
        ]


@mcp.tool
def preview_data(
    connection_id: str,
    table: str | None = None,
    namespace: str | None = None,
    query: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """소스 데이터를 소량 미리 본다. 서버가 정한 상한을 넘을 수 없다."""
    with session_scope() as session:
        columns, rows, truncated = connection_service.preview_rows(
            session, connection_id, table=table, namespace=namespace, query=query, limit=limit
        )
        return {"columns": columns, "rows": rows, "truncated": truncated}


@mcp.tool
def list_pipelines(status: str | None = None) -> list[dict[str, Any]]:
    """파이프라인 목록과 최근 실행 상태를 돌려준다."""
    with session_scope() as session:
        pipelines = pipeline_service.list_pipelines(session, status=status)
        return [s.model_dump(mode="json") for s in pipeline_service.summarize(session, pipelines)]


@mcp.tool
def get_pipeline(pipeline_id: str) -> dict[str, Any]:
    """파이프라인의 DAG 정의 전체를 돌려준다."""
    with session_scope() as session:
        pipeline = pipeline_service.get_pipeline(session, pipeline_id)
        return {
            "id": pipeline.id,
            "name": pipeline.name,
            "version": pipeline.version,
            "status": pipeline.status,
            "schedule": pipeline.schedule,
            "definition": pipeline.definition,
        }


@mcp.tool
def create_pipeline(
    name: str,
    definition: dict[str, Any],
    description: str | None = None,
    schedule: str | None = None,
) -> dict[str, Any]:
    """새 파이프라인을 만든다. ``definition`` 은 {"nodes": [...], "edges": [...]} 형식이다."""
    with session_scope() as session:
        payload = PipelineCreate.model_validate(
            {"name": name, "description": description, "definition": definition, "schedule": schedule}
        )
        pipeline = pipeline_service.create_pipeline(session, payload)
        return {"id": pipeline.id, "name": pipeline.name, "version": pipeline.version}


@mcp.tool
def validate_pipeline(pipeline_id: str) -> dict[str, Any]:
    """DAG 구조와 노드 설정을 검증한다. 실행 전에 반드시 호출하라."""
    with session_scope() as session:
        result = pipeline_service.validate_pipeline(pipeline_service.get_pipeline(session, pipeline_id))
        return result.model_dump(mode="json")


@mcp.tool
def run_pipeline(pipeline_id: str, full_refresh: bool = False) -> dict[str, Any]:
    """파이프라인을 큐에 넣어 실행한다. ``full_refresh=True`` 면 워터마크를 무시하고 전체 적재한다."""
    with session_scope() as session:
        try:
            run = run_service.enqueue_run(session, pipeline_id, trigger="manual", full_refresh=full_refresh)
        except ServiceError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "run_id": run.id, "status": run.status}


@mcp.tool
def get_run_status(run_id: str) -> dict[str, Any]:
    """실행 상태·진행률·에러를 조회한다."""
    with session_scope() as session:
        run = run_service.get_run(session, run_id)
        return {
            "id": run.id,
            "pipeline_id": run.pipeline_id,
            "status": run.status,
            "progress": run.progress,
            "records": run.records,
            "error": run.error,
            "node_states": run.node_states,
            "duration_seconds": run.duration_seconds,
        }


@mcp.tool
def get_run_logs(run_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """실행 로그를 시간순으로 돌려준다."""
    with session_scope() as session:
        return [
            {
                "id": log.id,
                "node_id": log.node_id,
                "level": log.level,
                "message": log.message,
                "ts": log.ts.isoformat(),
            }
            for log in run_service.list_logs(session, run_id, limit=limit)
        ]


@mcp.tool
def dashboard_stats() -> dict[str, Any]:
    """플랫폼 전체 통계 (파이프라인 수, 24시간 성공률, 처리 건수 등)."""
    with session_scope() as session:
        return run_service.dashboard_stats(session).model_dump(mode="json")


# ----------------------------------------------------------------- CDC (Phase 4)


@mcp.tool
def start_cdc_stream(pipeline_id: str) -> dict[str, Any]:
    """CDC 파이프라인을 켜서 실시간 스트림을 시작한다 (Debezium 커넥터 등록)."""
    with session_scope() as session:
        try:
            stream = cdc_service.start_stream(session, pipeline_id)
        except ServiceError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "stream_id": stream.id, "status": stream.status, "topics": stream.topics}


@mcp.tool
def stop_cdc_stream(stream_id: str) -> dict[str, Any]:
    """CDC 스트림을 정지한다 (Debezium 커넥터 삭제)."""
    with session_scope() as session:
        try:
            stream = cdc_service.stop_stream(session, stream_id)
        except ServiceError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "stream_id": stream.id, "status": stream.status}


@mcp.tool
def get_cdc_stream_status(stream_id: str) -> dict[str, Any]:
    """CDC 스트림의 상태·지표를 조회한다 (Debezium 실제 상태와 맞춘 뒤)."""
    with session_scope() as session:
        stream = cdc_service.refresh_status(session, stream_id)
        return {
            "id": stream.id,
            "pipeline_id": stream.pipeline_id,
            "status": stream.status,
            "debezium_connector": stream.debezium_connector,
            "topics": stream.topics,
            "metrics": stream.metrics,
            "error": stream.error,
        }


@mcp.tool
def list_cdc_streams(status: str | None = None) -> list[dict[str, Any]]:
    """CDC 스트림 목록을 돌려준다."""
    with session_scope() as session:
        return [s.model_dump(mode="json") for s in cdc_service.list_streams(session, status=status)]


# --------------------------------------------------- 실시간 DB 동기화 (SymmetricDS)


@mcp.tool
def sync_preflight(pipeline_id: str) -> dict[str, Any]:
    """실시간 동기화 착수 전 점검. 원본을 읽기만 하므로 몇 번을 불러도 안전하다.

    SQL Server 버전·에디션, 대상 테이블의 존재와 **기본키 유무**, 원본 트리거 생성 권한,
    타깃·사이드카 접속을 본다. 코드가 판정할 수 없는 두 가지(복제본 용도·부하 테스트)는
    경고로만 돌려준다.
    """
    with session_scope() as session:
        try:
            return sync_service.preflight(session, pipeline_id).model_dump(mode="json")
        except ServiceError as exc:
            return {"ok": False, "error": str(exc)}


@mcp.tool
def start_sync_stream(pipeline_id: str, skip_preflight: bool = False) -> dict[str, Any]:
    """실시간 DB 동기화를 시작한다 (원본 SYM_* 에 트리거·라우터 등록).

    **원본 테이블에 트리거가 생긴다** — 쓰기 트랜잭션이 느려지므로 운영 적용 전에는
    부하 테스트가 필요하다. 기본은 착수 점검을 통과해야 시작된다.
    """
    with session_scope() as session:
        try:
            stream = sync_service.start_stream(
                session, pipeline_id, skip_preflight=skip_preflight
            )
        except ServiceError as exc:
            return {"ok": False, "error": str(exc)}
        return {
            "ok": True,
            "stream_id": stream.id,
            "status": stream.status,
            "tables": [t["name"] for t in (stream.config or {}).get("tables", [])],
            "notes": (stream.config or {}).get("notes", []),
        }


@mcp.tool
def stop_sync_stream(stream_id: str) -> dict[str, Any]:
    """실시간 동기화를 정지하고 원본에 심은 트리거·라우터를 걷어낸다."""
    with session_scope() as session:
        try:
            stream = sync_service.stop_stream(session, stream_id)
        except ServiceError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "stream_id": stream.id, "status": stream.status}


@mcp.tool
def get_sync_stream_status(stream_id: str) -> dict[str, Any]:
    """실시간 동기화의 상태·지표. 원본의 SYM_DATA·SYM_OUTGOING_BATCH 를 읽어 갱신한다.

    ``pending_rows`` 가 지속 증가하면 전송이 밀리고 있다는 신호이고, 방치하면 원본 DB
    용량과 트랜잭션 로그가 계속 늘어난다.
    """
    with session_scope() as session:
        stream = sync_service.refresh_status(session, stream_id)
        return {
            "id": stream.id,
            "pipeline_id": stream.pipeline_id,
            "engine": stream.engine,
            "status": stream.status,
            "metrics": stream.metrics,
            "last_event_at": stream.last_event_at.isoformat() if stream.last_event_at else None,
            "error": stream.error,
        }
