"""목 RFC 백엔드 (개발·CI용).

NW RFC SDK 없이 사이드카 전체를 돌리기 위한 대역이다 (설계 문서 §13).

**제약을 그대로 재현하는 것이 이 목의 존재 이유다.** 512자 행폭, 72자 OPTIONS 줄,
ROWSKIPS/ROWCOUNT 페이지네이션을 SAP 과 똑같이 강제한다. 제약을 눙치는 목은
분할 로직을 검증하지 못하므로 있으나 마나다.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from .base import RfcBackend, SapCallError

logger = logging.getLogger(__name__)

#: RFC_READ_TABLE 의 DATA-WA 필드 폭. 이걸 넘으면 SAP 이 DATA_BUFFER_EXCEEDED 를 던진다.
MAX_ROW_WIDTH = 512
#: OPTIONS 테이블 한 줄의 최대 길이. 넘으면 잘리거나 문법 오류가 난다.
MAX_OPTION_LINE = 72

_CONDITION = re.compile(
    r"^\s*(?P<field>\w+)\s*(?P<op><=|>=|<>|=|<|>)\s*'(?P<value>[^']*)'\s*$", re.IGNORECASE
)


class MockRfcBackend(RfcBackend):
    """픽스처 JSON 으로 동작하는 SAP 대역."""

    def __init__(self, fixture_path: str | Path) -> None:
        path = Path(fixture_path)
        if not path.exists():
            raise FileNotFoundError(f"SAP 목 픽스처를 찾을 수 없습니다: {path}")
        self._data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        self._path = path
        logger.info("SAP 목 백엔드 사용: %s (테이블 %d개)", path, len(self._data.get("tables", {})))

    # ------------------------------------------------------------- 계약

    def ping(self) -> dict[str, Any]:
        system = dict(self._data.get("system", {}))
        system.setdefault("system_id", "MOCK")
        system["mock"] = True
        return system

    def call(self, function_name: str, **params: Any) -> dict[str, Any]:
        handler = {
            "RFC_READ_TABLE": self._read_table,
            "DDIF_FIELDINFO_GET": self._fieldinfo,
            "RFC_GET_FUNCTION_INTERFACE": self._function_interface,
        }.get(function_name.upper())

        if handler is not None:
            return handler(params)
        if function_name.upper() in self._data.get("bapis", {}):
            return self._bapi(function_name.upper(), params)
        raise SapCallError(f"목 백엔드에 정의되지 않은 함수입니다: {function_name}", code="FU_NOT_FOUND")

    def close(self) -> None:
        return None

    # -------------------------------------------------------- RFC_READ_TABLE

    def _read_table(self, params: dict[str, Any]) -> dict[str, Any]:
        table_name = str(params.get("QUERY_TABLE", "")).upper()
        table = self._data.get("tables", {}).get(table_name)
        if table is None:
            raise SapCallError(f"테이블이 없습니다: {table_name}", code="TABLE_NOT_AVAILABLE")

        all_fields = {f["name"].upper(): f for f in table["fields"]}
        requested = [str(f["FIELDNAME"]).upper() for f in params.get("FIELDS") or []]
        if not requested:
            requested = list(all_fields)

        unknown = [f for f in requested if f not in all_fields]
        if unknown:
            raise SapCallError(f"존재하지 않는 필드: {unknown}", code="FIELD_NOT_VALID")

        delimiter = str(params.get("DELIMITER", "") or "")

        # ── SAP 의 실제 제약을 그대로 강제한다 ──
        width = sum(int(all_fields[f]["length"]) for f in requested)
        if delimiter:
            width += len(delimiter) * (len(requested) - 1)
        if width > MAX_ROW_WIDTH:
            raise SapCallError(
                f"행 폭 {width}자가 한계 {MAX_ROW_WIDTH}자를 넘었습니다", code="DATA_BUFFER_EXCEEDED"
            )

        options = [str(o.get("TEXT", "")) for o in params.get("OPTIONS") or []]
        for line in options:
            if len(line) > MAX_OPTION_LINE:
                raise SapCallError(
                    f"OPTIONS 한 줄이 {MAX_OPTION_LINE}자를 넘었습니다 ({len(line)}자)",
                    code="OPTION_NOT_VALID",
                )

        rows = [r for r in table.get("rows", []) if _matches(r, " ".join(options))]

        skips = int(params.get("ROWSKIPS", 0) or 0)
        count = int(params.get("ROWCOUNT", 0) or 0)
        window = rows[skips:] if count == 0 else rows[skips : skips + count]

        # 필드 메타 (OFFSET 은 요청한 필드 순서 기준으로 다시 계산된다)
        field_meta: list[dict[str, Any]] = []
        offset = 0
        for name in requested:
            spec = all_fields[name]
            length = int(spec["length"])
            field_meta.append(
                {
                    "FIELDNAME": name,
                    "OFFSET": offset,
                    "LENGTH": length,
                    "TYPE": spec.get("type", "C"),
                    "FIELDTEXT": spec.get("text", ""),
                }
            )
            offset += length + (len(delimiter) if delimiter else 0)

        no_data = bool(str(params.get("NO_DATA", "")).strip())
        data = [] if no_data else [{"WA": _pack(row, requested, all_fields, delimiter)} for row in window]

        return {"FIELDS": field_meta, "DATA": data, "OPTIONS": params.get("OPTIONS") or []}

    # ------------------------------------------------------ DDIF_FIELDINFO_GET

    def _fieldinfo(self, params: dict[str, Any]) -> dict[str, Any]:
        table_name = str(params.get("TABNAME", "")).upper()
        table = self._data.get("tables", {}).get(table_name)
        if table is None:
            raise SapCallError(f"테이블이 없습니다: {table_name}", code="NOT_FOUND")
        return {
            "DFIES_TAB": [
                {
                    "TABNAME": table_name,
                    "FIELDNAME": f["name"].upper(),
                    "DATATYPE": f.get("type", "CHAR"),
                    "LENG": int(f["length"]),
                    "FIELDTEXT": f.get("text", ""),
                    "KEYFLAG": "X" if f.get("key") else "",
                }
                for f in table["fields"]
            ],
            "DDTEXT": table.get("text", ""),
        }

    def _function_interface(self, params: dict[str, Any]) -> dict[str, Any]:
        name = str(params.get("FUNCNAME", "")).upper()
        bapi = self._data.get("bapis", {}).get(name)
        if bapi is None:
            raise SapCallError(f"함수가 없습니다: {name}", code="FU_NOT_FOUND")
        return {"PARAMS": bapi.get("interface", [])}

    # ---------------------------------------------------------------- BAPI

    def _bapi(self, name: str, params: dict[str, Any]) -> dict[str, Any]:
        """픽스처에 정의된 응답을 그대로 돌려준다.

        ``responses`` 가 있으면 입력에 따라 고른다 — 오류 응답(RETURN 메시지)도 재현하기 위해서다.
        """
        bapi = self._data["bapis"][name]
        for rule in bapi.get("responses", []):
            when = rule.get("when", {})
            if all(str(params.get(k, "")) == str(v) for k, v in when.items()):
                return dict(rule["result"])
        return dict(bapi.get("result", {}))

    # --------------------------------------------------------------- 헬퍼

    def tables(self) -> dict[str, Any]:
        return dict(self._data.get("tables", {}))


def _pack(
    row: dict[str, Any], fields: list[str], meta: dict[str, dict[str, Any]], delimiter: str
) -> str:
    """SAP 이 하듯 값을 고정폭(또는 구분자)으로 이어붙인다."""
    parts = []
    for name in fields:
        length = int(meta[name]["length"])
        value = "" if row.get(name) is None else str(row.get(name))
        # SAP 은 넘치면 자르고 모자라면 공백으로 채운다
        parts.append(value[:length] if delimiter else value[:length].ljust(length))
    return delimiter.join(parts) if delimiter else "".join(parts)


def _matches(row: dict[str, Any], where: str) -> bool:
    """WHERE 절 평가. ``AND`` 로 연결된 단순 비교만 지원한다 (목의 범위)."""
    clause = where.strip()
    if not clause:
        return True
    for condition in re.split(r"\s+AND\s+", clause, flags=re.IGNORECASE):
        match = _CONDITION.match(condition)
        if match is None:
            logger.warning("목이 해석하지 못한 조건은 통과시킵니다: %r", condition)
            continue
        field, op, expected = match.group("field").upper(), match.group("op"), match.group("value")
        actual = row.get(field)
        if actual is None or not _compare(str(actual).strip(), op, expected):
            return False
    return True


def _compare(actual: str, op: str, expected: str) -> bool:
    if op == "=":
        return actual == expected
    if op == "<>":
        return actual != expected
    # 문자열 비교로 충분하다 — SAP 날짜(YYYYMMDD)·자재번호는 사전순이 곧 크기순이다
    if op == ">":
        return actual > expected
    if op == ">=":
        return actual >= expected
    if op == "<":
        return actual < expected
    if op == "<=":
        return actual <= expected
    return False
