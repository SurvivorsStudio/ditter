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
        '{ref} points at a node name that does not exist: "{name}"',
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
    "dag.var.not_a_number": ("{name} 은(는) 숫자여야 합니다: {value}", "{name} must be a number: {value}"),
    "dag.var.not_a_boolean": (
        "{name} 은(는) 참/거짓이어야 합니다: {value}",
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
        "${name} 은(는) 선택 변수인데 기본값이 없습니다 — 호출에서 빠지면 실행이 실패합니다",
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
    # ---- 정의 자체의 형식 (pydantic 검증기 — RequestValidationError 로 나간다) ----
    "dag.def.self_edge": ("자기 자신을 가리키는 엣지: {name}", "An edge points at itself: {name}"),
    "dag.def.duplicate_node_id": ("중복된 노드 id: {list}", "Duplicate node ids: {list}"),
    "dag.def.edge_unknown_node": (
        "존재하지 않는 노드를 참조하는 엣지: {list}",
        "Edges reference nodes that do not exist: {list}",
    ),
    # ---- CDC 파이프라인 ----
    "dag.cdc.mixed_sources": (
        "CDC 소스와 배치 소스를 한 파이프라인에 섞을 수 없습니다 — 분리하세요",
        "CDC sources and batch sources cannot share a pipeline — split them",
    ),
    "dag.cdc.batch_trigger": (
        "CDC 파이프라인에는 스케줄·수동 트리거를 쓸 수 없습니다 (CDC 트리거만)",
        "A CDC pipeline cannot use schedule or manual triggers (CDC trigger only)",
    ),
    "dag.cdc.source_without_trigger": (
        "CDC 소스에 CDC 트리거가 연결되지 않았습니다",
        "The CDC source has no CDC trigger connected",
    ),
    "dag.cdc.trigger_without_source": (
        "CDC 트리거는 CDC 소스가 있어야 의미가 있습니다",
        "A CDC trigger is only meaningful with a CDC source",
    ),
    "dag.cdc.tables_not_a_list": ("tables 는 목록이어야 합니다", "tables must be a list"),
    "dag.cdc.tables_required": (
        "캡처할 테이블(table 또는 tables)이 필요합니다",
        "Tables to capture are required (table or tables)",
    ),
    "dag.cdc.unknown_delete_mode": (
        "알 수 없는 삭제 처리 방식: {name} ({allowed})",
        "Unknown delete handling: {name} ({allowed})",
    ),
    "dag.cdc.unknown_snapshot": (
        "알 수 없는 스냅샷 모드: {name} ({allowed})",
        "Unknown snapshot mode: {name} ({allowed})",
    ),
    # ---- CDC 다중 테이블 매핑 ----
    "dag.cdcmap.empty": (
        "테이블 매핑이 비어 있습니다 (최소 1개 필요)",
        "The table mapping is empty (at least one is required)",
    ),
    "dag.cdcmap.bad_shape": ("매핑 #{i}: 형식이 올바르지 않습니다", "Mapping #{i}: malformed"),
    "dag.cdcmap.source_required": (
        "매핑 #{i}: 소스 테이블이 필요합니다",
        "Mapping #{i}: a source table is required",
    ),
    "dag.cdcmap.target_required": (
        "매핑 #{i}: 타깃 테이블이 필요합니다",
        "Mapping #{i}: a target table is required",
    ),
    "dag.cdcmap.columns_not_a_list": (
        "매핑 #{i}: columns 는 목록이어야 합니다",
        "Mapping #{i}: columns must be a list",
    ),
    "dag.cdcmap.column_names_required": (
        "매핑 #{i}: 컬럼 매핑에는 원본·대상 이름이 모두 필요합니다 (제외 항목은 원본만 있어도 됩니다)",
        "Mapping #{i}: a column mapping needs both source and target names "
        "(an excluded column only needs the source)",
    ),
    "dag.cdcmap.unknown_cast": (
        "매핑 #{i}: 지원하지 않는 변환 {name} ({allowed})",
        "Mapping #{i}: unsupported cast {name} ({allowed})",
    ),
    "dag.cdcmap.no_key_columns": (
        "매핑 #{i}: 키 컬럼이 없어 append 로 적재됩니다 (upsert·삭제 반영 불가)",
        "Mapping #{i}: without key columns this loads as append (no upsert, no deletes)",
    ),
    # ---- Mongo 필터 ----
    "dag.mongo.filter_not_json": (
        "필터가 올바른 JSON 이 아닙니다: {cause}",
        "The filter is not valid JSON: {cause}",
    ),
    "dag.mongo.filter_not_object": (
        "필터는 JSON 객체여야 합니다",
        "The filter must be a JSON object",
    ),
    # ---- 실시간 동기화 파이프라인 ----
    "dag.sync.source_with_others": (
        "실시간 동기화 소스는 다른 소스와 한 파이프라인에 둘 수 없습니다 — 분리하세요",
        "A real-time sync source cannot share a pipeline with other sources — split them",
    ),
    "dag.sync.target_with_others": (
        "실시간 동기화 타깃 외의 타깃을 함께 둘 수 없습니다 "
        "— SymmetricDS 는 타깃 DB 하나로만 밀어 넣습니다",
        "No other target may sit alongside the real-time sync target "
        "— SymmetricDS pushes into exactly one target DB",
    ),
    "dag.sync.no_source": (
        "실시간 동기화 소스가 없습니다 — 소스·타깃이 한 쌍이어야 합니다",
        "There is no real-time sync source — source and target must come as a pair",
    ),
    "dag.sync.too_many_sources": (
        "동기화 소스가 {n}개입니다 — 노드 그룹 링크가 소스↔타깃 한 쌍이라 소스는 하나여야 합니다",
        "There are {n} sync sources — the node group link is one source to one target, "
        "so there can be only one",
    ),
    "dag.sync.no_target": (
        "실시간 동기화 타깃이 없습니다 — 어느 DB 로 밀어 넣을지 정해야 합니다",
        "There is no real-time sync target — pick the DB to push into",
    ),
    "dag.sync.too_many_targets": (
        "동기화 타깃이 {n}개입니다 — 타깃도 하나여야 합니다",
        "There are {n} sync targets — there can be only one target as well",
    ),
    "dag.sync.no_transform": (
        "실시간 동기화 파이프라인에는 변환 노드를 둘 수 없습니다 "
        "— 데이터가 워커를 지나지 않아 변환이 적용되지 않습니다",
        "A real-time sync pipeline cannot contain transform nodes "
        "— the data never passes through a worker, so nothing would be applied",
    ),
    "dag.sync.only_sync_trigger": (
        "실시간 동기화 파이프라인에는 동기화 트리거만 쓸 수 있습니다",
        "A real-time sync pipeline can only use a sync trigger",
    ),
    "dag.sync.source_without_trigger": (
        "실시간 동기화 소스에 동기화 트리거가 연결되지 않았습니다",
        "The real-time sync source has no sync trigger connected",
    ),
    "dag.sync.source_edge": (
        "동기화 소스는 동기화 타깃에만 이을 수 있습니다 — 사이에 다른 노드를 두면 조용히 무시됩니다",
        "A sync source may only connect to a sync target — anything in between is silently ignored",
    ),
    "dag.sync.target_edge": (
        "동기화 타깃에는 동기화 소스만 이을 수 있습니다",
        "Only a sync source may connect to a sync target",
    ),
    # ---- 동기화 소스의 테이블 목록 ----
    "dag.synctbl.required": (
        "동기화할 테이블이 지정되지 않았습니다",
        "No tables to sync are specified",
    ),
    "dag.synctbl.bad_shape": (
        "테이블 #{i}: 이름·채널을 담은 객체여야 합니다",
        "Table #{i}: must be an object with a name and a channel",
    ),
    "dag.synctbl.name_empty": ("테이블 #{i}: 이름이 비어 있습니다", "Table #{i}: the name is empty"),
    "dag.synctbl.duplicate": (
        "테이블 #{i}: {name} 이(가) 중복입니다",
        "Table #{i}: {name} is a duplicate",
    ),
    "dag.synctbl.unknown_channel": (
        "테이블 #{i}: 알 수 없는 채널 {name} ({allowed})",
        "Table #{i}: unknown channel {name} ({allowed})",
    ),
    "dag.synctbl.load_order_not_int": (
        "테이블 #{i}: 초기 적재 순서는 정수여야 합니다",
        "Table #{i}: the initial load order must be an integer",
    ),
    "dag.synctbl.row_filter_not_str": (
        "테이블 #{i}: 행 필터는 문자열이어야 합니다",
        "Table #{i}: the row filter must be a string",
    ),
    "dag.synctbl.unknown_purpose": (
        "알 수 없는 복제본 용도 {name} ({allowed})",
        "Unknown replica purpose {name} ({allowed})",
    ),
    # ---- 동기화 타깃의 테이블명 매핑 ----
    "dag.synctgt.no_mapping": (
        "타깃 테이블명 매핑이 없습니다 "
        "— PostgreSQL 은 대문자 식별자를 소문자로 접으므로 명시하는 편이 안전합니다",
        "There is no target table name mapping "
        "— PostgreSQL folds upper-case identifiers to lower case, so it is safer to be explicit",
    ),
    "dag.synctgt.not_a_list": (
        "table_mappings 는 목록이어야 합니다",
        "table_mappings must be a list",
    ),
    "dag.synctgt.bad_shape": ("매핑 #{i}: 객체여야 합니다", "Mapping #{i}: must be an object"),
    "dag.synctgt.source_required": (
        "매핑 #{i}: source_table 이 필요합니다",
        "Mapping #{i}: source_table is required",
    ),
    "dag.synctgt.duplicate": (
        "매핑 #{i}: {name} 매핑이 중복입니다",
        "Mapping #{i}: the mapping for {name} is a duplicate",
    ),
    # ---- 실행 게이트 래퍼 (services/pipeline_service.py) ----
    # 위 규칙 문구들을 감싸는 자리다. 여기를 안 옮기면 en 사용자가
    # `실행할 수 없는 파이프라인입니다 — A target table is required` 를 본다.
    # `{list}` 는 호출부에서 `; ` 로 이어 붙인 규칙 문구들이다.
    "dag.gate.parse_failed": ("DAG 파싱 실패: {cause}", "Failed to parse the DAG: {cause}"),
    "dag.gate.pipeline_not_runnable": (
        "실행할 수 없는 파이프라인입니다 — {list}",
        "This pipeline cannot run — {list}",
    ),
    "dag.gate.node_not_found": (
        "노드를 찾을 수 없습니다: {name}",
        "Node not found: {name}",
    ),
    "dag.gate.check_api_trigger": (
        "API 트리거 설정을 확인하세요 — {list}",
        "Check the API trigger settings — {list}",
    ),
    "dag.gate.not_runnable_kind": (
        "이 노드는 실행할 수 없습니다 (트리거·메모는 실행 대상이 아닙니다)",
        "This node cannot be run (triggers and notes are not run targets)",
    ),
    "dag.gate.node_not_runnable": (
        "이 노드를 실행할 수 없습니다 — {list}",
        "This node cannot run — {list}",
    ),
    "dag.gate.pipeline_not_found": (
        "파이프라인을 찾을 수 없습니다: {name}",
        "Pipeline not found: {name}",
    ),
}
