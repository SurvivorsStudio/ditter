"""결과 내보내기 인코더 (CSV/TSV/JSON) 단위 테스트."""

from __future__ import annotations

import json

from eai_api.services.connection_service import (
    EXPORT_FORMATS,
    _export_value,
    iter_delimited,
    iter_json,
)


def test_export_value_types() -> None:
    assert _export_value(None) == ""  # NULL → 빈칸
    assert _export_value(3) == "3"
    assert _export_value("a") == "a"
    # 중첩 객체/배열은 JSON 문자열로 (CSV 셀에 깨지지 않게)
    assert _export_value({"k": 1}) == '{"k": 1}'
    assert _export_value([1, 2]) == "[1, 2]"


def test_csv_has_bom_header_and_rows() -> None:
    rows = [{"a": 1, "b": "x"}, {"a": 2, "b": None}]
    out = b"".join(iter_delimited(["a", "b"], iter(rows), ","))
    assert out.startswith(b"\xef\xbb\xbf")  # Excel 한글용 BOM
    text = out.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0] == "a,b"
    assert lines[1] == "1,x"
    assert lines[2] == "2,"  # None → 빈칸


def test_tsv_uses_tab_delimiter() -> None:
    out = b"".join(iter_delimited(["a", "b"], iter([{"a": 1, "b": 2}]), "\t"))
    assert "1\t2" in out.decode("utf-8-sig")


def test_json_stream_is_valid_array() -> None:
    rows = [{"a": 1}, {"a": 2}, {"a": 3}]
    out = b"".join(iter_json(iter(rows))).decode("utf-8")
    parsed = json.loads(out)
    assert parsed == rows


def test_json_stream_empty() -> None:
    assert json.loads(b"".join(iter_json(iter([]))).decode("utf-8")) == []


def test_export_formats_registry() -> None:
    assert set(EXPORT_FORMATS) == {"csv", "json", "txt"}
    assert EXPORT_FORMATS["txt"][0] == "txt"
