"""SymmetricDS 설정 테이블(SYM_*) 조작 SQL — 순수 생성기.

기획안 §5-3~5-7 이 전부 SQL ``INSERT`` 로 적혀 있는 데는 이유가 있다. SymmetricDS 의 설정은
**설정 파일이 아니라 원본 DB 안의 테이블**이다(``SYM_TRIGGER``·``SYM_ROUTER``·``SYM_CHANNEL``…).
엔진 자체(접속 정보·노드 그룹)는 컨테이너에 고정해 두고, "무엇을 동기화하는가"만 런타임에
이 테이블들로 넣는다. 그래서 이 계층은 SymmetricDS 를 임포트하지 않고 SQL 만 만든다.

**전역 설정을 읽지 않는다.** ``cdc_connect.build_connector_config`` 와 같은 이유다 —
순수 함수여야 테스트가 환경에 매이지 않는다. 접두어·노드 그룹은 인자로 받는다.

**모든 값은 바인드 파라미터다.** 테이블 이름조차 SYM_* 에서는 식별자가 아니라 *데이터*로
저장되므로(``SYM_TRIGGER.source_table_name`` 은 그냥 VARCHAR 다) 문자열을 조립할 자리가
없다. 식별자로 들어가는 것은 우리가 정하는 테이블 접두어 하나뿐이고, 그것은 형식을 강제한다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .errors import ValidationError

#: SQL Server 기본 스키마
DEFAULT_SOURCE_SCHEMA = "dbo"
#: 문서 5-3 — 노드 그룹 두 개와 그 사이의 링크 하나가 전체 구조다
SOURCE_GROUP = "source"
TARGET_GROUP = "target"
#: P = Push. 실시간성이 요건이라 Pull(폴링 주기만큼 지연 추가)을 쓰지 않는다 (문서 5-3)
DATA_EVENT_ACTION_PUSH = "P"

#: 채널 정의 (문서 5-4). 대량 배치가 발생하는 테이블을 realtime 에 넣으면 그 한 번이
#: 채널을 점유해 다른 테이블의 실시간성을 통째로 망친다 — 그래서 셋으로 갈라 둔다.
CHANNELS: tuple[dict[str, Any], ...] = (
    {
        "channel_id": "realtime",
        "processing_order": 1,
        "max_batch_size": 1000,
        "description": "재고/출고 등 지연 민감 테이블",
    },
    {
        "channel_id": "standard",
        "processing_order": 5,
        "max_batch_size": 10000,
        "description": "일반 마스터 테이블",
    },
    {
        "channel_id": "bulk",
        "processing_order": 10,
        "max_batch_size": 50000,
        "description": "대량 배치 발생 테이블",
    },
)

#: 트리거/라우터 id 최대 길이 (SymmetricDS 는 128 이지만 여유를 둔다)
MAX_ID_LENGTH = 100
_PREFIX_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,29}$")
_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_]+")

#: (sql, params) 쌍. 실행은 sync_service 가 SQLAlchemy 로 한다.
Statement = tuple[str, dict[str, Any]]


@dataclass(frozen=True, slots=True)
class SyncTable:
    """동기화 대상 테이블 하나와 그 전송 정책."""

    name: str
    namespace: str = DEFAULT_SOURCE_SCHEMA
    #: 이 테이블이 있는 **데이터베이스**. SYM_* 를 다른 DB 에 두었을 때만 채운다 —
    #: 그때 SymmetricDS 는 catalog.schema.table 로 트리거를 만들어 크로스 DB 로 캡처한다.
    #: 같은 DB 면 비워 둔다(기존 동작 유지).
    catalog: str = ""
    channel: str = "standard"
    #: 초기 적재 순서. FK 의존을 고려해 마스터 테이블을 먼저 배치한다 (문서 5-6).
    initial_load_order: int = 100
    #: 행 단위 필터. SymmetricDS 가 subselect 라우터의 WHERE 조각으로 그대로 실행한다
    #: (문서 5-7). 임의 SQL 이므로 이 값을 넣는 것은 소스 DB 에 SQL 을 쓰는 것과 같은
    #: 권한이다 — 라우터는 OPERATOR 역할로 제한된다.
    row_filter: str = ""
    #: 타깃 테이블/스키마. 비우면 SymmetricDS 가 소스 이름을 그대로 쓴다 —
    #: PostgreSQL 은 인용하지 않은 식별자를 소문자로 접으므로 대개 명시해야 한다 (문서 6).
    target_table: str = ""
    target_namespace: str = ""


@dataclass(frozen=True, slots=True)
class SyncPlan:
    """한 스트림이 SYM_* 에 심는 것 전부."""

    stream_id: str
    tables: list[SyncTable] = field(default_factory=list)
    source_group: str = SOURCE_GROUP
    target_group: str = TARGET_GROUP
    table_prefix: str = "SYM"

    def __post_init__(self) -> None:
        if not self.stream_id:
            raise ValidationError("stream_id 가 필요합니다")
        if not self.tables:
            raise ValidationError("동기화할 테이블이 최소 하나 필요합니다")
        if not _PREFIX_RE.match(self.table_prefix):
            raise ValidationError(
                f"SymmetricDS 테이블 접두어가 올바르지 않습니다: {self.table_prefix!r} "
                "(영문으로 시작하는 영숫자·언더스코어)"
            )

    # SYM_* 는 접두어가 설정값이라 식별자로 조립되는 **유일한** 자리다.
    # 그래서 __post_init__ 이 형식을 강제한다 — 그 검사가 이 프로퍼티의 전제다.
    def table(self, name: str) -> str:
        return f"{self.table_prefix}_{name}"


def short_id(stream_id: str) -> str:
    """스트림 id 앞 8자. 트리거/라우터 id 를 짧게 유지하면서 스트림끼리 겹치지 않게 한다."""
    return stream_id.replace("-", "")[:8].lower()


def _slug(table: str) -> str:
    """테이블 이름을 id 조각으로 다듬는다. 스키마 구분자·특수문자를 눕힌다."""
    return _SAFE_ID_RE.sub("_", table).strip("_").lower()


def trigger_id(stream_id: str, table: str) -> str:
    raw = f"eai_{short_id(stream_id)}_{_slug(table)}"
    return raw[:MAX_ID_LENGTH]


def router_id(stream_id: str, table: str) -> str:
    raw = f"eair_{short_id(stream_id)}_{_slug(table)}"
    return raw[:MAX_ID_LENGTH]


def _now() -> str:
    """SYM_* 의 create_time/last_update_time.

    설정 마스터는 **소스(SQL Server) DB 안**에 있다 — 그래서 여기 SQL 은 T-SQL 이다
    (``IF NOT EXISTS … INSERT`` 도 마찬가지). 소스가 다른 엔진으로 늘어나면 그때 갈라야 한다.
    """
    return "CURRENT_TIMESTAMP"


# --------------------------------------------------------------------- 구성


def build_group_statements(plan: SyncPlan) -> list[Statement]:
    """노드 그룹과 링크 (문서 5-3). 이미 있으면 넣지 않는다 — 스트림끼리 공유한다."""
    ts = _now()
    stmts: list[Statement] = []
    ng = plan.table("NODE_GROUP")
    for group, desc in ((plan.source_group, "EAI 동기화 소스"), (plan.target_group, "EAI 동기화 타깃")):
        stmts.append(
            (
                f"IF NOT EXISTS (SELECT 1 FROM {ng} WHERE node_group_id = :gid) "
                f"INSERT INTO {ng} (node_group_id, description, create_time, last_update_time) "
                f"VALUES (:gid, :desc, {ts}, {ts})",
                {"gid": group, "desc": desc},
            )
        )

    ngl = plan.table("NODE_GROUP_LINK")
    link = {
        "src": plan.source_group,
        "tgt": plan.target_group,
        # Push — 소스가 타깃으로 밀어낸다. Pull 은 폴링 주기만큼 지연이 붙는다 (문서 5-3).
        "action": DATA_EVENT_ACTION_PUSH,
    }
    stmts.append(
        (
            f"IF NOT EXISTS (SELECT 1 FROM {ngl} "
            f"WHERE source_node_group_id = :src AND target_node_group_id = :tgt) "
            f"INSERT INTO {ngl} "
            f"(source_node_group_id, target_node_group_id, data_event_action, "
            f"create_time, last_update_time) "
            f"VALUES (:src, :tgt, :action, {ts}, {ts})",
            dict(link),
        )
    )
    # **넣는 것만으로는 부족하다.** SymmetricDS 가 노드 등록 과정에서 이 링크를 먼저
    # 만들어 두는데 기본값이 'W'(풀 대기)다. "이미 있으면 건너뛴다"로 두면 우리가 의도한
    # 푸시가 아니라 타깃의 풀 주기(기본 10초)로 돌아간다 — 설정은 들어갔는데 지연만
    # 그대로인, 원인을 찾기 어려운 종류다. 실측에서 이것 때문에 16초가 나왔다.
    stmts.append(
        (
            f"UPDATE {ngl} SET data_event_action = :action, last_update_time = {ts} "
            f"WHERE source_node_group_id = :src AND target_node_group_id = :tgt "
            f"AND data_event_action <> :action",
            dict(link),
        )
    )
    return stmts


def build_channel_statements(plan: SyncPlan) -> list[Statement]:
    """채널 셋을 보장한다 (문서 5-4). 이미 있으면 건드리지 않는다 —
    운영이 max_batch_size 를 부하 테스트 결과로 조정했을 수 있고, 그것을 되돌리면 안 된다."""
    ts = _now()
    ch = plan.table("CHANNEL")
    return [
        (
            f"IF NOT EXISTS (SELECT 1 FROM {ch} WHERE channel_id = :cid) "
            f"INSERT INTO {ch} "
            f"(channel_id, processing_order, max_batch_size, enabled, description, "
            f"create_time, last_update_time) "
            f"VALUES (:cid, :order, :size, 1, :desc, {ts}, {ts})",
            {
                "cid": c["channel_id"],
                "order": c["processing_order"],
                "size": c["max_batch_size"],
                "desc": c["description"],
            },
        )
        for c in CHANNELS
    ]


def build_table_statements(plan: SyncPlan) -> list[Statement]:
    """테이블마다 트리거·라우터·연결을 심는다 (문서 5-5·5-6·5-7).

    라우터를 **테이블마다** 만드는 것이 문서(라우터 하나에 트리거 여럿)와 다른 점이다.
    타깃 테이블명과 행 필터가 테이블별로 달라야 하는데, 그 둘이 라우터에 붙어 있기 때문이다.
    라우터를 공유하면 테이블 하나에 필터를 걸 때 나머지가 함께 걸린다.

    멱등하게 만들려고 먼저 지우고 넣는다 — 파이프라인을 고쳐 다시 시작하는 것이 흔하고,
    그때 남은 옛 트리거가 조용히 계속 도는 것이 가장 나쁘다.
    """
    ts = _now()
    trg = plan.table("TRIGGER")
    rtr = plan.table("ROUTER")
    tr = plan.table("TRIGGER_ROUTER")

    stmts: list[Statement] = []
    for t in plan.tables:
        if not t.name.strip():
            raise ValidationError("테이블 이름이 비어 있습니다")
        tid = trigger_id(plan.stream_id, t.name)
        rid = router_id(plan.stream_id, t.name)

        # 순서가 중요하다 — trigger_router 가 둘을 참조하므로 지울 때는 그것부터다.
        stmts.append((f"DELETE FROM {tr} WHERE trigger_id = :tid", {"tid": tid}))
        stmts.append((f"DELETE FROM {rtr} WHERE router_id = :rid", {"rid": rid}))
        stmts.append((f"DELETE FROM {trg} WHERE trigger_id = :tid", {"tid": tid}))

        stmts.append(
            (
                f"INSERT INTO {trg} "
                f"(trigger_id, source_catalog_name, source_schema_name, source_table_name, "
                f"channel_id, create_time, last_update_time) "
                f"VALUES (:tid, :catalog, :schema, :table, :channel, {ts}, {ts})",
                {
                    "tid": tid,
                    # NULL 이면 "엔진이 붙은 DB" 라는 뜻이다. 값이 있으면 그 DB 를 가리킨다.
                    "catalog": t.catalog or None,
                    "schema": t.namespace or DEFAULT_SOURCE_SCHEMA,
                    "table": t.name,
                    "channel": t.channel or "standard",
                },
            )
        )

        # 행 필터가 있으면 subselect 라우터, 없으면 default (문서 5-7)
        router_type = "subselect" if t.row_filter.strip() else "default"
        stmts.append(
            (
                f"INSERT INTO {rtr} "
                f"(router_id, source_node_group_id, target_node_group_id, router_type, "
                f"router_expression, target_schema_name, target_table_name, "
                f"create_time, last_update_time) "
                f"VALUES (:rid, :src, :tgt, :rtype, :expr, :tschema, :ttable, {ts}, {ts})",
                {
                    "rid": rid,
                    "src": plan.source_group,
                    "tgt": plan.target_group,
                    "rtype": router_type,
                    # 빈 문자열이 아니라 NULL 이어야 한다 — SymmetricDS 는 빈 표현식을
                    # 조건으로 읽어 아무 행도 라우팅하지 않는다.
                    "expr": t.row_filter.strip() or None,
                    "tschema": t.target_namespace or None,
                    "ttable": t.target_table or None,
                },
            )
        )

        stmts.append(
            (
                f"INSERT INTO {tr} "
                f"(trigger_id, router_id, enabled, initial_load_order, "
                f"create_time, last_update_time) "
                f"VALUES (:tid, :rid, 1, :order, {ts}, {ts})",
                {"tid": tid, "rid": rid, "order": t.initial_load_order},
            )
        )
    return stmts


def build_setup_statements(plan: SyncPlan) -> list[Statement]:
    """스트림을 세우는 전체 SQL. 순서가 곧 FK 의존 순서다."""
    return [
        *build_group_statements(plan),
        *build_channel_statements(plan),
        *build_table_statements(plan),
    ]


def build_teardown_statements(plan: SyncPlan) -> list[Statement]:
    """이 스트림이 만든 것만 지운다.

    채널·노드 그룹·링크는 **남긴다** — 스트림끼리 공유하므로 지우면 남의 동기화가 끊긴다.
    원본 테이블의 실제 트리거는 이 삭제 뒤 sync-triggers 가 돌면서 정리된다.
    """
    trg = plan.table("TRIGGER")
    rtr = plan.table("ROUTER")
    tr = plan.table("TRIGGER_ROUTER")
    stmts: list[Statement] = []
    for t in plan.tables:
        tid = trigger_id(plan.stream_id, t.name)
        rid = router_id(plan.stream_id, t.name)
        stmts.append((f"DELETE FROM {tr} WHERE trigger_id = :tid", {"tid": tid}))
        stmts.append((f"DELETE FROM {rtr} WHERE router_id = :rid", {"rid": rid}))
        stmts.append((f"DELETE FROM {trg} WHERE trigger_id = :tid", {"tid": tid}))
    return stmts


def build_enable_statements(plan: SyncPlan, *, enabled: bool) -> list[Statement]:
    """일시정지/재개.

    채널을 끄지 않는 이유는 채널이 스트림끼리 공유되기 때문이다 — 하나를 멈추려다
    남의 동기화까지 멈춘다. ``SYM_TRIGGER_ROUTER.enabled`` 를 내리면 **트리거는 그대로
    남아** 변경이 ``SYM_DATA`` 에 계속 쌓이고, 재개하면 밀린 것이 이어서 흘러간다.
    이것이 '일시정지'의 뜻에 맞다.

    다만 정지가 길어지면 원본 DB 용량이 늘어난다 (문서 §3 장애 내성 · §7). 이 사실은
    모니터링 지표(pending_rows)로 드러낸다.
    """
    tr = plan.table("TRIGGER_ROUTER")
    ts = _now()
    return [
        (
            f"UPDATE {tr} SET enabled = :enabled, last_update_time = {ts} WHERE trigger_id = :tid",
            {"enabled": 1 if enabled else 0, "tid": trigger_id(plan.stream_id, t.name)},
        )
        for t in plan.tables
    ]


def build_initial_load_statement(plan: SyncPlan) -> Statement:
    """타깃 노드에 초기 적재를 요청한다 (문서 8장 Phase 2·4 — 전량 덤프).

    REST 없이 SQL 로 끝난다. 등록된 타깃 노드 전부에 걸며, 적재 순서는
    ``SYM_TRIGGER_ROUTER.initial_load_order`` 가 정한다 (FK 의존 순서).
    """
    ns = plan.table("NODE_SECURITY")
    node = plan.table("NODE")
    return (
        f"UPDATE {ns} SET initial_load_enabled = 1, initial_load_time = NULL "
        f"WHERE node_id IN (SELECT node_id FROM {node} WHERE node_group_id = :tgt)",
        {"tgt": plan.target_group},
    )


# --------------------------------------------------------------------- 조회


def registered_nodes_sql(plan: SyncPlan) -> Statement:
    """타깃 노드가 등록을 마쳤는지. 등록 전에는 아무리 기다려도 데이터가 가지 않는다."""
    node = plan.table("NODE")
    return (
        f"SELECT node_id, node_group_id, sync_enabled, sync_url "
        f"FROM {node} WHERE node_group_id = :tgt",
        {"tgt": plan.target_group},
    )


def batch_summary_sql(plan: SyncPlan) -> Statement:
    """배치 상태 요약 (문서 §11). status != 'OK' 가 쌓이면 전송이 밀리고 있다는 뜻이다."""
    ob = plan.table("OUTGOING_BATCH")
    return (
        f"SELECT status, COUNT(*) AS cnt, MIN(create_time) AS oldest "
        f"FROM {ob} GROUP BY status",
        {},
    )


def pending_data_sql(plan: SyncPlan) -> Statement:
    """아직 라우팅되지 않은 SYM_DATA 행수와 가장 오래된 시각 (문서 §7).

    이 수치가 지속 증가하면 전송이 밀리고 있다는 신호이고, 방치하면 **원본 DB 용량과
    트랜잭션 로그가 계속 증가한다.** 동기화에서 가장 먼저 봐야 할 지표다.
    """
    data = plan.table("DATA")
    event = plan.table("DATA_EVENT")
    return (
        f"SELECT COUNT(*) AS pending_rows, MIN(d.create_time) AS oldest "
        f"FROM {data} d "
        f"WHERE NOT EXISTS (SELECT 1 FROM {event} e WHERE e.data_id = d.data_id)",
        {},
    )


def last_capture_sql(plan: SyncPlan) -> Statement:
    """이 스트림 채널로 마지막으로 잡힌 변경 시각 — 지연(lag) 계산의 근거."""
    data = plan.table("DATA")
    return (f"SELECT MAX(create_time) AS last_capture FROM {data}", {})


def config_tables_exist_sql(plan: SyncPlan) -> Statement:
    """SYM_* 가 원본 DB 에 설치되어 있는지. 없으면 SymmetricDS 가 아직 붙지 않은 것이다."""
    return (
        "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES "
        "WHERE UPPER(TABLE_NAME) IN (:t1, :t2, :t3)",
        {
            "t1": plan.table("TRIGGER").upper(),
            "t2": plan.table("ROUTER").upper(),
            "t3": plan.table("NODE").upper(),
        },
    )
