"""파이프라인 DAG 스펙.

API(저장 시 검증)와 Worker(실행)가 **같은 정의**를 공유한다.
UI 의 React Flow 노드/엣지가 그대로 이 모양으로 직렬화된다.
"""

from __future__ import annotations

import ast
import json
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import variables as var_syntax


class NodeKind(StrEnum):
    # 트리거
    SCHEDULE = "trigger.schedule"
    MANUAL = "trigger.manual"
    #: 외부 REST 호출로 도는 트리거. 실행 모델은 수동과 같은 1회성 배치지만, 호출 본문의
    #: 값을 `$변수` 로 노드에 주입한다는 점이 다르다 — 그래서 별도 종류가 필요하다.
    API = "trigger.api"
    #: 상시 스트리밍 트리거 (Phase 4 CDC). 배치 트리거와 달리 "언제 한 번 도는가"가 아니라
    #: "스트림을 켜둔다"는 뜻이라 실행 모델이 완전히 다르다 (docs/PHASE4_CDC_기획안.md §2).
    CDC = "trigger.cdc"
    #: 실시간 DB 동기화 트리거 (SymmetricDS). CDC 트리거처럼 "켜둔다"는 뜻이지만 엔진이
    #: 다르다 — Kafka 를 거치지 않고 SymmetricDS 노드끼리 HTTP 로 직송한다.
    SYNC = "trigger.sync"
    # 소스
    SOURCE_MYSQL = "source.mysql"
    SOURCE_POSTGRES = "source.postgres"
    SOURCE_MSSQL = "source.mssql"
    SOURCE_MONGO = "source.mongo"
    SOURCE_SAP = "source.sap"
    #: CDC 소스 (실시간). read() 로 당기는 배치 소스와 달리 Debezium 이 변경을 밀어낸다 —
    #: 커넥터가 아니라 Debezium 커넥터 설정으로 표현되므로 종류를 분리한다 (기획안 §5.1).
    SOURCE_CDC_MYSQL = "source.cdc.mysql"
    SOURCE_CDC_POSTGRES = "source.cdc.postgres"
    SOURCE_CDC_MSSQL = "source.cdc.mssql"
    #: 실시간 동기화 소스 (SymmetricDS). CDC 소스와도 다른 점 하나가 결정적이다 —
    #: **데이터가 우리 워커를 지나지 않는다.** SymmetricDS 가 원본 테이블 트리거로 잡아
    #: 타깃 DB 로 직접 밀어 넣는다. 그래서 뒤에 변환 노드를 이을 수 없고, 짝이 되는
    #: ``target.sync.db`` 만 연결할 수 있다 (docs/SYMMETRICDS_실시간동기화_기획안.md §3).
    SOURCE_SYNC_MSSQL = "source.sync.mssql"
    # 변환
    TRANSFORM_FILTER = "transform.filter"
    TRANSFORM_MAP = "transform.map"
    #: 사용자 Python 코드 전처리. 임의 코드라 격리 자식 프로세스에서 실행한다
    #: (worker/nodes/pysandbox). 필터·맵과 달리 화이트리스트가 아니라 사용자 코드다.
    TRANSFORM_PYTHON = "transform.python"
    #: 스위치(조건 분기). 출력이 여러 개다 — 각 행을 처음 맞는 case 의 출력으로 보낸다.
    #: 엣지의 source_handle 이 어느 case 인지 가리킨다 (라우팅은 engine 이 처리).
    LOGIC_SWITCH = "logic.switch"
    # 타깃
    TARGET_DB = "target.db"
    TARGET_MONGO = "target.mongo"
    TARGET_S3 = "target.s3"
    TARGET_FILE = "target.file"
    #: 호출자에게 결과를 돌려주는 타깃. 다른 타깃과 달리 **연결이 없다** — 데이터를
    #: 어딘가에 적재하는 것이 아니라 API 응답 본문으로 되돌린다 (API 트리거와 짝).
    TARGET_RESPONSE = "target.response"
    #: 실시간 동기화 타깃 (SymmetricDS). 다른 타깃과 달리 워커가 write() 하지 않는다 —
    #: "어느 DB 로 밀어 넣을지"를 선언할 뿐이고 적재는 SymmetricDS 타깃 노드가 한다.
    TARGET_SYNC_DB = "target.sync.db"
    # 주석 — 실행되지 않는 캔버스 메모·영역 그룹
    NOTE = "note.memo"
    GROUP = "note.group"


TRIGGER_KINDS = frozenset(
    {NodeKind.SCHEDULE, NodeKind.MANUAL, NodeKind.API, NodeKind.CDC, NodeKind.SYNC}
)
#: 배치 트리거 — CDC 트리거와 섞이면 안 된다 (실행 모델이 다르다)
BATCH_TRIGGER_KINDS = frozenset({NodeKind.SCHEDULE, NodeKind.MANUAL, NodeKind.API})
#: 실시간 CDC 소스. is_source 에는 포함되지만 배치 read() 경로를 타지 않는다
CDC_SOURCE_KINDS = frozenset(
    {NodeKind.SOURCE_CDC_MYSQL, NodeKind.SOURCE_CDC_POSTGRES, NodeKind.SOURCE_CDC_MSSQL}
)
#: 실시간 동기화 소스/타깃 (SymmetricDS). is_source·is_target 이지만 배치 read()/write() 도
#: CDC sink 도 타지 않는다 — 데이터가 우리 프로세스를 아예 지나가지 않는 유일한 종류다.
SYNC_SOURCE_KINDS = frozenset({NodeKind.SOURCE_SYNC_MSSQL})
SYNC_TARGET_KINDS = frozenset({NodeKind.TARGET_SYNC_DB})
SOURCE_KINDS = frozenset(
    {
        NodeKind.SOURCE_MYSQL,
        NodeKind.SOURCE_POSTGRES,
        NodeKind.SOURCE_MSSQL,
        NodeKind.SOURCE_MONGO,
        NodeKind.SOURCE_SAP,
    }
    | CDC_SOURCE_KINDS
    | SYNC_SOURCE_KINDS
)
TRANSFORM_KINDS = frozenset(
    {
        NodeKind.TRANSFORM_FILTER,
        NodeKind.TRANSFORM_MAP,
        NodeKind.TRANSFORM_PYTHON,
        NodeKind.LOGIC_SWITCH,
    }
)

#: 스위치에서 아무 case 에도 안 맞은 행이 가는 기본(그 외) 출력 핸들 id.
SWITCH_DEFAULT_HANDLE = "__default__"
TARGET_KINDS = frozenset(
    {
        NodeKind.TARGET_DB,
        NodeKind.TARGET_MONGO,
        NodeKind.TARGET_S3,
        NodeKind.TARGET_FILE,
        NodeKind.TARGET_RESPONSE,
    }
    | SYNC_TARGET_KINDS
)

#: 커넥터를 쓰지 않는 타깃. connection_id 를 요구하면 안 된다 —
#: 응답 노드는 어디에도 붙지 않고 호출자에게 되돌려주기만 한다.
CONNECTORLESS_TARGET_KINDS = frozenset({NodeKind.TARGET_RESPONSE})

#: 오브젝트/파일 타깃 — 테이블이 아니라 경로에 쓰고, upsert 를 지원하지 않는다
OBJECT_TARGET_KINDS = frozenset({NodeKind.TARGET_S3, NodeKind.TARGET_FILE})

