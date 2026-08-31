"""Transform 노드 — 필터, 필드 매핑, Python 전처리.

필터·필드 매핑은 배치 단위 순수 변환만 하며 상태를 갖지 않는다. Python 전처리는
사용자 코드를 **격리 자식 프로세스**(pysandbox)에서 돌린다 — 워커 프로세스의 시크릿·
메타DB·커넥터와 분리된다. 셋 다 어느 워커에서 돌아도 결과가 같다.
"""

from __future__ import annotations

import logging
import operator
import re
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from typing import Any

from eai_api.schemas.dag import SWITCH_DEFAULT_HANDLE, NodeKind, PipelineNode
from eai_connectors import RecordBatch
from eai_connectors.errors import ConfigurationError

from ..context import RunContext
from .pysandbox import PySandbox

logger = logging.getLogger(__name__)

#: 스위치가 각 행에 붙이는 라우팅 태그 키. 어느 출력(case handle)으로 갈지 담는다.
#: 엔진이 소비 엣지의 source_handle 로 걸러내고 이 키를 제거하므로 다운스트림은 못 본다.
#: 실제 컬럼과 충돌하지 않도록 눈에 띄는 이름을 쓴다.
ROUTE_KEY = "__eai_route__"

#: 필터 연산자. 여기 없는 연산자는 설정 오류로 처리한다 — eval 은 절대 쓰지 않는다.
OPERATORS: dict[str, Callable[[Any, Any], bool]] = {
    "eq": operator.eq,
    "ne": operator.ne,
    "gt": operator.gt,
    "gte": operator.ge,
    "lt": operator.lt,
    "lte": operator.le,
    "in": lambda a, b: a in (b or []),
    "not_in": lambda a, b: a not in (b or []),
    "contains": lambda a, b: b is not None and str(b) in str(a or ""),
    "starts_with": lambda a, b: str(a or "").startswith(str(b)),
    "is_null": lambda a, _: a is None,
    "is_not_null": lambda a, _: a is not None,
    "regex": lambda a, b: bool(re.search(str(b), str(a or ""))),
}

def _to_datetime(v: Any) -> Any:
    """숫자 epoch 를 naive datetime 으로. 문자열·datetime 은 그대로 둔다.

    CDC 에서 필요하다. Debezium 은 시간 컬럼을 **epoch 정수**로 내보내는데
    (JSON 컨버터에 스키마를 끄면 논리 타입이 숫자로 납작해진다), 타깃의 timestamp
    컬럼에 그대로 넣으면 ``type timestamp but expression is of type bigint`` 로 깨진다.

    단위는 자릿수로 가른다 — 초·밀리초·마이크로초가 소스마다 다르고, 어느 쪽인지
    설정으로 받으면 컬럼마다 달라 손이 많이 간다. 2001년 이후 값이면 자릿수가 겹치지 않는다.

    UTC 로 해석한 뒤 tz 를 떼는 이유: MySQL DATETIME 은 시간대가 없는 벽시계 값이고
    Debezium 이 그것을 UTC 기준 epoch 로 싣는다. 로컬 시간대로 풀면 시간이 밀린다.
    """
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return v  # 문자열 등은 드라이버가 파싱하도록 넘긴다
    n = float(v)
    if abs(n) >= 1e14:      # 마이크로초
        n /= 1_000_000
    elif abs(n) >= 1e11:    # 밀리초
        n /= 1_000
    return datetime.fromtimestamp(n, tz=timezone.utc).replace(tzinfo=None)


CASTS: dict[str, Callable[[Any], Any]] = {
    "str": lambda v: None if v is None else str(v),
    "int": lambda v: None if v in (None, "") else int(v),
    "float": lambda v: None if v in (None, "") else float(v),
    "bool": lambda v: None if v is None else bool(v),
    "upper": lambda v: None if v is None else str(v).upper(),
    "lower": lambda v: None if v is None else str(v).lower(),
    "strip": lambda v: None if v is None else str(v).strip(),
    "datetime": _to_datetime,
}


def transform(node: PipelineNode, upstream: Iterator[RecordBatch], ctx: RunContext) -> Iterator[RecordBatch]:
    if node.kind is NodeKind.TRANSFORM_FILTER:
        return _filter(node, upstream, ctx)
    if node.kind is NodeKind.TRANSFORM_MAP:
        return _map(node, upstream, ctx)
    if node.kind is NodeKind.TRANSFORM_PYTHON:
        return _python(node, upstream, ctx)
    if node.kind is NodeKind.LOGIC_SWITCH:
        return _switch(node, upstream, ctx)
    raise ConfigurationError(f"알 수 없는 변환 노드: {node.kind}")


