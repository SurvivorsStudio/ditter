"""실시간 동기화(SymmetricDS) — 스트림에 엔진 구분을 더한다

Revision ID: 0007
Revises: 0006
Create Date: 실시간 DB 동기화

``cdc_streams`` 를 새 테이블로 가르지 않는 이유는, 수명주기(provisioning→running↔paused→
stopped/failed)·지표·모니터 화면이 두 엔진에서 완전히 같기 때문이다. 다른 것은 **무엇이
변경을 잡아 어디로 보내는가** 뿐이라 컬럼 하나로 가른다.

``engine`` 에 서버 기본값 ``debezium`` 을 두는 것이 이 마이그레이션의 핵심이다 —
기존 행은 전부 Debezium 스트림이고, 기본값이 없으면 NOT NULL 추가가 실패한다.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column(
        "cdc_streams",
        sa.Column("engine", sa.String(16), nullable=False, server_default="debezium"),
    )
    op.add_column("cdc_streams", sa.Column("target_connection_id", sa.String(36)))
    op.add_column(
        "cdc_streams",
        sa.Column("config", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_cdc_streams_engine", "cdc_streams", ["engine"])
    op.create_index(
        "ix_cdc_streams_target_connection_id", "cdc_streams", ["target_connection_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_cdc_streams_target_connection_id", table_name="cdc_streams")
    op.drop_index("ix_cdc_streams_engine", table_name="cdc_streams")
    op.drop_column("cdc_streams", "config")
    op.drop_column("cdc_streams", "target_connection_id")
    op.drop_column("cdc_streams", "engine")
