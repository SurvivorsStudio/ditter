"""EAI 커넥터 라이브러리 — api / worker 가 공유한다.

커넥터 **구현체는 지연 로딩**된다 (PEP 562). ``from eai_connectors import MongoConnector`` 는
그대로 동작하지만, 단순히 ``import eai_connectors`` 만 해서는 pyodbc·pymongo·boto3 가
프로세스에 올라오지 않는다. 이유는 registry.py 의 모듈 도크스트링 참고.
"""

from typing import TYPE_CHECKING, Any

from .base import (
    BaseConnector,
    ColumnSchema,
    ConnectorType,
    DbObject,
    HealthResult,
    HealthStatus,
    IndexInfo,
    ObjectDetail,
    ReadSpec,
    RecordBatch,
    TableSchema,
    WriteMode,
    WriteResult,
    WriteSpec,
)
from .errors import (
    ConfigurationError,
    ConnectionFailed,
    ConnectorError,
    ReadFailed,
    SchemaDiscoveryFailed,
    UnsupportedOperation,
    WriteFailed,
)
from .registry import build, register, supported_types

if TYPE_CHECKING:  # 타입 검사기와 IDE 에는 실제 심볼을 보여준다
    from .bedrock import BedrockConnector
    from .gemini import GeminiConnector
    from .local_file import LocalFileConnector
    from .mongo import MongoConnector
    from .mssql import MsSqlConnector
    from .mysql import MySqlConnector
    from .ollama import OllamaConnector
    from .postgres import PostgresConnector
    from .s3 import S3Connector
    from .sap_rfc import SapRfcConnector

#: 지연 로딩 대상 — 속성 접근 시점에 해당 모듈을 임포트한다
_LAZY: dict[str, str] = {
    "BedrockConnector": ".bedrock",
    "GeminiConnector": ".gemini",
    "LocalFileConnector": ".local_file",
    "MongoConnector": ".mongo",
    "MsSqlConnector": ".mssql",
    "MySqlConnector": ".mysql",
    "OllamaConnector": ".ollama",
    "PostgresConnector": ".postgres",
    "S3Connector": ".s3",
    "SapRfcConnector": ".sap_rfc",
}


def __getattr__(name: str) -> Any:
    module_name = _LAZY.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from importlib import import_module

    return getattr(import_module(module_name, __name__), name)


def __dir__() -> list[str]:
    return sorted(__all__)


__all__ = [
    "BaseConnector",
    "ColumnSchema",
    "ConfigurationError",
    "ConnectionFailed",
    "ConnectorError",
    "ConnectorType",
    "BedrockConnector",
    "DbObject",
    "GeminiConnector",
    "HealthResult",
    "HealthStatus",
    "IndexInfo",
    "ObjectDetail",
    "LocalFileConnector",
    "MongoConnector",
    "MsSqlConnector",
    "MySqlConnector",
    "OllamaConnector",
    "PostgresConnector",
    "ReadFailed",
    "ReadSpec",
    "RecordBatch",
    "S3Connector",
    "SapRfcConnector",
    "SchemaDiscoveryFailed",
    "TableSchema",
    "UnsupportedOperation",
    "WriteFailed",
    "WriteMode",
    "WriteResult",
    "WriteSpec",
    "build",
    "register",
    "supported_types",
]
