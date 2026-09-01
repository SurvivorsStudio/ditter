"""다국어 문구 조회 `t(key, **vars)` — 프론트 `web/src/i18n/index.ts` 와 같은 계약.

사전은 **[ko, en] 쌍 튜플**이다. 별도 en 사전을 두면 키가 한쪽에만 있는 상태가 생기는데,
쌍으로 묶으면 그 상태가 자료구조상 불가능하고 리뷰에서 두 언어가 나란히 보인다.

보간은 두 형태다 (정규식까지 프론트와 같다):

- ``{name}``            — vars["name"] 치환. int 는 자릿수 구분(1,234)까지 맞춘다.
- ``{n|단수|복수}``      — vars["n"] == 1 이면 단수, 아니면 복수. 한국어에는 복수형이
  없어 ko 문구에는 쓸 일이 없고, en 의 ``{n} row{n||s}`` 같은 자리를 위한 최소 장치다.

**`str.format` 을 쓰지 않는 이유**: 사용자 데이터에 `{` 가 들어오면 그대로 터진다
(테이블명·변수명·SQL 조각이 전부 이 자리에 온다). `re.sub` + 콜백은 치환 결과를
**재스캔하지 않아** 값 안의 중괄호가 다시 해석될 일도 없다.

**모르는 키는 키를 그대로 돌려준다** (프론트와 같다, 예외를 던지지 않는다).
오류 메시지를 만드는 자리에서 번역이 터지면 진짜 오류를 가린다. 대신 경고를 남기고,
`tests/test_i18n.py` 가 AST 로 소스를 훑어 CI 에서 잡는다.

## 조사(을/를·이/가)를 자동으로 고르지 않는다

종성 계산(`(ord(ch) - 0xAC00) % 28`)으로 `이/가` 를 고르는 방법이 있지만 **기각한다.**

- 라틴·숫자로 끝나는 값에서 틀린다. `S3` 는 "에스쓰리"로 읽혀 종성이 없지만 코드는 모른다.
  `table1`·`customers` 도 마찬가지다. 이 자리에 오는 값이 대부분 그런 식별자다.
- **조용히** 틀린다. 잘못 고른 조사는 어떤 테스트도 빨갛게 만들지 않는다.
- `이(가)` 는 이미 한국 소프트웨어의 표준 회피형이다. 어색하지만 **정확**하다.

규칙: `이(가)`·`은(는)` 는 **슬롯이 사용자 데이터일 때만** 쓴다. 고정 명사가 관여하면
그 문장은 자기 키를 갖는다 (문장을 조립하지 않는다 — 아래).

## 문장을 조립하지 않는다

슬롯에는 **번역 대상이 아닌 값만** 넣는다 — 식별자·숫자·사용자 데이터·이미 join 된 목록.
슬롯에 들어갈 값이 사전에서 온다면 그 분기는 **키 선택으로 올린다.** 번역된 낱말을 번역된
문장에 끼우면 어순이 다른 언어에서 깨지고("S3 does not" ↔ "Local files do not"),
한국어 조사도 맞출 수 없다.

보간 이름은 여섯 개로 고정한다 — `{i}`(1-based 순번) `{n}`(개수) `{name}`(식별자·사용자
입력) `{list}`(**호출부에서 이미 join 한** 문자열) `{allowed}`(허용값 열거)
`{cause}`(예외 문자열, **항상 문장 끝**). join 을 사전 안에서 하지 않는 이유는 구분자가
언어를 타는 순간 사전이 코드가 되기 때문이고, `{cause}` 를 끝에 두는 이유는 번역할 수 없는
텍스트(드라이버 예외)가 문장 중간에 오면 en 어순에서 문장이 두 동강 나기 때문이다.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .locale import (
    DEFAULT_LOCALE,
    Locale,
    get_locale,
    locale_from_header,
    set_locale,
)
from .messages import MESSAGES

logger = logging.getLogger(__name__)

#: `{name}` 과 `{n|단수|복수}` 를 함께 잡는다 (프론트 index.ts 의 SLOT 과 같은 정규식).
_SLOT = re.compile(r"\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}")


#: 자릿수 구분(1,234)을 붙이는 슬롯. **`{n}`(개수) 하나뿐이다.**
#:
#: 처음엔 모든 int 에 붙였는데 `{line}`(줄 번호)과 `{i}`(순번)까지 걸렸다 —
#: `줄 1,024` 는 편집기 go-to-line 에 붙여넣을 수 없고 `case #1,000` 은 개수로 읽힌다.
#: 게다가 사용자가 보낸 값을 되돌려 주는 `{name}` 에도 붙어(`channel: 1234567` →
#: `1,234,567`) 보낸 것과 다른 값을 보여 준다.
_GROUPED_SLOTS = frozenset({"n"})


def _render(name: str, value: Any) -> str:
    # bool 은 int 의 하위 타입이라 먼저 걸러야 True 가 "1" 이 되지 않는다.
    if isinstance(value, bool):
        return str(value)
    # ko-KR 과 en-US 는 둘 다 3자리 콤마라 로케일 분기가 필요 없다.
    # float 은 `1,234.0` 이 되어 프론트와 갈리므로 개수 자리에는 int 만 넘긴다.
    if name in _GROUPED_SLOTS and isinstance(value, int):
        return f"{value:,}"
    return str(value)


def _interpolate(text: str, vars: dict[str, Any]) -> str:
    if not vars:
        return text

    def sub(m: re.Match[str]) -> str:
        name, one, many = m.group(1), m.group(2), m.group(3)
        if name not in vars:
            return m.group(0)  # 빠뜨린 변수는 자리 그대로 — 조용히 빈칸이 되면 원인을 못 찾는다
        value = vars[name]
        if one is not None and many is not None:
            return one if value == 1 else many
        return _render(name, value)

    return _SLOT.sub(sub, text)


def t(key: str, **vars: Any) -> str:
    """현재 요청의 언어로 문구를 만든다. 요청 밖에서는 한국어."""
    pair = MESSAGES.get(key)
    if pair is None:
        # 오류 문구 자리에서 예외를 던지면 진짜 오류를 가린다 — 키를 그대로 보이고 알린다.
        logger.warning("사전에 없는 문구 키: %s", key)
        return key
    text = pair[0] if get_locale() == "ko" else pair[1]
    return _interpolate(text, vars)


__all__ = [
    "DEFAULT_LOCALE",
    "MESSAGES",
    "Locale",
    "get_locale",
    "locale_from_header",
    "set_locale",
    "t",
]
