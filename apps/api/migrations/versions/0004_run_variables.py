"""API 트리거로 주입된 `$변수` 값을 실행에 남긴다

Revision ID: 0004
Revises: 0003
Create Date: Phase 4 — API 트리거

기존 행에도 값이 있어야 하므로 ``server_default`` 를 준다. 나중에 벗기지 않는 이유는
워커가 Run 을 만들 때 이 컬럼을 채우지 않는 경로(재시도·스케줄)가 남아 있어서다 —
기본값이 DB 쪽에 있어야 NOT NULL 이 안전하다.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("variables", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("runs", "variables")
