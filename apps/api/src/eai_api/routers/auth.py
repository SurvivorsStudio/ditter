"""``/auth`` — 로그인, 내 정보, 사용자 관리 (설계 문서 §7 인증·인가)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth.rbac import Principal, Role, get_principal, require_role
from ..auth.tokens import create_access_token
from ..config import get_settings
from ..db import get_db
from ..models import User
from ..schemas.user import (
    LoginRequest,
    PasswordChange,
    PasswordReset,
    TokenResponse,
    UserActiveUpdate,
    UserCreate,
    UserOut,
    UserRolesUpdate,
)
from ..services import user_service
from ..services.user_service import AuthenticationFailed

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db)]


def _to_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=list(user.roles),
        is_active=user.is_active,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    try:
        user = user_service.authenticate(db, payload.email, payload.password)
    except AuthenticationFailed as exc:
        # 401 로 통일 — 어떤 이유로 실패했는지 알려주지 않는다
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    settings = get_settings()
    token = create_access_token(user.id, list(user.roles))
    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_ttl_seconds,
        user=_to_out(user),
    )


@router.get("/me", response_model=UserOut)
def me(db: DbSession, principal: Principal = Depends(get_principal)) -> UserOut:
    """토큰 주체의 정보. 인증이 꺼진 로컬 개발에서는 가상 관리자를 돌려준다."""
    if not get_settings().auth_enabled:
        from datetime import UTC, datetime

        return UserOut(
            id="local-dev",
            email="local@dev",
            display_name="로컬 개발자",
            roles=[str(Role.ADMIN)],
            is_active=True,
            created_at=datetime.now(UTC),
        )
    return _to_out(user_service.get_user(db, principal.subject))


@router.post("/me/password", response_model=UserOut)
def change_my_password(
    payload: PasswordChange, db: DbSession, principal: Principal = Depends(get_principal)
) -> UserOut:
    """본인 비밀번호 변경 — 현재 비밀번호를 반드시 확인한다."""
    user = user_service.get_user(db, principal.subject)
    try:
        user_service.authenticate(db, user.email, payload.current_password)
    except AuthenticationFailed as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "현재 비밀번호가 올바르지 않습니다") from exc
    return _to_out(user_service.set_password(db, user.id, payload.new_password))


# ------------------------------------------------------------- 사용자 관리


@router.get("/users", response_model=list[UserOut])
def list_users(db: DbSession, _: object = Depends(require_role(Role.ADMIN))) -> list[UserOut]:
    return [_to_out(u) for u in user_service.list_users(db)]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DbSession, _: object = Depends(require_role(Role.ADMIN))) -> UserOut:
    user = user_service.create_user(
        db,
        email=payload.email,
        password=payload.password,
        roles=payload.roles,
        display_name=payload.display_name,
    )
    return _to_out(user)


@router.patch("/users/{user_id}/roles", response_model=UserOut)
def update_roles(
    user_id: str,
    payload: UserRolesUpdate,
    db: DbSession,
    _: object = Depends(require_role(Role.ADMIN)),
) -> UserOut:
    return _to_out(user_service.set_roles(db, user_id, payload.roles))


@router.patch("/users/{user_id}/active", response_model=UserOut)
def update_active(
    user_id: str,
    payload: UserActiveUpdate,
    db: DbSession,
    _: object = Depends(require_role(Role.ADMIN)),
) -> UserOut:
    return _to_out(user_service.set_active(db, user_id, payload.is_active))


@router.post("/users/{user_id}/password", response_model=UserOut)
def reset_password(
    user_id: str,
    payload: PasswordReset,
    db: DbSession,
    _: object = Depends(require_role(Role.ADMIN)),
) -> UserOut:
    return _to_out(user_service.set_password(db, user_id, payload.new_password))


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_user(
    user_id: str,
    db: DbSession,
    principal: Principal = Depends(require_role(Role.ADMIN)),
) -> None:
    if user_id == principal.subject:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "자기 자신은 삭제할 수 없습니다")
    user_service.delete_user(db, user_id)
