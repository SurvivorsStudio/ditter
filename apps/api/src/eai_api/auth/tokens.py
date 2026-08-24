"""JWT 발급/검증."""

from __future__ import annotations

import time
from typing import Any

import jwt

from ..config import get_settings


class TokenError(Exception):
    pass


def create_access_token(subject: str, roles: list[str], *, ttl_seconds: int | None = None) -> str:
    s = get_settings()
    if not s.jwt_secret:
        raise RuntimeError("EAI_JWT_SECRET 이 설정되지 않았습니다")
    now = int(time.time())
    payload = {
        "sub": subject,
        "roles": roles,
        "iat": now,
        "exp": now + (ttl_seconds or s.jwt_ttl_seconds),
        "iss": "eai-platform",
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    s = get_settings()
    try:
        decoded: dict[str, Any] = jwt.decode(
            token, s.jwt_secret, algorithms=[s.jwt_algorithm], issuer="eai-platform"
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("토큰이 만료되었습니다") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError(f"유효하지 않은 토큰입니다: {exc}") from exc
    return decoded
