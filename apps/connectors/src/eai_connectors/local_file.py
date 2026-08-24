"""로컬 파일 타깃 커넥터 — 주로 테스트/디버깅용.

S3 타깃과 멱등성 전략이 같다: 오브젝트를 덮어쓰지 않고 **실행 단위로 경로를 분리**한다.
  <root>/<base_dir>/<prefix>/run_id=<run_id>/part-00000.parquet
같은 Run 을 재시도하면 같은 경로에 같은 파일명으로 다시 써서 결과가 수렴한다.

**보안:** 모든 쓰기는 시스템이 정한 ``root`` 아래로 강제 격리된다. root 는 연결에
저장되지 않고 실행 시점에 서버 설정에서 주입된다(connection_service.resolve_config).
연결이 넘긴 ``base_dir``·노드의 ``path_prefix`` 가 ``..`` 나 절대경로로 root 를 벗어나면
쓰기를 거부한다 — 워커 프로세스가 파일시스템 아무 데나 쓰지 못하게 하기 위해서다.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

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
from .errors import ConfigurationError, UnsupportedOperation, WriteFailed
from .serialize import SUPPORTED_FORMATS, extension_for, serialize

logger = logging.getLogger(__name__)


class LocalFileConnector:
    """로컬 파일시스템 타깃. 소스로는 사용하지 않는다 (S3 와 동일)."""

    type = ConnectorType.LOCAL_FILE
    #: 실행 단위 경로(run_id=)로 멱등성을 확보하는 타깃임을 표시한다 (S3 와 동일).
    #: Load 노드가 이 표시로 overwrite 정리·per-batch DB truncate 여부를 가른다.
    writes_object_parts = True

    def __init__(
        self,
        *,
        root: str = "",
        base_dir: str = "",
        write_spec: WriteSpec | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if not root:
            raise ConfigurationError(
                "파일 저장 루트(root)가 설정되지 않았습니다 — 서버 EAI_LOCAL_FILE_ROOT 를 확인하세요",
                connector=str(self.type),
            )
        self.root = Path(root).expanduser()
        self.base_dir = str(base_dir or "").strip().strip("/")
        self.write_spec = write_spec or WriteSpec()
        self.extra = extra or {}
        self._part_no = 0

        fmt = self.write_spec.file_format
        if fmt not in SUPPORTED_FORMATS:
            raise ConfigurationError(
                f"지원하지 않는 포맷: {fmt} (가능: {sorted(SUPPORTED_FORMATS)})", connector=str(self.type)
            )

    def close(self) -> None:
        pass

    def __enter__(self) -> LocalFileConnector:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------ 계약 구현

    def test_connection(self) -> HealthResult:
        started = time.perf_counter()
        base = self._base_dir()
        try:
            base.mkdir(parents=True, exist_ok=True)
            probe = base / ".eai_write_test"
            probe.write_bytes(b"ok")
            probe.unlink()
        except OSError as exc:
            return HealthResult(status=HealthStatus.ERROR, message=f"쓰기 불가 ({base}): {exc}")
        return HealthResult(
            status=HealthStatus.OK,
            message=f"쓰기 가능: {base}",
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
        )

    def discover_schema(
        self, table: str | None = None, *, include_pk: bool = True, include_columns: bool = True
    ) -> list[TableSchema]:
        """파일 타깃은 스키마가 없다 — 목록을 비워 돌려준다 (타깃 전용)."""
        return []

    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]:
        raise UnsupportedOperation("로컬 파일은 타깃 전용입니다", connector=str(self.type))

    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult:
        if mode is WriteMode.UPSERT:
            raise UnsupportedOperation(
                "로컬 파일은 upsert 를 지원하지 않습니다 — append 또는 overwrite 를 쓰세요",
                connector=str(self.type),
            )
        run_dir = self._run_dir()
        if not batch.rows:
            return WriteResult(records_written=0, location=str(run_dir))

        fmt = self.write_spec.file_format
        try:
            run_dir.mkdir(parents=True, exist_ok=True)
            path = run_dir / f"part-{self._part_no:05d}.{extension_for(fmt)}"
            payload = serialize(fmt, batch.rows, batch.columns)
            path.write_bytes(payload)
        except OSError as exc:
            raise WriteFailed(f"{run_dir} 쓰기 실패: {exc}", connector=str(self.type), cause=exc) from exc
        self._part_no += 1

        logger.info("로컬 파일 적재: %s (%d rows, %d bytes)", path, len(batch.rows), len(payload))
        return WriteResult(
            records_written=len(batch.rows),
            location=str(path),
            details={"bytes": len(payload), "format": fmt, "mode": str(mode)},
        )

    def purge_run_prefix(self) -> int:
        """overwrite 재시도 시 이 실행의 이전 파트를 정리한다. 지운 파일 수를 돌려준다.

        run_id 로 좁혀진 디렉터리의 ``part-*`` 파일만 지운다 — 임의 경로는 건드리지 않는다.
        """
        run_dir = self._run_dir()
        self._part_no = 0
        if not run_dir.exists():
            return 0
        removed = 0
        for child in sorted(run_dir.glob(f"part-*.{extension_for(self.write_spec.file_format)}")):
            if child.is_file():
                try:
                    child.unlink()
                except OSError as exc:
                    raise WriteFailed(
                        f"{child} 정리 실패: {exc}", connector=str(self.type), cause=exc
                    ) from exc
                removed += 1
        return removed

    # -------------------------------------------------------------- 내부 헬퍼

    def _base_dir(self) -> Path:
        """root/base_dir — 루트 안에 있음을 보장한다."""
        return self._confine(self.root / self.base_dir if self.base_dir else self.root)

    def _run_dir(self) -> Path:
        """이 실행이 파일을 쓸 디렉터리. S3 의 _run_prefix 와 같은 규칙."""
        path = self.root
        if self.base_dir:
            path = path / self.base_dir
        prefix = (self.write_spec.path_prefix or "").strip("/")
        if prefix:
            path = path / prefix
        if self.write_spec.table:
            path = path / self.write_spec.table
        if self.write_spec.run_id:
            path = path / f"run_id={self.write_spec.run_id}"
        return self._confine(path)

    def _confine(self, path: Path) -> Path:
        """resolve 후 root 아래인지 확인한다. 벗어나면 거부.

        Path 조인은 절대경로/``..`` 를 그대로 반영하므로(``/root`` / ``/etc`` → ``/etc``),
        resolve 결과가 root 밖이면 경로 조작으로 보고 막는다.
        """
        root = self.root.resolve()
        resolved = path.resolve()
        if resolved != root and root not in resolved.parents:
            raise WriteFailed(
                f"저장 경로가 허용된 루트를 벗어납니다: {resolved} (루트: {root})", connector=str(self.type)
            )
        return resolved
