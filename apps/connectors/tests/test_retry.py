"""재시도 정책 테스트."""

from __future__ import annotations

import pytest

from eai_connectors.errors import ConfigurationError, ConnectionFailed, ConnectorError
from eai_connectors.retry import backoff_delay, with_retry


def test_succeeds_without_retry() -> None:
    calls = []

    @with_retry(attempts=3, sleep=lambda _: None)
    def fn() -> str:
        calls.append(1)
        return "ok"

    assert fn() == "ok"
    assert len(calls) == 1


def test_retries_then_succeeds() -> None:
    calls: list[int] = []

    @with_retry(attempts=3, sleep=lambda _: None)
    def fn() -> str:
        calls.append(1)
        if len(calls) < 3:
            raise ConnectionFailed("일시적 오류")
        return "ok"

    assert fn() == "ok"
    assert len(calls) == 3


def test_raises_last_error_after_exhausting_attempts() -> None:
    calls: list[int] = []

    @with_retry(attempts=2, sleep=lambda _: None)
    def fn() -> None:
        calls.append(1)
        raise ConnectionFailed("계속 실패")

    with pytest.raises(ConnectionFailed, match="계속 실패"):
        fn()
    assert len(calls) == 2


def test_configuration_error_is_not_retried() -> None:
    """설정 오류는 몇 번을 다시 해도 같은 결과다 — 즉시 포기해야 한다."""
    calls: list[int] = []

    @with_retry(attempts=5, sleep=lambda _: None)
    def fn() -> None:
        calls.append(1)
        raise ConfigurationError("host 누락")

    with pytest.raises(ConfigurationError):
        fn()
    assert len(calls) == 1


def test_unrelated_exception_propagates_immediately() -> None:
    calls: list[int] = []

    @with_retry(attempts=3, retry_on=(ConnectorError,), sleep=lambda _: None)
    def fn() -> None:
        calls.append(1)
        raise KeyError("전혀 다른 오류")

    with pytest.raises(KeyError):
        fn()
    assert len(calls) == 1


def test_sleep_delays_grow_and_are_capped() -> None:
    delays: list[float] = []

    @with_retry(attempts=5, base_delay=1.0, max_delay=4.0, sleep=delays.append)
    def fn() -> None:
        raise ConnectionFailed("실패")

    with pytest.raises(ConnectionFailed):
        fn()
    assert len(delays) == 4  # 마지막 시도 뒤에는 자지 않는다
    assert all(0 <= d <= 4.0 for d in delays)


def test_backoff_delay_respects_cap() -> None:
    assert backoff_delay(10, base=1.0, cap=8.0, jitter=False) == 8.0
    assert backoff_delay(1, base=0.5, cap=8.0, jitter=False) == 0.5


def test_attempts_must_be_at_least_one() -> None:
    with pytest.raises(ValueError, match="attempts"):
        with_retry(attempts=0)
