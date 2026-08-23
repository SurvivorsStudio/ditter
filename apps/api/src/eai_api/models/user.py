"""User — RBAC 주체 (Phase 2).

비밀번호는 **해시만** 저장한다. 원문은 어디에도 남기지 않는다 (설계 문서 §11).
외부 IdP(OIDC) 로그인 사용자는 ``password_hash`` 가 비고 ``external_id`` 가 채워진다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    #: 로컬 로그인용 해시. OIDC 전용 사용자는 비어 있다.
    password_hash: Mapped[str | None] = mapped_column(Text)
    #: OIDC subject. 외부 IdP 연동 시 채워진다 (Phase 2 범위에서는 스키마만 준비).
    external_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    external_provider: Mapped[str | None] = mapped_column(String(64))

    roles: Mapped[list[str]] = mapped_column(ARRAY(String(32)), nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return f"<User {self.email} {self.roles}>"
