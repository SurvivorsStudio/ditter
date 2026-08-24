"""PipelineTrigger — 외부 시스템이 파이프라인을 부르는 창구(웹훅) 하나.

토큰이 곧 자격증명이다. 그래서 **원문은 저장하지 않는다** — 발급 순간 한 번만 보여주고,
DB 에는 SHA-256 해시만 남는다. 잃어버리면 재발급뿐이다.

해시를 Argon2 가 아니라 SHA-256 으로 두는 이유가 있다. 토큰은 사람이 고른 비밀번호가
아니라 **256비트 난수**라 사전 공격 대상이 아니고, 웹훅은 호출마다 검증하므로 의도적으로
느린 해시를 쓰면 그 비용을 매 호출에 치른다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class PipelineTrigger(Base, TimestampMixin):
    __tablename__ = "pipeline_triggers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pipeline_id: Mapped[str] = mapped_column(
        ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 창구 이름 — 어느 시스템이 쓰는 토큰인지 사람이 알아보기 위한 것
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="기본")

    #: SHA-256(토큰) 16진수. 조회 키라 유니크 인덱스를 건다.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    #: 토큰 앞 8자 — 목록에서 어느 토큰인지 구분하는 용도. 이것만으로는 호출할 수 없다.
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False)

    #: 끄면 호출이 401 로 막힌다. 지우지 않고 잠시 막을 때 쓴다.
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    last_called_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    call_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_by: Mapped[str | None] = mapped_column(String(120))

    def __repr__(self) -> str:
        return f"<PipelineTrigger {self.name} {self.token_prefix}…>"
