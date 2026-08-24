"""파이프라인 변수 문법 — `$이름` 자리표시자의 **단일 출처**.

API 트리거로 들어온 값을 노드 설정에 꽂아 넣기 위한 최소 문법이다.
저작(저장 시 검증)·실행(치환)·UI(하이라이트)가 모두 이 규칙 하나를 본다.

이 모듈은 **아무것도 import 하지 않는 순수 모듈**이어야 한다. ``dag.py`` 가 이것을 import 하므로
여기서 ``dag`` 를 참조하면 순환한다. 프론트(`canvas/variables.ts`)가 같은 정규식을 복제하며,
양쪽 테스트에 동일한 사례를 넣어 한쪽만 고치면 둘 다 깨지도록 묶어 두었다.
"""

from __future__ import annotations

import re
from typing import Any, NamedTuple

#: 변수 이름 규칙 — 영문/숫자/밑줄, 숫자로 시작 불가.
#: 한글을 허용하지 않는 이유는 이 이름이 그대로 JSON 키·URL 쿼리·환경변수로 오가기 때문이다.
NAME_RE = r"[A-Za-z_][A-Za-z0-9_]*"

#: `$이름` 과 `${이름}` 둘 다 받는다. 중괄호형은 경계가 모호할 때 쓴다 —
#: `$table_suffix` 는 `$table` + `_suffix` 인지 알 수 없지만 `${table}_suffix` 는 분명하다.
VARIABLE_PATTERN = re.compile(rf"\$(?:\{{({NAME_RE})\}}|({NAME_RE}))")

#: 노드 결과 참조 — `${노드이름.컬럼}` 은 그 노드가 내놓은 **첫 행의 그 컬럼 값**이다.
#:
#: 트리거 변수와 달리 **중괄호가 필수**다. 노드 이름은 사람이 캔버스에서 붙인 이름이라
#: 한글·공백이 들어가는데, 경계 없이 `$` 뒤에 두면 어디까지가 이름인지 알 수 없다.
#:
#: 이름과 컬럼은 **마지막 점**으로 가른다 — 컬럼 쪽이 점을 못 쓰게 막아 그렇게 된다.
#: 둘 중 하나는 점을 포기해야 하는데, 이름은 사람이 짓는 것이라 제약이 없는 편이 낫다.
#: (`${주문.집계.dt}` → 노드 `주문.집계` 의 컬럼 `dt`)
#:
#: 컬럼 뒤의 `[]` 는 **모든 행의 그 컬럼**을 쉼표로 이어 붙인다 — `IN (...)` 을 위한 것이다.
#: (`${주문.id[]}` → `1, 2, 3`). 컬럼 이름에 대괄호를 못 쓰게 막아 경계를 만든다.
NODE_REF_PATTERN = re.compile(r"\$\{\s*([^{}$]+?)\s*\.\s*([^{}$.\[\]]+?)\s*(\[\s*\])?\s*\}")

#: 치환은 두 문법을 **한 번에** 훑는다 (노드 참조 1·2·3 / 트리거 변수 4·5).
#: 따로 훑으면 앞 단계가 꽂은 값 안의 `$` 를 뒤 단계가 다시 변수로 읽는다.
_SUBSTITUTION_PATTERN = re.compile(f"{NODE_REF_PATTERN.pattern}|{VARIABLE_PATTERN.pattern}")

#: `$$` 는 리터럴 `$` 로 탈출한다. 금액·정규식을 쓰는 설정에서 필요하다.
ESCAPE = "$$"
_ESCAPE_SENTINEL = "\x00EAI_DOLLAR\x00"

#: SQL 로 조립되는 파라미터. 여기 꽂히는 값은 주입 가드를 통과해야 한다.
#: 근본 해법은 바인드 파라미터지만 그건 ``ReadSpec`` 계약 개편이 필요해서, 지금은 값을 거절한다.
SQL_CONTEXT_KEYS = frozenset({"query", "where", "filter", "sql"})

#: **Python 코드**로 조립되는 파라미터 (transform.python 노드의 ``code``).
#:
#: 여기서는 JSON 표기가 통하지 않는다 — `true`·`null` 을 그대로 꽂으면 NameError 다.
#: 그래서 값을 Python 리터럴로 만든다. 문자열 낱값만 예외로 원문 그대로 둔다:
#: 사용자가 `x = "${집계.dt}"` 처럼 따옴표를 직접 붙이는 것이 기존 규칙이라, 여기서 또
#: 감싸면 `x = "'2026-08-01'"` 이 된다. **낱값은 직접, 목록은 자동** — SQL 과 같은 규칙이다.
#:
#: 주입 가드는 걸지 않는다. 목록 원소는 ``repr`` 로 감싸 문자열을 벗어날 수 없고,
#: 코드는 어차피 격리 샌드박스에서 돈다 — 여기서 따옴표를 막으면 O'Brien 을 못 쓴다.
PY_CONTEXT_KEYS = frozenset({"code"})

