"""백엔드 선택 + 커넥션 풀.

방안 A: 접속 정보가 요청 body 로 온다(``credentials.py``). SAP 커넥션은 비싸므로
접속 정보별로 백엔드를 캐시해 재사용한다 — 같은 SAP 시스템으로의 반복 호출이
매번 새 세션을 열지 않도록.

``nwrfc`` 는 pyrfc 를 지연 임포트한다 — 목 백엔드로 돌 때 SDK 가 없어도 기동해야 한다.
"""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict

from ..config import SapBackendKind, Settings
from ..credentials import SapCredentials
from .base import RfcBackend, SapCallError, SapConnectionError, SapError

logger = logging.getLogger(__name__)

#: 동시에 유지할 SAP 커넥션 수 상한. 넘으면 가장 오래 안 쓴 것을 닫는다.
MAX_POOLED = 8

_mock: RfcBackend | None = None
#: 접속정보 해시 → 백엔드. LRU 로 관리한다.
_pool: OrderedDict[str, RfcBackend] = OrderedDict()


def _params_key(params: dict[str, str]) -> str:
    """접속 파라미터로 안정적인 캐시 키를 만든다.

    비밀번호가 섞이지만 해시라 로그·메모리에 평문이 남지 않는다. 같은 접속 정보는
    같은 키가 되어 커넥션이 재사용된다.
    """
    blob = "\x1f".join(f"{k}={params[k]}" for k in sorted(params))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _mock_backend(settings: Settings) -> RfcBackend:
    global _mock
    if _mock is None:
        from .mock import MockRfcBackend

        _mock = MockRfcBackend(settings.mock_fixture)
    return _mock


def resolve_backend(settings: Settings, credentials: SapCredentials | None = None) -> RfcBackend:
    """이 요청을 처리할 백엔드를 고른다.

    - 목 백엔드: 픽스처 기반이라 접속 정보를 무시한다 (단일 인스턴스).
    - nwrfc: 요청 접속 정보를 우선 쓰고, 없으면 ``.env`` 폴백. 접속 정보별로 캐시한다.
    """
    if settings.backend is SapBackendKind.MOCK:
        return _mock_backend(settings)

    if credentials is not None and not credentials.is_empty():
        params = credentials.to_params()
    else:
        params = settings.connection_params()  # .env 폴백
    if not params:
        raise SapConnectionError(
            "SAP 접속 정보가 없습니다 — 연결 설정에 호스트·클라이언트·사용자를 넣거나 "
            "사이드카 .env(EAI_SAP_*)에 폴백을 설정하세요",
            code="NO_CREDENTIALS",
        )

    key = _params_key(params)
    cached = _pool.get(key)
    if cached is not None:
        _pool.move_to_end(key)  # 최근 사용으로 표시
        return cached

    from .nwrfc import NwRfcBackend

    backend: RfcBackend = NwRfcBackend(params)
    _pool[key] = backend
    _pool.move_to_end(key)
    logger.info("SAP 백엔드 신규 (풀 %d/%d)", len(_pool), MAX_POOLED)
    _evict_if_needed()
    return backend


def _evict_if_needed() -> None:
    while len(_pool) > MAX_POOLED:
        _, victim = _pool.popitem(last=False)  # 가장 오래 안 쓴 것
        try:
            victim.close()
        except Exception:
            logger.warning("풀에서 밀려난 커넥션 종료 실패", exc_info=True)


def reset_backends() -> None:
    """모든 커넥션을 버린다 (테스트·복구용)."""
    global _mock
    for backend in _pool.values():
        try:
            backend.close()
        except Exception:
            logger.warning("백엔드 종료 실패", exc_info=True)
    _pool.clear()
    if _mock is not None:
        _mock.close()
        _mock = None


__all__ = [
    "RfcBackend",
    "SapCallError",
    "SapConnectionError",
    "SapError",
    "reset_backends",
    "resolve_backend",
]
