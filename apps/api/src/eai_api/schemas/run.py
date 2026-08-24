"""Run / RunLog API 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    pipeline_id: str
    pipeline_version: int
    status: str
    trigger: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    records: int = 0
    progress: int = 0
    error: str | None = None
    node_states: dict[str, Any] = Field(default_factory=dict)
    #: 이 실행에 주입된 `$변수` 값 — "그때 어떤 값으로 돌았나"를 실행 상세에서 본다
    variables: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class RunListItem(BaseModel):
    """모니터링 표 한 줄."""

    id: str
    pipeline_id: str
    pipeline_name: str
    status: str
    trigger: str
    records: int = 0
    progress: int = 0
    duration_seconds: float | None = None
    started_at: datetime | None = None


class RunLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: str
    node_id: str | None = None
    level: str
    message: str
    ts: datetime


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class DashboardStats(BaseModel):
    """홈/모니터링 상단 카드."""

    pipelines_total: int = 0
    pipelines_active: int = 0
    pipelines_inactive: int = 0
    runs_success_today: int = 0
    runs_failed_today: int = 0
    runs_total_24h: int = 0
    runs_scheduled_24h: int = 0
    runs_manual_24h: int = 0
    records_24h: int = 0
    success_rate_24h: float = 0.0
    avg_duration_seconds: float | None = None
    median_duration_seconds: float | None = None


class RunEvent(BaseModel):
    """WebSocket 으로 UI 에 밀어주는 이벤트."""

    type: str  # status | progress | log | node
    run_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    ts: datetime