#: SQL 문맥에서 거절하는 조각. 문자열을 닫거나 문장을 잇거나 주석으로 뒤를 죽이는 것들.
_INJECTION_TOKENS = ("'", '"', ";", "--", "/*", "*/", "\\")


class NodeRef(NamedTuple):
    """`${노드이름.컬럼}` 한 건. 값 묶음에서는 ``key`` 로 찾는다.

    ``many`` 면 `${이름.컬럼[]}` — 첫 행이 아니라 **모든 행**의 그 컬럼이다.
    같은 컬럼이라도 낱값과 목록은 만드는 방법이 달라 키를 구분한다.
    """

    node: str
    column: str
    many: bool = False

    @property
    def key(self) -> str:
        return f"{self.node}.{self.column}[]" if self.many else f"{self.node}.{self.column}"

    def __str__(self) -> str:
        return "${" + self.key + "}"


class VariableError(ValueError):
    """변수 문법·값 관련 오류의 공통 조상."""


class MissingVariableError(VariableError):
    """치환할 값이 없다.

    빈 문자열로 대체하지 않는 것이 핵심이다. `WHERE updated_at > '$since'` 에서 값이 비면
    `> ''` 가 되어 **전체 재적재**가 조용히 일어난다. 조용한 사고보다 시끄러운 실패가 낫다.
    """


class InvalidVariableValueError(VariableError):
    """SQL 문맥에 넣을 수 없는 값 (따옴표·세미콜론·주석)."""


def extract(text: str) -> list[str]:
    """문자열에서 참조된 변수 이름을 등장 순서대로, 중복 없이 뽑는다."""
    if not text or "$" not in text:
        return []

    names: list[str] = []
    for match in VARIABLE_PATTERN.finditer(_mask_escapes(_mask_dollar_quotes(text)[0])):
        name = match.group(1) or match.group(2)
        if name not in names:
            names.append(name)
    return names


def extract_from_params(params: dict[str, Any] | None) -> list[str]:
    """노드 파라미터 전체(중첩 dict/list 포함)에서 참조된 변수를 모은다."""
    names: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, str):
            for name in extract(value):
                if name not in names:
                    names.append(name)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)

    walk(params or {})
    return names


def extract_node_refs(text: str) -> list[NodeRef]:
    """문자열에서 참조된 노드 결과를 등장 순서대로, 중복 없이 뽑는다."""
    if not text or "$" not in text:
        return []

    refs: list[NodeRef] = []
    for match in NODE_REF_PATTERN.finditer(_mask_escapes(_mask_dollar_quotes(text)[0])):
        ref = NodeRef(match.group(1), match.group(2), match.group(3) is not None)
        if ref not in refs:
            refs.append(ref)
    return refs


def extract_node_refs_from_params(params: dict[str, Any] | None) -> list[NodeRef]:
    """노드 파라미터 전체(중첩 dict/list 포함)에서 참조된 노드 결과를 모은다."""
    refs: list[NodeRef] = []

    def walk(value: Any) -> None:
        if isinstance(value, str):
            for ref in extract_node_refs(value):
                if ref not in refs:
                    refs.append(ref)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)

    walk(params or {})
    return refs