#: 문서 지향 소스 — table 대신 컬렉션, query 는 SQL 이 아니라 JSON 필터다
DOCUMENT_KINDS = frozenset({NodeKind.SOURCE_MONGO, NodeKind.TARGET_MONGO})

#: 실행되지 않는 주석 노드(메모·영역 그룹) — 검증·실행·흐름 요약에서 모두 제외된다
NOTE_KINDS = frozenset({NodeKind.NOTE, NodeKind.GROUP})

#: 노드 종류 → 커넥터 타입 (소스/타깃만 해당).
#: target.db 는 어떤 RDB 든 될 수 있어 여기에 고정하지 않는다.
NODE_CONNECTOR_TYPE: dict[NodeKind, str] = {
    NodeKind.SOURCE_MYSQL: "mysql",
    NodeKind.SOURCE_POSTGRES: "postgres",
    NodeKind.SOURCE_MSSQL: "mssql",
    NodeKind.SOURCE_MONGO: "mongo",
    NodeKind.SOURCE_SAP: "sap_rfc",
    # CDC 소스는 같은 RDB 연결을 쓴다 (cdc_enabled 만 켜진 것) — 연결 타입은 동일하다
    NodeKind.SOURCE_CDC_MYSQL: "mysql",
    NodeKind.SOURCE_CDC_POSTGRES: "postgres",
    NodeKind.SOURCE_CDC_MSSQL: "mssql",
    # 실시간 동기화 소스도 같은 MSSQL 연결을 쓴다 — SymmetricDS 가 그 접속 정보로 붙는다.
    # target.sync.db 는 target.db 처럼 어떤 RDB 든 될 수 있어 여기에 고정하지 않는다.
    NodeKind.SOURCE_SYNC_MSSQL: "mssql",
    NodeKind.TARGET_MONGO: "mongo",
    NodeKind.TARGET_S3: "s3",
    NodeKind.TARGET_FILE: "local_file",
}

#: CDC 소스에서 잡아낸 삭제(DELETE) 이벤트를 타깃에 반영하는 방식 (기획안 §5.2 · 2026-07-31 결정)
CDC_DELETE_MODES = frozenset({"soft", "hard", "ignore"})
#: Debezium 초기 스냅샷 모드
CDC_SNAPSHOT_MODES = frozenset({"initial", "never", "when_needed"})
#: CDC 타깃 컬럼 매핑에서 허용하는 캐스트.
#: worker ``nodes/transform.py`` 의 ``CASTS`` 키와 반드시 같아야 한다 (한쪽만 고치면 어긋남).
CDC_MAP_CASTS = frozenset({"str", "int", "float", "bool", "upper", "lower", "strip", "datetime"})

#: SymmetricDS 채널 — 전송 단위이자 우선순위 단위다 (기획안 §5-4).
#: 대량 배치가 발생하는 테이블을 realtime 에 넣으면 그 한 번이 채널을 점유해
#: 다른 테이블의 실시간성을 통째로 망친다 — 그래서 테이블마다 고르게 한다.
SYNC_CHANNELS = frozenset({"realtime", "standard", "bulk"})
DEFAULT_SYNC_CHANNEL = "standard"
#: SymmetricDS 가 붙을 수 있는 동기화 타깃 커넥터 타입.
#: JDBC 드라이버를 사이드카에 넣어 둔 것만 가능하다 (기획안 §4).
SYNC_TARGET_TYPES = frozenset({"postgres"})
#: 복제본을 무엇에 쓰는가 (기획안 §1.3). 코드가 판정할 수 없지만 **묻지 않을 수도 없다** —
#: 복제본으로 출고/재고를 판단하는 구조라면 동기화가 아니라 원본 직접 조회가 맞고,
#: 그 판단은 구축 전에 해야 한다. 그래서 선언만 받아 두고 preflight 가 경고로 드러낸다.
SYNC_PURPOSES = frozenset({"readonly", "operational"})

#: target.db 노드가 받아들이는 커넥터 타입
DB_TARGET_TYPES = frozenset({"mysql", "postgres", "mssql"})


#: API 트리거가 받는 값의 타입. JSON 이 표현할 수 있는 스칼라로 제한한다 —
#: 배열·객체를 받으면 `$var` 를 문자열에 꽂는 순간 표현이 모호해진다.
VARIABLE_TYPES = ("string", "number", "boolean")