def _filter(node: PipelineNode, upstream: Iterator[RecordBatch], ctx: RunContext) -> Iterator[RecordBatch]:
    """조건 필터링. 여러 조건은 ``match`` 에 따라 all(기본) / any 로 결합한다."""
    conditions = node.params.get("conditions") or []
    match_all = str(node.params.get("match", "all")).lower() != "any"

    for cond in conditions:
        op = cond.get("op")
        if op not in OPERATORS:
            raise ConfigurationError(f"지원하지 않는 필터 연산자: {op} (가능: {sorted(OPERATORS)})")
        if not cond.get("field"):
            raise ConfigurationError("필터 조건에 field 가 없습니다")

    kept = dropped = 0
    for batch in upstream:
        rows = [r for r in batch.rows if _matches(r, conditions, match_all)] if conditions else batch.rows
        kept += len(rows)
        dropped += len(batch.rows) - len(rows)
        ctx.add_records(node.id, len(rows))
        yield RecordBatch(
            rows=rows, columns=batch.columns, max_watermark=batch.max_watermark, is_last=batch.is_last
        )

    ctx.log(f"필터 완료: 통과 {kept:,}건 · 제외 {dropped:,}건", node_id=node.id)


def _matches(row: dict[str, Any], conditions: list[dict[str, Any]], match_all: bool) -> bool:
    results = []
    for cond in conditions:
        fn = OPERATORS[cond["op"]]
        try:
            results.append(bool(fn(row.get(cond["field"]), cond.get("value"))))
        except (TypeError, ValueError):
            # 타입이 안 맞는 비교는 "불일치"로 본다 — 여기서 실행을 죽이지 않는다
            results.append(False)
    return all(results) if match_all else any(results)


def _switch(node: PipelineNode, upstream: Iterator[RecordBatch], ctx: RunContext) -> Iterator[RecordBatch]:
    """조건 분기(스위치). 각 행을 **처음 맞는 case** 의 출력으로 보낸다.

    출력이 여러 개인데, 실행기는 단일 스트림만 낸다 — 각 행에 어느 출력(case id)으로
    갈지 ``ROUTE_KEY`` 태그를 붙이고, 실제 분배는 엔진이 소비 엣지의 source_handle 로
    필터링해 처리한다. 아무 case 에도 안 맞으면 기본(그 외, SWITCH_DEFAULT_HANDLE) 출력.
    """
    cases = node.params.get("cases") or []
    if not cases:
        raise ConfigurationError("스위치에 case 가 없습니다")

    # 필터와 같은 방식으로 연산자·field 를 미리 검증한다 (eval 은 쓰지 않는다).
    for i, case in enumerate(cases, start=1):
        for cond in case.get("conditions") or []:
            if cond.get("op") not in OPERATORS:
                raise ConfigurationError(
                    f"case #{i}: 지원하지 않는 연산자 {cond.get('op')} (가능: {sorted(OPERATORS)})"
                )
            if not cond.get("field"):
                raise ConfigurationError(f"case #{i}: 조건에 field 가 없습니다")

    # 안정적인 case id — 프론트가 부여하지만 없으면 인덱스로 채운다 (엣지 핸들과 짝).
    case_ids = [str(c.get("id") or f"case_{i}") for i, c in enumerate(cases)]
    counts: dict[str, int] = {}
    for batch in upstream:
        rows: list[dict[str, Any]] = []
        for row in batch.rows:
            handle = _route_row(row, cases, case_ids)
            tagged = dict(row)
            tagged[ROUTE_KEY] = handle
            rows.append(tagged)
            counts[handle] = counts.get(handle, 0) + 1
        ctx.add_records(node.id, len(rows))
        yield RecordBatch(
            rows=rows, columns=batch.columns, max_watermark=batch.max_watermark, is_last=batch.is_last
        )

    dist = " · ".join(f"{h}={c:,}" for h, c in counts.items()) or "없음"
    ctx.log(f"스위치 분기 완료: {dist}", node_id=node.id)


def _route_row(row: dict[str, Any], cases: list[dict[str, Any]], case_ids: list[str]) -> str:
    """행이 갈 출력 핸들을 정한다 — 위에서부터 처음 맞는 case, 없으면 기본."""
    for case, cid in zip(cases, case_ids, strict=True):
        conds = case.get("conditions") or []
        match_all = str(case.get("match", "all")).lower() != "any"
        if conds and _matches(row, conds, match_all):
            return cid
    return SWITCH_DEFAULT_HANDLE


def _map(node: PipelineNode, upstream: Iterator[RecordBatch], ctx: RunContext) -> Iterator[RecordBatch]:
    """필드 매핑. ``mappings``: [{source, target, cast?, default?}, ...]

    ``drop_unmapped=True`` 면 매핑에 없는 컬럼을 버린다 (기본값).
    """
    mappings = node.params.get("mappings") or []
    drop_unmapped = bool(node.params.get("drop_unmapped", True))

    for m in mappings:
        if not m.get("source") or not m.get("target"):
            raise ConfigurationError("매핑에는 source 와 target 이 모두 필요합니다")
        cast = m.get("cast")
        if cast and cast not in CASTS:
            raise ConfigurationError(f"지원하지 않는 캐스트: {cast} (가능: {sorted(CASTS)})")

    total = 0
    out_columns: list[str] = []
    for batch in upstream:
        rows = [_map_row(r, mappings, drop_unmapped) for r in batch.rows]
        if rows and not out_columns:
            out_columns = list(rows[0].keys())
        total += len(rows)
        ctx.add_records(node.id, len(rows))
        yield RecordBatch(
            rows=rows,
            columns=out_columns or batch.columns,
            max_watermark=batch.max_watermark,
            is_last=batch.is_last,
        )

    ctx.log(f"필드 매핑 완료: {total:,}건 · 출력 컬럼 {len(out_columns)}개", node_id=node.id)


