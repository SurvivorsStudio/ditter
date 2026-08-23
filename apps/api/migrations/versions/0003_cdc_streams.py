"""CDC 스트림 수명주기 테이블 (Phase 4 — docs/PHASE4_CDC_기획안.md §4.1)

Revision ID: 0003
Revises: 0002
Create Date: Phase 4
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "cdc_streams",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("pipeline_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="provisioning"),
        sa.Column("debezium_connector", sa.String(255)),
        sa.Column("source_connection_id", sa.String(36)),
        sa.Column("topics", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("last_event_at", TS),
        sa.Column("metrics", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_cdc_streams"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["pipelines.id"],
            name="fk_cdc_streams_pipeline_id_pipelines",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_cdc_streams_pipeline_id", "cdc_streams", ["pipeline_id"])
    op.create_index("ix_cdc_streams_status", "cdc_streams", ["status"])
    op.create_index("ix_cdc_streams_source_connection_id", "cdc_streams", ["source_connection_id"])


def downgrade() -> None:
    op.drop_table("cdc_streams")
