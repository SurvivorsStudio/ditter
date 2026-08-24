"""비밀번호 해싱.

Argon2id 를 쓴다 — 메모리 하드 함수라 GPU 대량 공격에 강하다.
검증 실패 시에도 **같은 시간**이 걸리도록 존재하지 않는 사용자에게도 더미 해시를 검증한다
(타이밍으로 계정 존재 여부가 새는 것을 막는다).
"""

from __future__ import annotations

import logging

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

logger = logging.getLogger(__name__)

_hasher = PasswordHasher()

#: 존재하지 않는 계정에 대해서도 검증 비용을 치르기 위한 더미 해시.
#: **임포트 시점에 만들지 않는다** — Argon2 해싱은 네이티브 라이브러리에서 수백 ms 걸리는
#: 실제 연산이고, 그것이 임포트 부작용으로 일어나면 Celery prefork 워커가 fork() 할 때
#: macOS 에서 ObjC 런타임 초기화와 충돌해 죽는다. 첫 검증 때 한 번만 만든다.
_dummy_hash: str | None = None

MIN_PASSWORD_LENGTH = 10


def _get_dummy_hash() -> str:
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = _hasher.hash("this-password-never-matches-anything")
    return _dummy_hash


class WeakPasswordError(ValueError):
    pass


def hash_password(plain: str) -> str:
    validate_strength(plain)
    return _hasher.hash(plain)


def verify_password(plain: str, password_hash: str | None) -> bool:
    """비밀번호를 검증한다. 해시가 없어도 더미 검증으로 같은 시간을 쓴다."""
    target = password_hash or _get_dummy_hash()
    try:
        _hasher.verify(target, plain)
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:
        logger.exception("비밀번호 검증 중 예외")
        return False
    # 해시가 애초에 없던 계정(OIDC 전용)은 로컬 로그인을 허용하지 않는다
    return password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    """해싱 파라미터가 올라갔으면 다음 로그인 때 조용히 갱신한다."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def validate_strength(plain: str) -> None:
    if len(plain) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(f"비밀번호는 최소 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다")
    if plain.isdigit() or plain.isalpha():
        raise WeakPasswordError("비밀번호는 문자와 숫자를 함께 포함해야 합니다")
