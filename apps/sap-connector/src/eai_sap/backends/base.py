"""RFC 백엔드 계약.

SAP 접속은 **여기 한 곳으로만** 통한다. 그래야 NW RFC SDK 가 없는 환경(개발·CI)에서
목 백엔드로 갈아끼울 수 있다 (설계 문서 §13: 외부 의존은 목으로 우회 가능하게).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


class SapError(Exception):
    """SAP 계층의 모든 예외의 뿌리."""

    def __init__(self, message: str, *, code: str | None = None, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        #: 통신 오류처럼 재시도할 가치가 있는지. ABAP 예외는 다시 불러도 같은 결과다.
        self.retryable = retryable


class SapConnectionError(SapError):
    """접속 실패 (게이트웨이·자격증명·네트워크)."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message, code=code, retryable=True)


class SapCallError(SapError):
    """RFC 호출은 닿았으나 ABAP 쪽에서 거부 (권한·존재하지 않는 함수·잘못된 인자)."""


@runtime_checkable
class RfcBackend(Protocol):
    """NW RFC SDK 를 감싸는 최소 인터페이스."""

    def ping(self) -> dict[str, Any]:
        """접속 확인. 시스템 정보를 돌려준다."""
        ...

    def call(self, function_name: str, **params: Any) -> dict[str, Any]:
        """원격 함수 호출. 반환값은 SAP 이 준 구조 그대로."""
        ...

    def close(self) -> None: ...
