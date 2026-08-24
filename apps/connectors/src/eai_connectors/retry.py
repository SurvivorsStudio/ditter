"""지수 백오프 재시도. 커넥터 내부에서 사용한다 (설계 문서 §5)."""

from __future__ import annotations

import functools
import logging
import random
import time
from collections.abc import Callable
from typing import ParamSpec, TypeVar

from .errors import NON_RETRYABLE, ConnectorError

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

DEFAULT_ATTEMPTS = 3
DEFAULT_BASE_DELAY = 0.5
DEFAULT_MAX_DELAY = 8.0


def backoff_delay(attempt: int, base: float, cap: float, jitter: bool = True) -> float:
    """attempt(1부터) 에 대한 지수 백오프 지연. full jitter 로 thundering herd 회피."""
    raw = min(cap, base * (2 ** (attempt - 1)))
    return random.uniform(0, raw) if jitter else raw


def with_retry(
    attempts: int = DEFAULT_ATTEMPTS,
    *,
    base_delay: float = DEFAULT_BASE_DELAY,
    max_delay: float = DEFAULT_MAX_DELAY,
    retry_on: tuple[type[BaseException], ...] = (ConnectorError,),
    sleep: Callable[[float], None] = time.sleep,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """일시적 실패를 지수 백오프로 재시도한다.

    제너레이터에는 쓰지 말 것 — 스트리밍 도중 재시도는 배치 중복을 만든다.
    스트리밍은 커넥션 획득 단계에만 재시도를 건다.
    """
    if attempts < 1:
        raise ValueError("attempts 는 1 이상이어야 합니다")

    def decorator(fn: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            last: BaseException | None = None
            for attempt in range(1, attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except NON_RETRYABLE:
                    raise
                except retry_on as exc:
                    last = exc
                    if attempt == attempts:
                        break
                    delay = backoff_delay(attempt, base_delay, max_delay)
                    logger.warning(
                        "%s 실패 (%d/%d), %.2fs 후 재시도: %s", fn.__qualname__, attempt, attempts, delay, exc
                    )
                    sleep(delay)
            assert last is not None
            raise last

        return wrapper

    return decorator
