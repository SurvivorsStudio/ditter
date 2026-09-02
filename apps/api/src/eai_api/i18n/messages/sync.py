"""sync 문구 — `services/sync_service.py` 의 실시간 동기화 착수 점검과 예외.

값은 **[한국어, 영어] 쌍**이다. ko 는 기존 리터럴과 바이트 동일하게 유지한다.

## 점검 항목의 label 은 key 에서 유도한다

`PreflightCheck` 는 이미 `key`(안정 식별자)를 갖고 있다. 그래서 `_check()` 가 label 을
인자로 받지 않고 `sync.pre.<key>.label` 을 찾는다 — 호출 26곳에서 label 이 사라졌고,
같은 항목의 label 이 자리마다 달라질 여지도 없어졌다.

**이 키들은 계산해서 만들므로 `t("리터럴")` AST 검사가 잡지 못한다.**
`test_i18n.py::test_every_preflight_key_has_a_label` 이 `_check()` 의 첫 인자를 모아
label 키가 실제로 있는지 따로 본다.

## ⚠️ 이 점검들은 **소스**(원본 MSSQL)를 본다

`tables`·`tables_exist`·`primary_keys`·`trigger_permission`·`unicode_capture` 는 전부
`_source_checks` 가 **소스 커넥터**로 조회한다. ko 의 "대상 테이블"은 "점검 대상"이라는
뜻이라 중립이지만, en 에서 Target 이라고 쓰면 같은 모달의 `Target connectivity`
(= 목적지 PostgreSQL)와 섞여 **방향이 뒤집힌다** — 영어 사용자가 원본의 PK 누락을
타깃 문제로 진단하게 된다. 그래서 en 은 Source 라고 쓴다.

## detail 에 남는 한국어

`str(exc)` 로 들어오는 드라이버·사이드카 예외와, `connection_service` 가 DB 에 저장해 둔
`health_message` 는 번역하지 않는다 — 앞의 것은 우리 문장이 아니고, 뒤의 것은 **쓰는
시점과 읽는 시점의 사람이 다른** 저장 문자열이라 여기서 번역하면 틀린다.
그래서 en 화면의 점검 목록에는 label 은 영어인데 그 줄의 detail 만 한국어인 줄이 섞인다.
**알고 남기는 것**이다.
"""

from __future__ import annotations

