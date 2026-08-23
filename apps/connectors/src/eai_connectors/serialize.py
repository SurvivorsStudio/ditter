"""파일 포맷 직렬화 — S3·로컬 파일 타깃이 공유한다.

두 타깃은 "행 배치를 parquet/jsonl/csv 바이트로 바꾼다"는 로직이 똑같다.
한쪽에만 두면 반드시 갈라지므로 여기로 모았다.

무거운 임포트(pyarrow)는 함수 안에서 지연 로딩한다 — 이 모듈 자체는
io/json/csv 만 최상위로 임포트하므로 import 비용이 싸다 (registry.py 도크스트링 참고).
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from typing import Any

SUPPORTED_FORMATS = frozenset({"parquet", "jsonl", "csv"})

_EXTENSION = {"parquet": "parquet", "jsonl": "jsonl", "csv": "csv"}
_CONTENT_TYPE = {
    "parquet": "application/octet-stream",
    "jsonl": "application/x-ndjson",
    "csv": "text/csv",
}


def extension_for(fmt: str) -> str:
    return _EXTENSION[fmt]


def content_type_for(fmt: str) -> str:
    return _CONTENT_TYPE[fmt]


def serialize(fmt: str, rows: list[dict[str, Any]], columns: Sequence[str]) -> bytes:
    """배치를 지정 포맷의 바이트로 바꾼다. 빈 배치는 호출자가 걸러 온다는 전제."""
    if fmt == "parquet":
        return _to_parquet(rows, columns)
    if fmt == "jsonl":
        return _to_jsonl(rows)
    return _to_csv(rows, columns)


def _to_parquet(rows: list[dict[str, Any]], columns: Sequence[str]) -> bytes:
    import pyarrow as pa
    import pyarrow.parquet as pq

    names = list(columns) or list(rows[0].keys())
    table = pa.Table.from_pydict({name: [r.get(name) for r in rows] for name in names})
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    return buf.getvalue()


def _to_jsonl(rows: list[dict[str, Any]]) -> bytes:
    import json

    return ("\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows) + "\n").encode("utf-8")


def _to_csv(rows: list[dict[str, Any]], columns: Sequence[str]) -> bytes:
    import csv

    names = list(columns) or list(rows[0].keys())
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=names, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")
