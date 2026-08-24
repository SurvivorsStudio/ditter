"""Microsoft SQL Server 커넥터 (pyodbc).

드라이버 주의: ``pyodbc`` 는 시스템에 ODBC 드라이버가 설치되어 있어야 한다.
컨테이너에는 ``msodbcsql18`` 을 넣는다 (apps/*/Dockerfile 참고).
드라이버 이름은 ``config.odbc_driver`` 로 덮어쓸 수 있다.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .base import ConnectorType
from .errors import ConfigurationError
from .sql_base import SqlConnector

DEFAULT_ODBC_DRIVER = "ODBC Driver 18 for SQL Server"


class MsSqlConnector(SqlConnector):
    type = ConnectorType.MSSQL
    default_port = 1433

    def __init__(
        self,
        *,
        odbc_driver: str | None = None,
        trust_server_certificate: bool = True,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.odbc_driver = odbc_driver or DEFAULT_ODBC_DRIVER
        self.trust_server_certificate = trust_server_certificate

    @property
    def drivername(self) -> str:
        return "mssql+pyodbc"

    def url_query(self) -> dict[str, str]:
        query = {"driver": self.odbc_driver}
        # 사내 SQL Server 는 자체 서명 인증서를 쓰는 경우가 많다.
        # 운영에서 검증이 필요하면 trust_server_certificate=False 로 명시적으로 끈다.
        query["TrustServerCertificate"] = "yes" if self.trust_server_certificate else "no"
        query["Encrypt"] = "yes" if self.ssl else "no"
        return query

    def connect_args(self) -> dict[str, Any]:
        return {"timeout": self.connect_timeout}

    def version_sql(self) -> str:
        return "SELECT @@VERSION"

    def _upsert_sql(
        self, table: str, namespace: str | None, columns: Sequence[str], keys: Sequence[str]
    ) -> str:
        """T-SQL 에는 upsert 구문이 없다 — MERGE 로 만든다.

        MERGE 는 마지막에 세미콜론이 **필수**다. 빠뜨리면 문법 오류가 난다.
        """
        if not keys:
            raise ConfigurationError("upsert 는 key_columns 가 필요합니다", connector=str(self.type))

        target = self._qualified(table, namespace)
        q = self.quote
        source_cols = ", ".join(f":{c} AS {q(c)}" for c in columns)
        on_clause = " AND ".join(f"target.{q(k)} = source.{q(k)}" for k in keys)
        insert_cols = ", ".join(q(c) for c in columns)
        insert_vals = ", ".join(f"source.{q(c)}" for c in columns)

        updatable = [c for c in columns if c not in set(keys)]
        matched = (
            f"WHEN MATCHED THEN UPDATE SET {', '.join(f'target.{q(c)} = source.{q(c)}' for c in updatable)} "
            if updatable
            else ""
        )
        return (
            f"MERGE INTO {target} AS target "
            f"USING (SELECT {source_cols}) AS source ON {on_clause} "
            f"{matched}"
            f"WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals});"
        )
