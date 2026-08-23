"""워터마크 인코딩 — 체크포인트 왕복에서 타입이 보존되어야 한다.

타입을 잃으면 다음 실행의 `incremental_column > watermark` 비교가 조용히 어긋난다.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from eai_worker.engine import _decode_watermark, _encode_watermark


def roundtrip(value: object) -> object:
    return _decode_watermark({"watermark": _encode_watermark(value)})


@pytest.mark.parametrize(
    "value",
    [
        datetime(2026, 7, 5, 1, 0, tzinfo=UTC),
        datetime(2026, 1, 1, 23, 59, 59),
        date(2026, 7, 5),
        Decimal("12345.6789"),
        42,
        "abc-999",
        0,
    ],
)
def test_roundtrip_preserves_value_and_type(value: object) -> None:
    result = roundtrip(value)
    assert result == value
    assert type(result) is type(value)


def test_timezone_is_preserved() -> None:
    original = datetime(2026, 7, 5, 1, 0, tzinfo=UTC)
    restored = roundtrip(original)
    assert isinstance(restored, datetime)
    assert restored.tzinfo is not None
    assert restored.utcoffset() == original.utcoffset()


def test_encoded_form_is_json_serializable() -> None:
    """JSONB 컬럼에 그대로 들어가야 하므로 순수 JSON 타입이어야 한다."""
    import json

    encoded = _encode_watermark(datetime(2026, 7, 5, tzinfo=UTC))
    assert json.loads(json.dumps(encoded)) == encoded


def test_untagged_legacy_value_passes_through() -> None:
    """태그 없는 옛 체크포인트도 읽을 수 있어야 한다 — 마이그레이션 없이 호환."""
    assert _decode_watermark({"watermark": 100}) == 100


def test_missing_watermark_is_none() -> None:
    assert _decode_watermark({}) is None


def test_corrupt_value_degrades_to_full_load() -> None:
    """복원에 실패하면 None → 전체 적재. 잘못된 증분보다 안전하다."""
    assert _decode_watermark({"watermark": {"kind": "datetime", "value": "쓰레기값"}}) is None
    assert _decode_watermark({"watermark": {"kind": "decimal", "value": "not-a-number"}}) is None
