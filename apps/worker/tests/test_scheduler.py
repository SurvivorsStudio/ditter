"""스케줄러 — cron 발화 계산과 중복 실행 방지."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from eai_worker.scheduler import SLOT_TTL_SECONDS, claim_slot, due_fire_time


class FakeRedis:
    """SETNX 의미만 흉내내는 최소 대역."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool | None:
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True


SEOUL = ZoneInfo("Asia/Seoul")


class TestDueFireTime:
    def test_daily_cron_returns_previous_fire(self) -> None:
        now = datetime(2026, 7, 23, 5, 30, tzinfo=SEOUL)
        fired = due_fire_time("0 2 * * *", "Asia/Seoul", now)
        assert fired is not None
        assert (fired.hour, fired.minute) == (2, 0)
        assert fired.day == 23

    def test_before_todays_fire_returns_yesterday(self) -> None:
        now = datetime(2026, 7, 23, 1, 0, tzinfo=SEOUL)
        fired = due_fire_time("0 2 * * *", "Asia/Seoul", now)
        assert fired is not None
        assert fired.day == 22

    def test_hourly_cron(self) -> None:
        now = datetime(2026, 7, 23, 5, 30, tzinfo=SEOUL)
        fired = due_fire_time("0 * * * *", "Asia/Seoul", now)
        assert fired is not None
        assert (fired.hour, fired.minute) == (5, 0)

    def test_timezone_is_respected(self) -> None:
        """같은 순간이라도 타임존이 다르면 발화 시각이 달라야 한다."""
        now = datetime(2026, 7, 23, 5, 30, tzinfo=UTC)
        seoul = due_fire_time("0 2 * * *", "Asia/Seoul", now)
        utc = due_fire_time("0 2 * * *", "UTC", now)
        assert seoul is not None and utc is not None
        assert seoul.astimezone(UTC) != utc.astimezone(UTC)

    def test_invalid_cron_returns_none(self) -> None:
        assert due_fire_time("이건 cron 이 아님", "Asia/Seoul", datetime.now(UTC)) is None

    def test_unknown_timezone_falls_back_instead_of_crashing(self) -> None:
        fired = due_fire_time("0 2 * * *", "Mars/Olympus", datetime(2026, 7, 23, 5, 30, tzinfo=UTC))
        assert fired is not None


class TestClaimSlot:
    def test_first_claim_wins(self) -> None:
        client = FakeRedis()
        fire = datetime(2026, 7, 23, 2, 0, tzinfo=SEOUL)
        assert claim_slot(client, "p1", fire) is True  # type: ignore[arg-type]

    def test_second_claim_on_same_slot_loses(self) -> None:
        """beat 를 여러 개 띄워도 한 발화는 한 번만 실행돼야 한다."""
        client = FakeRedis()
        fire = datetime(2026, 7, 23, 2, 0, tzinfo=SEOUL)
        assert claim_slot(client, "p1", fire) is True  # type: ignore[arg-type]
        assert claim_slot(client, "p1", fire) is False  # type: ignore[arg-type]

    def test_different_slots_are_independent(self) -> None:
        client = FakeRedis()
        a = datetime(2026, 7, 23, 2, 0, tzinfo=SEOUL)
        b = datetime(2026, 7, 24, 2, 0, tzinfo=SEOUL)
        assert claim_slot(client, "p1", a) is True  # type: ignore[arg-type]
        assert claim_slot(client, "p1", b) is True  # type: ignore[arg-type]

    def test_different_pipelines_are_independent(self) -> None:
        client = FakeRedis()
        fire = datetime(2026, 7, 23, 2, 0, tzinfo=SEOUL)
        assert claim_slot(client, "p1", fire) is True  # type: ignore[arg-type]
        assert claim_slot(client, "p2", fire) is True  # type: ignore[arg-type]

    def test_redis_failure_skips_rather_than_double_fires(self) -> None:
        """Redis 가 죽었을 때 중복 실행보다 미실행이 안전하다."""
        import redis

        class BrokenRedis:
            def set(self, *_: object, **__: object) -> bool:
                raise redis.RedisError("down")

        fire = datetime(2026, 7, 23, 2, 0, tzinfo=SEOUL)
        assert claim_slot(BrokenRedis(), "p1", fire) is False  # type: ignore[arg-type]


def test_slot_ttl_outlives_tick_interval() -> None:
    """TTL 이 틱 주기보다 짧으면 잠금이 풀려 중복 실행이 난다."""
    from eai_worker.scheduler import TICK_SECONDS

    assert SLOT_TTL_SECONDS > TICK_SECONDS * 10


@pytest.mark.parametrize("cron", ["0 2 * * *", "*/5 * * * *", "0 0 1 * *", "30 4 * * 1"])
def test_common_cron_expressions_parse(cron: str) -> None:
    assert due_fire_time(cron, "Asia/Seoul", datetime(2026, 7, 23, 12, 0, tzinfo=UTC)) is not None
