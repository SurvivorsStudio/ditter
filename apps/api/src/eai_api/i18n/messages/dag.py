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
    # ---- API 트리거 변수 바인딩 (bind_variables · _coerce) ----
    # `${name}` 은 표기다 — SLOT 이 `{name}` 만 치환하므로 앞의 `$` 는 글자로 남는다.
    "dag.var.undeclared_supplied": (
        "선언되지 않은 값입니다: {list}. 받을 수 있는 변수: {allowed}",
        "These values are not declared: {list}. Accepted variables: {allowed}",
    ),
    "dag.var.none_allowed": ("(없음)", "(none)"),
    "dag.var.required_missing": ("필수 값이 없습니다: {name}", "A required value is missing: {name}"),
    "dag.var.no_value_no_default": (
        "{name} 값이 없고 기본값도 없습니다 — 값을 보내거나 기본값을 정하세요",
        "{name} has neither a value nor a default — send a value or set a default",
    ),
    "dag.var.not_a_number": ("{name} 은 숫자여야 합니다: {value}", "{name} must be a number: {value}"),
    "dag.var.not_a_boolean": (
        "{name} 은 참/거짓이어야 합니다: {value}",
        "{name} must be true or false: {value}",
    ),
    # ---- API 트리거 노드 ----
    "dag.trigger.only_one": (
        "API 트리거는 파이프라인당 하나만 둘 수 있습니다 "
        "— 호출 창구가 여럿이면 어느 변수 묶음으로 도는지 알 수 없습니다",
        "Only one API trigger is allowed per pipeline "
        "— with several endpoints there is no telling which set of variables a run uses",
    ),
    "dag.trigger.duplicate_variable": (
        "변수 이름이 중복됩니다: ${name}",
        "Duplicate variable name: ${name}",
    ),
    "dag.trigger.undeclared_variable": (
        "선언되지 않은 변수입니다: ${name} — API 트리거 노드에 이 변수를 추가하세요",
        "This variable is not declared: ${name} — add it to the API trigger node",
    ),
    "dag.trigger.no_trigger_for_variable": (
        "`${name}` 을 쓰려면 API 트리거 노드가 필요합니다",
        "Using `${name}` requires an API trigger node",
    ),
    "dag.trigger.unused_variable": (
        "선언만 하고 쓰지 않는 변수입니다: ${name}",
        "This variable is declared but never used: ${name}",
    ),
    "dag.trigger.optional_without_default": (
        "${name} 은 선택 변수인데 기본값이 없습니다 — 호출에서 빠지면 실행이 실패합니다",
        "${name} is optional but has no default — a call that omits it will fail",
    ),
    # ---- Python 변환 노드 ----
    "dag.python.empty": ("Python 코드가 비어 있습니다", "The Python code is empty"),
    # `{cause}` 는 CPython 이 만든 영어 구문 오류다 — 번역할 수 없어 문장 끝에 둔다.
    "dag.python.syntax_error": (
        "Python 구문 오류: {cause} (줄 {line})",
        "Python syntax error on line {line}: {cause}",
    ),
    "dag.python.both_defined": (
        "transform 과 transform_batch 를 동시에 정의할 수 없습니다",
        "transform and transform_batch cannot both be defined",
    ),
    "dag.python.none_defined": (
        "transform(row) 또는 transform_batch(df) 함수를 정의해야 합니다",
        "Define either transform(row) or transform_batch(df)",
    ),
    # ---- 스위치(분기) 노드 ----
    "dag.switch.need_case": (
        "스위치에 case 가 최소 1개 필요합니다",
        "A switch needs at least one case",
    ),
    "dag.switch.case_no_condition": ("case #{i} 에 조건이 없습니다", "Case #{i} has no conditions"),
    "dag.switch.case_no_field": (
        "case #{i} 조건에 field 가 없습니다",
        "A condition in case #{i} has no field",
    ),
    # ---- SAP 소스 ----
    "dag.sap.unknown_mode": (
        "알 수 없는 SAP 읽기 모드: {name} ({allowed})",
        "Unknown SAP read mode: {name} ({allowed})",
    ),
    "dag.sap.bapi_needs_function": (
        "BAPI 모드는 function_name 이 필요합니다",
        "BAPI mode requires function_name",
    ),
    "dag.sap.read_table_needs_table": (
        "RFC_READ_TABLE 모드는 table 이 필요합니다",
        "RFC_READ_TABLE mode requires table",
    ),
    "dag.sap.no_fields_warning": (
        "필드를 지정하지 않으면 테이블 전체를 읽습니다. "
        "폭이 512자를 넘으면 나눠 호출하게 되니 필요한 필드만 고르거나 BAPI 를 쓰세요",
        "Without a field list the whole table is read. "
        "Rows wider than 512 characters are split across calls — pick only the fields you "
        "need, or use a BAPI",
    ),
    # ---- 응답 노드 ----
    "dag.resp.max_rows_not_a_number": (
        "max_rows 는 숫자여야 합니다: {value}",
        "max_rows must be a number: {value}",
    ),
    "dag.resp.max_rows_too_small": (
        "max_rows 는 1 이상이어야 합니다",
        "max_rows must be at least 1",
    ),
    "dag.resp.max_rows_too_large": (
        "max_rows 는 {n} 이하여야 합니다 — 응답 노드는 행을 메모리에 모으므로 상한이 필요합니다",
        "max_rows must be at most {n} — a response node collects rows in memory, so it needs a cap",
    ),
    "dag.resp.columns_not_a_list": (
        "columns 는 컬럼명 목록이어야 합니다",
        "columns must be a list of column names",
    ),
    "dag.resp.columns_duplicate": ("columns 에 중복이 있습니다", "columns contains duplicates"),
}
