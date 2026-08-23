"""외부 호출 창구(웹훅) 테이블

Revision ID: 0005
Revises: 0004
Create Date: Phase 4 — API 트리거 공개 엔드포인트

토큰 원문은 저장하지 않는다. ``token_hash`` 가 조회 키라 유니크 인덱스를 건다 —
호출마다 해시로 찾으므로 인덱스가 없으면 전체 스캔이 된다.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "pipeline_triggers",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("pipeline_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False, server_default="기본"),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("token_prefix", sa.String(16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_called_at", TS, nullable=True),
        sa.Column("call_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(120), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["pipeline_id"], ["pipelines.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pipeline_triggers_pipeline_id", "pipeline_triggers", ["pipeline_id"])
    op.create_index("ix_pipeline_triggers_token_hash", "pipeline_triggers", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_pipeline_triggers_token_hash", table_name="pipeline_triggers")
    op.drop_index("ix_pipeline_triggers_pipeline_id", table_name="pipeline_triggers")
    op.drop_table("pipeline_triggers")
