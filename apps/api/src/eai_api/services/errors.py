"""서비스 계층 도메인 예외. 라우터가 HTTP 상태로 매핑한다."""

from __future__ import annotations


class ServiceError(Exception):
    status_code = 500


class NotFoundError(ServiceError):
    status_code = 404


class ConflictError(ServiceError):
    status_code = 409


class ValidationError(ServiceError):
    status_code = 422


class DependencyError(ServiceError):
    """외부 시스템(소스 DB, S3, Redis) 문제로 처리하지 못함."""

    status_code = 502


class PermissionDeniedError(ServiceError):
    """권한 부족 — 설정상 허용된 동작이지만 이 사용자가 할 수 없다."""

    status_code = 403
