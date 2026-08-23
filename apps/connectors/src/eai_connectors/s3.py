"""Amazon S3 타깃 커넥터.

멱등성 전략(설계 문서 §1): 오브젝트는 덮어쓸 수 없으므로 **실행 단위로 경로를 분리**한다.
  s3://bucket/<prefix>/run_id=<run_id>/part-00000.parquet
같은 Run 을 재시도하면 같은 경로에 같은 파일명으로 다시 써서 결과가 수렴한다.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Any

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from .base import (
    ConnectorType,
    HealthResult,
    HealthStatus,
    ReadSpec,
    RecordBatch,
    TableSchema,
    WriteMode,
    WriteResult,
    WriteSpec,
)
from .errors import ConfigurationError, ConnectionFailed, UnsupportedOperation, WriteFailed
from .retry import with_retry
from .serialize import SUPPORTED_FORMATS, content_type_for, extension_for, serialize

logger = logging.getLogger(__name__)


class S3Connector:
    """오브젝트 스토리지 타깃. 소스로는 사용하지 않는다 (Phase 1 범위)."""

    type = ConnectorType.S3
    #: 실행 단위 경로(run_id=)로 멱등성을 확보하는 타깃임을 표시한다.
    #: Load 노드가 이 표시로 overwrite 정리·per-batch DB truncate 여부를 가른다.
    writes_object_parts = True

    def __init__(
        self,
        *,
        bucket: str,
        region: str = "ap-northeast-2",
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        session_token: str | None = None,
        endpoint_url: str | None = None,
        sse_kms_key_id: str | None = None,
        write_spec: WriteSpec | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not bucket:
            raise ConfigurationError("bucket 은 필수입니다", connector=str(self.type))
        self.bucket = bucket
        self.region = region
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.session_token = session_token
        self.endpoint_url = endpoint_url or None
        self.sse_kms_key_id = sse_kms_key_id
        self.write_spec = write_spec or WriteSpec()
        self.extra = extra or {}
        self._client: Any = None
        self._part_no = 0

        fmt = self.write_spec.file_format
        if fmt not in SUPPORTED_FORMATS:
            raise ConfigurationError(
                f"지원하지 않는 포맷: {fmt} (가능: {sorted(SUPPORTED_FORMATS)})", connector=str(self.type)
            )

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = boto3.client(
                "s3",
                region_name=self.region,
                aws_access_key_id=self.access_key_id or None,
                aws_secret_access_key=self.secret_access_key or None,
                aws_session_token=self.session_token or None,
                endpoint_url=self.endpoint_url,
                config=BotoConfig(retries={"max_attempts": 3, "mode": "standard"}),
            )
        return self._client

    def close(self) -> None:
        self._client = None

    def __enter__(self) -> S3Connector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------ 계약 구현

    @with_retry(retry_on=(ConnectionFailed,))
    def test_connection(self) -> HealthResult:
        started = time.perf_counter()
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"403", "AccessDenied"}:
                return HealthResult(status=HealthStatus.ERROR, message="인증 필요 — 버킷 접근 권한 없음")
            if code in {"404", "NoSuchBucket"}:
                return HealthResult(status=HealthStatus.ERROR, message=f"버킷 없음: {self.bucket}")
            raise ConnectionFailed(str(exc), connector=str(self.type), cause=exc) from exc
        except BotoCoreError as exc:
            raise ConnectionFailed(str(exc), connector=str(self.type), cause=exc) from exc
        return HealthResult(
            status=HealthStatus.OK,
            message="연결 정상",
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )

    def discover_schema(
        self, table: str | None = None, *, include_pk: bool = True, include_columns: bool = True
    ) -> list[TableSchema]:
        """오브젝트 스토리지는 스키마가 없다. 최상위 prefix 를 '테이블'처럼 노출한다."""
        try:
            paginator = self.client.get_paginator("list_objects_v2")
            prefixes: list[str] = []
            for page in paginator.paginate(Bucket=self.bucket, Delimiter="/"):
                prefixes.extend(cp["Prefix"].rstrip("/") for cp in page.get("CommonPrefixes", []))
        except (ClientError, BotoCoreError) as exc:
            raise ConnectionFailed(str(exc), connector=str(self.type), cause=exc) from exc
        if table:
            prefixes = [p for p in prefixes if p == table.strip("/")]
        return [TableSchema(name=p, columns=[], namespace=self.bucket) for p in prefixes]

    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        raise UnsupportedOperation("S3 는 Phase 1 에서 타깃 전용입니다", connector=str(self.type))

    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult:
        if mode is WriteMode.UPSERT:
            raise UnsupportedOperation(
                "S3 는 upsert 를 지원하지 않습니다 — append 또는 overwrite 를 쓰세요",
                connector=str(self.type),
            )
        if not batch.rows:
            return WriteResult(records_written=0, location=self._run_prefix())

        fmt = self.write_spec.file_format
        key = f"{self._run_prefix()}/part-{self._part_no:05d}.{extension_for(fmt)}"
        payload = serialize(fmt, batch.rows, batch.columns)
        self._part_no += 1

        extra: dict[str, Any] = {"ContentType": content_type_for(fmt)}
        if self.sse_kms_key_id:
            extra["ServerSideEncryption"] = "aws:kms"
            extra["SSEKMSKeyId"] = self.sse_kms_key_id

        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=payload, **extra)
        except (ClientError, BotoCoreError) as exc:
            raise WriteFailed(f"{key} 업로드 실패: {exc}", connector=str(self.type), cause=exc) from exc

        location = f"s3://{self.bucket}/{key}"
        logger.info("S3 적재 완료: %s (%d rows, %d bytes)", location, len(batch.rows), len(payload))
        return WriteResult(
            records_written=len(batch.rows),
            location=location,
            details={"bytes": len(payload), "format": self.write_spec.file_format, "mode": str(mode)},
        )

    def purge_run_prefix(self) -> int:
        """overwrite 재시도 시 이전 파트를 정리한다. 삭제한 오브젝트 수를 돌려준다."""
        prefix = self._run_prefix() + "/"
        deleted = 0
        try:
            paginator = self.client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
                if keys:
                    self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": keys})
                    deleted += len(keys)
        except (ClientError, BotoCoreError) as exc:
            raise WriteFailed(f"{prefix} 정리 실패: {exc}", connector=str(self.type), cause=exc) from exc
        self._part_no = 0
        return deleted

    # -------------------------------------------------------------- 내부 헬퍼

    def _run_prefix(self) -> str:
        parts = [(self.write_spec.path_prefix or "").strip("/")]
        if self.write_spec.table:
            parts.append(self.write_spec.table)
        if self.write_spec.run_id:
            parts.append(f"run_id={self.write_spec.run_id}")
        return "/".join(p for p in parts if p)