def substitute(text: str, values: dict[str, Any], *, context_key: str | None = None) -> str:
    """`$이름` 과 `${노드이름.컬럼}` 을 값으로 바꾼다. 값이 없으면 ``MissingVariableError``.

    ``context_key`` 가 SQL 로 조립되는 자리(query·where…)면 값에 주입 가드를 건다.
    노드 결과는 원격 데이터에서 온 값이라 가드가 **더** 중요하다 — 트리거 변수는 호출자가
    보낸 것이라 받는 시점에 한 번 걸러지지만, 노드 결과는 실행 도중에야 정체를 안다.
    """
    if not text or "$" not in text:
        return text

    key_lower = context_key.lower() if context_key is not None else None
    guard = key_lower in SQL_CONTEXT_KEYS
    python = key_lower in PY_CONTEXT_KEYS
    # 프로시저·함수 본문($procedure$ … $procedure$)은 치환 대상에서 빼 둔다.
    dq_text, dq_blocks = _mask_dollar_quotes(text)
    masked = _mask_escapes(dq_text)

    def replace(match: re.Match[str]) -> str:
        # 노드 참조(1·2·3)와 트리거 변수(4·5)를 **한 번의 순회**로 처리한다. 두 번 훑으면
        # 앞 단계가 꽂아 넣은 값 안의 `$` 를 뒤 단계가 다시 변수로 읽는다.
        if match.group(1) is not None:
            ref = NodeRef(match.group(1), match.group(2), match.group(3) is not None)
            if ref.key not in values:
                raise MissingVariableError(f"노드 결과 값이 없습니다: {ref}")
            if ref.many:
                return render_list(ref.key, values[ref.key], guard=guard, python=python)
            name, raw = ref.key, values[ref.key]
        else:
            name = match.group(4) or match.group(5)
            if name not in values:
                raise MissingVariableError(f"변수 값이 없습니다: ${name}")
            raw = values[name]

        # 문자열은 사용자가 따옴표를 붙이는 자리라 원문 그대로 둔다 (위 PY_CONTEXT_KEYS 참고)
        rendered = _py_literal(raw) if python and not isinstance(raw, str) else render(raw)
        if guard:
            _assert_sql_safe(name, rendered)
        return rendered

    return _restore_dollar_quotes(
        _unmask_escapes(_SUBSTITUTION_PATTERN.sub(replace, masked)), dq_blocks
    )


#: `${...}` 껍데기 전부 — 안이 무엇이든 일단 잡는다.
_BRACED_PATTERN = re.compile(r"\$\{([^{}]*)\}")


def malformed_placeholders(params: dict[str, Any] | None) -> list[str]:
    """변수 이름도 노드 참조도 아닌 `${...}`.

    이런 것은 치환되지 않고 **글자 그대로 남는다**. `${주문조회.}` 같은 오타가 SQL 에
    그대로 실려 나가면 원인을 찾기 어려우니, 저작 시점에 알려주기 위한 목록이다.
    """
    found: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, str):
            if "$" not in value:
                return
            for match in _BRACED_PATTERN.finditer(_mask_escapes(_mask_dollar_quotes(value)[0])):
                inner = match.group(1)
                if re.fullmatch(NAME_RE, inner) or NODE_REF_PATTERN.fullmatch(match.group(0)):
                    continue
                if match.group(0) not in found:
                    found.append(match.group(0))
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)

    walk(params or {})
    return found


def substitute_params(params: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    """노드 파라미터를 통째로 치환한다. 최상위 키를 SQL 문맥 판단에 쓴다.

    중첩 구조 안에서도 그 키를 물려준다 — `params["query"]` 든
    `params["query"]["text"]` 든 결국 SQL 로 조립되는 것은 같다.
    """

    def walk(value: Any, context_key: str | None) -> Any:
        if isinstance(value, str):
            return substitute(value, values, context_key=context_key)
        if isinstance(value, dict):
            return {k: walk(v, context_key or k) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(item, context_key) for item in value]
        return value

    return {key: walk(value, key) for key, value in params.items()}


def render(value: Any) -> str:
    """치환에 쓸 문자열 표현.

    ``True`` 를 `"True"` 로 넣으면 SQL 이 못 알아듣는다. JSON 쪽 표기(true/false/null)로 맞춘다.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def render_list(name: str, raw: Any, *, guard: bool = False, python: bool = False) -> str:
    """`${이름.컬럼[]}` 을 `IN (...)` 이나 Python 리스트 안쪽에 넣을 문자열로 만든다.

    **원소의 따옴표는 우리가 붙인다.** 낱값(`'$since'`)은 사용자가 직접 감싸지만 목록은
    원소마다 감싸야 해서 손으로 쓸 방법이 없다. SQL 자리에서는 가드를 먼저 통과시킨 뒤에
    붙인다 — 순서가 뒤집히면 그 따옴표가 그대로 주입 통로가 된다.

    빈 목록은 만들지 않는다. `IN ()` 은 문법 오류이고, `IN (NULL)` 로 때우면 "아무것도
    안 맞는다"가 조용히 지나가 원인을 찾을 수 없다.
    """
    if not isinstance(raw, (list, tuple)):
        raise VariableError(f"${{{name}}} 는 목록이어야 합니다: {type(raw).__name__}")
    if not raw:
        raise MissingVariableError(
            f"${{{name}}} 가 빈 목록입니다 — 참조한 노드가 행을 내지 않았습니다"
        )

    parts: list[str] = []
    for item in raw:
        if python:
            parts.append(_py_literal(item))
            continue
        rendered = render(item)
        if guard:
            _assert_sql_safe(name, rendered)
            parts.append(_sql_literal(item, rendered))
        else:
            parts.append(rendered)
    return ", ".join(parts)


def _sql_literal(value: Any, rendered: str) -> str:
    """SQL 리터럴 표기. 문자만 따옴표로 감싼다 — 숫자를 감싸면 비교가 문자열 비교가 된다."""
    if value is None or isinstance(value, (bool, int, float)):
        return rendered
    return f"'{rendered}'"


def _py_literal(value: Any) -> str:
    """Python 리터럴 표기. `repr` 이 따옴표·역슬래시를 알아서 이스케이프한다 —
    직접 감싸면 O'Brien 같은 값에서 문자열이 깨진다."""
    if value is None:
        return "None"
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return str(value)
    return repr(str(value))


def missing(required: list[str], values: dict[str, Any]) -> list[str]:
    """참조됐지만 값이 없는 변수. 실행 전 사전 점검용."""
    return [name for name in required if name not in values]


def sql_context_names(params: dict[str, Any] | None) -> set[str]:
    """SQL 로 조립되는 자리에 꽂히는 변수 이름.

    호출을 **받는 시점에** 주입 가드를 걸기 위한 것이다. 치환할 때만 검사하면 Run 이
    먼저 만들어지고 실행에서 실패하는데, 잘못된 값이라는 것은 그 전에 알 수 있다.
    """
    found: set[str] = set()

    def walk(value: Any, context_key: str | None) -> None:
        if isinstance(value, str):
            if context_key and context_key.lower() in SQL_CONTEXT_KEYS:
                found.update(extract(value))
        elif isinstance(value, dict):
            for key, item in value.items():
                walk(item, context_key or key)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item, context_key)

    for key, value in (params or {}).items():
        walk(value, key)
    return found


