"""MySQL 커넥터 (PyMySQL)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .base import ConnectorType
from .sql_base import SqlConnector


class MySqlConnector(SqlConnector):
    type = ConnectorType.MYSQL
    default_port = 3306

    @property
    def drivername(self) -> str:
        return "mysql+pymysql"

    def connect_args(self) -> dict[str, Any]:
        args: dict[str, Any] = {"connect_timeout": self.connect_timeout, "charset": "utf8mb4"}
        if self.ssl:
            args["ssl"] = {"ssl_mode": "REQUIRED"}
        return args

    def version_sql(self) -> str:
        return "SELECT VERSION()"

    def _upsert_sql(
        self, table: str, namespace: str | None, columns: Sequence[str], keys: Sequence[str]
    ) -> str:
        cols = ", ".join(self.quote(c) for c in columns)
        binds = ", ".join(f":{c}" for c in columns)
        # 키 컬럼은 갱신 대상에서 제외 — 갱신하면 매칭된 행의 정체성이 바뀐다
        updatable = [c for c in columns if c not in set(keys)] or list(columns)
        updates = ", ".join(f"{self.quote(c)} = VALUES({self.quote(c)})" for c in updatable)
        return (
            f"INSERT INTO {self._qualified(table, namespace)} ({cols}) VALUES ({binds}) "
            f"ON DUPLICATE KEY UPDATE {updates}"
        )
