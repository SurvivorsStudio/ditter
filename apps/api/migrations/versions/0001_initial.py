"""초기 스키마 — connections / pipelines / runs / checkpoints / secret_blobs

Revision ID: 0001
Revises:
Create Date: Phase 0
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "connections",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("config", JSONB, nullable=False),
        sa.Column("secret_ref", sa.String(255)),
        sa.Column("pool_size", sa.Integer(), nullable=False),
        sa.Column("ssl", sa.Boolean(), nullable=False),
        sa.Column("cdc_enabled", sa.Boolean(), nullable=False),
        sa.Column("health_status", sa.String(16), nullable=False),
        sa.Column("health_message", sa.Text()),
        sa.Column("last_tested_at", TS),
        sa.Column("created_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_connections"),
        sa.UniqueConstraint("name", name="uq_connections_name"),
    )
    op.create_index("ix_connections_type", "connections", ["type"])

    op.create_table(
        "pipelines",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("definition", JSONB, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("schedule", sa.String(120)),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("schedule_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_pipelines"),
        sa.UniqueConstraint("name", name="uq_pipelines_name"),
    )
    op.create_index("ix_pipelines_status", "pipelines", ["status"])

    op.create_table(
        "pipeline_versions",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("pipeline_id", sa.String(36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("definition", JSONB, nullable=False),
        sa.Column("created_by", sa.String(120)),
        sa.Column("created_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_pipeline_versions"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["pipelines.id"],
            name="fk_pipeline_versions_pipeline_id_pipelines",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("pipeline_id", "version", name="uq_pipeline_version"),
    )
    op.create_index("ix_pipeline_versions_pipeline_id", "pipeline_versions", ["pipeline_id"])

    op.create_table(
        "runs",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("pipeline_id", sa.String(36), nullable=False),
        sa.Column("pipeline_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("started_at", TS),
        sa.Column("finished_at", TS),
        sa.Column("records", sa.BigInteger(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("node_states", JSONB, nullable=False),
        sa.Column("celery_task_id", sa.String(64)),
        sa.Column("created_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_runs"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"], ["pipelines.id"], name="fk_runs_pipeline_id_pipelines", ondelete="CASCADE"
        ),
    )
    op.create_index("ix_runs_pipeline_id", "runs", ["pipeline_id"])
    op.create_index("ix_runs_status", "runs", ["status"])
    op.create_index("ix_runs_celery_task_id", "runs", ["celery_task_id"])
    op.create_index("ix_runs_pipeline_started", "runs", ["pipeline_id", "started_at"])

    op.create_table(
        "run_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("node_id", sa.String(64)),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("ts", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_run_logs"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], name="fk_run_logs_run_id_runs", ondelete="CASCADE"),
    )
    op.create_index("ix_run_logs_run_ts", "run_logs", ["run_id", "ts"])

    op.create_table(
        "checkpoints",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("pipeline_id", sa.String(36), nullable=False),
        sa.Column("node_id", sa.String(64), nullable=False),
        sa.Column("state", JSONB, nullable=False),
        sa.Column("last_run_id", sa.String(36)),
        sa.Column("created_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_checkpoints"),
        sa.ForeignKeyConstraint(
            ["pipeline_id"],
            ["pipelines.id"],
            name="fk_checkpoints_pipeline_id_pipelines",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("pipeline_id", "node_id", name="uq_checkpoint_pipeline_node"),
    )
    op.create_index("ix_checkpoints_pipeline_id", "checkpoints", ["pipeline_id"])

    op.create_table(
        "secret_blobs",
        sa.Column("ref", sa.String(64), nullable=False),
        sa.Column("backend", sa.String(16), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("created_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("ref", name="pk_secret_blobs"),
    )


def downgrade() -> None:
    op.drop_table("secret_blobs")
    op.drop_table("checkpoints")
    op.drop_table("run_logs")
    op.drop_table("runs")
    op.drop_table("pipeline_versions")
    op.drop_table("pipelines")
    op.drop_table("connections")
