"""Pipeline 도메인 로직 — 버전 스냅샷, DAG 검증, 요약."""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..i18n import t
from ..models import (
    CDC_ACTIVE_STATUSES,
    TERMINAL_STATUSES,
    CdcStream,
    Checkpoint,
    Pipeline,
    PipelineVersion,
    Run,
)
from ..schemas.dag import (
    SINGLE_NODE_IGNORED_CODES,
    PipelineDefinition,
    ValidationIssue,
    topological_order,
    validate_definition,
)
from ..schemas.pipeline import (
    DeletionImpact,
    PipelineCreate,
    PipelineSummary,
    PipelineUpdate,
    ValidationOut,
)
from .errors import ConflictError, NotFoundError, ValidationError

logger = logging.getLogger(__name__)

#: 노드 종류 → 홈 목록의 미니 플로우 칩 라벨.
#: NodeKind 를 추가하면 여기도 채워야 한다 — 빠지면 raw 값이 그대로 노출된다.
_FLOW_LABEL = {
    "source.mysql": "MySQL",
    "source.postgres": "PostgreSQL",
    "source.mssql": "MSSQL",
    "source.mongo": "MongoDB",
    "source.sap": "SAP",
    "source.cdc.mysql": "MySQL CDC",
    "source.cdc.postgres": "PostgreSQL CDC",
    "source.cdc.mssql": "MSSQL CDC",
    "source.sync.mssql": "MSSQL 실시간 동기화",
    "transform.filter": "필터",
    "transform.map": "매핑",
    "transform.python": "Python",
    "logic.switch": "스위치",
    "target.db": "Target DB",
    "target.mongo": "MongoDB",
    "target.s3": "S3",
    "target.file": "로컬 파일",
    "target.response": "API 응답",
    "target.sync.db": "동기화 타깃 DB",
    "note.memo": "메모",
    "note.group": "그룹",
    "trigger.schedule": "스케줄",
    "trigger.manual": "수동",
    "trigger.api": "API",
    "trigger.cdc": "CDC",
    "trigger.sync": "실시간 동기화",
}


def list_pipelines(session: Session, *, status: str | None = None) -> list[Pipeline]:
    stmt = select(Pipeline).order_by(Pipeline.updated_at.desc())
    if status:
        stmt = stmt.where(Pipeline.status == status)
    return list(session.execute(stmt).scalars())


def get_pipeline(session: Session, pipeline_id: str) -> Pipeline:
    pipeline = session.get(Pipeline, pipeline_id)
    if pipeline is None:
        raise NotFoundError(t("dag.gate.pipeline_not_found", name=pipeline_id))
    return pipeline


def create_pipeline(session: Session, payload: PipelineCreate) -> Pipeline:
    clash = session.execute(select(Pipeline).where(Pipeline.name == payload.name)).scalar_one_or_none()
    if clash is not None:
        raise ConflictError(f"이미 존재하는 파이프라인 이름입니다: {payload.name}")

    definition = payload.definition.model_dump(mode="json")
    pipeline = Pipeline(
        name=payload.name,
        description=payload.description,
        definition=definition,
        schedule=payload.schedule,
        timezone=payload.timezone,
        schedule_enabled=payload.schedule_enabled,
        version=1,
        status="draft",
    )
    session.add(pipeline)
    session.flush()
    session.add(PipelineVersion(pipeline_id=pipeline.id, version=1, definition=definition))
    session.flush()
    return pipeline


def update_pipeline(session: Session, pipeline_id: str, payload: PipelineUpdate) -> Pipeline:
    pipeline = get_pipeline(session, pipeline_id)

    if payload.name and payload.name != pipeline.name:
        clash = session.execute(select(Pipeline).where(Pipeline.name == payload.name)).scalar_one_or_none()
        if clash is not None:
            raise ConflictError(f"이미 존재하는 파이프라인 이름입니다: {payload.name}")
        pipeline.name = payload.name

    if payload.definition is not None:
        definition = payload.definition.model_dump(mode="json")
        if definition != pipeline.definition:
            # DAG 가 실제로 바뀐 경우에만 버전을 올린다 — 이름만 고쳤다고 버전이 늘면 이력이 지저분해진다
            pipeline.version += 1
            session.add(
                PipelineVersion(pipeline_id=pipeline.id, version=pipeline.version, definition=definition)
            )
        pipeline.definition = definition

    for field in ("description", "schedule", "timezone", "schedule_enabled", "status"):
        value = getattr(payload, field)
        if value is not None:
            setattr(pipeline, field, value)

    if pipeline.schedule_enabled and not pipeline.schedule:
        raise ValidationError("스케줄을 활성화하려면 cron 식이 필요합니다")

    session.flush()
    return pipeline


