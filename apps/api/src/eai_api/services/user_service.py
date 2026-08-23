"""사용자 도메인 로직 — 인증, 생성, 역할 관리."""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth.passwords import WeakPasswordError, hash_password, needs_rehash, verify_password
from ..auth.rbac import Role
from ..models import User, utcnow
from .errors import ConflictError, NotFoundError, ValidationError

logger = logging.getLogger(__name__)


class AuthenticationFailed(Exception):
    """자격증명 불일치. 이유는 호출부에 알리지 않는다 — 계정 존재 여부가 새면 안 된다."""


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user(session: Session, user_id: str) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"사용자를 찾을 수 없습니다: {user_id}")
    return user


def find_by_email(session: Session, email: str) -> User | None:
    stmt = select(User).where(User.email == normalize_email(email))
    return session.execute(stmt).scalar_one_or_none()


def list_users(session: Session) -> list[User]:
    return list(session.execute(select(User).order_by(User.created_at)).scalars())


def count_users(session: Session) -> int:
    return int(session.execute(select(func.count(User.id))).scalar_one())


def _validate_roles(roles: list[str]) -> list[str]:
    valid = {str(r) for r in Role}
    unknown = [r for r in roles if r not in valid]
    if unknown:
        raise ValidationError(f"알 수 없는 역할: {unknown} (가능: {sorted(valid)})")
    if not roles:
        raise ValidationError("역할을 최소 하나 지정해야 합니다")
    return roles


def create_user(
    session: Session,
    *,
    email: str,
    password: str | None,
    roles: list[str],
    display_name: str = "",
) -> User:
    normalized = normalize_email(email)
    if find_by_email(session, normalized) is not None:
        raise ConflictError(f"이미 등록된 이메일입니다: {normalized}")

    _validate_roles(roles)
    try:
        password_hash = hash_password(password) if password else None
    except WeakPasswordError as exc:
        raise ValidationError(str(exc)) from exc

    user = User(
        email=normalized,
        display_name=display_name or normalized.split("@")[0],
        password_hash=password_hash,
        roles=roles,
        is_active=True,
    )
    session.add(user)
    session.flush()
    logger.info("사용자 생성: %s %s", user.email, user.roles)
    return user


def authenticate(session: Session, email: str, password: str) -> User:
    """이메일·비밀번호로 인증한다.

    실패 사유(없는 계정 / 틀린 비밀번호 / 비활성)를 구분해서 알리지 않는다 —
    계정 열거 공격의 단서가 되기 때문이다. 어느 경로든 해시 검증 비용을 치른다.
    """
    user = find_by_email(session, email)
    matched = verify_password(password, user.password_hash if user else None)

    if user is None or not matched or not user.is_active:
        logger.warning("로그인 실패: %s", normalize_email(email))
        raise AuthenticationFailed("이메일 또는 비밀번호가 올바르지 않습니다")

    if user.password_hash and needs_rehash(user.password_hash):
        # 해싱 파라미터가 올라갔다 — 평문을 들고 있는 지금이 갱신할 유일한 기회다
        user.password_hash = hash_password(password)

    user.last_login_at = utcnow()
    session.flush()
    return user


def set_password(session: Session, user_id: str, new_password: str) -> User:
    user = get_user(session, user_id)
    try:
        user.password_hash = hash_password(new_password)
    except WeakPasswordError as exc:
        raise ValidationError(str(exc)) from exc
    session.flush()
    return user


def set_roles(session: Session, user_id: str, roles: list[str]) -> User:
    user = get_user(session, user_id)
    _validate_roles(roles)

    # 마지막 관리자의 admin 을 뺏으면 아무도 사용자를 관리할 수 없게 된다
    if Role.ADMIN not in roles and Role.ADMIN in user.roles and _admin_count(session) <= 1:
        raise ValidationError("마지막 관리자의 admin 역할은 제거할 수 없습니다")

    user.roles = roles
    session.flush()
    return user


def set_active(session: Session, user_id: str, is_active: bool) -> User:
    user = get_user(session, user_id)
    if not is_active and Role.ADMIN in user.roles and _admin_count(session) <= 1:
        raise ValidationError("마지막 관리자는 비활성화할 수 없습니다")
    user.is_active = is_active
    session.flush()
    return user


def delete_user(session: Session, user_id: str) -> None:
    user = get_user(session, user_id)
    if Role.ADMIN in user.roles and _admin_count(session) <= 1:
        raise ValidationError("마지막 관리자는 삭제할 수 없습니다")
    session.delete(user)


def _admin_count(session: Session) -> int:
    # ARRAY 컬럼은 containment(@>) 로 검색한다
    stmt = select(func.count(User.id)).where(
        User.is_active.is_(True), User.roles.contains([str(Role.ADMIN)])
    )
    return int(session.execute(stmt).scalar_one())


def ensure_bootstrap_admin(session: Session, email: str, password: str) -> User | None:
    """사용자가 하나도 없을 때만 초기 관리자를 만든다.

    이미 누군가 있으면 아무것도 하지 않는다 — 재기동할 때마다 관리자가 되살아나거나
    비밀번호가 초기화되면 그 자체가 백도어다.
    """
    if count_users(session) > 0:
        return None
    user = create_user(
        session, email=email, password=password, roles=[str(Role.ADMIN)], display_name="관리자"
    )
    logger.warning("초기 관리자를 생성했습니다: %s — 첫 로그인 후 비밀번호를 변경하세요", user.email)
    return user
