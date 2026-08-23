"""RFC_READ_TABLE — SAP 의 두 가지 하드 제약을 넘기는 코드.

설계 문서 §5: "RFC_READ_TABLE 은 512자 행폭 제한 → 넓은 테이블은 컬럼 분할. 가능하면 BAPI 우선."

제약 1 — **행 폭 512자.** 반환 구조 DATA-WA 가 CHAR(512) 라서, 요청 필드 폭의 합이
512 를 넘으면 ``DATA_BUFFER_EXCEEDED`` 로 실패한다. 필드를 여러 그룹으로 쪼개
같은 조건으로 여러 번 호출한 뒤 **행 위치로 맞춰 병합**한다.

제약 2 — **OPTIONS 한 줄 72자.** WHERE 절을 72자 단위로 잘라 넣어야 하는데,
아무 데서나 자르면 문법이 깨진다. 토큰 경계에서만 자른다.

병합의 전제: 같은 WHERE·같은 ROWSKIPS/ROWCOUNT 로 부른 호출들이 **같은 순서**의 행을
돌려준다는 것. SAP 은 ORDER BY 를 주지 않으면 순서를 보장하지 않으므로, 이 방식은
호출 사이에 원본이 바뀌면 행이 어긋날 수 있다. 그래서 넓은 테이블은 BAPI 를 우선하고,
분할이 일어나면 경고를 남긴다.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from .backends.base import RfcBackend, SapCallError

logger = logging.getLogger(__name__)

MAX_ROW_WIDTH = 512
MAX_OPTION_LINE = 72

#: 기본 페이지 크기. SAP 게이트웨이 타임아웃을 피하려면 한 번에 다 읽지 않는 편이 낫다.
DEFAULT_PAGE_SIZE = 2000


@dataclass(frozen=True, slots=True)
class SapField:
    name: str
    length: int
    offset: int = 0
    type: str = "C"
    text: str = ""


@dataclass
class ReadTableResult:
    rows: list[dict[str, str]]
    fields: list[SapField]
    #: 512자 제한 때문에 나눠 호출한 그룹 수. 1이면 분할이 없었다는 뜻.
    field_groups: int = 1
    truncated: bool = False
    warnings: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ 분할


def split_fields_by_width(
    fields: list[SapField], *, delimiter: str = "", max_width: int = MAX_ROW_WIDTH
) -> list[list[SapField]]:
    """필드를 폭 합계가 ``max_width`` 를 넘지 않는 그룹으로 나눈다.

    순서를 유지한다 — 그래야 병합 후 컬럼 순서가 요청과 같다.
    """
    if not fields:
        return []

    groups: list[list[SapField]] = []
    current: list[SapField] = []
    width = 0

    for f in fields:
        cost = f.length + (len(delimiter) if delimiter and current else 0)
        if f.length > max_width:
            raise SapCallError(
                f"단일 필드 {f.name}({f.length}자)가 한계 {max_width}자보다 넓어 읽을 수 없습니다",
                code="FIELD_TOO_WIDE",
            )
        if current and width + cost > max_width:
            groups.append(current)
            current, width = [f], f.length
        else:
            current.append(f)
            width += cost

    if current:
        groups.append(current)
    return groups


def split_where_clause(where: str, *, max_line: int = MAX_OPTION_LINE) -> list[str]:
    """WHERE 절을 OPTIONS 줄 길이에 맞춰 자른다.

    토큰 경계에서만 자른다 — 문자열 리터럴이나 식별자 중간에서 끊으면 ABAP 이 거부한다.
    한 토큰이 줄 길이보다 길면 그건 사용자가 고쳐야 할 입력이므로 그대로 알린다.
    """
    text = " ".join(str(where or "").split())
    if not text:
        return []

    # 따옴표 안의 공백은 보존해야 하므로 리터럴을 하나의 토큰으로 잡는다
    tokens = re.findall(r"'[^']*'|\S+", text)

    lines: list[str] = []
    current = ""
    for token in tokens:
        if len(token) > max_line:
            raise SapCallError(
                f"WHERE 토큰이 한 줄 한계 {max_line}자를 넘습니다: {token[:40]}…", code="OPTION_TOO_LONG"
            )
        candidate = f"{current} {token}" if current else token
        if len(candidate) > max_line:
            lines.append(current)
            current = token
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


# ------------------------------------------------------------------ 파싱


def parse_row(wa: str, fields: list[SapField], delimiter: str) -> dict[str, str]:
    """DATA-WA 한 줄을 필드 딕셔너리로 푼다."""
    if delimiter:
        parts = wa.split(delimiter)
        # SAP 은 마지막 필드가 비면 조각을 덜 줄 수 있다 — 모자란 만큼 빈 값으로 채운다
        parts += [""] * (len(fields) - len(parts))
        return {f.name: parts[i].strip() for i, f in enumerate(fields)}
    return {f.name: wa[f.offset : f.offset + f.length].strip() for f in fields}


# ------------------------------------------------------------------ 실행


def describe_table(backend: RfcBackend, table: str) -> list[SapField]:
    """DDIF_FIELDINFO_GET 으로 필드 메타를 가져온다."""
    result = backend.call("DDIF_FIELDINFO_GET", TABNAME=table.upper(), ALL_TYPES="X")
    rows = result.get("DFIES_TAB") or []
    if not rows:
        raise SapCallError(f"테이블 메타를 읽지 못했습니다: {table}", code="NOT_FOUND")
    return [
        SapField(
            name=str(r["FIELDNAME"]),
            length=int(r.get("LENG") or 0),
            type=str(r.get("DATATYPE") or "CHAR"),
            text=str(r.get("FIELDTEXT") or ""),
        )
        for r in rows
    ]


def read_table(
    backend: RfcBackend,
    *,
    table: str,
    fields: list[str] | None = None,
    where: str = "",
    delimiter: str = "|",
    row_skips: int = 0,
    row_count: int = DEFAULT_PAGE_SIZE,
) -> ReadTableResult:
    """RFC_READ_TABLE 로 한 페이지를 읽는다. 512자 제약은 내부에서 처리한다."""
    table = table.upper()

    # 필드 폭을 알아야 512자 분할이 가능하다. 그런데 SAP RFC 전용 계정은
    # RFC_READ_TABLE 권한만 받는 경우가 흔해 DDIF_FIELDINFO_GET 이 막혀 있을 수 있다.
    # 막혀 있으면 분할 없이 SAP 이 돌려주는 FIELDS 메타로 직접 읽는다.
    try:
        meta = {f.name.upper(): f for f in describe_table(backend, table)}
    except SapCallError as exc:
        logger.warning(
            "%s 메타 조회 실패(%s) — 분할 없이 직접 읽습니다. "
            "폭이 512자를 넘으면 SAP 이 거부하므로 필드를 지정하세요.",
            table,
            exc.code or exc,
        )
        return _read_direct(
            backend,
            table=table,
            fields=fields,
            where=where,
            delimiter=delimiter,
            row_skips=row_skips,
            row_count=row_count,
        )

    wanted = [f.upper() for f in (fields or list(meta))]
    unknown = [f for f in wanted if f not in meta]
    if unknown:
        raise SapCallError(f"{table} 에 없는 필드: {unknown}", code="FIELD_NOT_VALID")

    selected = [meta[f] for f in wanted]
    options = [{"TEXT": line} for line in split_where_clause(where)]
    groups = split_fields_by_width(selected, delimiter=delimiter)

    warnings: list[str] = []
    if len(groups) > 1:
        warnings.append(
            f"필드 폭 합계가 {MAX_ROW_WIDTH}자를 넘어 {len(groups)}회로 나눠 읽습니다. "
            "호출 사이에 원본이 바뀌면 행이 어긋날 수 있으니 가능하면 BAPI 나 필드 축소를 쓰세요."
        )
        logger.warning("%s: 컬럼 분할 %d그룹", table, len(groups))

    merged: list[dict[str, str]] = []
    for index, group in enumerate(groups):
        result = backend.call(
            "RFC_READ_TABLE",
            QUERY_TABLE=table,
            DELIMITER=delimiter,
            FIELDS=[{"FIELDNAME": f.name} for f in group],
            OPTIONS=options,
            ROWSKIPS=row_skips,
            ROWCOUNT=row_count,
        )
        group_meta = _field_meta(result, group)
        chunk = [parse_row(str(d.get("WA", "")), group_meta, delimiter) for d in result.get("DATA") or []]

        if index == 0:
            merged = chunk
            continue

        if len(chunk) != len(merged):
            # 호출 사이에 원본이 바뀌었다는 뜻 — 조용히 이어붙이면 행이 섞인다
            raise SapCallError(
                f"컬럼 분할 병합 실패: 그룹 {index + 1} 의 행 수({len(chunk)})가 "
                f"첫 그룹({len(merged)})과 다릅니다. 읽는 도중 원본이 바뀐 것으로 보입니다.",
                code="SPLIT_ROW_MISMATCH",
            )
        for target, extra in zip(merged, chunk, strict=True):
            target.update(extra)

    return ReadTableResult(
        rows=merged,
        fields=selected,
        field_groups=len(groups),
        truncated=row_count > 0 and len(merged) >= row_count,
        warnings=warnings,
    )


def _read_direct(
    backend: RfcBackend,
    *,
    table: str,
    fields: list[str] | None,
    where: str,
    delimiter: str,
    row_skips: int,
    row_count: int,
) -> ReadTableResult:
    """필드 메타 없이 RFC_READ_TABLE 만으로 읽는다 (권한이 좁은 계정용).

    SAP 이 응답에 실어주는 ``FIELDS`` (FIELDNAME/OFFSET/LENGTH)를 그대로 쓴다.
    ``FIELDS`` 를 비워 보내면 SAP 이 전체 컬럼을 돌려준다 — 폭이 512자를 넘으면
    분할할 근거가 없으므로 SAP 의 거부를 그대로 올린다.
    """
    try:
        result = backend.call(
            "RFC_READ_TABLE",
            QUERY_TABLE=table,
            DELIMITER=delimiter,
            FIELDS=[{"FIELDNAME": f.upper()} for f in (fields or [])],
            OPTIONS=[{"TEXT": line} for line in split_where_clause(where)],
            ROWSKIPS=row_skips,
            ROWCOUNT=row_count,
        )
    except SapCallError as exc:
        if exc.code == "DATA_BUFFER_EXCEEDED":
            raise SapCallError(
                f"{table} 의 행 폭이 {MAX_ROW_WIDTH}자를 넘습니다. "
                "필드 메타를 읽을 권한이 없어 자동 분할을 할 수 없으니, "
                "노드 설정에서 필요한 필드만 지정하거나 BAPI 를 쓰세요.",
                code=exc.code,
            ) from exc
        raise

    returned = _field_meta(result, [])
    rows = [parse_row(str(d.get("WA", "")), returned, delimiter) for d in result.get("DATA") or []]
    return ReadTableResult(
        rows=rows,
        fields=returned,
        field_groups=1,
        truncated=row_count > 0 and len(rows) >= row_count,
        warnings=["필드 메타 조회 권한이 없어 분할 없이 읽었습니다"],
    )


def _field_meta(result: dict[str, Any], requested: list[SapField]) -> list[SapField]:
    """SAP 이 돌려준 FIELDS(OFFSET/LENGTH)를 쓴다. 없으면 요청 순서로 직접 계산한다."""
    returned = result.get("FIELDS") or []
    if not returned:
        offset = 0
        out = []
        for f in requested:
            out.append(SapField(name=f.name, length=f.length, offset=offset, type=f.type))
            offset += f.length
        return out
    return [
        SapField(
            name=str(r["FIELDNAME"]),
            length=int(r.get("LENGTH") or 0),
            offset=int(r.get("OFFSET") or 0),
            type=str(r.get("TYPE") or "C"),
            text=str(r.get("FIELDTEXT") or ""),
        )
        for r in returned
    ]