def deletion_blockers(*, active_run_status: str | None, cdc_stream_status: str | None) -> list[str]:
    """삭제를 막는 사유를 사람이 읽을 문장으로.

    UI 경고와 서버 거부가 갈리지 않도록 문구를 한 곳에서만 만든다.
    CDC 를 먼저 놓는 이유는 force 로도 못 넘기는 쪽이라 사용자가 먼저 봐야 하기 때문이다.
    """
    blockers: list[str] = []
    if cdc_stream_status:
        blockers.append(f"CDC 스트림이 살아 있습니다 ({cdc_stream_status}). 먼저 스트림을 중지하세요.")
    if active_run_status:
        blockers.append(f"실행이 진행 중입니다 ({active_run_status}). 끝나기를 기다리거나 실행을 취소하세요.")
    return blockers


def assert_deletable(impact: DeletionImpact, *, force: bool = False) -> None:
    """삭제 가드. DB 를 건드리지 않는 순수 판단이라 단위 테스트로 고정한다.

    ``force`` 는 진행 중 실행에만 듣는다 — CDC 는 외부(Kafka Connect)에 흔적을 남기므로
    어떤 플래그로도 넘기지 않는다.
    """
    if impact.cdc_stream_id is not None:
        raise ConflictError(
            f"'{impact.pipeline_name}' 은(는) CDC 스트림이 살아 있어 지울 수 없습니다 "
            f"({impact.cdc_stream_status}). 먼저 스트림을 중지하세요."
        )

    if impact.active_run_id is not None and not force:
        raise ConflictError(
            f"'{impact.pipeline_name}' 은(는) 실행이 진행 중입니다 ({impact.active_run_status}). "
            "끝나기를 기다리거나, 그래도 지우려면 force 를 지정하세요."
        )


def deletion_impact(session: Session, pipeline_id: str) -> DeletionImpact:
    """지우면 무엇이 함께 사라지고 무엇이 막고 있는지 — 확인 대화상자가 먼저 부른다.

    실행 이력·체크포인트·버전 스냅샷은 FK 의 ``ON DELETE CASCADE`` 로 조용히 함께 사라진다.
    조용한 게 문제라 건수를 세어 돌려준다.
    """
    pipeline = get_pipeline(session, pipeline_id)

    def _count(model: type[Run] | type[Checkpoint] | type[PipelineVersion]) -> int:
        stmt = select(func.count()).select_from(model).where(model.pipeline_id == pipeline_id)
        return int(session.execute(stmt).scalar_one())

    last_run_at = session.execute(
        select(func.max(Run.started_at)).where(Run.pipeline_id == pipeline_id)
    ).scalar_one()

    active_run = (
        session.execute(
            select(Run)
            .where(
                Run.pipeline_id == pipeline_id,
                Run.status.notin_(sorted(str(s) for s in TERMINAL_STATUSES)),
            )
            .order_by(Run.created_at.desc())
        )
        .scalars()
        .first()
    )

    cdc_stream = (
        session.execute(
            select(CdcStream).where(
                CdcStream.pipeline_id == pipeline_id,
                CdcStream.status.in_(sorted(str(s) for s in CDC_ACTIVE_STATUSES)),
            )
        )
        .scalars()
        .first()
    )

    blockers = deletion_blockers(
        active_run_status=active_run.status if active_run else None,
        cdc_stream_status=cdc_stream.status if cdc_stream else None,
    )

    return DeletionImpact(
        pipeline_id=pipeline.id,
        pipeline_name=pipeline.name,
        runs_total=_count(Run),
        versions_total=_count(PipelineVersion),
        checkpoints_total=_count(Checkpoint),
        last_run_at=last_run_at,
        active_run_id=active_run.id if active_run else None,
        active_run_status=active_run.status if active_run else None,
        cdc_stream_id=cdc_stream.id if cdc_stream else None,
        cdc_stream_status=cdc_stream.status if cdc_stream else None,
        deletable=not blockers,
        blockers=blockers,
    )


