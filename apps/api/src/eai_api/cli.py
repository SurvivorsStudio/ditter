"""운영 CLI.

초기 관리자 생성은 API 를 거치지 않는다 — 인증이 걸린 엔드포인트로 첫 관리자를
만들 수는 없고, 무인증 부트스트랩 엔드포인트를 열어두면 그 자체가 취약점이기 때문이다.

    python -m eai_api.cli create-admin admin@company.com
    python -m eai_api.cli reset-password admin@company.com
    python -m eai_api.cli list-users
"""

from __future__ import annotations

import argparse
import getpass
import sys

from .auth.rbac import Role
from .db import session_scope
from .services import user_service
from .services.errors import ServiceError


def _read_password(prompt: str = "비밀번호") -> str:
    """비밀번호는 인자로 받지 않는다 — 셸 히스토리와 프로세스 목록에 남는다."""
    first = getpass.getpass(f"{prompt}: ")
    second = getpass.getpass(f"{prompt} 확인: ")
    if first != second:
        print("비밀번호가 일치하지 않습니다", file=sys.stderr)
        raise SystemExit(1)
    return first


def create_admin(email: str) -> int:
    password = _read_password()
    with session_scope() as session:
        if user_service.find_by_email(session, email) is not None:
            print(f"이미 존재하는 사용자입니다: {email}", file=sys.stderr)
            return 1
        try:
            user = user_service.create_user(
                session, email=email, password=password, roles=[str(Role.ADMIN)], display_name="관리자"
            )
        except ServiceError as exc:
            print(f"생성 실패: {exc}", file=sys.stderr)
            return 1
        print(f"관리자를 생성했습니다: {user.email} ({user.id})")
    return 0


def create_user(email: str, roles: list[str]) -> int:
    password = _read_password()
    with session_scope() as session:
        try:
            user = user_service.create_user(session, email=email, password=password, roles=roles)
        except ServiceError as exc:
            print(f"생성 실패: {exc}", file=sys.stderr)
            return 1
        print(f"사용자를 생성했습니다: {user.email} {user.roles}")
    return 0


def reset_password(email: str) -> int:
    password = _read_password("새 비밀번호")
    with session_scope() as session:
        user = user_service.find_by_email(session, email)
        if user is None:
            print(f"사용자를 찾을 수 없습니다: {email}", file=sys.stderr)
            return 1
        try:
            user_service.set_password(session, user.id, password)
        except ServiceError as exc:
            print(f"변경 실패: {exc}", file=sys.stderr)
            return 1
        print(f"비밀번호를 변경했습니다: {user.email}")
    return 0


def list_users() -> int:
    with session_scope() as session:
        users = user_service.list_users(session)
        if not users:
            print("등록된 사용자가 없습니다. create-admin 으로 초기 관리자를 만드세요.")
            return 0
        print(f"{'이메일':<34}{'역할':<28}{'상태':<8}마지막 로그인")
        for u in users:
            last = u.last_login_at.strftime("%Y-%m-%d %H:%M") if u.last_login_at else "-"
            state = "활성" if u.is_active else "비활성"
            print(f"{u.email:<34}{','.join(u.roles):<28}{state:<8}{last}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="eai-api", description="EAI 플랫폼 운영 CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("create-admin", help="초기 관리자 생성")
    p.add_argument("email")

    p = sub.add_parser("create-user", help="사용자 생성")
    p.add_argument("email")
    p.add_argument("--roles", default="viewer", help=f"쉼표 구분 ({', '.join(str(r) for r in Role)})")

    p = sub.add_parser("reset-password", help="비밀번호 재설정")
    p.add_argument("email")

    sub.add_parser("list-users", help="사용자 목록")

    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin(args.email)
    if args.command == "create-user":
        return create_user(args.email, [r.strip() for r in args.roles.split(",") if r.strip()])
    if args.command == "reset-password":
        return reset_password(args.email)
    return list_users()


if __name__ == "__main__":
    raise SystemExit(main())
