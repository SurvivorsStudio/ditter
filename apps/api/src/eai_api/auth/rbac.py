"""역할 기반 접근제어."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..config import get_settings
from .tokens import TokenError, decode_access_token


class Role(StrEnum):
    VIEWER = "viewer"  # 읽기 전용
    OPERATOR = "operator"  # 파이프라인 실행/중단
    EDITOR = "editor"  # 연결·파이프라인 편집
    ADMIN = "admin"  # 전체


#: 상위 역할은 하위 역할의 권한을 포함한다
_IMPLIES: dict[Role, set[Role]] = {
    Role.ADMIN: {Role.ADMIN, Role.EDITOR, Role.OPERATOR, Role.VIEWER},
    Role.EDITOR: {Role.EDITOR, Role.OPERATOR, Role.VIEWER},
    Role.OPERATOR: {Role.OPERATOR, Role.VIEWER},
    Role.VIEWER: {Role.VIEWER},
}


@dataclass(frozen=True, slots=True)
class Principal:
    subject: str
    roles: frozenset[Role] = field(default_factory=frozenset)

    def has(self, required: Role) -> bool:
        return any(required in _IMPLIES[r] for r in self.roles)


LOCAL_ADMIN = Principal(subject="local-dev", roles=frozenset({Role.ADMIN}))

_bearer = HTTPBearer(auto_error=False)


def get_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Principal:
    if not get_settings().auth_enabled:
        return LOCAL_ADMIN
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "인증이 필요합니다")
    try:
        claims = decode_access_token(credentials.credentials)
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    roles: set[Role] = set()
    for raw in claims.get("roles", []):
        try:
            roles.add(Role(raw))
        except ValueError:
            continue  # 모르는 역할은 무시 — 권한을 넓히는 방향으로 실패하지 않는다
    principal = Principal(subject=str(claims.get("sub", "")), roles=frozenset(roles))
    request.state.principal = principal
    return principal


def require_role(required: Role) -> Callable[[Principal], Principal]:
    """라우터 의존성: ``Depends(require_role(Role.EDITOR))``."""

    def dependency(principal: Principal = Depends(get_principal)) -> Principal:
        if not principal.has(required):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"{required} 권한이 필요합니다")
        return principal

    return dependency