def assert_sql_safe(name: str, value: Any) -> None:
    """SQL 자리에 꽂아도 되는 값인지. 치환 전에도 부를 수 있게 공개한다."""
    _assert_sql_safe(name, render(value))


def _assert_sql_safe(name: str, rendered: str) -> None:
    for token in _INJECTION_TOKENS:
        if token in rendered:
            raise InvalidVariableValueError(
                f"${name} 의 값에 SQL 로 해석될 수 있는 문자가 있습니다: {token!r}. "
                "쿼리·조건절에 꽂는 값에는 따옴표·세미콜론·주석을 넣을 수 없습니다."
            )
    if any(ch < " " for ch in rendered):
        raise InvalidVariableValueError(f"${name} 의 값에 제어문자가 있습니다.")


def _mask_escapes(text: str) -> str:
    return text.replace(ESCAPE, _ESCAPE_SENTINEL)


def _unmask_escapes(text: str) -> str:
    return text.replace(_ESCAPE_SENTINEL, "$")


#: PL/pgSQL 달러 인용 여는 구분자 ($tag$, tag 는 이름). 프로시저·함수 본문이 여기 담긴다.
_DOLLAR_OPEN = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)\$")
_DQ_MARK = "\x00DQ"
_DQ_RESTORE = re.compile(r"\x00DQ(\d+)\x00")


def _mask_dollar_quotes(text: str) -> tuple[str, list[str]]:
    """달러 인용 블록($tag$ … $tag$)을 자리표시자로 빼낸다.

    빼 두지 않으면 `$procedure$` 의 `$procedure` 를 변수로 오인해 실행이 깨진다.
    이름 없는 `$$`(빈 태그)는 이스케이프와 모호하므로 건드리지 않는다 — 이름 있는 태그만.
    """
    if "$" not in text:
        return text, []
    blocks: list[str] = []
    out: list[str] = []
    last = 0
    pos = 0
    while True:
        m = _DOLLAR_OPEN.search(text, pos)
        if not m:
            break
        delim = m.group(0)
        close = text.find(delim, m.end())
        if close < 0:  # 짝이 없으면 인용 블록이 아니다 — 변수로 둔다
            pos = m.end()
            continue
        end = close + len(delim)
        out.append(text[last : m.start()])
        out.append(f"{_DQ_MARK}{len(blocks)}\x00")
        blocks.append(text[m.start() : end])
        last = end
        pos = end
    if not blocks:
        return text, []
    out.append(text[last:])
    return "".join(out), blocks


def _restore_dollar_quotes(text: str, blocks: list[str]) -> str:
    if not blocks:
        return text
    return _DQ_RESTORE.sub(lambda m: blocks[int(m.group(1))], text)
