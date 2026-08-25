"""커넥터 팩토리.

신규 커넥터는 ``register`` 로 등록만 하면 API·Worker 양쪽에서 바로 쓰인다.
Phase 3(SAP RFC)도 여기에 추가된다.

**드라이버는 지연 임포트한다.** ``import eai_connectors`` 만으로 pyodbc·pymongo·boto3 를
전부 끌어오면 (1) 쓰지도 않는 네이티브 드라이버가 프로세스에 올라오고,
(2) macOS 에서 Celery prefork 워커가 fork() 할 때 ObjC 런타임 초기화 충돌로 죽는다.
실제로 그 커넥터를 만드는 순간에 처음 임포트한다.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .base import BaseConnector, ConnectorType, WriteSpec
from .errors import ConfigurationError

Factory = Callable[..., BaseConnector]
#: 호출 시점에 커넥터 클래스를 돌려주는 함수 — 임포트를 여기까지 미룬다
Loader = Callable[[], Factory]

_REGISTRY: dict[ConnectorType, Loader] = {}


def register(kind: ConnectorType, loader: Loader) -> None:
    _REGISTRY[kind] = loader


def supported_types() -> list[str]:
    return sorted(str(k) for k in _REGISTRY)


def build(
    kind: str | ConnectorType, config: dict[str, Any], *, write_spec: WriteSpec | None = None
) -> BaseConnector:
    """연결 설정(dict)으로 커넥터 인스턴스를 만든다.

    ``config`` 는 Connection.config(jsonb) + 복호화된 시크릿을 합친 것이다.
    알 수 없는 키는 ``extra`` 로 넘겨 드라이버별 확장을 허용한다.
    """
    try:
        ctype = ConnectorType(str(kind))
    except ValueError as exc:
        raise ConfigurationError(f"알 수 없는 커넥터 타입: {kind}") from exc

    loader = _REGISTRY.get(ctype)
    if loader is None:
        raise ConfigurationError(f"커넥터 미구현: {ctype} (현재 지원: {', '.join(supported_types())})")

    try:
        factory = loader()
    except ImportError as exc:
        # 드라이버 미설치를 설정 오류로 보고한다 — 재시도해도 소용없는 종류다
        raise ConfigurationError(
            f"{ctype} 드라이버를 불러올 수 없습니다: {exc} — 패키지와 시스템 드라이버 설치를 확인하세요"
        ) from exc

    known = _ALLOWED_KEYS[ctype]
    kwargs = {k: v for k, v in config.items() if k in known}
    extra = {k: v for k, v in config.items() if k not in known}
    if extra:
        kwargs["extra"] = extra
    if write_spec is not None:
        kwargs["write_spec"] = write_spec
    try:
        return factory(**kwargs)
    except TypeError as exc:
        raise ConfigurationError(f"{ctype} 설정이 올바르지 않습니다: {exc}") from exc


_SQL_KEYS = frozenset({"host", "port", "database", "user", "password", "pool_size", "ssl", "connect_timeout"})
_MSSQL_KEYS = _SQL_KEYS | {"odbc_driver", "trust_server_certificate"}
_MONGO_KEYS = frozenset(
    {
        "host",
        "port",
        "database",
        "user",
        "password",
        "uri",
        "auth_source",
        "replica_set",
        "ssl",
        "connect_timeout",
        "pool_size",
    }
)
_SAP_KEYS = frozenset(
    {
        "sidecar_url",
        "api_token",
        "timeout",
        "page_size",
        "verify_tls",
        # SAP 접속 정보 (방안 A) — 사이드카로 전달
        "ashost",
        "sysnr",
        "client",
        "user",
        "passwd",
        "lang",
        "mshost",
        "group",
        "sysid",
        "snc_qop",
        "snc_myname",
        "snc_partnername",
        "snc_lib",
    }
)
_S3_KEYS = frozenset(
    {
        "bucket",
        "region",
        "access_key_id",
        "secret_access_key",
        "session_token",
        "endpoint_url",
        "sse_kms_key_id",
    }
)
#: ``root`` 는 UI 필드가 아니라 서버 설정에서 주입되는 격리 루트다 (resolve_config).
_LOCAL_FILE_KEYS = frozenset({"root", "base_dir"})
#: AI 모델 — 프론트 CONNECTOR_SPECS.gemini.fields 와 키가 같아야 한다 (한쪽만 늘리면 extra 로 버려짐).
_GEMINI_KEYS = frozenset({"api_key", "model", "endpoint"})

_ALLOWED_KEYS: dict[ConnectorType, frozenset[str]] = {
    ConnectorType.MYSQL: _SQL_KEYS,
    ConnectorType.POSTGRES: _SQL_KEYS,
    ConnectorType.MSSQL: _MSSQL_KEYS,
    ConnectorType.MONGO: _MONGO_KEYS,
    ConnectorType.SAP_RFC: _SAP_KEYS,
    ConnectorType.S3: _S3_KEYS,
    ConnectorType.LOCAL_FILE: _LOCAL_FILE_KEYS,
    ConnectorType.GEMINI: _GEMINI_KEYS,
}


def _load_mysql() -> Factory:
    from .mysql import MySqlConnector

    return MySqlConnector


def _load_postgres() -> Factory:
    from .postgres import PostgresConnector

    return PostgresConnector


def _load_mssql() -> Factory:
    from .mssql import MsSqlConnector

    return MsSqlConnector


def _load_mongo() -> Factory:
    from .mongo import MongoConnector

    return MongoConnector


def _load_sap() -> Factory:
    from .sap_rfc import SapRfcConnector

    return SapRfcConnector


def _load_s3() -> Factory:
    from .s3 import S3Connector

    return S3Connector


def _load_local_file() -> Factory:
    from .local_file import LocalFileConnector

    return LocalFileConnector


def _load_gemini() -> Factory:
    from .gemini import GeminiConnector

    return GeminiConnector


register(ConnectorType.MYSQL, _load_mysql)
register(ConnectorType.POSTGRES, _load_postgres)
register(ConnectorType.MSSQL, _load_mssql)
register(ConnectorType.MONGO, _load_mongo)
register(ConnectorType.SAP_RFC, _load_sap)
register(ConnectorType.S3, _load_s3)
register(ConnectorType.LOCAL_FILE, _load_local_file)
register(ConnectorType.GEMINI, _load_gemini)
