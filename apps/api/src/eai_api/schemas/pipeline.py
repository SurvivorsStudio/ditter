"""Pipeline API 스키마."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .dag import PipelineDefinition, ValidationIssue


class PipelineBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    definition: PipelineDefinition = Field(default_factory=PipelineDefinition)
    schedule: str | None = Field(default=None, max_length=120)
    timezone: str = "Asia/Seoul"
    schedule_enabled: bool = False


class PipelineCreate(PipelineBase):
    pass


class PipelineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    definition: PipelineDefinition | None = None
    schedule: str | None = Field(default=None, max_length=120)
    timezone: str | None = None
    schedule_enabled: bool | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|inactive)$")


class PipelineOut(PipelineBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    version: int
    status: str
    created_at: datetime
    updated_at: datetime


class PipelineSummary(BaseModel):
    """홈 화면 목록용 — DAG 전체를 실어 보내지 않는다."""

    id: str
    name: str
    description: str | None = None
    status: str
    schedule: str | None = None
    schedule_enabled: bool = False
    #: ["MySQL", "매핑", "S3"] 같은 미니 플로우 칩
    flow: list[str] = Field(default_factory=list)
    last_run_status: str | None = None
    last_run_at: datetime | None = None
    updated_at: datetime


class DeletionImpact(BaseModel):
    """삭제하면 무엇이 함께 사라지고, 무엇이 삭제를 막고 있는지.

    확인 대화상자가 지우기 전에 보여주고, 삭제 응답이 지운 내역으로 되돌려준다.
    실행 이력·체크포인트는 FK 의 ``ON DELETE CASCADE`` 로 함께 사라진다 — 되돌릴 수 없으니
    건수를 미리 알려주는 것이 이 스키마의 존재 이유다.
    """

    pipeline_id: str
    pipeline_name: str

    #: 함께 삭제되는 것들 (cascade)
    runs_total: int = 0
    versions_total: int = 0
    checkpoints_total: int = 0
    last_run_at: datetime | None = None

    #: 삭제를 막는 것들. 진행 중 실행은 force 로 넘길 수 있고, CDC 스트림은 넘길 수 없다.
    active_run_id: str | None = None
    active_run_status: str | None = None
    cdc_stream_id: str | None = None
    cdc_stream_status: str | None = None

    #: force 없이 지금 지울 수 있는가
    deletable: bool = True
    #: 사용자에게 보여줄 차단 사유 (deletable=False 일 때만 채워진다)
    blockers: list[str] = Field(default_factory=list)


class ValidationOut(BaseModel):
    valid: bool
    order: list[str] = Field(default_factory=list)
    issues: list[ValidationIssue] = Field(default_factory=list)


class RunRequest(BaseModel):
    trigger: str = Field(default="manual", pattern="^(manual|schedule|cdc|api)$")
    #: API 트리거가 선언한 `$변수` 에 넣을 값 {이름: 값}.
    #: 캔버스의 테스트 실행도 같은 통로를 쓴다 — 테스트와 실제 호출이 갈리면 테스트가 무의미하다.
    variables: dict[str, str | int | float | bool | None] | None = None
    full_refresh: bool = False  # True 면 워터마크를 무시하고 전체 적재
    #: 지정하면 그 노드만 독립 실행한다 (그 노드까지 필요한 상류만).
    #: 타깃이면 실제 적재, 소스·변환이면 적재 없이 출력 미리보기. 워터마크는 건드리지 않는다.
    only_node: str | None = None
