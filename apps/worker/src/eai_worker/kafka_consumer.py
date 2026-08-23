"""Kafka 소비 구현 (Phase 4c). ``cdc_sink`` 의 ``SinkConsumer`` 계약을 만족한다.

**import 는 싸야 한다** (Phase 2 교훈). ``kafka`` 는 이 모듈이 실제로 인스턴스화될 때만
로딩한다 — cdc_sink 를 import 하는 것만으로 Kafka 드라이버가 프로세스에 올라오지 않도록.

오프셋은 여기서 자동 커밋하지 않는다(``enable_auto_commit=False``). 커밋 시점은 상위
루프(``run_once``)가 write 성공 뒤에만 잡는다 — at-least-once 의 핵심이다.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .cdc_sink import SinkRecord

logger = logging.getLogger(__name__)


class KafkaSinkConsumer:
    """kafka-python 기반 컨슈머. 컨슈머 그룹은 고정해 재시작 시 오프셋을 이어받는다."""

    GROUP_ID = "eai-cdc-sink"

    def __init__(self, topics: list[str], bootstrap_servers: str | None = None) -> None:
        from eai_api.config import get_settings
        from kafka import KafkaConsumer  # 지연 로딩 — import 시점에 드라이버를 끌어오지 않는다

        servers = bootstrap_servers or get_settings().kafka_bootstrap_servers
        self._consumer = KafkaConsumer(
            *topics,
            bootstrap_servers=servers.split(","),
            group_id=self.GROUP_ID,
            enable_auto_commit=False,  # 커밋은 write 성공 뒤 상위 루프가 명시적으로 한다
            auto_offset_reset="earliest",
            value_deserializer=_maybe_json,
            key_deserializer=_maybe_json,
        )
        logger.info("Kafka 구독: %s (group=%s)", ", ".join(topics) or "(없음)", self.GROUP_ID)

    def poll(self, timeout_ms: int, max_records: int) -> list[SinkRecord]:
        batches = self._consumer.poll(timeout_ms=timeout_ms, max_records=max_records)
        out: list[SinkRecord] = []
        for tp, messages in batches.items():
            for msg in messages:
                out.append(
                    SinkRecord(
                        topic=tp.topic,
                        value=msg.value,
                        key=msg.key if isinstance(msg.key, dict) else None,
                        partition=tp.partition,
                        offset=msg.offset,
                    )
                )
        return out

    def commit(self) -> None:
        self._consumer.commit()

    def resubscribe(self, topics: list[str]) -> None:
        """구독 토픽 집합을 통째로 갈아끼운다. 새 스트림이 생기면 상위 루프가 부른다.

        kafka-python 의 ``subscribe`` 는 이전 구독을 대체한다. 토픽이 없으면 unsubscribe.
        컨슈머 그룹은 그대로라 기존 토픽의 오프셋은 유지된다.
        """
        if topics:
            self._consumer.subscribe(topics)
        else:
            self._consumer.unsubscribe()
        logger.info("Kafka 재구독: %s", ", ".join(topics) or "(없음)")

    def close(self) -> None:
        self._consumer.close()


def _maybe_json(raw: bytes | None) -> Any:
    """Debezium JSON 컨버터 페이로드. tombstone 은 value 가 None 이다.

    커넥터는 schemas.enable=false 로 평평한 JSON 을 내보내지만, 워커 기본값이 스키마를 켜면
    ``{"schema":…, "payload":…}`` 봉투로 온다. 그 경우 payload 만 벗겨 쓴다 — 설정이 어긋나도
    sink 가 schema/payload 를 컬럼으로 착각해 조용히 깨지지 않도록.
    """
    if raw is None:
        return None
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if isinstance(parsed, dict) and set(parsed) == {"schema", "payload"}:
        return parsed["payload"]
    return parsed