def delete_pipeline(session: Session, pipeline_id: str, *, force: bool = False) -> DeletionImpact:
    """파이프라인을 지운다. 지운 내역(삭제 직전 스냅샷)을 돌려준다.

    두 가지를 막는다. 성격이 달라서 ``force`` 가 미치는 범위도 다르다.

    - **진행 중인 실행** — 워커가 이 파이프라인을 들고 도는 중인데 행을 지우면 실행이
      영문 모를 곳에서 죽는다. 다만 워커가 죽어 ``running`` 으로 굳은 실행이 남으면
      파이프라인을 영영 못 지우게 되므로 ``force`` 로 넘길 수 있게 둔다.
    - **살아 있는 CDC 스트림** — 이건 ``force`` 로도 못 넘긴다. 메타DB 행만 사라지고
      Kafka Connect 의 Debezium 커넥터는 그대로 남아 계속 토픽에 쓴다. 주인 없는 커넥터는
      UI 에서 보이지도 않아 손으로 지워야 한다. 스트림 중지를 먼저 시키는 편이 낫다.
    """
    impact = deletion_impact(session, pipeline_id)
    assert_deletable(impact, force=force)

    session.delete(get_pipeline(session, pipeline_id))
    logger.info(
        "파이프라인 삭제: %s(%s) — 실행 %d건·버전 %d개·체크포인트 %d개 함께 삭제%s",
        impact.pipeline_name,
        impact.pipeline_id,
        impact.runs_total,
        impact.versions_total,
        impact.checkpoints_total,
        " (force)" if force and impact.active_run_id else "",
    )
    return impact


def parse_definition(pipeline: Pipeline) -> PipelineDefinition:
    return PipelineDefinition.model_validate(pipeline.definition or {})


def validate_pipeline(pipeline: Pipeline) -> ValidationOut:
    try:
        definition = parse_definition(pipeline)
    except Exception as exc:
        return ValidationOut(
            valid=False, issues=[_gate_issue("dag.gate.parse_failed", cause=exc)]
        )

    issues = validate_definition(definition)
    order = topological_order(definition.nodes, definition.edges) if definition.nodes else []
    return ValidationOut(
        valid=not any(i.level == "error" for i in issues),
        order=order,
        issues=issues,
    )


def _gate_issue(key: str, **vars: object) -> ValidationIssue:
    """정의를 아예 못 읽었을 때의 검증 항목. `dag._issue` 와 같은 규칙(키가 곧 코드)."""
    return ValidationIssue(level="error", code=key, message=t(key, **vars))


def _node_label(definition: PipelineDefinition, node_id: str | None) -> str:
    """오류 메시지에 쓸 노드 이름.

    노드 id(`db_msr1tqfy1`)는 내부 식별자라 캔버스에 보이지 않는다. 웹훅 호출처럼 화면
    밖에서 오류를 받으면 어느 노드인지 알 길이 없으므로 라벨을 함께 준다.
    """
    if not node_id:
        return "-"
    node = definition.node_map().get(node_id)
    label = (node.label or "").strip() if node else ""
    return f"{label}({node_id})" if label else node_id


def assert_runnable(pipeline: Pipeline) -> PipelineDefinition:
    """실행 전 관문. 에러가 하나라도 있으면 실행을 막는다."""
    result = validate_pipeline(pipeline)
    if not result.valid:
        definition = parse_definition(pipeline)
        problems = "; ".join(
            f"{_node_label(definition, i.node_id)}: {i.message}" for i in result.issues if i.level == "error"
        )
        raise ValidationError(t("dag.gate.pipeline_not_runnable", list=problems))
    return parse_definition(pipeline)


def _ancestors(definition: PipelineDefinition, node_id: str) -> set[str]:
    """``node_id`` 로 데이터를 흘려보내는 모든 상류 노드 id (자신 포함)."""
    upstream = definition.upstream_map()
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(upstream.get(current, []))
    return seen


