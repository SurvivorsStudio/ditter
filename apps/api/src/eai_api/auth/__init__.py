"""인증·인가.

Phase 1 범위: JWT Bearer + 역할 기반 접근제어의 **골격**.
사용자 저장소·OAuth2 IdP 연동은 Phase 2 에서 붙인다 (설계 문서 §10).
``auth_enabled=False`` 면 로컬 개발용으로 admin 주체를 통과시킨다.
"""

from .passwords import hash_password, verify_password
from .rbac import Principal, Role, get_principal, require_role
from .tokens import create_access_token, decode_access_token

__all__ = [
    "Principal",
    "Role",
    "create_access_token",
    "decode_access_token",
    "get_principal",
    "hash_password",
    "require_role",
    "verify_password",
]
