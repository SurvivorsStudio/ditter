"""응답 노드가 모은 결과를 실행에 남긴다

Revision ID: 0006
Revises: 0005
Create Date: Phase 4 — 응답 노드(target.response)

``nullable=True`` 이고 기본값이 없다. 응답 노드가 **없는** 실행과 있는데 아직 안 채워진
실행을 구분해야 하기 때문이다 — 웹훅이 이 값을 기다릴지 말지를 그것으로 판단한다.
빈 dict 를 기본값으로 두면 "결과 없음"과 "아직"이 같아져 영영 기다리게 된다.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.add_column("runs", sa.Column("response", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "response")
