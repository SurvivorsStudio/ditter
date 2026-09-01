"""dag 문구 — `schemas/dag.py` 의 파이프라인 검증.

값은 **[한국어, 영어] 쌍**이다 (프론트 `web/src/i18n/messages/*.ts` 와 같은 모양 —
리뷰에서 두 언어가 나란히 보이고, 키가 한쪽에만 있는 상태가 자료구조상 불가능하다).

**ko 문구는 기존 리터럴과 바이트 동일하게 유지한다** — 기존 테스트가 한글 부분 문자열을
단언한다(`test_dag.py` 의 `"노드가 없" in i.message` 등). `이(가)`·`은(는)` 같은 어색한
조사 회피 표기도 그대로 둔다. 한국어 표현 개선은 별건이다.

**유일한 예외가 아래 `target_*_required`·`*_no_upsert` 네 개**다. 예전 코드가
`f"타깃 {label} 이(가) 필요합니다"` 처럼 한국어 낱말을 변수로 끼워 문장을 조립했는데,
영어는 어순도 수 일치도 달라("S3 does not" ↔ "Local files do not") 슬롯 하나로 표현할 수
없다. 조립을 없앤 대가로 ko 에서 `"로컬 파일 은(는)"` → `"로컬 파일은"` 이 되었다.

키 이름은 `dag.<규칙군>.<규칙>` 이고 규칙군은 `schemas/dag.py` 의 `_xxx_issues` 헬퍼와
1:1 이다 — `grep dag.ref.` 로 한 규칙군을 통째로 볼 수 있다.
"""

from __future__ import annotations