def assert_node_runnable(pipeline: Pipeline, node_id: str) -> PipelineDefinition:
    """단일 노드 실행 관문.

    전체 파이프라인 관문(assert_runnable)과 달리 **그 노드까지의 하위 그래프**만 본다 —
    "타깃이 없다", "이 소스가 어디에도 연결되지 않았다" 같은 전역·하류 규칙은 무시하고,
    그 노드와 상류가 데이터를 만들 수 있는지에 관한 오류(연결 누락, 테이블 미지정 등)만 막는다.
    """
    definition = parse_definition(pipeline)
    node = definition.node_map().get(node_id)
    if node is None:
        raise ValidationError(t("dag.gate.node_not_found", name=node_id))
    if node.is_api_trigger:
        # API 트리거는 예외다. 데이터를 옮기지 않고 "받은 값이 다음 노드에 어떻게 꽂히는가"만
        # 확인하므로, 하류가 아직 비어 있어도 실행할 수 있어야 한다 — 오히려 그 상태에서
        # 먼저 확인하려고 누르는 버튼이다. 이 노드 자신의 오류만 막는다.
        own = [i for i in validate_definition(definition) if i.level == "error" and i.node_id == node_id]
        if own:
            problems = "; ".join(i.message for i in own)
            raise ValidationError(t("dag.gate.check_api_trigger", list=problems))
        return definition

    if node.is_trigger or node.is_note:
        raise ValidationError(t("dag.gate.not_runnable_kind"))

    scope = _ancestors(definition, node_id)
    # 단일 노드 범위에서 무의미한 구조 규칙 — 하류 연결 여부는 여기서 따지지 않는다.
    #
    # 예전에는 한국어 부분 문자열로 골랐다(`"입력이 없습니다" in i.message`). 문구를
    # 다국어로 옮기면 그 매칭이 조용히 어긋나 **무시해야 할 이슈가 차단 이슈로 바뀐다** —
    # en 에서만 단일 노드 실행이 막히고, 화면에는 "이 노드를 실행할 수 없습니다"만 뜬다.
    # 규칙의 안정 식별자(`code`)로 고르면 그 사고가 구조적으로 불가능하다.
    blocking = [
        i
        for i in validate_definition(definition)
        if i.level == "error" and i.node_id in scope and i.code not in SINGLE_NODE_IGNORED_CODES
    ]
    if blocking:
        problems = "; ".join(f"{_node_label(definition, i.node_id)}: {i.message}" for i in blocking)
        raise ValidationError(t("dag.gate.node_not_runnable", list=problems))
    return definition


def summarize(session: Session, pipelines: list[Pipeline]) -> list[PipelineSummary]:
    """홈 목록용 요약. 마지막 실행 상태를 파이프라인당 한 번의 쿼리로 붙인다."""
    if not pipelines:
        return []

    ids = [p.id for p in pipelines]
    latest: dict[str, Run] = {}
    stmt = select(Run).where(Run.pipeline_id.in_(ids)).order_by(Run.pipeline_id, Run.created_at.desc())
    for run in session.execute(stmt).scalars():
        latest.setdefault(run.pipeline_id, run)

    summaries: list[PipelineSummary] = []
    for p in pipelines:
        last_run: Run | None = latest.get(p.id)
        summaries.append(
            PipelineSummary(
                id=p.id,
                name=p.name,
                description=p.description,
                status=p.status,
                schedule=p.schedule,
                schedule_enabled=p.schedule_enabled,
                flow=_flow_chips(p),
                last_run_status=last_run.status if last_run else None,
                last_run_at=last_run.started_at if last_run else None,
                updated_at=p.updated_at,
            )
        )
    return summaries


def _flow_chips(pipeline: Pipeline) -> list[str]:
    """DAG 를 위상 순서대로 훑어 소스→변환→타깃 칩 라벨을 만든다."""
    try:
        definition = parse_definition(pipeline)
    except Exception:
        return []
    if not definition.nodes:
        return []
    node_map = definition.node_map()
    try:
        order = topological_order(definition.nodes, definition.edges)
    except ValueError:
        order = [n.id for n in definition.nodes]
    labels = [
        _FLOW_LABEL.get(str(node_map[nid].kind), str(node_map[nid].kind))
        for nid in order
        if not node_map[nid].is_trigger and not node_map[nid].is_note
    ]
    return labels[:4]
