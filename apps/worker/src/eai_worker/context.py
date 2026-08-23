"""실행 컨텍스트 — 노드 실행기가 진행상황을 보고하는 통로.

메타DB 갱신과 Redis 이벤트 발행을 한 곳에 묶어, 노드 실행기가
"어디에 어떻게 보고하는지"를 몰라도 되게 한다 (설계 문서 §6).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from eai_api.db import session_scope
from eai_api.models import LogLevel, Run, RunLog, utcnow
from eai_api.services import events
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

#: 로그 폭주를 막는 상한. 초과분은 요약 한 줄로 대체한다.
MAX_LOGS_PER_NODE = 200


@dataclass
class NodeState:
    status: str = "pending"  # pending | running | success | failed | skipped
    records: int = 0
    message: str = ""
    location: str | None = None
    #: 노드 실행 결과 샘플 {columns, rows, truncated}. 단일 노드 실행에서만 채운다 —
    #: 전체 실행에서 노드마다 채우면 node_states 가 커지고 WS 로 반복 전송된다.
    sample: dict[str, Any] | None = None
    #: API 트리거가 하류로 넘긴 **값 그 자체** {이름: 값}. 엣지에 띄우는 것이 이것이다 —
    #: 사용자가 보낸 `{"since": "kim"}` 이 그대로 선을 타고 넘어간다는 모델.
    handed: dict[str, Any] | None = None
    #: 그 값으로 하류 노드 설정이 어떻게 바뀌었는지 {하류_노드_id: {파라미터: 치환된 값}}.
    #: 엣지 상세(모달)에서 저작↔실행을 대비해 보여준다. 트리거에만 채운다.
    applied: dict[str, dict[str, Any]] | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "status": self.status,
            "records": self.records,
            "message": self.message,
            "location": self.location,
        }
        if self.sample is not None:
            data["sample"] = self.sample
        if self.handed is not None:
            data["handed"] = self.handed
        if self.applied is not None:
            data["applied"] = self.applied
        return data


@dataclass
class RunContext:
    run_id: str
    pipeline_id: str
    full_refresh: bool = False
    #: API 트리거로 주입된 `$변수` 값 {이름: 값}. 실행 첫 단계에서 노드 파라미터에 치환된다.
    variables: dict[str, Any] = field(default_factory=dict)
    node_states: dict[str, NodeState] = field(default_factory=dict)
    #: 소스 노드 id → 이번 실행에서 관측한 최대 워터마크.
    #: 적재가 전부 성공한 뒤에만 체크포인트로 승격된다.
    watermarks: dict[str, Any] = field(default_factory=dict)
    _log_counts: dict[str, int] = field(default_factory=dict)
    total_nodes: int = 0
    completed_nodes: int = 0

    # ---------------------------------------------------------------- 로깅

    def log(self, message: str, *, node_id: str | None = None, level: str = LogLevel.INFO) -> None:
        key = node_id or "-"
        count = self._log_counts.get(key, 0)
        if count == MAX_LOGS_PER_NODE:
            self._log_counts[key] = count + 1
            self._persist_log(
                f"로그가 {MAX_LOGS_PER_NODE}건을 넘어 이후 상세 로그는 생략합니다", key, LogLevel.WARNING
            )
            return
        if count > MAX_LOGS_PER_NODE and level not in {LogLevel.ERROR, LogLevel.WARNING}:
            self._log_counts[key] = count + 1
            return
        self._log_counts[key] = count + 1
        self._persist_log(message, node_id, level)

    def _persist_log(self, message: str, node_id: str | None, level: str) -> None:
        ts = utcnow()
        try:
            with session_scope() as session:
                session.add(RunLog(run_id=self.run_id, node_id=node_id, level=level, message=message, ts=ts))
        except Exception:
            logger.exception("RunLog 저장 실패 (run=%s)", self.run_id)
        events.publish(self.run_id, "log", {"node_id": node_id, "level": level, "message": message}, ts=ts)
        logger.info("[run=%s node=%s] %s", self.run_id[:8], node_id or "-", message)

    # ------------------------------------------------------------ 상태 갱신

    def node_state(self, node_id: str) -> NodeState:
        return self.node_states.setdefault(node_id, NodeState())

    def set_node(self, node_id: str, **changes: Any) -> None:
        state = self.node_state(node_id)
        for key, value in changes.items():
            setattr(state, key, value)
        events.publish(self.run_id, "node", {"node_id": node_id, **state.to_dict()})
        self._flush_run()

    def add_records(self, node_id: str, count: int) -> None:
        self.node_state(node_id).records += count
        events.publish(
            self.run_id, "progress", {"node_id": node_id, "records": self.node_state(node_id).records}
        )

    def observe_watermark(self, node_id: str, value: Any) -> None:
        """소스가 관측한 워터마크를 누적한다. 항상 최대값만 남긴다."""
        if value is None:
            return
        current = self.watermarks.get(node_id)
        self.watermarks[node_id] = value if current is None else max(current, value)

    def mark_node_done(self, node_id: str) -> None:
        self.completed_nodes += 1
        self._flush_run()

    def set_response(self, payload: dict[str, Any]) -> None:
        """응답 노드가 모은 결과를 Run 에 남긴다 — 웹훅 호출자가 이걸 기다린다.

        **상태 전이보다 먼저** 불려야 한다. Run 이 success 로 바뀐 뒤에 쓰면, 상태만 보고
        깨어난 호출자가 빈손으로 돌아간다.

        실패하면 조용히 넘어가지 않는다. 호출자는 결과를 받으려고 기다리는 중이라,
        저장이 안 됐는데 성공으로 끝나면 영영 오지 않는 것을 기다리게 된다.
        """
        with session_scope() as session:
            run = session.get(Run, self.run_id)
            if run is None:
                raise RuntimeError(f"Run 을 찾을 수 없습니다: {self.run_id}")
            run.response = payload

    @property
    def progress(self) -> int:
        if self.total_nodes == 0:
            return 0
        return min(100, round(self.completed_nodes / self.total_nodes * 100))

    @property
    def total_records(self) -> int:
        """타깃 노드에 적재된 건수만 센다 — 소스/변환까지 더하면 중복 집계된다."""
        return sum(s.records for nid, s in self.node_states.items() if nid in self._target_ids)

    _target_ids: set[str] = field(default_factory=set)

    def register_targets(self, node_ids: set[str]) -> None:
        self._target_ids = node_ids

    def _flush_run(self) -> None:
        """진행상황을 메타DB 에 반영. 실패해도 실행은 계속한다."""
        try:
            with session_scope() as session:
                self._write_run(session)
        except Exception:
            logger.exception("Run 상태 갱신 실패 (run=%s)", self.run_id)

    def _write_run(self, session: Session) -> None:
        run = session.get(Run, self.run_id)
        if run is None:
            return
        run.progress = self.progress
        run.records = self.total_records
        run.node_states = {nid: s.to_dict() for nid, s in self.node_states.items()}