class TriggerVariable(BaseModel):
    """API 트리거가 선언하는 입력 변수 하나.

    선언은 두 가지를 한다. 호출 본문 검증의 근거가 되고, 저작 화면에서 `$이름` 자동완성의
    목록이 된다. 선언되지 않은 `$이름` 을 노드가 쓰면 저장 시점에 에러로 잡힌다 —
    실행할 때 알면 이미 늦다.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=rf"^{var_syntax.NAME_RE}$", max_length=64)
    type: Literal["string", "number", "boolean"] = "string"
    required: bool = True
    #: 호출 본문에 값이 없을 때 쓸 기본값. ``required`` 면 무시된다.
    default: str | float | bool | None = None
    #: 테스트 실행 화면이 미리 채워 줄 예시 값
    example: str | float | bool | None = None
    description: str = Field(default="", max_length=200)


def bind_variables(declared: list[TriggerVariable], supplied: dict[str, Any] | None) -> dict[str, Any]:
    """호출 본문을 선언에 맞춰 검증·보정해 실행에 쓸 변수 묶음을 만든다.

    실행이 시작되기 **전에** 여기서 걸러야 한다. 반쯤 적재하고 나서 값이 틀린 걸 알면
    되돌릴 방법이 없다.

    - 선언에 없는 키는 거절한다. 조용히 무시하면 오타(`sinse`)가 "값이 없다"는 엉뚱한
      에러로 나타나 원인을 찾기 어렵다.
    - 필수인데 없으면 거절. 선택인데 없으면 기본값을 채우고, 기본값도 없으면 거절한다
      (엔진이 어차피 실패시킨다 — 여기서 알려주는 편이 낫다).
    """
    values: dict[str, Any] = {}
    body = supplied or {}
    known = {spec.name for spec in declared}

    unknown = sorted(set(body) - known)
    if unknown:
        raise var_syntax.VariableError(
            f"선언되지 않은 값입니다: {', '.join(unknown)}. "
            f"받을 수 있는 변수: {', '.join(sorted(known)) or '(없음)'}"
        )

    for spec in declared:
        if spec.name in body:
            values[spec.name] = _coerce(spec, body[spec.name])
        elif spec.required:
            raise var_syntax.VariableError(f"필수 값이 없습니다: {spec.name}")
        elif spec.default is not None:
            values[spec.name] = _coerce(spec, spec.default)
        else:
            raise var_syntax.VariableError(
                f"{spec.name} 값이 없고 기본값도 없습니다 — 값을 보내거나 기본값을 정하세요"
            )

    return values


def _coerce(spec: TriggerVariable, raw: Any) -> Any:
    """선언된 타입으로 맞춘다. JSON 은 숫자를 문자열로 보내오는 경우가 흔하다."""
    if spec.type == "number":
        try:
            number = float(raw)
        except (TypeError, ValueError) as exc:
            raise var_syntax.VariableError(f"{spec.name} 은 숫자여야 합니다: {raw!r}") from exc
        # 정수로 떨어지면 정수로 — `LIMIT 10.0` 은 SQL 이 거부한다
        return int(number) if number.is_integer() else number

    if spec.type == "boolean":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in {"true", "1", "yes"}:
            return True
        if text in {"false", "0", "no"}:
            return False
        raise var_syntax.VariableError(f"{spec.name} 은 참/거짓이어야 합니다: {raw!r}")

    return str(raw)


class Position(BaseModel):
    x: float = 0
    y: float = 0


class PipelineNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    kind: NodeKind
    label: str = ""
    position: Position = Field(default_factory=Position)
    params: dict[str, Any] = Field(default_factory=dict)

    @property
    def is_trigger(self) -> bool:
        return self.kind in TRIGGER_KINDS

    @property
    def is_source(self) -> bool:
        return self.kind in SOURCE_KINDS

    @property
    def is_cdc_source(self) -> bool:
        """실시간 CDC 소스. is_source 이기도 하지만 배치 read() 경로를 타지 않는다."""
        return self.kind in CDC_SOURCE_KINDS

    @property
    def is_cdc_trigger(self) -> bool:
        return self.kind is NodeKind.CDC

    @property
    def is_sync_source(self) -> bool:
        """실시간 동기화 소스. is_source 이지만 데이터가 워커를 지나지 않는다."""
        return self.kind in SYNC_SOURCE_KINDS

    @property
    def is_sync_target(self) -> bool:
        return self.kind in SYNC_TARGET_KINDS

    @property
    def is_sync_trigger(self) -> bool:
        return self.kind is NodeKind.SYNC

    @property
    def is_api_trigger(self) -> bool:
        return self.kind is NodeKind.API

    def declared_variables(self) -> list[TriggerVariable]:
        """API 트리거가 선언한 입력 변수. 다른 종류의 노드면 빈 목록."""
        if not self.is_api_trigger:
            return []
        raw = self.params.get("variables") or []
        if not isinstance(raw, list):
            return []
        declared: list[TriggerVariable] = []
        for item in raw:
            if isinstance(item, dict):
                try:
                    declared.append(TriggerVariable.model_validate(item))
                except Exception:
                    # 저작 중 반쯤 채운 행 — 여기서 터뜨리지 않는다. 검증(_api_trigger_issues)이
                    # 이름 규칙 위반을 따로 알려주므로 이 함수는 읽을 수 있는 것만 모은다.
                    continue
        return declared

    @property
    def is_target(self) -> bool:
        return self.kind in TARGET_KINDS

    @property
    def is_note(self) -> bool:
        """실행되지 않는 캔버스 주석. 소스·타깃·트리거 어디에도 속하지 않는다."""
        return self.kind in NOTE_KINDS


class PipelineEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default="", max_length=64)
    source: str
    target: str
    #: 소스 노드의 출력 포트. 스위치 노드처럼 출력이 여러 개일 때 어느 케이스에서
    #: 나온 엣지인지 가리킨다. 단일 출력 노드는 None (React Flow 의 sourceHandle 과 짝).
    source_handle: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _no_self_loop(self) -> PipelineEdge:
        if self.source == self.target:
            raise ValueError(f"자기 자신을 가리키는 엣지: {self.source}")
        if not self.id:
            suffix = f":{self.source_handle}" if self.source_handle else ""
            object.__setattr__(self, "id", f"{self.source}{suffix}->{self.target}")
        return self


class PipelineDefinition(BaseModel):
    """노드·엣지 DAG. 저장 시점에 구조를 전부 검증한다."""

    model_config = ConfigDict(extra="forbid")

    nodes: list[PipelineNode] = Field(default_factory=list)
    edges: list[PipelineEdge] = Field(default_factory=list)
    variables: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_graph(self) -> PipelineDefinition:
        ids = [n.id for n in self.nodes]
        if len(ids) != len(set(ids)):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"중복된 노드 id: {dupes}")

        known = set(ids)
        for edge in self.edges:
            missing = {edge.source, edge.target} - known
            if missing:
                raise ValueError(f"존재하지 않는 노드를 참조하는 엣지: {sorted(missing)}")

        if self.nodes:
            topological_order(self.nodes, self.edges)  # 순환이면 여기서 터진다
        return self

    def node_map(self) -> dict[str, PipelineNode]:
        return {n.id: n for n in self.nodes}

    def node_by_label(self, label: str) -> PipelineNode | None:
        """이름으로 노드를 찾는다 — `${노드이름.컬럼}` 이 가리키는 대상.

        비교는 앞뒤 공백을 지우고 대소문자를 무시한다. 캔버스가 이름 유일성을 지키는 기준과
        같아야 한다 — 한쪽만 엄격하면 화면에서는 다른 이름인데 참조는 같은 곳을 가리킨다.
        """
        key = label.strip().casefold()
        if not key:
            return None
        for node in self.nodes:
            if node.label.strip().casefold() == key:
                return node
        return None

    def node_ref_dependencies(self) -> dict[str, set[str]]:
        """노드 id → 그 노드가 `${이름.컬럼}` 으로 참조하는 노드 id 집합.

        데이터가 흐르지 않아도 **실행 순서 의존**이 생긴다는 뜻이다. 참조된 노드가 먼저
        값을 내야 참조하는 노드의 설정이 완성된다 — 엔진과 순환 검사가 이것을 본다.
        """
        deps: dict[str, set[str]] = {}
        for node in self.nodes:
            for ref in var_syntax.extract_node_refs_from_params(node.params):
                target = self.node_by_label(ref.node)
                if target is not None and target.id != node.id:
                    deps.setdefault(node.id, set()).add(target.id)
        return deps

    def upstream_map(self) -> dict[str, list[str]]:
        up: dict[str, list[str]] = {n.id: [] for n in self.nodes}
        for e in self.edges:
            up[e.target].append(e.source)
        return up

    def executable_nodes(self) -> list[PipelineNode]:
        """실제로 실행되는 노드. 트리거(언제 도는지)와 주석(메모)은 제외한다."""
        return [n for n in self.nodes if not n.is_trigger and not n.is_note]


#: 단일 노드 실행에서 **무시하는** 구조 규칙들의 코드.
#:
#: 그래프 전체로 보면 오류지만 "이 노드 하나만 돌려 본다"는 문맥에서는 뜻이 없다 —
#: 아직 하류를 안 그렸어도 소스 하나는 읽어 볼 수 있어야 한다.
#: `pipeline_service.assert_node_runnable` 이 이 집합을 쓴다.
STRUCTURAL_SOURCE_ORPHAN = "dag.graph.source_orphan"
STRUCTURAL_TARGET_NO_INPUT = "dag.graph.target_no_input"
STRUCTURAL_TRANSFORM_NO_INPUT = "dag.graph.transform_no_input"

#: 단일 노드 실행 게이트가 건너뛸 코드들.
SINGLE_NODE_IGNORED_CODES = frozenset(
    {STRUCTURAL_SOURCE_ORPHAN, STRUCTURAL_TARGET_NO_INPUT, STRUCTURAL_TRANSFORM_NO_INPUT}
)


class ValidationIssue(BaseModel):
    level: Literal["error", "warning"]
    node_id: str | None = None
    message: str
    #: 규칙의 안정 식별자. **코드가 메시지 본문을 보고 분기하지 않게 하려고 있다.**
    #: `pipeline_service.assert_node_runnable` 이 단일 노드 실행에서 무시할 구조 규칙을
    #: 고를 때 이것을 본다 — 예전에는 한국어 부분 문자열로 골랐다.
    #: 문구를 다국어로 옮기면 그 매칭이 조용히 어긋난다(en 에서만 실행이 막힌다).
    code: str | None = None


def topological_order(nodes: list[PipelineNode], edges: list[PipelineEdge]) -> list[str]:
    """Kahn 알고리즘. 순환이 있으면 ValueError.

    같은 계층 내 순서는 노드 id 사전순으로 고정한다 — 실행 순서를 재현 가능하게 만들기 위해서다.
    """
    indegree: dict[str, int] = {n.id: 0 for n in nodes}
    adjacency: dict[str, list[str]] = {n.id: [] for n in nodes}
    for e in edges:
        adjacency[e.source].append(e.target)
        indegree[e.target] += 1

    ready = sorted(nid for nid, deg in indegree.items() if deg == 0)
    order: list[str] = []
    while ready:
        current = ready.pop(0)
        order.append(current)
        newly_ready = []
        for nxt in adjacency[current]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                newly_ready.append(nxt)
        if newly_ready:
            ready = sorted(ready + newly_ready)

    if len(order) != len(nodes):
        stuck = sorted(set(indegree) - set(order))
        raise ValueError(f"DAG 에 순환이 있습니다: {stuck}")
    return order


def validate_definition(definition: PipelineDefinition) -> list[ValidationIssue]:
    """구조는 맞지만 실행하면 문제가 될 것들을 잡아낸다 (에러/경고 구분)."""
    issues: list[ValidationIssue] = []
    nodes = definition.nodes

    if not nodes:
        return [ValidationIssue(level="error", message="노드가 없습니다")]

    sources = [n for n in nodes if n.is_source]
    targets = [n for n in nodes if n.is_target]
    if not sources:
        issues.append(ValidationIssue(level="error", message="소스 노드가 최소 1개 필요합니다"))
    if not targets:
        issues.append(ValidationIssue(level="error", message="타깃 노드가 최소 1개 필요합니다"))

    issues.extend(_cdc_pipeline_issues(nodes, sources))
    issues.extend(_sync_pipeline_issues(definition, sources))
    issues.extend(_api_trigger_issues(nodes))
    issues.extend(_duplicate_label_issues(nodes))
    issues.extend(_node_ref_issues(definition))

    # 메모는 실행 흐름의 일부가 아니다 — 엣지로 이으면 실행 시 소스로 오인된다
    note_ids = {n.id for n in nodes if n.is_note}
    for e in definition.edges:
        touching = note_ids & {e.source, e.target}
        if touching:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=next(iter(touching)),
                    message="메모 노드는 다른 노드와 연결할 수 없습니다",
                )
            )

    # 타깃은 흐름의 끝이다 — 뒤에 노드를 이을 수 없다.
    #
    # 캔버스는 타깃에 출구를 그리지 않지만, 예전에 그려둔 엣지나 API 로 직접 저장한
    # 정의에는 남아 있을 수 있다. 엔진은 타깃을 종점으로 보고 상류만 거슬러 올라가므로
    # 그런 엣지는 실행 시점에 엉뚱하게 깨진다 — 저장할 때 잡아 준다.
    target_ids = {n.id for n in nodes if n.is_target}
    trigger_ids = {n.id for n in nodes if n.is_trigger}
    source_ids = {n.id for n in nodes if n.is_source}
    for e in definition.edges:
        if e.source in target_ids:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=e.source,
                    message="타깃 뒤에는 노드를 이을 수 없습니다 — 타깃은 흐름의 끝입니다",
                )
            )
        # 반대쪽 규칙 — 트리거는 흐름의 시작이라 받을 것이 없다.
        # 들어오는 엣지가 있어도 엔진은 트리거를 실행 대상으로 보지 않아 데이터가 조용히 사라진다.
        if e.target in trigger_ids:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=e.target,
                    message="트리거 앞에는 노드를 둘 수 없습니다 — 트리거는 흐름의 시작입니다",
                )
            )
        # 소스도 받을 것이 없다. **트리거만 예외**다 (언제 도는지를 정해 준다).
        #
        # 엔진의 `_stream_of` 는 소스를 만나면 상류를 조립하지 않고 곧장 read() 한다.
        # 그래서 소스 → 소스 엣지는 그려는 지는데 데이터가 닿지 않는다 — 화면에는 이어져
        # 보이고 실행도 성공하는데 상류 데이터만 조용히 사라지는, 가장 찾기 어려운 종류다.
        if e.target in source_ids and e.source not in trigger_ids:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=e.target,
                    message="소스 앞에는 트리거 외에 노드를 둘 수 없습니다 "
                    "— 소스는 스스로 읽어 오므로 들어온 데이터가 사라집니다",
                )
            )

    upstream = definition.upstream_map()
    downstream: dict[str, list[str]] = {n.id: [] for n in nodes}
    for e in definition.edges:
        downstream[e.source].append(e.target)

    for node in nodes:
        if node.is_source and not downstream[node.id]:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    code=STRUCTURAL_SOURCE_ORPHAN,
                    message="소스가 어디에도 연결되지 않았습니다",
                )
            )
        if node.is_target and not upstream[node.id]:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    code=STRUCTURAL_TARGET_NO_INPUT,
                    message="타깃에 들어오는 입력이 없습니다",
                )
            )
        if node.kind in TRANSFORM_KINDS and not upstream[node.id]:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    code=STRUCTURAL_TRANSFORM_NO_INPUT,
                    message="변환 노드에 입력이 없습니다",
                )
            )
        if node.kind is NodeKind.TRANSFORM_PYTHON:
            issues.extend(_python_node_issues(node))
        if node.kind is NodeKind.LOGIC_SWITCH:
            issues.extend(_switch_node_issues(node))
        needs_connection = (node.is_source or node.is_target) and node.kind not in CONNECTORLESS_TARGET_KINDS
        if needs_connection and not node.params.get("connection_id"):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message="connection_id 가 지정되지 않았습니다"
                )
            )
        if node.kind is NodeKind.SOURCE_SAP:
            issues.extend(_sap_issues(node))
        elif node.kind in CDC_SOURCE_KINDS:
            issues.extend(_cdc_source_issues(node))
        elif node.kind in SYNC_SOURCE_KINDS:
            issues.extend(_sync_source_issues(node))
        elif node.kind is NodeKind.SOURCE_MONGO:
            # Mongo 는 query 가 SQL 이 아니라 필터라서 컬렉션 지정을 대신할 수 없다
            if not node.params.get("table"):
                issues.append(
                    ValidationIssue(level="error", node_id=node.id, message="컬렉션(table)이 필요합니다")
                )
            issues.extend(_mongo_filter_issues(node))
        elif node.is_source and not (node.params.get("table") or node.params.get("query")):
            issues.append(
                ValidationIssue(level="error", node_id=node.id, message="table 또는 query 가 필요합니다")
            )

        if node.kind in SYNC_TARGET_KINDS:
            issues.extend(_sync_target_issues(node))
        # CDC 다중 테이블 타깃 — 소스 테이블마다 타깃/컬럼/키를 따로 매핑한다 (table_mappings).
        # 이게 있으면 단일 table 대신 매핑을 검증한다.
        elif node.kind is NodeKind.TARGET_DB and node.params.get("table_mappings") is not None:
            issues.extend(_cdc_target_mapping_issues(node))
        elif node.kind in {NodeKind.TARGET_DB, NodeKind.TARGET_MONGO}:
            label = "컬렉션" if node.kind is NodeKind.TARGET_MONGO else "table"
            if not node.params.get("table"):
                issues.append(
                    ValidationIssue(level="error", node_id=node.id, message=f"타깃 {label} 이(가) 필요합니다")
                )
            if node.params.get("mode") == "upsert" and not node.params.get("key_columns"):
                issues.append(
                    ValidationIssue(
                        level="error", node_id=node.id, message="upsert 모드는 key_columns 가 필요합니다"
                    )
                )

        if node.kind in OBJECT_TARGET_KINDS and node.params.get("mode") == "upsert":
            label = "S3" if node.kind is NodeKind.TARGET_S3 else "로컬 파일"
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    message=f"{label} 은(는) upsert 를 지원하지 않습니다 — append 또는 overwrite 를 쓰세요",
                )
            )

        if node.kind is NodeKind.TARGET_RESPONSE:
            issues.extend(_response_node_issues(node))

        if node.kind is NodeKind.SCHEDULE and not node.params.get("cron"):
            issues.append(ValidationIssue(level="error", node_id=node.id, message="cron 식이 필요합니다"))

        # SQL 소스에서만 해당 — Mongo·SAP·CDC 는 증분키 개념이 다르다
        if (
            node.is_source
            and node.kind not in DOCUMENT_KINDS
            and node.kind not in CDC_SOURCE_KINDS
            and node.kind is not NodeKind.SOURCE_SAP
            and node.params.get("incremental_column")
            and node.params.get("query")
        ):
            issues.append(
                ValidationIssue(
                    level="warning",
                    node_id=node.id,
                    message="query 모드에서는 증분키가 무시됩니다 — table 모드를 쓰세요",
                )
            )

    trigger_count = sum(1 for n in nodes if n.is_trigger)
    if trigger_count == 0:
        issues.append(ValidationIssue(level="warning", message="트리거가 없어 수동 실행만 가능합니다"))
    return issues


def _duplicate_label_issues(nodes: list[PipelineNode]) -> list[ValidationIssue]:
    """이름이 겹치는 노드.

    캔버스는 이름을 유일하게 만들지만, API 로 직접 저장한 정의나 이 규칙이 생기기 전에
    저장된 정의에는 겹친 이름이 남아 있을 수 있다. **실행을 막지는 않는다** — 실행 자체는
    id 로 돌아가고 이름은 화면·로그에서 노드를 가리키는 데만 쓰이므로, 이미 돌던 파이프라인을
    세우는 대신 경고로 알린다. (메모·영역은 이름을 쓰지 않아 제외)
    """
    issues: list[ValidationIssue] = []
    seen: set[str] = set()
    for n in nodes:
        if n.is_note:
            continue
        name = n.label.strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            issues.append(
                ValidationIssue(
                    level="warning",
                    node_id=n.id,
                    message=f"노드 이름 '{name}' 이(가) 다른 노드와 겹칩니다",
                )
            )
        seen.add(key)
    return issues


def _node_ref_issues(definition: PipelineDefinition) -> list[ValidationIssue]:
    """`${노드이름.컬럼}` 참조가 실행 가능한지.

    참조는 데이터 흐름(엣지)과 별개로 **실행 순서 의존**을 만든다. 그래서 엣지가 없어도
    순환이 생길 수 있다 — A 가 B 의 결과를 참조하고 B 가 A 의 결과를 참조하면 어느 쪽도
    먼저 돌 수 없다. 저장 시점에 잡지 않으면 실행 중에야 드러난다.
    """
    issues: list[ValidationIssue] = []

    for node in definition.nodes:
        for placeholder in var_syntax.malformed_placeholders(node.params):
            issues.append(
                ValidationIssue(
                    level="warning",
                    node_id=node.id,
                    message=(
                        f"{placeholder} 는 변수도 노드 참조도 아니라 글자 그대로 남습니다 "
                        "— $이름 또는 ${노드이름.컬럼} 형태여야 합니다"
                    ),
                )
            )

        for ref in var_syntax.extract_node_refs_from_params(node.params):
            target = definition.node_by_label(ref.node)
            if target is None:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"{ref} 가 가리키는 노드 이름을 찾을 수 없습니다: 「{ref.node}」",
                    )
                )
            elif target.id == node.id:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"{ref} — 자기 자신의 결과는 참조할 수 없습니다",
                    )
                )
            elif target.is_trigger or target.is_note:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"{ref} — 트리거·메모 노드는 결과를 내지 않습니다",
                    )
                )
            elif target.is_target:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"{ref} — 타깃 노드는 입력만 있고 출력이 없습니다",
                    )
                )
            elif target.is_cdc_source:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"{ref} — CDC 소스는 상시 스트림이라 '첫 행'이 정해지지 않습니다",
                    )
                )
            elif target.is_sync_source:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"{ref} — 동기화 소스는 행을 우리 쪽으로 읽어 오지 않습니다 "
                        "(SymmetricDS 가 타깃 DB 로 직접 보냅니다)",
                    )
                )

    deps = definition.node_ref_dependencies()
    if deps:
        # 참조를 엣지처럼 취급해 한 번에 순환을 본다 — 엣지 순환과 참조 순환이 섞인
        # 경우까지 잡으려면 따로 보아서는 안 된다.
        extra = [
            PipelineEdge(source=dep, target=node_id)
            for node_id, targets in deps.items()
            for dep in targets
        ]
        try:
            topological_order(definition.nodes, definition.edges + extra)
        except ValueError:
            issues.append(
                ValidationIssue(
                    level="error",
                    message="노드 결과 참조가 순환합니다 "
                    "— 서로의 결과를 참조하면 어느 쪽도 먼저 실행할 수 없습니다",
                )
            )

    return issues


def _python_node_issues(node: PipelineNode) -> list[ValidationIssue]:
    """Python 전처리 노드 검증 — 저장 시점에 코드를 파싱해 빠른 피드백을 준다.

    실제 실행은 격리 자식 프로세스에서 하지만, 여기서 (1) 코드 존재, (2) 구문 오류,
    (3) ``transform`` 함수 정의 여부를 미리 잡아 UI 에서 즉시 알린다. 코드를 실행하지는
    않는다 — ast 파싱만 한다.
    """
    code = str(node.params.get("code") or "").strip()
    if not code:
        return [ValidationIssue(level="error", node_id=node.id, message="Python 코드가 비어 있습니다")]
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return [
            ValidationIssue(
                level="error", node_id=node.id, message=f"Python 구문 오류: {exc.msg} (줄 {exc.lineno})"
            )
        ]
    names = {
        n.name
        for n in tree.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    has_row = "transform" in names
    has_batch = "transform_batch" in names
    if has_row and has_batch:
        return [
            ValidationIssue(
                level="error",
                node_id=node.id,
                message="transform 과 transform_batch 를 동시에 정의할 수 없습니다",
            )
        ]
    if not has_row and not has_batch:
        return [
            ValidationIssue(
                level="error",
                node_id=node.id,
                message="transform(row) 또는 transform_batch(df) 함수를 정의해야 합니다",
            )
        ]
    return []


def _switch_node_issues(node: PipelineNode) -> list[ValidationIssue]:
    """스위치(조건 분기) 검증 — case 가 있고 각 case 에 조건이 있어야 한다.

    연산자 유효성은 필터와 마찬가지로 워커 실행 시점에 확인한다.
    """
    cases = node.params.get("cases")
    if not isinstance(cases, list) or not cases:
        return [
            ValidationIssue(level="error", node_id=node.id, message="스위치에 case 가 최소 1개 필요합니다")
        ]
    issues: list[ValidationIssue] = []
    for i, case in enumerate(cases, start=1):
        conds = case.get("conditions") if isinstance(case, dict) else None
        if not isinstance(conds, list) or not conds:
            issues.append(
                ValidationIssue(level="error", node_id=node.id, message=f"case #{i} 에 조건이 없습니다")
            )
            continue
        if any(not (isinstance(c, dict) and c.get("field")) for c in conds):
            issues.append(
                ValidationIssue(level="error", node_id=node.id, message=f"case #{i} 조건에 field 가 없습니다")
            )
    return issues


def _sap_issues(node: PipelineNode) -> list[ValidationIssue]:
    """SAP 소스 검증 — 읽기 모드에 따라 필요한 것이 다르다 (설계 문서 §5)."""
    issues: list[ValidationIssue] = []
    mode = str(node.params.get("mode", "read_table")).lower()

    if mode not in {"read_table", "bapi"}:
        return [
            ValidationIssue(
                level="error",
                node_id=node.id,
                message=f"알 수 없는 SAP 읽기 모드: {mode} (read_table | bapi)",
            )
        ]

    if mode == "bapi":
        if not node.params.get("function_name"):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message="BAPI 모드는 function_name 이 필요합니다"
                )
            )
        return issues

    # read_table 모드
    if not node.params.get("table"):
        issues.append(
            ValidationIssue(
                level="error", node_id=node.id, message="RFC_READ_TABLE 모드는 table 이 필요합니다"
            )
        )
    if not node.params.get("columns"):
        # 전체 필드를 요청하면 512자를 넘겨 분할 호출이 일어난다 — 느리고 행이 어긋날 위험이 있다
        issues.append(
            ValidationIssue(
                level="warning",
                node_id=node.id,
                message="필드를 지정하지 않으면 테이블 전체를 읽습니다. "
                "폭이 512자를 넘으면 나눠 호출하게 되니 필요한 필드만 고르거나 BAPI 를 쓰세요",
            )
        )
    return issues


#: 응답 노드가 모을 수 있는 행 수의 상한. 이 노드는 스트리밍 원칙의 **의도된 예외**라
#: 행을 메모리에 쌓는다 — 상한이 없으면 큰 테이블 하나가 워커를 통째로 삼킨다.
RESPONSE_MAX_ROWS_CAP = 10_000
RESPONSE_DEFAULT_MAX_ROWS = 100


def _response_node_issues(node: PipelineNode) -> list[ValidationIssue]:
    """응답 노드 규칙.

    다른 타깃과 성격이 다르다. 어딘가에 적재하지 않고 **호출자에게 돌려준다.** 그래서
    연결이 없고, 대신 행을 메모리에 모은다 — 스트리밍 원칙의 의도된 예외다.
    그 예외를 감당할 수 있게 하는 것이 ``max_rows`` 상한이라 필수로 둔다.
    """
    issues: list[ValidationIssue] = []
    raw = node.params.get("max_rows", RESPONSE_DEFAULT_MAX_ROWS)

    try:
        max_rows = int(raw)
    except (TypeError, ValueError):
        return [
            ValidationIssue(
                level="error", node_id=node.id, message=f"max_rows 는 숫자여야 합니다: {raw!r}"
            )
        ]

    if max_rows < 1:
        issues.append(
            ValidationIssue(level="error", node_id=node.id, message="max_rows 는 1 이상이어야 합니다")
        )
    elif max_rows > RESPONSE_MAX_ROWS_CAP:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=node.id,
                message=f"max_rows 는 {RESPONSE_MAX_ROWS_CAP:,} 이하여야 합니다 "
                "— 응답 노드는 행을 메모리에 모으므로 상한이 필요합니다",
            )
        )

    columns = node.params.get("columns")
    if columns is not None:
        if not isinstance(columns, list) or not all(isinstance(c, str) and c for c in columns):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message="columns 는 컬럼명 목록이어야 합니다"
                )
            )
        elif len(set(columns)) != len(columns):
            issues.append(
                ValidationIssue(level="error", node_id=node.id, message="columns 에 중복이 있습니다")
            )

    return issues


def _api_trigger_issues(nodes: list[PipelineNode]) -> list[ValidationIssue]:
    """API 트리거와 `$변수` 규칙.

    핵심은 **선언되지 않은 `$이름` 을 저장 시점에 잡는 것**이다. 실행할 때 알면 이미 늦다 —
    엔진은 값이 없으면 실패시키므로(빈 문자열 치환은 전체 재적재를 부른다) 저작 화면에서
    미리 막아 주는 편이 사고를 줄인다.
    """
    issues: list[ValidationIssue] = []
    api_triggers = [n for n in nodes if n.is_api_trigger]

    if len(api_triggers) > 1:
        issues.append(
            ValidationIssue(
                level="error",
                message="API 트리거는 파이프라인당 하나만 둘 수 있습니다 "
                "— 호출 창구가 여럿이면 어느 변수 묶음으로 도는지 알 수 없습니다",
            )
        )

    declared: dict[str, TriggerVariable] = {}
    for trigger in api_triggers:
        for spec in trigger.declared_variables():
            if spec.name in declared:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=trigger.id,
                        message=f"변수 이름이 중복됩니다: ${spec.name}",
                    )
                )
            declared[spec.name] = spec

    used: dict[str, str] = {}  # 변수 이름 → 처음 쓴 노드
    for node in nodes:
        if node.is_api_trigger or node.is_note:
            continue
        for name in var_syntax.extract_from_params(node.params):
            used.setdefault(name, node.id)

    for name, node_id in used.items():
        if name in declared:
            continue
        if api_triggers:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node_id,
                    message=f"선언되지 않은 변수입니다: ${name} "
                    "— API 트리거 노드에 이 변수를 추가하세요",
                )
            )
        else:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node_id,
                    message=f"`${name}` 을 쓰려면 API 트리거 노드가 필요합니다",
                )
            )

    for name, spec in declared.items():
        if name not in used:
            issues.append(
                ValidationIssue(
                    level="warning",
                    message=f"선언만 하고 쓰지 않는 변수입니다: ${name}",
                )
            )
        elif not spec.required and spec.default is None:
            # 선택 변수인데 기본값이 없으면, 호출자가 값을 빼는 순간 실행이 실패한다
            issues.append(
                ValidationIssue(
                    level="warning",
                    message=f"${name} 은 선택 변수인데 기본값이 없습니다 "
                    "— 호출에서 빠지면 실행이 실패합니다",
                )
            )

    return issues


def _cdc_pipeline_issues(
    nodes: list[PipelineNode], sources: list[PipelineNode]
) -> list[ValidationIssue]:
    """CDC 파이프라인 수준 규칙 (기획안 §5.3).

    CDC 는 실행 모델이 배치와 달라(끝나지 않는 스트림·push 소스) 한 파이프라인 안에서
    배치와 섞을 수 없다. 트리거도 CDC 전용이어야 한다.
    """
    issues: list[ValidationIssue] = []
    cdc_sources = [n for n in sources if n.is_cdc_source]
    batch_sources = [n for n in sources if not n.is_cdc_source and not n.is_sync_source]
    cdc_triggers = [n for n in nodes if n.is_cdc_trigger]
    batch_triggers = [n for n in nodes if n.kind in BATCH_TRIGGER_KINDS]

    if cdc_sources and batch_sources:
        issues.append(
            ValidationIssue(
                level="error",
                message="CDC 소스와 배치 소스를 한 파이프라인에 섞을 수 없습니다 — 분리하세요",
            )
        )

    if cdc_sources:
        # CDC 파이프라인
        if batch_triggers:
            issues.append(
                ValidationIssue(
                    level="error",
                    message="CDC 파이프라인에는 스케줄·수동 트리거를 쓸 수 없습니다 (CDC 트리거만)",
                )
            )
        if not cdc_triggers:
            # 스트림은 API 로도 시작되지만, 저작 의도를 분명히 하려면 CDC 트리거를 두는 게 맞다
            issues.append(
                ValidationIssue(
                    level="warning",
                    message="CDC 소스에 CDC 트리거가 연결되지 않았습니다",
                )
            )
    elif cdc_triggers:
        # CDC 트리거만 있고 CDC 소스가 없다
        for trg in cdc_triggers:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=trg.id,
                    message="CDC 트리거는 CDC 소스가 있어야 의미가 있습니다",
                )
            )
    return issues


def _cdc_source_issues(node: PipelineNode) -> list[ValidationIssue]:
    """CDC 소스 노드 검증 (기획안 §5.2)."""
    issues: list[ValidationIssue] = []

    # 캡처 대상 테이블 — 단일(table) 또는 다중(tables) 중 하나는 있어야 한다
    tables = node.params.get("tables")
    if tables is not None and not isinstance(tables, list):
        issues.append(
            ValidationIssue(level="error", node_id=node.id, message="tables 는 목록이어야 합니다")
        )
        tables = None
    if not node.params.get("table") and not tables:
        issues.append(
            ValidationIssue(
                level="error", node_id=node.id, message="캡처할 테이블(table 또는 tables)이 필요합니다"
            )
        )

    delete_mode = node.params.get("delete_mode")
    if delete_mode is not None and str(delete_mode) not in CDC_DELETE_MODES:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=node.id,
                message=f"알 수 없는 삭제 처리 방식: {delete_mode} "
                f"({' | '.join(sorted(CDC_DELETE_MODES))})",
            )
        )

    snapshot = node.params.get("snapshot")
    if snapshot is not None and str(snapshot) not in CDC_SNAPSHOT_MODES:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=node.id,
                message=f"알 수 없는 스냅샷 모드: {snapshot} "
                f"({' | '.join(sorted(CDC_SNAPSHOT_MODES))})",
            )
        )
    return issues


def _cdc_target_mapping_issues(node: PipelineNode) -> list[ValidationIssue]:
    """CDC 다중 테이블 타깃 매핑 검증.

    각 매핑 = 소스 테이블 하나를 타깃 테이블 하나로 보내는 규칙(컬럼 리네임·키 포함).
    소스 테이블마다 컬럼 구성이 달라서 매핑은 반드시 테이블별이어야 한다.
    """
    issues: list[ValidationIssue] = []
    mappings = node.params.get("table_mappings")
    if not isinstance(mappings, list) or not mappings:
        return [
            ValidationIssue(
                level="error", node_id=node.id, message="테이블 매핑이 비어 있습니다 (최소 1개 필요)"
            )
        ]

    for i, m in enumerate(mappings, start=1):
        if not isinstance(m, dict):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"매핑 #{i}: 형식이 올바르지 않습니다"
                )
            )
            continue
        if not m.get("source_table"):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"매핑 #{i}: 소스 테이블이 필요합니다"
                )
            )
        if not m.get("target_table"):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"매핑 #{i}: 타깃 테이블이 필요합니다"
                )
            )
        columns = m.get("columns")
        if columns is not None and not isinstance(columns, list):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"매핑 #{i}: columns 는 목록이어야 합니다"
                )
            )
            columns = []
        for c in columns or []:
            # disabled 는 제외만 하므로 대상 이름이 없어도 된다 —
            # sink 의 _build_column_map 이 그렇게 읽는데 여기서 막으면 저장이 거부돼,
            # 화면에서 만든 제외 규칙이 실행에 닿지 못한다.
            ok = isinstance(c, dict) and c.get("source") and (c.get("target") or c.get("disabled"))
            if not ok:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"매핑 #{i}: 컬럼 매핑에는 원본·대상 이름이 모두 필요합니다"
                        " (제외 항목은 원본만 있어도 됩니다)",
                    )
                )
            cast = c.get("cast") if isinstance(c, dict) else None
            if cast and str(cast) not in CDC_MAP_CASTS:
                issues.append(
                    ValidationIssue(
                        level="error",
                        node_id=node.id,
                        message=f"매핑 #{i}: 지원하지 않는 변환 {cast} ({' | '.join(sorted(CDC_MAP_CASTS))})",
                    )
                )
        # 키가 없으면 append(중복 가능)로 적재된다 — 삭제/갱신 반영이 안 되므로 경고
        if not m.get("key_columns"):
            issues.append(
                ValidationIssue(
                    level="warning",
                    node_id=node.id,
                    message=f"매핑 #{i}: 키 컬럼이 없어 append 로 적재됩니다 (upsert·삭제 반영 불가)",
                )
            )
    return issues


def _mongo_filter_issues(node: PipelineNode) -> list[ValidationIssue]:
    """Mongo 필터는 JSON 객체여야 한다. 실행 시점에 터지기 전에 저장 시점에 잡는다."""
    raw = node.params.get("query")
    if not raw or not str(raw).strip():
        return []
    try:
        parsed = json.loads(str(raw))
    except json.JSONDecodeError as exc:
        return [
            ValidationIssue(level="error", node_id=node.id, message=f"필터가 올바른 JSON 이 아닙니다: {exc}")
        ]
    if not isinstance(parsed, dict):
        return [ValidationIssue(level="error", node_id=node.id, message="필터는 JSON 객체여야 합니다")]
    return []


# ------------------------------------------------------- 실시간 동기화 (SymmetricDS)


def _sync_pipeline_issues(
    definition: PipelineDefinition, sources: list[PipelineNode]
) -> list[ValidationIssue]:
    """실시간 동기화 파이프라인 수준 규칙.

    다른 모든 파이프라인과 갈리는 지점이 하나 있다 — **데이터가 우리 워커를 지나지 않는다.**
    SymmetricDS 가 원본 테이블 트리거로 변경을 잡아 타깃 DB 로 직접 밀어 넣는다.

    그래서 소스와 타깃 사이에 변환 노드를 두면 화면에는 이어져 보이는데 아무 일도 일어나지
    않는다. 소스 앞 엣지와 정확히 같은 계열의 함정이라 같은 방식으로 막는다 —
    **못 하는 일은 그릴 수 없게 한다.**

    노드 그룹 링크가 source→target 한 쌍이므로 소스도 타깃도 파이프라인당 하나다.
    """
    nodes = definition.nodes
    sync_sources = [n for n in sources if n.is_sync_source]
    sync_targets = [n for n in nodes if n.is_sync_target]
    sync_triggers = [n for n in nodes if n.is_sync_trigger]

    if not (sync_sources or sync_targets or sync_triggers):
        return []

    issues: list[ValidationIssue] = []
    other_sources = [n for n in sources if not n.is_sync_source]
    other_targets = [n for n in nodes if n.is_target and not n.is_sync_target]

    if other_sources:
        issues.append(
            ValidationIssue(
                level="error",
                message="실시간 동기화 소스는 다른 소스와 한 파이프라인에 둘 수 없습니다 — 분리하세요",
            )
        )
    if other_targets:
        issues.append(
            ValidationIssue(
                level="error",
                message="실시간 동기화 타깃 외의 타깃을 함께 둘 수 없습니다 "
                "— SymmetricDS 는 타깃 DB 하나로만 밀어 넣습니다",
            )
        )

    if not sync_sources:
        for node in sync_targets + sync_triggers:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    message="실시간 동기화 소스가 없습니다 — 소스·타깃이 한 쌍이어야 합니다",
                )
            )
        return issues

    if len(sync_sources) > 1:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=sync_sources[1].id,
                message=f"동기화 소스가 {len(sync_sources)}개입니다 "
                "— 노드 그룹 링크가 소스↔타깃 한 쌍이라 소스는 하나여야 합니다",
            )
        )
    if not sync_targets:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=sync_sources[0].id,
                message="실시간 동기화 타깃이 없습니다 — 어느 DB 로 밀어 넣을지 정해야 합니다",
            )
        )
    elif len(sync_targets) > 1:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=sync_targets[1].id,
                message=f"동기화 타깃이 {len(sync_targets)}개입니다 — 타깃도 하나여야 합니다",
            )
        )

    # 변환은 애초에 놓을 수 없다. 이어붙이지 않아 "입력이 없습니다"로 잡히는 것과 달리,
    # 여기서는 **놓았다는 사실 자체**를 알려준다 — 사용자는 변환이 될 거라 믿고 놓은 것이다.
    for node in nodes:
        if node.kind in TRANSFORM_KINDS:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    message="실시간 동기화 파이프라인에는 변환 노드를 둘 수 없습니다 "
                    "— 데이터가 워커를 지나지 않아 변환이 적용되지 않습니다",
                )
            )

    batch_triggers = [n for n in nodes if n.kind in BATCH_TRIGGER_KINDS]
    cdc_triggers = [n for n in nodes if n.is_cdc_trigger]
    for trg in batch_triggers + cdc_triggers:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=trg.id,
                message="실시간 동기화 파이프라인에는 동기화 트리거만 쓸 수 있습니다",
            )
        )
    if not sync_triggers:
        # 동기화는 API 로도 시작되지만, 저작 의도를 분명히 하려면 트리거를 두는 게 맞다
        issues.append(
            ValidationIssue(
                level="warning",
                message="실시간 동기화 소스에 동기화 트리거가 연결되지 않았습니다",
            )
        )

    sync_source_ids = {n.id for n in sync_sources}
    sync_target_ids = {n.id for n in sync_targets}
    for e in definition.edges:
        if e.source in sync_source_ids and e.target not in sync_target_ids:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=e.source,
                    message="동기화 소스는 동기화 타깃에만 이을 수 있습니다 "
                    "— 사이에 다른 노드를 두면 조용히 무시됩니다",
                )
            )
        if e.target in sync_target_ids and e.source not in sync_source_ids:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=e.target,
                    message="동기화 타깃에는 동기화 소스만 이을 수 있습니다",
                )
            )
    return issues


def _sync_source_issues(node: PipelineNode) -> list[ValidationIssue]:
    """동기화 소스 노드 검증 — 테이블마다 채널·초기적재순서·행필터를 갖는다."""
    issues: list[ValidationIssue] = []
    tables = node.params.get("tables")
    if not isinstance(tables, list) or not tables:
        return [
            ValidationIssue(
                level="error", node_id=node.id, message="동기화할 테이블이 지정되지 않았습니다"
            )
        ]

    seen: set[str] = set()
    for i, item in enumerate(tables, start=1):
        if not isinstance(item, dict):
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    message=f"테이블 #{i}: 이름·채널을 담은 객체여야 합니다",
                )
            )
            continue

        name = str(item.get("name") or "").strip()
        if not name:
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"테이블 #{i}: 이름이 비어 있습니다"
                )
            )
            continue
        # SQL Server 는 식별자 대소문자를 구분하지 않는다 — 같은 테이블을 두 번 등록하면
        # 트리거가 겹쳐 SymmetricDS 가 등록 시점에 실패한다. 저장할 때 잡는다.
        key = name.casefold()
        if key in seen:
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"테이블 #{i}: {name} 이(가) 중복입니다"
                )
            )
        seen.add(key)

        channel = item.get("channel")
        if channel is not None and str(channel) not in SYNC_CHANNELS:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    message=f"테이블 #{i}: 알 수 없는 채널 {channel} "
                    f"({' | '.join(sorted(SYNC_CHANNELS))})",
                )
            )

        order = item.get("initial_load_order")
        if order is not None and (isinstance(order, bool) or not isinstance(order, int)):
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    message=f"테이블 #{i}: 초기 적재 순서는 정수여야 합니다",
                )
            )

        row_filter = item.get("row_filter")
        if row_filter is not None and not isinstance(row_filter, str):
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"테이블 #{i}: 행 필터는 문자열이어야 합니다"
                )
            )

    purpose = node.params.get("purpose")
    if purpose is not None and str(purpose) not in SYNC_PURPOSES:
        issues.append(
            ValidationIssue(
                level="error",
                node_id=node.id,
                message=f"알 수 없는 복제본 용도 {purpose} ({' | '.join(sorted(SYNC_PURPOSES))})",
            )
        )

    return issues


def _sync_target_issues(node: PipelineNode) -> list[ValidationIssue]:
    """동기화 타깃 노드 검증 — 테이블명 매핑이 핵심이다.

    PostgreSQL 은 인용하지 않은 식별자를 소문자로 접는다 (``INVENTORY`` → ``inventory``).
    매핑을 비워 두면 대문자 테이블명이 그대로 나가 타깃에서 찾지 못한다 — 그래서 경고한다.
    """
    issues: list[ValidationIssue] = []
    mappings = node.params.get("table_mappings")
    if mappings is None:
        return [
            ValidationIssue(
                level="warning",
                node_id=node.id,
                message="타깃 테이블명 매핑이 없습니다 "
                "— PostgreSQL 은 대문자 식별자를 소문자로 접으므로 명시하는 편이 안전합니다",
            )
        ]
    if not isinstance(mappings, list):
        return [
            ValidationIssue(
                level="error", node_id=node.id, message="table_mappings 는 목록이어야 합니다"
            )
        ]

    seen: set[str] = set()
    for i, m in enumerate(mappings, start=1):
        if not isinstance(m, dict):
            issues.append(
                ValidationIssue(level="error", node_id=node.id, message=f"매핑 #{i}: 객체여야 합니다")
            )
            continue
        source_table = str(m.get("source_table") or "").strip()
        if not source_table:
            issues.append(
                ValidationIssue(
                    level="error", node_id=node.id, message=f"매핑 #{i}: source_table 이 필요합니다"
                )
            )
            continue
        key = source_table.casefold()
        if key in seen:
            issues.append(
                ValidationIssue(
                    level="error",
                    node_id=node.id,
                    message=f"매핑 #{i}: {source_table} 매핑이 중복입니다",
                )
            )
        seen.add(key)
    return issues