dag: dict[str, tuple[str, str]] = {
    # ---- 그래프 구조 (validate_definition 본체 · topological_order) ----
    "dag.graph.cycle": ("DAG 에 순환이 있습니다: {list}", "The DAG has a cycle: {list}"),
    "dag.graph.empty": ("노드가 없습니다", "There are no nodes"),
    "dag.graph.need_source": ("소스 노드가 최소 1개 필요합니다", "At least one source node is required"),
    "dag.graph.need_target": ("타깃 노드가 최소 1개 필요합니다", "At least one target node is required"),
    "dag.graph.note_not_connectable": (
        "메모 노드는 다른 노드와 연결할 수 없습니다",
        "A note node cannot be connected to other nodes",
    ),
    "dag.graph.after_target": (
        "타깃 뒤에는 노드를 이을 수 없습니다 — 타깃은 흐름의 끝입니다",
        "Nothing can follow a target — a target is where the flow ends",
    ),
    "dag.graph.before_trigger": (
        "트리거 앞에는 노드를 둘 수 없습니다 — 트리거는 흐름의 시작입니다",
        "Nothing can precede a trigger — a trigger is where the flow starts",
    ),
    "dag.graph.before_source": (
        "소스 앞에는 트리거 외에 노드를 둘 수 없습니다 "
        "— 소스는 스스로 읽어 오므로 들어온 데이터가 사라집니다",
        "Only a trigger may precede a source — a source reads on its own, "
        "so anything fed into it is discarded",
    ),
    "dag.graph.source_orphan": (
        "소스가 어디에도 연결되지 않았습니다",
        "This source is not connected to anything",
    ),
    "dag.graph.target_no_input": (
        "타깃에 들어오는 입력이 없습니다",
        "This target has no incoming input",
    ),
    "dag.graph.transform_no_input": (
        "변환 노드에 입력이 없습니다",
        "This transform node has no input",
    ),
    "dag.graph.no_trigger": (
        "트리거가 없어 수동 실행만 가능합니다",
        "Without a trigger this can only be run manually",
    ),
    # ---- 노드 파라미터 ----
    "dag.node.connection_required": (
        "connection_id 가 지정되지 않았습니다",
        "connection_id is not set",
    ),
    "dag.node.collection_required": ("컬렉션(table)이 필요합니다", "A collection (table) is required"),
    "dag.node.table_or_query_required": (
        "table 또는 query 가 필요합니다",
        "Either table or query is required",
    ),
    # 아래 둘은 예전에 `f"타깃 {label} 이(가) 필요합니다"` 한 문장이었다 (위 머리말 참조).
    "dag.node.target_collection_required": (
        "타깃 컬렉션이 필요합니다",
        "A target collection is required",
    ),
    "dag.node.target_table_required": ("타깃 table 이 필요합니다", "A target table is required"),
    "dag.node.upsert_needs_key_columns": (
        "upsert 모드는 key_columns 가 필요합니다",
        "upsert mode requires key_columns",
    ),
    # 마찬가지로 예전에 `f"{label} 은(는) upsert 를 …"` 한 문장이었다.
    "dag.node.s3_no_upsert": (
        "S3 은(는) upsert 를 지원하지 않습니다 — append 또는 overwrite 를 쓰세요",
        "S3 does not support upsert — use append or overwrite",
    ),
    "dag.node.file_no_upsert": (
        "로컬 파일은 upsert 를 지원하지 않습니다 — append 또는 overwrite 를 쓰세요",
        "Local files do not support upsert — use append or overwrite",
    ),
    "dag.node.cron_required": ("cron 식이 필요합니다", "A cron expression is required"),
    "dag.node.query_ignores_incremental": (
        "query 모드에서는 증분키가 무시됩니다 — table 모드를 쓰세요",
        "The incremental key is ignored in query mode — use table mode",
    ),
    "dag.node.duplicate_label": (
        "노드 이름 '{name}' 이(가) 다른 노드와 겹칩니다",
        "The node name '{name}' collides with another node",
    ),
    # ---- 노드 결과 참조 ${이름.컬럼} ----
    # `$이름`·`${노드이름.컬럼}` 은 **표기(문법)** 라 en 에서도 자리 낱말만 옮긴다
    # (프론트 `cui.ref.varName` 이 같은 일을 한다).
    "dag.ref.not_a_reference": (
        "{ref} 는 변수도 노드 참조도 아니라 글자 그대로 남습니다 "
        "— $이름 또는 ${노드이름.컬럼} 형태여야 합니다",
        "{ref} is neither a variable nor a node reference, so it stays as literal text "
        "— it must look like $name or ${node.column}",
    ),
    "dag.ref.node_not_found": (
        "{ref} 가 가리키는 노드 이름을 찾을 수 없습니다: 「{name}」",
        "{ref} points at a node name that does not exist: 「{name}」",
    ),
    "dag.ref.self": (
        "{ref} — 자기 자신의 결과는 참조할 수 없습니다",
        "{ref} — a node cannot reference its own result",
    ),
    "dag.ref.trigger_or_note": (
        "{ref} — 트리거·메모 노드는 결과를 내지 않습니다",
        "{ref} — trigger and note nodes produce no result",
    ),
    "dag.ref.target": (
        "{ref} — 타깃 노드는 입력만 있고 출력이 없습니다",
        "{ref} — a target node only takes input; it has no output",
    ),
    "dag.ref.cdc_source": (
        "{ref} — CDC 소스는 상시 스트림이라 '첫 행'이 정해지지 않습니다",
        "{ref} — a CDC source is a continuous stream, so there is no defined 'first row'",
    ),
    "dag.ref.sync_source": (
        "{ref} — 동기화 소스는 행을 우리 쪽으로 읽어 오지 않습니다 "
        "(SymmetricDS 가 타깃 DB 로 직접 보냅니다)",
        "{ref} — a sync source never reads rows into us "
        "(SymmetricDS sends them straight to the target DB)",
    ),
    "dag.ref.cycle": (
        "노드 결과 참조가 순환합니다 " "— 서로의 결과를 참조하면 어느 쪽도 먼저 실행할 수 없습니다",
        "Node result references form a cycle "
        "— if two nodes reference each other, neither can run first",
    ),
}
