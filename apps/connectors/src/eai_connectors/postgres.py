"""PostgreSQL 커넥터 (psycopg3)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .base import ConnectorType
from .errors import ConfigurationError
from .sql_base import SqlConnector


class PostgresConnector(SqlConnector):
    type = ConnectorType.POSTGRES
    default_port = 5432

    @property
    def drivername(self) -> str:
        return "postgresql+psycopg"

    def connect_args(self) -> dict[str, Any]:
        return {"connect_timeout": self.connect_timeout}

    def url_query(self) -> dict[str, str]:
        return {"sslmode": "require"} if self.ssl else {}

    def version_sql(self) -> str:
        return "SHOW server_version"

    def _upsert_sql(
        self, table: str, namespace: str | None, columns: Sequence[str], keys: Sequence[str]
    ) -> str:
        if not keys:
            raise ConfigurationError("upsert 는 key_columns 가 필요합니다", connector=str(self.type))
        cols = ", ".join(self.quote(c) for c in columns)
        binds = ", ".join(f":{c}" for c in columns)
        conflict = ", ".join(self.quote(c) for c in keys)
        updatable = [c for c in columns if c not in set(keys)]
        if not updatable:
            # 전 컬럼이 키인 경우 — 중복은 그냥 무시하는 것이 유일하게 옳은 동작
            action = "DO NOTHING"
        else:
            sets = ", ".join(f"{self.quote(c)} = EXCLUDED.{self.quote(c)}" for c in updatable)
            action = f"DO UPDATE SET {sets}"
        return (
            f"INSERT INTO {self._qualified(table, namespace)} ({cols}) VALUES ({binds}) "
            f"ON CONFLICT ({conflict}) {action}"
        )
