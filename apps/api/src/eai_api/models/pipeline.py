"""Pipeline — 노드·엣지 DAG 정의 (설계 문서 §4)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, new_uuid


class Pipeline(Base, TimestampMixin):
    __tablename__ = "pipelines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)

    #: {"nodes": [...], "edges": [...]} — 실행 시 위상 정렬 후 처리 (설계 문서 §4)
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)

    schedule: Mapped[str | None] = mapped_column(String(120))  # cron 식
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Seoul")
    schedule_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    versions: Mapped[list[PipelineVersion]] = relationship(
        back_populates="pipeline", cascade="all, delete-orphan", order_by="PipelineVersion.version.desc()"
    )

    def __repr__(self) -> str:
        return f"<Pipeline {self.name} v{self.version}>"


class PipelineVersion(Base, TimestampMixin):
    """저장 시마다 스냅샷을 남긴다 — 롤백과 감사를 위해."""

    __tablename__ = "pipeline_versions"
    __table_args__ = (UniqueConstraint("pipeline_id", "version", name="uq_pipeline_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pipeline_id: Mapped[str] = mapped_column(
        ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(120))

    pipeline: Mapped[Pipeline] = relationship(back_populates="versions")
