"""인증·인가 — 역할 계층, 비밀번호 해싱, 토큰."""

from __future__ import annotations

import time

import pytest

from eai_api.auth.passwords import (
    MIN_PASSWORD_LENGTH,
    WeakPasswordError,
    hash_password,
    validate_strength,
    verify_password,
)
from eai_api.auth.rbac import Principal, Role
from eai_api.auth.tokens import TokenError, create_access_token, decode_access_token


class TestRoleHierarchy:
    """상위 역할은 하위 역할의 권한을 포함한다."""

    def test_admin_implies_everything(self) -> None:
        admin = Principal("u", frozenset({Role.ADMIN}))
        assert all(admin.has(r) for r in Role)

    def test_editor_implies_operator_and_viewer(self) -> None:
        editor = Principal("u", frozenset({Role.EDITOR}))
        assert editor.has(Role.EDITOR)
        assert editor.has(Role.OPERATOR)
        assert editor.has(Role.VIEWER)
        assert not editor.has(Role.ADMIN)

    def test_operator_implies_viewer_only(self) -> None:
        operator = Principal("u", frozenset({Role.OPERATOR}))
        assert operator.has(Role.OPERATOR)
        assert operator.has(Role.VIEWER)
        assert not operator.has(Role.EDITOR)
        assert not operator.has(Role.ADMIN)

    def test_viewer_implies_nothing_higher(self) -> None:
        viewer = Principal("u", frozenset({Role.VIEWER}))
        assert viewer.has(Role.VIEWER)
        assert not viewer.has(Role.OPERATOR)
        assert not viewer.has(Role.EDITOR)
        assert not viewer.has(Role.ADMIN)

    def test_no_roles_grants_nothing(self) -> None:
        nobody = Principal("u", frozenset())
        assert not any(nobody.has(r) for r in Role)

    def test_multiple_roles_union(self) -> None:
        multi = Principal("u", frozenset({Role.VIEWER, Role.EDITOR}))
        assert multi.has(Role.EDITOR)
        assert not multi.has(Role.ADMIN)


class TestPasswordHashing:
    def test_hash_is_not_the_plaintext(self) -> None:
        plain = "Correct!horse2026"
        assert hash_password(plain) != plain

    def test_hash_uses_argon2id(self) -> None:
        assert hash_password("Correct!horse2026").startswith("$argon2id$")

    def test_same_password_hashes_differently(self) -> None:
        """솔트가 있으므로 같은 비밀번호도 매번 다른 해시가 나와야 한다."""
        plain = "Correct!horse2026"
        assert hash_password(plain) != hash_password(plain)

    def test_correct_password_verifies(self) -> None:
        assert verify_password("Correct!horse2026", hash_password("Correct!horse2026"))

    def test_wrong_password_fails(self) -> None:
        assert not verify_password("wrong!horse2026", hash_password("Correct!horse2026"))

    def test_missing_hash_never_verifies(self) -> None:
        """OIDC 전용 계정(해시 없음)은 로컬 로그인을 통과시키면 안 된다."""
        assert not verify_password("anything123", None)

    def test_garbage_hash_fails_without_raising(self) -> None:
        assert not verify_password("anything123", "not-a-real-hash")

    def test_missing_hash_still_costs_time(self) -> None:
        """계정 존재 여부가 응답 시간으로 새면 안 된다."""
        real = hash_password("Correct!horse2026")

        start = time.perf_counter()
        verify_password("guess!2026abc", real)
        with_hash = time.perf_counter() - start

        start = time.perf_counter()
        verify_password("guess!2026abc", None)
        without_hash = time.perf_counter() - start

        # 정확히 같을 수는 없지만 자릿수가 달라선 안 된다 (더미 해시 검증이 도는지 확인)
        assert without_hash > with_hash / 10


class TestPasswordStrength:
    def test_short_password_rejected(self) -> None:
        with pytest.raises(WeakPasswordError, match=str(MIN_PASSWORD_LENGTH)):
            validate_strength("Ab!1")

    def test_digits_only_rejected(self) -> None:
        with pytest.raises(WeakPasswordError, match="문자와 숫자"):
            validate_strength("12345678901")

    def test_letters_only_rejected(self) -> None:
        with pytest.raises(WeakPasswordError, match="문자와 숫자"):
            validate_strength("abcdefghijk")

    def test_mixed_password_accepted(self) -> None:
        validate_strength("Correct!horse2026")

    def test_hash_rejects_weak_password(self) -> None:
        with pytest.raises(WeakPasswordError):
            hash_password("short1")


class TestTokens:
    def test_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _use_test_secret(monkeypatch)
        token = create_access_token("user-1", ["admin", "viewer"])
        claims = decode_access_token(token)
        assert claims["sub"] == "user-1"
        assert claims["roles"] == ["admin", "viewer"]
        assert claims["iss"] == "eai-platform"

    def test_expired_token_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _use_test_secret(monkeypatch)
        token = create_access_token("user-1", ["viewer"], ttl_seconds=-1)
        with pytest.raises(TokenError, match="만료"):
            decode_access_token(token)

    def test_tampered_token_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _use_test_secret(monkeypatch)
        token = create_access_token("user-1", ["viewer"])
        header, payload, signature = token.split(".")
        forged = f"{header}.{payload}.{signature[:-4]}AAAA"
        with pytest.raises(TokenError):
            decode_access_token(forged)

    def test_token_signed_with_other_secret_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """서명 키가 바뀌면 이전 토큰은 전부 무효가 되어야 한다."""
        _use_test_secret(monkeypatch, "1" * 64)
        token = create_access_token("user-1", ["admin"])
        _use_test_secret(monkeypatch, "2" * 64)
        with pytest.raises(TokenError):
            decode_access_token(token)


def _use_test_secret(monkeypatch: pytest.MonkeyPatch, secret: str = "a" * 64) -> None:
    from eai_api import config

    config.get_settings.cache_clear()
    monkeypatch.setenv("EAI_JWT_SECRET", secret)
    monkeypatch.setenv("EAI_LOCAL_SECRET_KEY", "x")
