"""사전과 `t()` 의 계약.

**이 파일이 배치 1에서 가장 중요하다.** 프론트에는 `keyof typeof MESSAGES` 가 있어
없는 키를 쓰면 컴파일이 막지만, 파이썬에는 그런 장치가 없고 mypy 도 문자열 키를 못 본다.
그 검사를 대신하는 것이 여기 `test_every_t_call_uses_a_known_key` 다.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from eai_api.i18n import MESSAGES, get_locale, locale_from_header, t
from eai_api.i18n.locale import _locale
from eai_api.i18n.messages import MODULES

SRC = Path(__file__).resolve().parents[1] / "src" / "eai_api"
SLOT = re.compile(r"\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}")

#: 키를 리터럴로 받는 호출들 — 첫 인자(또는 지정 위치)가 사전 키다.
#: `_issue(level, key, ...)` 는 두 번째, 나머지는 첫 번째.
_KEY_ARG = {"t": 0, "_issue": 1}


@pytest.fixture(autouse=True)
def _reset_locale():
    token = _locale.set("ko")
    yield
    _locale.reset(token)


# ---------------------------------------------------------------- 사전


def test_every_key_has_both_languages() -> None:
    for key, pair in MESSAGES.items():
        assert len(pair) == 2, key
        assert pair[0].strip(), f"{key}: ko 가 비었다"
        assert pair[1].strip(), f"{key}: en 이 비었다"


def test_no_duplicate_keys_across_modules() -> None:
    # dict 병합은 중복 키를 조용히 덮어쓴다 — 합계와 크기가 갈리면 어딘가 겹쳤다.
    total = sum(len(m) for m in MODULES)
    assert total == len(MESSAGES), "사전 모듈 사이에 중복 키가 있다"


def test_slots_match_between_ko_and_en() -> None:
    # 번역하다 {table} 을 빠뜨리면 그 자리가 조용히 비어 나간다.
    for key, (ko, en) in MESSAGES.items():
        ko_slots = {m.group(1) for m in SLOT.finditer(ko)}
        en_slots = {m.group(1) for m in SLOT.finditer(en)}
        assert ko_slots == en_slots, f"{key}: 슬롯이 다르다 ko={ko_slots} en={en_slots}"


def _literal_keys() -> set[str]:
    """소스에서 `t("리터럴")` · `_issue(level, "리터럴")` 의 키를 모은다."""
    found: set[str] = set()
    for path in SRC.rglob("*.py"):
        if "i18n" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            pos = _KEY_ARG.get(node.func.id)
            if pos is None or len(node.args) <= pos:
                continue
            arg = node.args[pos]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                found.add(arg.value)
    return found


def test_every_t_call_uses_a_known_key() -> None:
    # 파이썬에는 keyof 가 없다 — 오타를 잡아 주는 것은 이 테스트뿐이다.
    unknown = sorted(_literal_keys() - set(MESSAGES))
    assert not unknown, f"사전에 없는 키를 쓴다: {unknown}"


def test_no_orphan_keys() -> None:
    # 사전만 남고 코드에서 사라진 문구 — 없애지 않으면 사전이 썩는다.
    orphans = sorted(set(MESSAGES) - _literal_keys())
    assert not orphans, f"아무도 쓰지 않는 키: {orphans}"


# ---------------------------------------------------------------- t()


def test_default_locale_is_ko_outside_request() -> None:
    # 기존 테스트 160여 건이 이 기본값 위에 서 있다. 워커 안전도 같은 근거다.
    assert get_locale() == "ko"


def test_interpolation_contract() -> None:
    MESSAGES["_test.plain"] = ("이름은 {name} 입니다", "The name is {name}")
    MESSAGES["_test.count"] = ("{n}건", "{n} row{n||s}")
    try:
        assert t("_test.plain", name="주문") == "이름은 주문 입니다"
        # 빠뜨린 변수는 자리 그대로 — 조용히 빈칸이 되면 원인을 못 찾는다
        assert t("_test.plain") == "이름은 {name} 입니다"
        # int 는 자릿수 구분까지 (프론트 toLocaleString 과 결과가 같다)
        assert t("_test.count", n=1234) == "1,234건"
        # 값 안의 중괄호가 다시 해석되지 않는다 (re.sub 는 치환 결과를 재스캔하지 않는다)
        assert t("_test.plain", name="{name}") == "이름은 {name} 입니다"

        _locale.set("en")
        assert t("_test.count", n=1) == "1 row"
        assert t("_test.count", n=3) == "3 rows"
    finally:
        del MESSAGES["_test.plain"]
        del MESSAGES["_test.count"]


def test_unknown_key_returns_the_key_instead_of_raising() -> None:
    # 오류 문구 자리에서 예외를 던지면 진짜 오류를 가린다.
    assert t("nope.missing") == "nope.missing"


# ---------------------------------------------------------------- Accept-Language


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("en", "en"),
        ("en-US", "en"),
        ("en-US,en;q=0.9,ko;q=0.8", "en"),
        ("ko", "ko"),
        ("ko-KR,en;q=0.9", "ko"),  # 첫 태그만 본다 — 협상하지 않는다
        (None, "ko"),
        ("", "ko"),
        ("*", "ko"),
        ("zz", "ko"),
        ("english", "ko"),  # `en` 또는 `en-*` 만 en 이다
    ],
)
def test_locale_from_header(header: str | None, expected: str) -> None:
    assert locale_from_header(header) == expected
