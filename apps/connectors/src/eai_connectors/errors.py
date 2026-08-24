"""도메인 예외. 드라이버 예외는 전부 여기로 래핑해서 올린다."""

from __future__ import annotations


class ConnectorError(Exception):
    """커넥터 계층의 모든 예외의 뿌리."""

    def __init__(
        self, message: str, *, connector: str | None = None, cause: BaseException | None = None
    ) -> None:
        super().__init__(message)
        self.connector = connector
        self.__cause__ = cause

    def __str__(self) -> str:
        base = super().__str__()
        return f"[{self.connector}] {base}" if self.connector else base


class ConnectionFailed(ConnectorError):
    """접속 자체가 실패 (네트워크·인증·DNS)."""


class SchemaDiscoveryFailed(ConnectorError):
    """스키마 탐색 실패."""


class ReadFailed(ConnectorError):
    """소스 읽기 실패."""


class WriteFailed(ConnectorError):
    """타깃 적재 실패."""


class ConfigurationError(ConnectorError):
    """커넥터 설정이 잘못됨 — 재시도해도 소용없는 종류."""


class UnsupportedOperation(ConnectorError):
    """해당 커넥터가 지원하지 않는 동작 (예: S3 소스 read)."""


#: 재시도해도 의미 없는 예외들. retry 데코레이터가 즉시 포기한다.
NON_RETRYABLE: tuple[type[ConnectorError], ...] = (ConfigurationError, UnsupportedOperation)