def _map_row(row: dict[str, Any], mappings: list[dict[str, Any]], drop_unmapped: bool) -> dict[str, Any]:
    out: dict[str, Any] = {} if drop_unmapped else dict(row)
    for m in mappings:
        value = row.get(m["source"], m.get("default"))
        if value is None and "default" in m:
            value = m["default"]
        cast = m.get("cast")
        if cast:
            try:
                value = CASTS[cast](value)
            except (TypeError, ValueError):
                value = m.get("default")
        out[m["target"]] = value
        if not drop_unmapped and m["source"] != m["target"]:
            out.pop(m["source"], None)
    return out


def _max_watermark(a: Any, b: Any) -> Any:
    """두 워터마크 중 큰 값. None 과 비교 불가 타입을 관대하게 처리한다."""
    if a is None:
        return b
    if b is None:
        return a
    try:
        return b if b > a else a
    except TypeError:
        return b  # 비교 불가면 나중에 온 값을 택한다 (배치는 순서대로 온다)


def _python(node: PipelineNode, upstream: Iterator[RecordBatch], ctx: RunContext) -> Iterator[RecordBatch]:
    """사용자 Python 코드로 레코드를 전처리한다. 코드는 **격리 자식 프로세스**(pysandbox)
    에서 실행된다 — 워커의 시크릿·메타DB·커넥터에 접근할 수 없다.

    함수 이름으로 두 모드를 자동 구분한다:
      - ``def transform(row: dict) -> dict | None`` : **행 단위**. 각 행마다 호출, None 은 제외.
        상류를 스트리밍하며 처리해 메모리가 상수로 유지된다.
      - ``def transform_batch(df: pd.DataFrame) -> pd.DataFrame`` : **배치 단위**. 전체 행을
        하나의 DataFrame 으로 받아 한 번 호출한다. groupby·정렬·중복제거처럼 전체를 봐야 하는
        처리에 쓴다. 대신 **모든 행을 메모리에 올린다** — 대용량 소스에서는 주의.
    """
    code = str(node.params.get("code") or "").strip()
    if not code:
        raise ConfigurationError("Python 노드에 실행할 코드가 없습니다")

    def log_print(text: str) -> None:
        # 사용자 print 출력을 노드 로그로 흘려보낸다 (디버깅 편의). 줄 끝 공백은 정리.
        for ln in text.rstrip().splitlines():
            ctx.log(f"[print] {ln}", node_id=node.id)

    with PySandbox(code, on_output=log_print) as sandbox:
        if sandbox.mode == "batch":
            yield from _python_batch(node, upstream, ctx, sandbox)
        else:
            yield from _python_rows(node, upstream, ctx, sandbox)


def _python_rows(
    node: PipelineNode, upstream: Iterator[RecordBatch], ctx: RunContext, sandbox: PySandbox
) -> Iterator[RecordBatch]:
    """행 단위 — 상류 배치를 그대로 스트리밍하며 처리한다."""
    total = kept = dropped = 0
    out_columns: list[str] = []
    for batch in upstream:
        rows = sandbox.run_batch(batch.rows)
        if rows and not out_columns:
            out_columns = list(rows[0].keys())
        total += len(batch.rows)
        kept += len(rows)
        dropped += len(batch.rows) - len(rows)
        ctx.add_records(node.id, len(rows))
        yield RecordBatch(
            rows=rows,
            columns=out_columns or batch.columns,
            max_watermark=batch.max_watermark,
            is_last=batch.is_last,
        )

    ctx.log(f"Python 전처리 완료: 입력 {total:,}건 · 출력 {kept:,}건 · 제외 {dropped:,}건", node_id=node.id)


def _python_batch(
    node: PipelineNode, upstream: Iterator[RecordBatch], ctx: RunContext, sandbox: PySandbox
) -> Iterator[RecordBatch]:
    """배치 단위 — 상류 전체를 모아 DataFrame 한 번으로 처리한다 (전체 행 메모리 적재)."""
    all_rows: list[dict[str, Any]] = []
    watermark: Any = None
    src_columns: list[str] = []
    for batch in upstream:
        all_rows.extend(batch.rows)
        watermark = _max_watermark(watermark, batch.max_watermark)
        if batch.columns and not src_columns:
            src_columns = list(batch.columns)

    out_rows = sandbox.run_batch(all_rows)
    out_columns = list(out_rows[0].keys()) if out_rows else src_columns
    ctx.add_records(node.id, len(out_rows))
    ctx.log(
        f"Python 배치 전처리 완료: 입력 {len(all_rows):,}건 · 출력 {len(out_rows):,}건", node_id=node.id
    )
    yield RecordBatch(rows=out_rows, columns=out_columns, max_watermark=watermark, is_last=True)
