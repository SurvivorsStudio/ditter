"""BAPI 호출.

설계 문서 §5 는 "가능하면 BAPI 우선"이라고 못박는다. 이유가 있다 — BAPI 는
512자 행폭 제약이 없고, 구조화된 결과와 표준 ``RETURN`` 메시지를 준다.
RFC_READ_TABLE 은 테이블을 날것으로 긁는 최후 수단에 가깝다.

**BAPI 는 예외를 던지지 않는다.** 실패해도 호출은 성공하고 ``RETURN`` 테이블에
타입 E(오류)·A(중단) 메시지가 담긴다. 이걸 확인하지 않으면 실패를 성공으로 착각한다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .backends.base import RfcBackend, SapCallError

logger = logging.getLogger(__name__)

#: BAPI RETURN 메시지 타입 — E(오류)/A(중단)는 실패, W(경고)/S(성공)/I(정보)는 통과
ERROR_TYPES = frozenset({"E", "A"})
WARNING_TYPES = frozenset({"W"})


@dataclass(frozen=True, slots=True)
class BapiMessage:
    type: str
    id: str = ""
    number: str = ""
    message: str = ""

    def __str__(self) -> str:
        code = f"{self.id}{self.number}" if self.id or self.number else ""
        return f"[{self.type}{' ' + code if code else ''}] {self.message}"


@dataclass
class BapiResult:
    rows: list[dict[str, Any]]
    #: 결과를 꺼낸 테이블 파라미터 이름
    table_name: str
    messages: list[BapiMessage] = field(default_factory=list)
    raw_keys: list[str] = field(default_factory=list)

    @property
    def warnings(self) -> list[str]:
        return [str(m) for m in self.messages if m.type in WARNING_TYPES]


def parse_return(raw: Any) -> list[BapiMessage]:
    """RETURN 파라미터를 메시지 목록으로 정규화한다.

    BAPI 마다 RETURN 이 테이블이기도 하고 단일 구조이기도 하다 — 둘 다 받는다.
    """
    if not raw:
        return []
    entries = raw if isinstance(raw, list) else [raw]
    messages = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        msg_type = str(entry.get("TYPE", "")).strip().upper()
        if not msg_type:
            continue
        messages.append(
            BapiMessage(
                type=msg_type,
                id=str(entry.get("ID", "")).strip(),
                number=str(entry.get("NUMBER", "")).strip(),
                message=str(entry.get("MESSAGE") or entry.get("MESSAGE_V1") or "").strip(),
            )
        )
    return messages


def raise_on_error(messages: list[BapiMessage], function_name: str) -> None:
    """오류 메시지가 있으면 실패로 올린다."""
    errors = [m for m in messages if m.type in ERROR_TYPES]
    if errors:
        detail = "; ".join(str(m) for m in errors[:5])
        raise SapCallError(f"{function_name} 실패 — {detail}", code="BAPI_RETURN_ERROR")


def call_bapi(
    backend: RfcBackend,
    *,
    function_name: str,
    parameters: dict[str, Any] | None = None,
    result_table: str | None = None,
) -> BapiResult:
    """BAPI 를 호출하고 결과 테이블을 행 목록으로 돌려준다.

    ``result_table`` 을 지정하지 않으면 RETURN 을 제외한 테이블 파라미터 중
    행이 있는 것을 자동으로 고른다 — 대부분의 조회 BAPI 는 결과 테이블이 하나뿐이다.
    """
    function_name = function_name.upper()
    raw = backend.call(function_name, **(parameters or {}))

    messages = parse_return(raw.get("RETURN"))
    raise_on_error(messages, function_name)  # 성공으로 착각하지 않도록 먼저 본다

    table_key = result_table.upper() if result_table else _guess_result_table(raw)
    if table_key is None:
        raise SapCallError(
            f"{function_name} 의 결과 테이블을 찾지 못했습니다 — result_table 을 지정하세요 "
            f"(반환 키: {sorted(k for k in raw if k != 'RETURN')})",
            code="RESULT_TABLE_NOT_FOUND",
        )

    payload = raw.get(table_key)
    if payload is None:
        raise SapCallError(
            f"{function_name} 응답에 {table_key} 가 없습니다 "
            f"(반환 키: {sorted(k for k in raw if k != 'RETURN')})",
            code="RESULT_TABLE_NOT_FOUND",
        )

    rows = _normalize_rows(payload)
    if messages:
        logger.info("%s RETURN 메시지 %d건", function_name, len(messages))
    return BapiResult(
        rows=rows,
        table_name=table_key,
        messages=messages,
        raw_keys=sorted(k for k in raw if k != "RETURN"),
    )


def _guess_result_table(raw: dict[str, Any]) -> str | None:
    """RETURN 을 뺀 나머지 중 행이 담긴 리스트 파라미터를 고른다."""
    candidates = [
        key
        for key, value in raw.items()
        if key != "RETURN" and isinstance(value, list) and value and isinstance(value[0], dict)
    ]
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        # 여러 개면 고르지 않는다 — 엉뚱한 테이블을 조용히 집는 것보다 물어보는 게 낫다
        logger.warning("결과 테이블 후보가 여러 개입니다: %s", candidates)
    return None


def _normalize_rows(payload: Any) -> list[dict[str, Any]]:
    """테이블 파라미터를 행 목록으로 맞춘다. 값은 문자열 공백만 정리한다."""
    entries = payload if isinstance(payload, list) else [payload]
    rows = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        rows.append({k: v.strip() if isinstance(v, str) else v for k, v in entry.items()})
    return rows
