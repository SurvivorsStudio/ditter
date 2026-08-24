"""CdcStream — 실시간 CDC 스트림의 수명주기 (Phase 4, docs/PHASE4_CDC_기획안.md §4.1).

배치의 ``Run`` 과 별개인 이유는 실행 모델이 근본적으로 다르기 때문이다.
``Run`` 은 ``pending→running→success/failed`` 로 **끝나지만**, CDC 스트림은 끝나지 않고
``running↔paused`` 를 오가다 ``stopped`` 로 내린다. 하나의 모델에 두 수명주기를 욱여넣으면
상태 전이가 서로를 오염시킨다.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_uuid


class StreamEngine(StrEnum):
    """이 스트림을 실제로 돌리는 엔진.

    수명주기(provisioning→running↔paused→stopped/failed)·지표·모니터 화면이 완전히 같아서
    모델을 하나로 둔다. 다른 것은 **무엇이 변경을 잡아 어디로 보내는가** 뿐이다.

    - ``debezium``    : 로그 기반 CDC → Kafka → 우리 Sink Worker 가 적재 (Phase 4)
    - ``symmetricds`` : 원본 트리거 → SYM_DATA → SymmetricDS 노드끼리 HTTP 직송.
      **데이터가 우리 프로세스를 지나지 않는다** — 그래서 변환 노드를 붙일 수 없다.
    """

    DEBEZIUM = "debezium"
    SYMMETRICDS = "symmetricds"


class CdcStreamStatus(StrEnum):
    #: Debezium 커넥터를 등록하는 중 (아직 이벤트가 흐르지 않음)
    PROVISIONING = "provisioning"
    RUNNING = "running"
    PAUSED = "paused"
    FAILED = "failed"
    STOPPED = "stopped"


#: 아직 살아 있어 사용자가 제어할 수 있는 상태 — 연결 삭제 등을 막는 근거가 된다
CDC_ACTIVE_STATUSES = frozenset(
    {CdcStreamStatus.PROVISIONING, CdcStreamStatus.RUNNING, CdcStreamStatus.PAUSED}
)


class CdcStream(Base, TimestampMixin):
    __tablename__ = "cdc_streams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    #: 캔버스 정의는 Pipeline 을 그대로 재사용한다 (CDC 소스·타깃 노드로 그린 DAG)
    pipeline_id: Mapped[str] = mapped_column(
        ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=CdcStreamStatus.PROVISIONING, index=True
    )
    #: 이 스트림을 돌리는 엔진. 기존 행은 전부 Debezium 이라 서버 기본값을 그것으로 둔다.
    engine: Mapped[str] = mapped_column(
        String(16), nullable=False, default=StreamEngine.DEBEZIUM, index=True
    )
    #: Kafka Connect 에 등록된 Debezium 커넥터 이름 (eai.<stream_id>). 4b 에서 채운다.
    debezium_connector: Mapped[str | None] = mapped_column(String(255))
    #: CDC 를 켠 소스 연결. 다른 노드처럼 id 참조만 두고 하드 FK 는 걸지 않는다
    #: (connections 는 pipeline jsonb 에서도 FK 없이 참조된다 — 사용처는 서비스가 계산).
    source_connection_id: Mapped[str | None] = mapped_column(String(36), index=True)
    #: 적재 대상 연결. Debezium 경로는 타깃이 여러 개일 수 있어 DAG 에서 읽지만,
    #: SymmetricDS 는 노드 그룹 링크가 소스↔타깃 한 쌍이라 여기 하나로 확정된다.
    target_connection_id: Mapped[str | None] = mapped_column(String(36), index=True)
    #: 이 스트림이 구독하는 Kafka 토픽들 (Debezium 전용)
    topics: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    #: 엔진별 부속 정보. SymmetricDS 면 {engine_name, node_group, trigger_ids, router_ids,
    #: channels, tables}. 정지할 때 무엇을 지워야 하는지의 근거라 반드시 남겨야 한다 —
    #: DAG 를 다시 읽어 추정하면 그 사이 파이프라인이 수정됐을 때 유령 트리거가 남는다.
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: 실시간 지표 스냅샷 {events_total, eps, lag_ms, per_table:{...}}.
    #: 진실의 원천은 Kafka/컨슈머 오프셋이고 이것은 UI 편의용 캐시다 (events.py 철학).
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text)

    @property
    def is_active(self) -> bool:
        return self.status in CDC_ACTIVE_STATUSES

    @property
    def is_symmetricds(self) -> bool:
        return self.engine == StreamEngine.SYMMETRICDS

    def __repr__(self) -> str:
        return f"<CdcStream {self.id[:8]} {self.engine}/{self.status}>"
