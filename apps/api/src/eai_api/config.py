"""환경설정. 시크릿 원문은 절대 기본값으로 두지 않는다."""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: HS256 서명 키 최소 길이 (RFC 7518 §3.2 — 해시 출력 길이 이상이어야 한다)
MIN_JWT_SECRET_BYTES = 32


class SecretBackend(StrEnum):
    LOCAL = "local"
    AWS_KMS = "aws_kms"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EAI_", env_file=".env", extra="ignore")

    app_name: str = "EAI Platform API"
    environment: str = "local"
    debug: bool = False

    # 큐 모드는 PostgreSQL + Redis 필수 (설계 문서 §6). SQLite 는 허용하지 않는다.
    database_url: str = "postgresql+psycopg://eai:eai@localhost:5432/eai"
    db_pool_size: int = 10
    db_echo: bool = False

    redis_url: str = "redis://localhost:6379/0"
    celery_queue: str = "eai.default"

    secret_backend: SecretBackend = SecretBackend.LOCAL
    local_secret_key: str = Field(default="", description="Fernet 키 (local 백엔드)")
    kms_key_id: str = ""

    jwt_secret: str = Field(default="", description="토큰 서명 키")
    jwt_algorithm: str = "HS256"
    jwt_ttl_seconds: int = 8 * 3600
    auth_enabled: bool = True

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]

    # 소스 미리보기 상한 — UI 에서 임의로 대용량을 끌어오지 못하게 한다
    preview_row_limit: int = 100

    # 커스텀 SQL 쿼리 테스트(DBeaver 식) 결과 행 상한. 미리보기보다 넉넉하게 둔다.
    query_row_limit: int = 500

    # MongoDB find 결과 문서 상한(페이지당). 문서가 중첩 구조로 커질 수 있어 SQL 보다 훨씬 작게.
    mongo_find_limit: int = 50

    # 결과 내보내기(파일 저장) 최대 행 수. 스트리밍이라 메모리는 안전하지만 폭주 방지용 상한.
    export_row_limit: int = 200_000

    # --- DuckDB 연합 조회 (이기종 조인) ---
    # DuckDB 는 API 프로세스 안에서 돈다. 조인이 커지면 그 메모리를 API 가 그대로 쓰므로
    # 상한을 둔다 — 넘으면 DuckDB 가 디스크로 흘리거나 실패시킨다(프로세스가 죽지 않는다).
    duckdb_memory_limit: str = "1GB"

    # 폐쇄망 배포용 확장 디렉터리. 비워 두면 첫 조회 때 확장 저장소에서 내려받는다
    # (postgres·mysql). 네트워크가 막힌 곳은 미리 받아 두고 이 경로를 지정한다.
    duckdb_extension_dir: str | None = None

    # SAP 사이드카 기본 주소. SAP 연결이 sidecar_url 을 비워두면 이 값을 쓴다 —
    # 사이드카가 하나뿐인 보통의 경우, 연결마다 주소를 반복 입력하지 않아도 된다.
    # 연결에 명시적으로 넣은 값이 있으면 그게 우선한다(드물게 사이드카가 여러 개인 경우).
    sap_default_sidecar_url: str = "http://sap-connector:8100"

    # 로컬 파일 타깃이 쓰는 격리 루트. 모든 파일은 이 디렉터리 아래에만 생성된다 —
    # 연결/노드가 지정하는 경로가 이 밖으로 나가면 워커가 쓰기를 거부한다.
    # 연결에 저장하지 않고 실행 시점에 주입하므로, 운영이 바꾸면 기존 연결도 따라간다.
    local_file_root: str = "/tmp/eai-exports"

    # --- Phase 4 CDC ---
    # Kafka Connect(Debezium) REST 주소. 스트림을 켜면 여기에 커넥터를 등록한다.
    # compose 의 debezium 서비스(profile cdc)와 짝이다.
    debezium_url: str = "http://debezium:8083"
    debezium_timeout_seconds: int = 30
    # Debezium 커넥터가 스키마 이력·오프셋을 저장할 Kafka. compose 의 kafka 서비스.
    kafka_bootstrap_servers: str = "kafka:9092"

    # --- 실시간 DB 동기화 (SymmetricDS) ---
    # 사이드카 REST 주소. 설정 자체는 원본 DB 의 SYM_* 테이블에 우리가 직접 넣으므로
    # 이 주소는 "방금 넣은 설정을 지금 반영하라"(synctriggers)에만 쓴다 —
    # 닿지 않아도 sync-triggers 잡이 다음 주기에 반영하므로 경고로 끝난다.
    symmetric_url: str = "http://symmetricds:31415"
    symmetric_timeout_seconds: int = 30
    # 사이드카 engines/*.properties 의 engine.name 과 **반드시 같아야 한다.**
    # 어긋나면 REST 반영만 조용히 실패하고(설정은 들어가고 트리거만 늦게 생긴다)
    # 원인을 찾기 어렵다 — preflight 가 엔진 목록으로 대조한다.
    symmetric_source_engine: str = "eai-source"
    symmetric_target_engine: str = "eai-target"
    # SymmetricDS 가 원본 DB 에 만드는 설정/데이터 테이블 접두어
    # (사이드카 properties 의 sync.table.prefix 와 같아야 한다).
    symmetric_table_prefix: str = "SYM"

    @field_validator("database_url")
    @classmethod
    def _reject_sqlite(cls, v: str) -> str:
        if v.startswith("sqlite"):
            raise ValueError("큐 모드에서는 SQLite 를 쓸 수 없습니다 — PostgreSQL 을 지정하세요")
        return v

    @model_validator(mode="after")
    def _require_strong_jwt_secret(self) -> Settings:
        """인증을 켰다면 서명 키가 HS256 최소 길이(RFC 7518 §3.2)를 넘어야 한다.

        짧은 키는 서명을 위조당할 수 있다. 기동 시점에 막지 않으면 아무도 눈치채지 못한다.
        """
        if not self.auth_enabled:
            return self
        if not self.jwt_secret:
            raise ValueError("EAI_JWT_SECRET 이 필요합니다 (또는 EAI_AUTH_ENABLED=false)")
        if len(self.jwt_secret.encode()) < MIN_JWT_SECRET_BYTES:
            raise ValueError(
                f"EAI_JWT_SECRET 은 최소 {MIN_JWT_SECRET_BYTES}바이트여야 합니다 "
                "— `openssl rand -hex 32` 로 생성하세요"
            )
        return self

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
