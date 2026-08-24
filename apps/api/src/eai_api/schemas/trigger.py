"""외부 호출 창구(웹훅) 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TriggerCreate(BaseModel):
    name: str = Field(default="기본", min_length=1, max_length=120)


class TriggerUpdate(BaseModel):
    """사용 중지/재개. 이름 변경은 두지 않았다 — 지우고 다시 발급하는 편이 명확하다."""

    enabled: bool


class TriggerOut(BaseModel):
    """목록·상세용. **토큰 원문은 들어 있지 않다.**"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    pipeline_id: str
    name: str
    #: 토큰 앞 8자. 어느 토큰인지 알아보기 위한 것이고 이것만으로는 호출할 수 없다.
    token_prefix: str
    enabled: bool
    last_called_at: datetime | None = None
    call_count: int = 0
    created_at: datetime


class TriggerCreated(TriggerOut):
    """발급 직후에만 돌려주는 응답.

    ``token`` 은 **이때 한 번만** 나온다. DB 에는 해시만 남으므로 서버도 원문을 다시
    만들어낼 수 없다 — 놓치면 재발급뿐이다.
    """

    token: str
    #: 그대로 복사해 쓸 수 있는 호출 주소
    url: str


class HookAccepted(BaseModel):
    """웹훅 호출 응답 — 실행을 큐에 넣었다는 접수증.

    파이프라인이 끝나기를 기다리지 않는다. 적재는 몇 분씩 걸릴 수 있고, 그동안 HTTP
    연결을 붙잡고 있으면 호출자의 타임아웃에 매달리게 된다. 진행 상황은 ``run_id`` 로
    조회한다.
    """

    run_id: str
    pipeline_id: str
    status: str
    #: 이번 실행에 적용된 값 (기본값이 채워진 결과까지 포함)
    variables: dict[str, str | int | float | bool] = Field(default_factory=dict)
    #: 실패했을 때의 사유. 응답 노드가 있어 결과를 기다린 경우에만 채워진다.
    error: str | None = None
    #: 응답 노드가 모은 결과 {columns, rows, row_count, truncated}.
    #: 응답 노드가 없으면 None — 그때는 실행을 기다리지 않고 접수증만 준다.
    data: dict[str, Any] | None = None
