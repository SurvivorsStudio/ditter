"""Connection — 소스/타깃 연결 정의 (설계 문서 §4)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class Connection(Base, TimestampMixin):
    __tablename__ = "connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)

    #: 비밀이 아닌 접속 정보만 담는다 (host/port/database/bucket/region …)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: 시크릿 원문은 저장하지 않는다. 실제 값은 KMS/시크릿 매니저에서 복호화 (설계 문서 §4)
    secret_ref: Mapped[str | None] = mapped_column(String(255))

    pool_size: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    ssl: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cdc_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    health_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    health_message: Mapped[str | None] = mapped_column(Text)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return f"<Connection {self.name} ({self.type})>"
