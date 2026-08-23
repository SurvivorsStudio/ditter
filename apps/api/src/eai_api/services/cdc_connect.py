"""Kafka Connect(Debezium) REST 클라이언트 + 커넥터 설정 빌더 (Phase 4b).

기획안 §6.2. 스트림을 켜면 Debezium REST(:8083)에 커넥터 설정(JSON)을 등록하고,
정지하면 삭제한다. SAP 사이드카(``sap_rfc.py``)가 HTTP 게이트웨이를 다룬 방식을 그대로 따른다 —
접속 정보는 연결에서 복호화해 커넥터 설정으로 넘기고, 이 계층은 SAP 도 SDK 도 모른다.

**설계 메모**
- 커넥터 이름은 ``eai.<stream_id>`` 로 고정한다. 재시작·중복 등록을 막는 유일 키다.
- topic.prefix 는 Kafka 토픽 이름의 일부라 영숫자·언더스코어만 허용된다 — uuid 의 하이픈을
  언더스코어로 바꿔 ``eai_<stream_id>`` 로 만든다.
- 비밀번호는 Kafka Connect 설정에 평문으로 저장된다(Debezium 의 알려진 한계). 로그에 남기지
  않으며, 운영 전환 시 config provider 로 externalize 한다 (Phase 5).
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import urllib3

from ..config import get_settings
from .errors import DependencyError, ValidationError

logger = logging.getLogger(__name__)

#: 커넥터 이름 접두 — 목록에서 우리 것만 골라내는 데도 쓴다
CONNECTOR_PREFIX = "eai."

#: 노드 종류(source.cdc.*) → Debezium 커넥터 클래스
_CONNECTOR_CLASS = {
    "mysql": "io.debezium.connector.mysql.MySqlConnector",
    "postgres": "io.debezium.connector.postgresql.PostgresConnector",
    "mssql": "io.debezium.connector.sqlserver.SqlServerConnector",
}

#: 소스 타입별 기본 포트
_DEFAULT_PORT = {"mysql": 3306, "postgres": 5432, "mssql": 1433}

#: 우리 삭제 처리 방식 → Debezium ExtractNewRecordState SMT 설정 (기획안 §5.2)
#: soft   = 삭제된 행을 __deleted=true 로 남긴다 (기본)
#: hard   = 삭제 이벤트를 tombstone 으로 흘려 Sink 가 실제 삭제하게 한다
#: ignore = 삭제 이벤트를 아예 버린다
_DELETE_SMT = {
    "soft": {"delete.handling.mode": "rewrite", "drop.tombstones": "true"},
    "hard": {"delete.handling.mode": "none", "drop.tombstones": "false"},
    "ignore": {"delete.handling.mode": "drop", "drop.tombstones": "true"},
}


def connector_name(stream_id: str) -> str:
    return f"{CONNECTOR_PREFIX}{stream_id}"


def topic_prefix(stream_id: str) -> str:
    """Kafka 토픽 접두. 하이픈은 토픽 이름에 쓸 수 없어 언더스코어로 바꾼다."""
    return "eai_" + stream_id.replace("-", "_")


def _server_id(stream_id: str) -> int:
    """MySQL binlog 클라이언트에 필요한 유일 server_id.

    복제 클라이언트마다 달라야 하므로 stream_id 로부터 결정적으로 유도한다
    (5400~6399). 같은 스트림은 재시작해도 같은 값을 갖는다.
    """
    digest = hashlib.md5(stream_id.encode()).hexdigest()
    return 5400 + int(digest, 16) % 1000


def _qualified_tables(source_type: str, database: str, tables: list[str]) -> list[str]:
    """table.include.list 용 정규화된 이름. 이미 점이 있으면 그대로 둔다.

    MySQL 은 ``db.table``, PostgreSQL 은 ``schema.table``(기본 public),
    SQL Server 는 ``schema.table``(기본 dbo) 형식이다. SQL Server 의 토픽·include.list 는
    모두 2단계(schema.table)라 PostgreSQL 과 같은 규칙을 쓰되 기본 스키마만 dbo 로 바뀐다.
    """
    if source_type == "mysql":
        default_ns = database
    elif source_type == "mssql":
        default_ns = "dbo"
    else:  # postgres
        default_ns = "public"
    out = []
    for t in tables:
        name = str(t).strip()
        if not name:
            continue
        out.append(name if "." in name else f"{default_ns}.{name}")
    return out


def _topic_qualified_tables(source_type: str, database: str, tables: list[str]) -> list[str]:
    """토픽 이름에 들어가는 정규화 이름.

    대부분은 ``table.include.list`` 와 같은 정규화(_qualified_tables)를 쓰지만,
    **SQL Server 만 예외**다: include.list 는 ``schema.table`` 인데 토픽은 DB 를 한 단계 더 붙인
    ``database.schema.table`` 로 발행한다 (Debezium: ``{prefix}.{db}.{schema}.{table}``).
    include.list 에 DB 를 넣으면 오히려 매칭이 깨지므로 둘을 갈라야 한다.
    """
    qualified = _qualified_tables(source_type, database, tables)
    if source_type != "mssql":
        return qualified
    # 이미 db.schema.table(3단계 이상)로 준 경우는 그대로 두고, schema.table(2단계)에만 DB 를 붙인다.
    return [q if q.count(".") >= 2 else f"{database}.{q}" for q in qualified]


def topics_for(stream_id: str, source_type: str, database: str, tables: list[str]) -> list[str]:
    """Sink 가 구독할 토픽 이름. Debezium 은 ``{prefix}.{qualified_table}`` 로 발행한다.

    MySQL 은 ``{prefix}.{db}.{table}``, PostgreSQL 은 ``{prefix}.{schema}.{table}``,
    SQL Server 는 ``{prefix}.{db}.{schema}.{table}`` (DB 를 한 단계 더 포함) 이다.
    """
    prefix = topic_prefix(stream_id)
    return [f"{prefix}.{q}" for q in _topic_qualified_tables(source_type, database, tables)]


def build_connector_config(
    *,
    stream_id: str,
    source_type: str,
    connection: dict[str, Any],
    tables: list[str],
    snapshot: str = "initial",
    delete_mode: str = "soft",
    kafka_bootstrap_servers: str = "kafka:9092",
) -> dict[str, Any]:
    """Debezium 커넥터 설정(JSON)을 만든다.

    ``connection`` 은 ``connection_service.resolve_config`` 가 돌려준, 복호화된 시크릿까지
    합쳐진 dict 다 (host/port/user/password/database …). 순수 함수로 두기 위해
    ``kafka_bootstrap_servers`` 는 전역 설정을 읽지 않고 인자로 받는다.
    """
    if source_type not in _CONNECTOR_CLASS:
        raise ValidationError(
            f"CDC 를 지원하지 않는 소스 타입: {source_type} (mysql | postgres | mssql)"
        )
    if not tables:
        raise ValidationError("캡처할 테이블이 최소 하나 필요합니다")
    if delete_mode not in _DELETE_SMT:
        raise ValidationError(f"알 수 없는 삭제 처리 방식: {delete_mode}")

    database = str(connection.get("database", ""))
    if not database:
        raise ValidationError("연결에 database 가 지정되어 있지 않습니다")

    prefix = topic_prefix(stream_id)
    include_list = ",".join(_qualified_tables(source_type, database, tables))

    # 어느 소스든 공통: 접속 정보 + 토픽 접두 + 캡처 테이블 + 삭제 처리 SMT
    config: dict[str, Any] = {
        "connector.class": _CONNECTOR_CLASS[source_type],
        "tasks.max": "1",
        "topic.prefix": prefix,
        # Sink 은 평평한 JSON 행을 기대한다. Connect 워커 기본값(schemas.enable=true)은 메시지를
        # {"schema":…, "payload":…} 봉투로 감싸버려, sink 가 payload 를 컬럼으로 착각해
        # `INSERT INTO t (schema, payload)` 로 깨진다. 커넥터마다 스키마 포함을 명시로 끈다.
        "key.converter": "org.apache.kafka.connect.json.JsonConverter",
        "key.converter.schemas.enable": "false",
        "value.converter": "org.apache.kafka.connect.json.JsonConverter",
        "value.converter.schemas.enable": "false",
        "database.hostname": str(connection.get("host", "")),
        "database.port": str(connection.get("port", _DEFAULT_PORT[source_type])),
        "database.user": str(connection.get("user", "")),
        "database.password": str(connection.get("password", "")),
        "table.include.list": include_list,
        "snapshot.mode": _snapshot_for(source_type, snapshot),
        # 평평한 after-이미지로 풀어 Sink 가 다루기 쉽게 한다. 삭제는 아래 SMT 설정이 좌우한다.
        "transforms": "unwrap",
        "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
        "transforms.unwrap.add.fields": "op,ts_ms",
        **{f"transforms.unwrap.{k}": v for k, v in _DELETE_SMT[delete_mode].items()},
    }

    if source_type == "mysql":
        config.update(
            {
                "database.server.id": str(_server_id(stream_id)),
                "database.include.list": database,
                # MySQL 커넥터는 스키마 변경 이력을 Kafka 에 남긴다
                "schema.history.internal.kafka.bootstrap.servers": kafka_bootstrap_servers,
                "schema.history.internal.kafka.topic": f"schema-history.{prefix}",
            }
        )
    elif source_type == "mssql":
        # SQL Server 커넥터는 소스 DB 에 CDC 가 켜져 있어야 한다
        # (sys.sp_cdc_enable_db + 테이블별 sys.sp_cdc_enable_table, SQL Server Agent 실행).
        # 이는 운영 전제조건이라 설정이 아니라 preflight/문서로 안내한다.
        config.update(
            {
                # 2.x 는 다중 DB 를 위해 database.dbname 대신 database.names(복수) 를 쓴다.
                "database.names": database,
                # MS JDBC 드라이버 10+ 는 encrypt 기본값이 true 라 사내 자체서명 인증서에서 실패한다.
                # 연결의 ssl 플래그를 따르고, 켜더라도 인증서 검증은 연결 설정에 맡긴다.
                "database.encrypt": "true" if connection.get("ssl") else "false",
                # MySQL 처럼 스키마 변경 이력을 Kafka 에 남긴다
                "schema.history.internal.kafka.bootstrap.servers": kafka_bootstrap_servers,
                "schema.history.internal.kafka.topic": f"schema-history.{prefix}",
            }
        )
        # 사내 SQL Server 는 자체서명 인증서가 흔하다 — 연결이 신뢰를 켜뒀으면 드라이버에 전달한다.
        if connection.get("trust_server_certificate", True):
            config["database.trustServerCertificate"] = "true"
    else:  # postgres
        config.update(
            {
                "database.dbname": database,
                "plugin.name": "pgoutput",
                # 슬롯·퍼블리케이션 이름도 스트림마다 유일해야 서로 간섭하지 않는다
                "slot.name": prefix,
                "publication.name": f"{prefix}_pub",
            }
        )
    return config


def _snapshot_for(source_type: str, snapshot: str) -> str:
    """스냅샷 모드를 커넥터별 유효값으로 옮긴다.

    PostgreSQL 커넥터에는 ``when_needed`` 가 없다 — 가장 가까운 ``initial`` 로 낮춘다.
    SQL Server 커넥터에는 ``never`` 가 없다 — 스냅샷 없이 스트리밍만 하는 ``no_data`` 로 옮긴다.
    """
    if source_type == "postgres" and snapshot == "when_needed":
        logger.info("PostgreSQL 은 when_needed 스냅샷이 없어 initial 로 대체합니다")
        return "initial"
    if source_type == "mssql" and snapshot == "never":
        logger.info("SQL Server 는 never 스냅샷이 없어 no_data 로 대체합니다")
        return "no_data"
    return snapshot


# --------------------------------------------------------------- REST 클라이언트


@dataclass
class DebeziumClient:
    """Kafka Connect REST 래퍼. 테스트는 ``http`` 에 가짜 transport 를 주입한다."""

    base_url: str
    timeout: int = 30
    http: Any = field(default=None)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        if self.http is None:
            self.http = urllib3.PoolManager(
                retries=False, timeout=urllib3.Timeout(connect=5, read=self.timeout)
            )

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        encoded = json.dumps(body).encode("utf-8") if body is not None else None
        try:
            resp = self.http.request(method, f"{self.base_url}{path}", body=encoded, headers=headers)
        except urllib3.exceptions.HTTPError as exc:
            raise DependencyError(f"Kafka Connect 에 연결할 수 없습니다 ({self.base_url}): {exc}") from exc

        payload: Any = None
        if getattr(resp, "data", None):
            try:
                payload = json.loads(resp.data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                payload = {"message": resp.data[:500].decode("utf-8", "replace")}
        return resp.status, payload

    def _ok(self, status: int, payload: Any, action: str) -> Any:
        if status >= 400:
            detail = ""
            if isinstance(payload, dict):
                detail = str(payload.get("message") or payload.get("detail") or payload)
            raise DependencyError(f"Debezium {action} 실패 ({status}): {detail}")
        return payload

    # PUT /connectors/{name}/config 는 없으면 만들고 있으면 갱신한다 (멱등)
    def put_connector(self, name: str, config: dict[str, Any]) -> Any:
        status, payload = self._request("PUT", f"/connectors/{name}/config", config)
        return self._ok(status, payload, f"커넥터 등록({name})")

    def pause(self, name: str) -> None:
        status, payload = self._request("PUT", f"/connectors/{name}/pause")
        self._ok(status, payload, f"일시정지({name})")

    def resume(self, name: str) -> None:
        status, payload = self._request("PUT", f"/connectors/{name}/resume")
        self._ok(status, payload, f"재개({name})")

    def delete(self, name: str) -> None:
        status, payload = self._request("DELETE", f"/connectors/{name}")
        # 이미 없으면 성공으로 친다 — 정지는 멱등이어야 한다
        if status == 404:
            logger.info("커넥터 %s 가 이미 없습니다 — 정지를 성공으로 처리합니다", name)
            return
        self._ok(status, payload, f"삭제({name})")

    def status(self, name: str) -> dict[str, Any]:
        status, payload = self._request("GET", f"/connectors/{name}/status")
        if status == 404:
            return {"connector": {"state": "GONE"}, "tasks": []}
        result = self._ok(status, payload, f"상태조회({name})")
        return result if isinstance(result, dict) else {}


_client: DebeziumClient | None = None


def get_debezium_client() -> DebeziumClient:
    """프로세스 공용 클라이언트. 테스트는 이 함수를 monkeypatch 한다 (get_celery 패턴)."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = DebeziumClient(settings.debezium_url, timeout=settings.debezium_timeout_seconds)
    return _client
