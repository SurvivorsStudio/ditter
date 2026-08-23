"""Run / RunLog / Checkpoint — 실행 상태·이력·오프셋 (설계 문서 §4)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, new_uuid


class RunStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = frozenset({RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.CANCELLED})


class RunTrigger(StrEnum):
    SCHEDULE = "schedule"
    MANUAL = "manual"
    CDC = "cdc"


class LogLevel(StrEnum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class Run(Base, TimestampMixin):
    __tablename__ = "runs"
    __table_args__ = (Index("ix_runs_pipeline_started", "pipeline_id", "started_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pipeline_id: Mapped[str] = mapped_column(
        ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pipeline_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=RunStatus.PENDING, index=True)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False, default=RunTrigger.MANUAL)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    records: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0-100
    error: Mapped[str | None] = mapped_column(Text)
    #: 노드별 상태·건수 스냅샷 {node_id: {status, records, ...}}
    node_states: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: 이 실행에 주입된 `$변수` 값 {name: value}. API 트리거로 들어온 본문이 여기 남는다.
    #: "그때 어떤 값으로 돌았나"를 나중에 확인할 수 있어야 재현이 가능하다.
    variables: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: 응답 노드(target.response)가 모은 결과 {columns, rows, truncated}.
    #: 웹훅 호출자가 이걸 기다렸다가 응답 본문으로 받는다. 응답 노드가 없으면 None.
    response: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    celery_task_id: Mapped[str | None] = mapped_column(String(64), index=True)

    logs: Mapped[list[RunLog]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="RunLog.ts"
    )

    @property
    def duration_seconds(self) -> float | None:
        if self.started_at is None or self.finished_at is None:
            return None
        return (self.finished_at - self.started_at).total_seconds()

    def __repr__(self) -> str:
        return f"<Run {self.id[:8]} {self.status}>"


class RunLog(Base):
    __tablename__ = "run_logs"
    __table_args__ = (Index("ix_run_logs_run_ts", "run_id", "ts"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    node_id: Mapped[str | None] = mapped_column(String(64))
    level: Mapped[str] = mapped_column(String(10), nullable=False, default=LogLevel.INFO)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    run: Mapped[Run] = relationship(back_populates="logs")


class Checkpoint(Base, TimestampMixin):
    """증분 워터마크 / CDC 오프셋. 재시작 지점의 유일한 근거."""

    __tablename__ = "checkpoints"
    __table_args__ = (UniqueConstraint("pipeline_id", "node_id", name="uq_checkpoint_pipeline_node"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pipeline_id: Mapped[str] = mapped_column(
        ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    #: {"watermark": ..., "column": ...} 또는 {"cdc_offset": {...}}
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    last_run_id: Mapped[str | None] = mapped_column(String(36))

    def __repr__(self) -> str:
        return f"<Checkpoint {self.pipeline_id[:8]}/{self.node_id}>"
