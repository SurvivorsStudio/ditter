"""NW RFC SDK 백엔드 (운영용).

SAP NetWeaver RFC SDK 는 **SAP 라이선스가 있어야 받을 수 있는 독점 바이너리**다.
저장소에 포함할 수 없고 pip 로도 설치되지 않는다. 컨테이너 빌드 시 별도로 넣어야 한다
(apps/sap-connector/Dockerfile 참고).

PyRFC 는 공식 유지보수가 중단되었지만(설계 문서 §2), SDK 를 파이썬에서 쓰는 실질적인
유일한 바인딩이다. 그래서 **여기 한 파일에만** 가둬 두고, 나머지 코드는 ``RfcBackend``
프로토콜만 안다. 나중에 바인딩을 바꿔도 이 파일만 교체하면 된다.
"""

from __future__ import annotations

import logging
from typing import Any

from .base import RfcBackend, SapCallError, SapConnectionError

logger = logging.getLogger(__name__)

#: 통신 계층 오류로 보이는 pyrfc 예외 이름 — 재시도할 가치가 있다
_RETRYABLE_EXC = {"CommunicationError", "ExternalRuntimeError", "RFCError"}


def _patch_python3_compat() -> None:
    """PyRFC 가 Python 2 시절의 ``long`` 을 참조한다 — 3.x 에는 없어서 그대로 두면 터진다.

    PyRFC 는 공식 유지보수가 중단되어(설계 문서 §2) 이 문제가 고쳐질 전망이 없다.
    현장에서 확인된 회피책이라, import **전에** 반드시 심어야 한다.
    """
    import builtins

    if not hasattr(builtins, "long"):
        builtins.long = int  # type: ignore[attr-defined]
        logger.debug("PyRFC 호환을 위해 builtins.long 을 int 로 별칭 처리했습니다")


class NwRfcBackend(RfcBackend):
    """pyrfc.Connection 을 감싼다. 커넥션은 지연 생성하고 재사용한다."""

    def __init__(self, params: dict[str, Any]) -> None:
        self._params = params
        self._conn: Any = None

    @property
    def connection(self) -> Any:
        if self._conn is None:
            _patch_python3_compat()
            try:
                from pyrfc import Connection
            except ImportError as exc:  # SDK/바인딩 미설치
                raise SapConnectionError(
                    "pyrfc 를 불러올 수 없습니다 — NW RFC SDK 와 pyrfc 설치를 확인하세요. "
                    "개발 환경이라면 EAI_SAP_BACKEND=mock 을 쓰세요."
                ) from exc
            try:
                self._conn = Connection(**self._params)
            except Exception as exc:
                raise SapConnectionError(_clean(exc), code=type(exc).__name__) from exc
        return self._conn

    def ping(self) -> dict[str, Any]:
        try:
            attrs = self.connection.get_connection_attributes()
        except Exception as exc:
            raise _wrap(exc) from exc
        return {
            "system_id": attrs.get("sysId", ""),
            "client": attrs.get("client", ""),
            "user": attrs.get("user", ""),
            "host": attrs.get("partnerHost", ""),
            "release": attrs.get("partnerRel", ""),
        }

    def call(self, function_name: str, **params: Any) -> dict[str, Any]:
        try:
            result: dict[str, Any] = self.connection.call(function_name, **params)
        except Exception as exc:
            raise _wrap(exc, function_name) from exc
        return result

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                logger.warning("SAP 커넥션 종료 실패", exc_info=True)
            self._conn = None


def _clean(exc: Exception) -> str:
    """pyrfc 예외 메시지를 한 줄로 정리한다. 자격증명이 섞이지 않도록 원문을 그대로 쓰지 않는다."""
    message = str(exc).strip().replace("\n", " ")
    return message[:500] or type(exc).__name__


def _wrap(exc: Exception, function_name: str | None = None) -> Exception:
    name = type(exc).__name__
    prefix = f"{function_name}: " if function_name else ""
    if name in _RETRYABLE_EXC:
        return SapConnectionError(f"{prefix}{_clean(exc)}", code=name)
    # ABAPRuntimeError·ABAPApplicationError 등 — 다시 불러도 결과가 같다
    return SapCallError(f"{prefix}{_clean(exc)}", code=name)