sync: dict[str, tuple[str, str]] = {
    # ---- 점검 항목 이름 (key 에서 유도된다) ----
    "sync.pre.definition.label": ("동기화 파이프라인 구조", "Sync pipeline structure"),
    "sync.pre.source_type.label": ("소스 연결 타입", "Source connection type"),
    "sync.pre.target_type.label": ("타깃 연결 타입", "Target connection type"),
    "sync.pre.source_reachable.label": ("소스 접속 (TLS·드라이버)", "Source connectivity (TLS, driver)"),
    "sync.pre.target_reachable.label": ("타깃 접속", "Target connectivity"),
    "sync.pre.tables.label": ("대상 테이블·기본키", "Source tables and primary keys"),
    "sync.pre.sidecar.label": ("SymmetricDS 사이드카", "SymmetricDS sidecar"),
    "sync.pre.sidecar_engines.label": ("사이드카 엔진 등록", "Sidecar engine registration"),
    "sync.pre.purpose.label": ("복제 데이터의 최종 용도", "What the replicated data is for"),
    "sync.pre.load_test.label": (
        "부하 테스트 (운영 적용 게이트)",
        "Load testing (production gate)",
    ),
    "sync.pre.sql_server_version.label": (
        "SQL Server 버전·에디션",
        "SQL Server version and edition",
    ),
    "sync.pre.cdc_available.label": ("CDC 사용 가능 여부", "CDC availability"),
    "sync.pre.create_table_permission.label": (
        "SYM_* 테이블 생성 권한",
        "Permission to create SYM_* tables",
    ),
    "sync.pre.tables_exist.label": ("대상 테이블 존재", "Source tables exist"),
    "sync.pre.primary_keys.label": ("대상 테이블 기본키", "Source table primary keys"),
    "sync.pre.trigger_permission.label": (
        "원본 트리거 생성 권한",
        "Permission to create triggers on the source",
    ),
    "sync.pre.config_db.label": ("SymmetricDS 설정 DB", "SymmetricDS config DB"),
    "sync.pre.unicode_capture.label": ("유니코드(한글) 캡처", "Unicode capture"),
    # ---- 점검 결과 상세 ----
    "sync.pre.definition.ok": ("소스·타깃 한 쌍 확인", "One source and one target confirmed"),
    "sync.pre.source_type.unsupported": (
        "{name} — SQL Server 만 지원합니다",
        "{name} — only SQL Server is supported",
    ),
    "sync.pre.target_type.unsupported": (
        "{name} — 지원: {allowed}",
        "{name} — supported: {allowed}",
    ),
    "sync.pre.reachable.ok": ("연결 정상", "Connected"),
    "sync.pre.reachable.fail": ("접속 실패", "Connection failed"),
    "sync.pre.tables.unreachable": (
        "소스에 접속하지 못해 확인하지 못했습니다",
        "Could not check — the source is unreachable",
    ),
    "sync.pre.sidecar.ok": ("응답함", "Responding"),
    "sync.pre.sidecar_engines.ok": ("{list} 확인", "{list} confirmed"),
    "sync.pre.sidecar_engines.missing": (
        "등록되지 않은 엔진: {list} "
        "— sync/symmetricds/engines/ 에 해당 이름의 .properties 를 만들었는지, "
        "그 안의 engine.name 이 같은지 확인하세요",
        "Engines not registered: {list} "
        "— check that sync/symmetricds/engines/ has a .properties file with that name "
        "and that engine.name inside it matches",
    ),
    "sync.pre.sidecar_engines.unreachable": (
        "사이드카에 닿지 못해 확인하지 못했습니다",
        "Could not check — the sidecar is unreachable",
    ),
    "sync.pre.purpose.readonly": ("조회/분석 용도", "For reading and analytics"),
    "sync.pre.purpose.operational": (
        "업무 판단 근거 — 복제본은 원본과 순간적으로 다를 수 있습니다. "
        "출고/재고 판단에 쓰면 이중 출고 같은 사고로 이어집니다 (원본 직접 조회·API 연동 검토)",
        "Basis for operational decisions — a replica can momentarily differ from the source. "
        "Using it for shipping or stock decisions leads to accidents such as double shipping "
        "(consider querying the source directly, or an API integration)",
    ),
    "sync.pre.load_test.done": ("완료 표시됨", "Marked as done"),
    "sync.pre.load_test.pending": (
        "원본 테이블에 트리거가 생겨 쓰기 트랜잭션이 느려집니다. "
        "현장 스캔 응답이 0.3초 이상 느려지면 재검토 — 운영 적용 전 필수",
        "Triggers on the source tables will slow write transactions. "
        "Reconsider if scan responses slow by more than 0.3 s — required before production use",
    ),
    "sync.pre.cdc_available.warn": (
        "2016 이상입니다 — CDC 가 Standard 에서도 정식 지원되므로, "
        "트리거 부하를 지지 않는 CDC 방식을 먼저 검토할 가치가 있습니다",
        "This is 2016 or later — CDC is fully supported even on Standard, "
        "so the CDC route, which carries no trigger overhead, is worth considering first",
    ),
    "sync.pre.permission.granted": ("있음", "Granted"),
    "sync.pre.create_table_permission.denied": (
        "없음 — SymmetricDS 가 설정 테이블을 만들지 못합니다",
        "Not granted — SymmetricDS cannot create its configuration tables",
    ),
    "sync.pre.tables_exist.ok": ("{n}개 확인", "{n} confirmed"),
    "sync.pre.tables_exist.missing": ("없는 테이블: {list}", "Missing tables: {list}"),
    "sync.pre.primary_keys.ok": ("모두 있음", "All present"),
    "sync.pre.primary_keys.missing": (
        "PK 없음: {list} — PK 를 추가하거나 대상에서 빼세요",
        "No primary key: {list} — add one, or remove the table from the targets",
    ),
    "sync.pre.trigger_permission.denied": ("ALTER 권한 없음: {list}", "No ALTER permission: {list}"),
    "sync.pre.config_db.same": (
        "소스와 같은 DB 에 SYM_* 를 만듭니다",
        "SYM_* tables are created in the same DB as the source",
    ),
    "sync.pre.config_db.ok": (
        "{name} 접속·테이블 생성 가능",
        "{name} is reachable and tables can be created",
    ),
    "sync.pre.config_db.denied": (
        "{name} 에 테이블 생성 권한이 없습니다",
        "No permission to create tables in {name}",
    ),
    "sync.pre.config_db.connect_failed": (
        "{name} 에 붙지 못했습니다: {cause}",
        "Could not connect to {name}: {cause}",
    ),
    "sync.pre.unicode_capture.none": (
        "대상 테이블에 유니코드 컬럼이 없습니다",
        "The source tables have no unicode columns",
    ),
    "sync.pre.unicode_capture.unverified": (
        "{list} 에 유니코드 컬럼이 있습니다 — 소스 엔진 properties 에 "
        "mssql.use.ntypes.for.sync=true 가 켜져 있는지 확인하세요. "
        "이 값은 SYM_* 를 처음 만들 때 반영되므로 시작 전에 켜 두어야 합니다",
        "Unicode columns exist in {list} — check that mssql.use.ntypes.for.sync=true is set in the "
        "source engine properties. It only takes effect when SYM_* is first created, "
        "so it must be on before you start",
    ),
    "sync.pre.unicode_capture.ok": (
        "{name}_DATA.row_data = {value} (유니코드 보존)",
        "{name}_DATA.row_data = {value} (unicode preserved)",
    ),
    "sync.pre.unicode_capture.lossy": (
        "{name}_DATA.row_data 가 {value} 입니다 — {list} 의 한글이 "
        "글자마다 '?' 로 손실됩니다. 소스 엔진에 mssql.use.ntypes.for.sync=true 를 켜고 "
        "{name}_* 를 다시 만들어야 합니다",
        "{name}_DATA.row_data is {value} — non-ASCII text in {list} is lost, "
        "one '?' per character. Turn on mssql.use.ntypes.for.sync=true in the source engine "
        "and recreate {name}_*",
    ),
    # 사이드카 엔진 목록에 들어가는 이름 — `sidecar_engines` 의 `{list}` 로 이어 붙는다.
    "sync.engine.source": ("소스", "source"),
    "sync.engine.target": ("타깃", "target"),
    # ---- 노드 종류 이름 (아래 `sync.node.*` 문장의 `{name}` 으로 들어간다) ----
    "sync.node.source": ("실시간 동기화 소스", "real-time sync source"),
    "sync.node.target": ("실시간 동기화 타깃", "real-time sync target"),

    # ---- 스펙 추출·수명주기 예외 ----
    "sync.node.missing": (
        "{name} 노드가 없습니다 — 이 파이프라인은 실시간 동기화가 아닙니다",
        "There is no {name} node — this is not a real-time sync pipeline",
    ),
    "sync.node.too_many": (
        "{name} 노드가 {n}개입니다 — 하나만 지원합니다",
        "There are {n} {name} nodes — only one is supported",
    ),
    "sync.spec.source_no_connection": (
        "동기화 소스 '{name}' 에 connection_id 가 없습니다",
        "The sync source '{name}' has no connection_id",
    ),
    "sync.spec.target_no_connection": (
        "동기화 타깃 '{name}' 에 connection_id 가 없습니다",
        "The sync target '{name}' has no connection_id",
    ),
    "sync.spec.no_tables": (
        "동기화 소스 '{name}' 에 동기화할 테이블이 없습니다",
        "The sync source '{name}' has no tables to sync",
    ),
    "sync.spec.table_bad_shape": (
        "테이블 항목은 이름·채널을 담은 객체여야 합니다",
        "A table entry must be an object with a name and a channel",
    ),
    "sync.spec.table_name_empty": ("테이블 이름이 비어 있습니다", "The table name is empty"),
    "sync.conn.not_sql": ("SQL 연결이 아닙니다: {name}", "Not an SQL connection: {name}"),
    "sync.stream.not_found": (
        "동기화 스트림을 찾을 수 없습니다: {name}",
        "Sync stream not found: {name}",
    ),
    "sync.stream.already_running": (
        "이미 실행 중인 동기화가 있습니다 — 먼저 정지하세요",
        "A sync is already running — stop it first",
    ),
    "sync.stream.preflight_failed": (
        "착수 점검을 통과하지 못했습니다: {list} (점검 결과를 확인하세요)",
        "The preflight check did not pass: {list} (see the check results)",
    ),
    "sync.stream.pause_wrong_status": (
        "실행 중인 동기화만 일시정지할 수 있습니다 (현재: {name})",
        "Only a running sync can be paused (currently: {name})",
    ),
    "sync.stream.resume_wrong_status": (
        "일시정지된 동기화만 재개할 수 있습니다 (현재: {name})",
        "Only a paused sync can be resumed (currently: {name})",
    ),
    # 드라이버 예외 래핑(`_wrap`)은 **사전에 없다.** 그 문자열이 `cdc_streams.error` 로
    # 영구 저장되기 때문이다 — 자세한 이유는 `sync_service._wrap` 주석 참조.
    "sync.stream.no_registered_tables": (
        "이 스트림에 등록된 테이블 정보가 없습니다 — 원본의 SYM_TRIGGER 를 직접 확인하세요",
        "This stream has no registered table information — check SYM_TRIGGER on the source",
    ),
    "sync.stream.table_conflict": (
        "같은 테이블을 이미 다른 동기화가 잡고 있습니다: {list} (스트림 {name}) — 먼저 정지하세요",
        "Another sync already holds the same tables: {list} (stream {name}) — stop it first",
    ),
}
