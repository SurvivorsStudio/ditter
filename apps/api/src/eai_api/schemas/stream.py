"""CDC 스트림 API 스키마 (Phase 4 — docs/PHASE4_CDC_기획안.md §6.1).

4a 에서는 계약(응답 모양·제어 액션)만 정의한다. 실제 엔드포인트와 Kafka Connect
연동은 4b, Sink Worker 는 4c 에서 붙인다.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StreamAction(StrEnum):
    """스트림 제어 액션 — /streams/{id}/{action} 로 노출된다 (4b)."""

    PAUSE = "pause"
    RESUME = "resume"
    STOP = "stop"


class CdcStreamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    pipeline_id: str
    status: str
    #: debezium | symmetricds — 무엇이 변경을 잡아 어디로 보내는가
    engine: str = "debezium"
    debezium_connector: str | None = None
    source_connection_id: str | None = None
    target_connection_id: str | None = None
    topics: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    last_event_at: datetime | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class CdcStreamListItem(BaseModel):
    """모니터링 Streams 탭 한 줄."""

    id: str
    pipeline_id: str
    pipeline_name: str
    status: str
    engine: str = "debezium"
    events_total: int = 0
    eps: float = 0.0
    lag_ms: int | None = None
    #: sink 가 이 스트림 토픽을 구독했는지. running 인데 False 면 '구독 대기중'(자동 재구독 대기).
    subscribed: bool = False
    last_event_at: datetime | None = None
    started_at: datetime | None = None


class CdcStreamEvent(BaseModel):
    """WebSocket 으로 UI 에 밀어주는 스트림 지표/상태 이벤트."""

    type: str  # status | metrics | log
    stream_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    ts: datetime


class PreflightCheck(BaseModel):
    key: str
    label: str
    ok: bool
    detail: str = ""
    #: error 면 통과해야 시작할 수 있고, warning·info 는 알리기만 한다.
    #: 부하 테스트·복제본 용도처럼 **코드가 판정할 수 없는 것**을 error 로 두면
    #: 문서가 요구한 파일럿(부하 테스트를 하기 위한 구축) 자체가 막힌다.
    level: str = "error"


class PreflightOut(BaseModel):
    """연결이 CDC 소스로 쓸 준비가 되었는지 점검한 결과 (기획안 §6.1)."""

    connection_id: str
    connection_name: str
    ready: bool
    checks: list[PreflightCheck] = Field(default_factory=list)


class SyncTableCheck(BaseModel):
    """동기화 대상 테이블 한 줄의 점검 결과 (기획안 §1 — PK 유무가 관건)."""

    name: str
    namespace: str = ""
    exists: bool = False
    has_primary_key: bool = False
    channel: str = ""
    row_count: int | None = None


class SyncPreflightOut(BaseModel):
    """실시간 동기화 착수 전 점검 (기획안 §1 미확정 항목 · §8 Phase 1).

    문서가 "확정 전에 코드를 작성하면 재작업이 발생한다"고 못 박은 항목들을 사람이 아니라
    **코드가** 확인한다. 사람에게 물어야만 아는 두 가지(복제본 용도 · 부하 테스트)는
    판정하지 않고 ``level='warning'`` 으로 드러내기만 한다.
    """

    pipeline_id: str
    source_connection_id: str = ""
    source_connection_name: str = ""
    target_connection_id: str = ""
    target_connection_name: str = ""
    #: error 레벨 점검이 전부 통과했는가 — start 가 이것으로 막힌다
    ready: bool = False
    server_version: str = ""
    edition: str = ""
    checks: list[PreflightCheck] = Field(default_factory=list)
    tables: list[SyncTableCheck] = Field(default_factory=list)
