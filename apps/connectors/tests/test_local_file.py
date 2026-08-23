"""로컬 파일 타깃 커넥터 테스트.

멱등성(run_id 경로 분리)·overwrite 정리·포맷 직렬화·루트 격리를 확인한다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eai_connectors import LocalFileConnector, WriteMode
from eai_connectors.base import RecordBatch, WriteSpec
from eai_connectors.errors import UnsupportedOperation, WriteFailed

ROWS = [
    {"id": 1, "name": "가", "amount": 10},
    {"id": 2, "name": "나", "amount": 20},
]


def _connector(root: Path, *, base_dir: str = "", **spec: object) -> LocalFileConnector:
    write_spec = WriteSpec(run_id="R1", **spec)  # type: ignore[arg-type]
    return LocalFileConnector(root=str(root), base_dir=base_dir, write_spec=write_spec)


class TestWrite:
    def test_jsonl_write_creates_run_scoped_file(self, tmp_path: Path) -> None:
        conn = _connector(tmp_path, base_dir="exports", path_prefix="customers", file_format="jsonl")
        result = conn.write(RecordBatch(rows=ROWS, columns=["id", "name", "amount"]), WriteMode.APPEND)

        expected = tmp_path / "exports" / "customers" / "run_id=R1" / "part-00000.jsonl"
        assert Path(result.location) == expected
        assert expected.exists()
        lines = expected.read_text(encoding="utf-8").strip().splitlines()
        assert json.loads(lines[0])["name"] == "가"
        assert result.records_written == 2

    def test_csv_write(self, tmp_path: Path) -> None:
        conn = _connector(tmp_path, file_format="csv")
        conn.write(RecordBatch(rows=ROWS, columns=["id", "name", "amount"]), WriteMode.APPEND)
        f = tmp_path / "run_id=R1" / "part-00000.csv"
        assert f.exists()
        assert f.read_text(encoding="utf-8").splitlines()[0] == "id,name,amount"

    def test_multiple_batches_increment_part_number(self, tmp_path: Path) -> None:
        conn = _connector(tmp_path, file_format="jsonl")
        conn.write(RecordBatch(rows=ROWS[:1]), WriteMode.APPEND)
        conn.write(RecordBatch(rows=ROWS[1:]), WriteMode.APPEND)
        run_dir = tmp_path / "run_id=R1"
        parts = sorted(p.name for p in run_dir.glob("part-*.jsonl"))
        assert parts == ["part-00000.jsonl", "part-00001.jsonl"]

    def test_empty_batch_writes_nothing(self, tmp_path: Path) -> None:
        conn = _connector(tmp_path, file_format="jsonl")
        result = conn.write(RecordBatch(rows=[]), WriteMode.APPEND)
        assert result.records_written == 0
        assert not (tmp_path / "run_id=R1" / "part-00000.jsonl").exists()

    def test_upsert_is_rejected(self, tmp_path: Path) -> None:
        conn = _connector(tmp_path, file_format="jsonl")
        with pytest.raises(UnsupportedOperation, match="upsert"):
            conn.write(RecordBatch(rows=ROWS), WriteMode.UPSERT)


class TestOverwritePurge:
    def test_purge_removes_previous_parts(self, tmp_path: Path) -> None:
        conn = _connector(tmp_path, file_format="jsonl")
        conn.write(RecordBatch(rows=ROWS[:1]), WriteMode.APPEND)
        conn.write(RecordBatch(rows=ROWS[1:]), WriteMode.APPEND)

        removed = conn.purge_run_prefix()
        assert removed == 2
        assert list((tmp_path / "run_id=R1").glob("part-*.jsonl")) == []
        # 정리 후 part 번호가 0 으로 되돌아가 재시도가 같은 파일명으로 수렴한다
        conn.write(RecordBatch(rows=ROWS), WriteMode.APPEND)
        assert (tmp_path / "run_id=R1" / "part-00000.jsonl").exists()

    def test_purge_on_missing_dir_is_noop(self, tmp_path: Path) -> None:
        conn = _connector(tmp_path, file_format="jsonl")
        assert conn.purge_run_prefix() == 0


class TestConfinement:
    def test_base_dir_escaping_root_is_rejected(self, tmp_path: Path) -> None:
        root = tmp_path / "root"
        root.mkdir()
        conn = LocalFileConnector(
            root=str(root), base_dir="../outside", write_spec=WriteSpec(run_id="R1", file_format="jsonl")
        )
        with pytest.raises(WriteFailed, match="루트를 벗어"):
            conn.write(RecordBatch(rows=ROWS), WriteMode.APPEND)

    def test_prefix_escaping_root_is_rejected(self, tmp_path: Path) -> None:
        root = tmp_path / "root"
        root.mkdir()
        conn = LocalFileConnector(
            root=str(root),
            write_spec=WriteSpec(run_id="R1", path_prefix="../../etc", file_format="jsonl"),
        )
        with pytest.raises(WriteFailed, match="루트를 벗어"):
            conn.write(RecordBatch(rows=ROWS), WriteMode.APPEND)

    def test_empty_root_is_configuration_error(self) -> None:
        from eai_connectors.errors import ConfigurationError

        with pytest.raises(ConfigurationError, match="루트"):
            LocalFileConnector(root="")


class TestHealthAndContract:
    def test_test_connection_ok_when_writable(self, tmp_path: Path) -> None:
        conn = LocalFileConnector(root=str(tmp_path), base_dir="out", write_spec=WriteSpec())
        assert conn.test_connection().healthy

    def test_read_is_unsupported(self, tmp_path: Path) -> None:
        from eai_connectors.base import ReadSpec

        conn = LocalFileConnector(root=str(tmp_path), write_spec=WriteSpec())
        with pytest.raises(UnsupportedOperation):
            list(conn.read(ReadSpec(table="x")))

    def test_marks_itself_as_object_target(self, tmp_path: Path) -> None:
        conn = LocalFileConnector(root=str(tmp_path), write_spec=WriteSpec())
        assert conn.writes_object_parts is True
