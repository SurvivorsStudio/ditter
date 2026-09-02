/** configPanel 문구 — 캔버스 오른쪽 노드 설정 패널(canvas/ConfigPanel.tsx).
 *  값은 [한국어, 영어] 쌍이다. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다.
 *
 *  주의: 기술 값(cron 식·`__deleted`·`run_id=`·SQL/ABAP 예시·모드 id 인 upsert·append·
 *  overwrite·initial·never·when_needed·soft·hard·ignore)은 번역하지 않는다 — 화면에
 *  보이는 설명만 번역하고 값 자체는 그대로 둔다. */
export const configPanel = {
  // ---- 필터 연산자 (모듈 상수는 MsgKey 로만 들고 렌더 시점에 t() 로 푼다) ----
  'cfg.op.eq': ['= 같음', '= equals'],
  'cfg.op.ne': ['≠ 다름', '≠ not equal'],
  'cfg.op.gt': ['> 초과', '> greater than'],
  'cfg.op.gte': ['≥ 이상', '≥ at least'],
  'cfg.op.lt': ['< 미만', '< less than'],
  'cfg.op.lte': ['≤ 이하', '≤ at most'],
  'cfg.op.in': ['in 포함됨', 'in — is one of'],
  'cfg.op.not_in': ['not in 미포함', 'not in — is none of'],
  'cfg.op.contains': ['문자열 포함', 'contains'],
  'cfg.op.starts_with': ['~로 시작', 'starts with'],
  'cfg.op.is_null': ['값 없음', 'is null'],
  'cfg.op.is_not_null': ['값 있음', 'is not null'],
  'cfg.op.regex': ['정규식', 'regex'],

  // ---- 패널 껍데기 ----
  'cfg.resizeTip': [
    '드래그해서 너비 조절 · 더블클릭으로 초기화',
    'Drag to resize · double-click to reset',
  ],
  'cfg.emptySelect': [
    '노드를 선택하면 설정을 편집할 수 있습니다.',
    'Select a node to edit its settings.',
  ],
  'cfg.emptyDrag': [
    '좌측 팔레트에서 노드를 캔버스로 드래그해 추가하세요.',
    'Drag a node from the palette on the left onto the canvas.',
  ],

  // ---- 노드 이름 ----
  'cfg.nodeName': ['노드 이름', 'Node name'],
  'cfg.nameRequired': ['노드 이름을 입력하세요.', 'Enter a node name.'],
  'cfg.nameTaken': ['같은 이름의 노드가 이미 있습니다.', 'Another node already has this name.'],

  // ---- 연결 고르기 ----
  'cfg.connection': ['연결', 'Connection'],
  'cfg.choose': ['— 선택 —', '— select —'],
  'cfg.noCdcConnections': [
    'CDC 를 켠 연결이 없습니다. [연결] 화면에서 이 소스 타입 연결의 「CDC 사용」을 켜고 전제조건을 점검하세요.',
    'No connection has CDC enabled. On the [Connections] screen, turn on “Use CDC” for a connection of this source type and check its prerequisites.',
  ],
  'cfg.noConnections': [
    '사용 가능한 연결이 없습니다. [연결] 화면에서 먼저 등록하세요.',
    'No usable connection. Register one on the [Connections] screen first.',
  ],
  'cfg.deleteNode': ['노드 삭제', 'Delete node'],

  // ---- 트리거 ----
  'cfg.trg.cdcHint': [
    'CDC 트리거는 파이프라인을 **상시 스트리밍**으로 표시합니다. 별도 설정은 없으며, 저장 후 [스트림 시작] 버튼으로 켜고 [모니터] Streams 탭에서 상태를 봅니다. 배치 트리거(스케줄·수동)와 같은 파이프라인에 섞을 수 없습니다.',
    'A CDC trigger marks the pipeline as **always streaming**. There is nothing to configure — save, then start it with [Start stream] and watch it on the Streams tab of [Monitor]. It cannot be mixed with batch triggers (schedule/manual) in the same pipeline.',
  ],
  'cfg.trg.syncHint': [
    '실시간 동기화 트리거는 파이프라인을 **상시 복제**로 표시합니다. 별도 설정은 없으며, 저장 후 [동기화 시작] 버튼으로 켜고 [모니터] 스트림 탭에서 상태를 봅니다. 데이터가 워커를 지나지 않으므로 **변환 노드를 둘 수 없습니다** — 소스와 타깃을 바로 이으세요.',
    'A real-time sync trigger marks the pipeline as **always replicating**. There is nothing to configure — save, then start it with [Start sync] and watch it on the Streams tab of [Monitor]. The data never passes through a worker, so **no transform node is allowed** — wire the source straight to the target.',
  ],
  'cfg.trg.manualHint': [
    '수동 트리거는 별도 설정이 없습니다. 실행 버튼으로 시작합니다.',
    'A manual trigger has nothing to configure. Start it with the run button.',
  ],
  'cfg.trg.cron': ['실행 주기 (Cron)', 'Schedule (cron)'],
  'cfg.trg.cronHint': [
    '분 시 일 월 요일 · 예) 0 2 * * * = 매일 02:00',
    'minute hour day month weekday · e.g. 0 2 * * * = 02:00 every day',
  ],
  'cfg.trg.timezone': ['타임존', 'Time zone'],
  'cfg.trg.timezoneHint': [
    '실제 스케줄은 파이프라인 설정의 cron 을 따릅니다. 상단 [저장] 시 함께 반영됩니다.',
    "The effective schedule comes from the pipeline's own cron setting. It is applied together when you press [Save] at the top.",
  ],

  // ---- 응답 노드 ----
  'cfg.resp.hint': [
    '이 노드에 흘러온 데이터를 **API 호출자에게 돌려줍니다.** 어디에도 적재하지 않으므로 연결이 필요 없습니다. API 트리거로 호출하면 실행이 끝날 때까지 기다렸다가 결과를 응답 본문으로 받습니다.',
    'Whatever reaches this node is **returned to the API caller.** It loads nowhere, so it needs no connection. A call through the API trigger waits for the run to finish and gets the result as the response body.',
  ],
  'cfg.resp.maxRows': ['최대 행 수', 'Max rows'],
  'cfg.resp.maxRowsHint': [
    '응답은 행을 메모리에 모으므로 상한이 필요합니다 (최대 10,000). 넘치면 잘라서 돌려주고 `{code}` 로 알립니다 — 조용히 자르지 않습니다.',
    'The response collects rows in memory, so it needs a cap (10,000 max). Beyond it the result is truncated and flagged with `{code}` — never silently.',
  ],
  'cfg.resp.columns': ['돌려줄 컬럼', 'Columns to return'],
  'cfg.resp.columnsEmpty': [
    '비워두면 **들어온 컬럼을 전부** 돌려줍니다. 외부에 무엇을 노출할지 정하려면 컬럼을 골라 넣으세요.',
    'Left empty, **every incoming column** is returned. Add columns to decide what is exposed.',
  ],
  'cfg.resp.removeCol': ['{name} 제거', 'Remove {name}'],
  'cfg.resp.remove': ['제거', 'Remove'],
  'cfg.resp.colNamePh': ['컬럼명', 'Column name'],
  'cfg.resp.add': ['추가', 'Add'],
  'cfg.resp.rowsVsCols': [
    '**행**을 걸러내려면 상류에 [변환 > 필터] 노드를 두세요. 여기서 고르는 것은** 컬럼**입니다.',
    'To filter **rows**, put a [Transform > Filter] node upstream. What you pick here is** columns**.',
  ],

  // ---- API 트리거 ----
  'cfg.api.hint': [
    '외부에서 **REST 호출**로 이 파이프라인을 실행합니다. 호출 본문(JSON)의 값이 아래 변수로 들어오고, 다른 노드에서 `{var}` 으로 씁니다 — 예) `{example}`. 저장하면 상단 [API] 버튼에서 호출 주소·토큰과 테스트 실행을 볼 수 있습니다.',
    'Run this pipeline from outside with a **REST call**. Values from the request body (JSON) arrive as the variables below, and other nodes use them as `{var}` — e.g. `{example}`. After saving, the [API] button at the top shows the call URL, tokens and a test run.',
  ],
  'cfg.api.varsLabel': ['입력 변수', 'Input variables'],
  'cfg.api.noVars': [
    '아직 변수가 없습니다. 값을 받지 않고 실행만 시키는 창구라면 그대로 두어도 됩니다.',
    'No variables yet. Leave it empty if the endpoint only triggers a run and takes no values.',
  ],
  'cfg.api.varNamePh': ['변수명 (영문/숫자/_)', 'Variable name (letters/digits/_)'],
  'cfg.api.typeString': ['문자', 'Text'],
  'cfg.api.typeNumber': ['숫자', 'Number'],
  'cfg.api.typeBoolean': ['참/거짓', 'True/false'],
  'cfg.api.deleteVar': ['변수 삭제', 'Delete variable'],
  'cfg.api.deleteVarAria': ['{name} 삭제', 'Delete {name}'],
  'cfg.api.unnamedVar': ['이름 없는 변수', 'unnamed variable'],
  'cfg.api.required': ['필수', 'Required'],
  'cfg.api.defaultPh': ['기본값 (없으면 실행 실패)', 'Default (run fails without one)'],
  'cfg.api.examplePh': ['예시 값 (테스트에 사용)', 'Example value (used in tests)'],
  'cfg.api.addVar': ['변수 추가', 'Add variable'],
  'cfg.api.payloadLabel': ['호출 본문 예시', 'Example request body'],
  'cfg.api.payloadHint': [
    '값이 없으면 실행을 **실패시킵니다**. 빈 값으로 넘기면 `{example}` 같은 조건이 되어 전체 재적재가 조용히 일어나기 때문입니다.',
    'A missing value **fails the run**. Passing an empty one would make a condition like `{example}`, silently reloading everything.',
  ],
  'cfg.api.sampleValue': ['값', 'value'],

  // ---- 웹훅(외부 호출 창구) ----
  'cfg.hook.label': ['외부 호출 창구', 'External call endpoints'],
  'cfg.hook.hint': [
    '외부 시스템이 이 주소로 POST 하면 파이프라인이 실행됩니다. 로그인 없이 **토큰**만으로 호출하므로, 토큰은 비밀번호처럼 다루세요.',
    'An outside system POSTs to this URL to run the pipeline. The call needs only a **token**, no login — so treat the token like a password.',
  ],
  'cfg.hook.loading': ['불러오는 중…', 'Loading…'],
  'cfg.hook.callCount': ['{n}회 호출', '{n} call{n||s}'],
  'cfg.hook.noCalls': ['호출 없음', 'No calls'],
  'cfg.hook.pauseTip': ['호출을 잠시 막습니다', 'Temporarily blocks calls'],
  'cfg.hook.resumeTip': ['다시 받습니다', 'Accepts calls again'],
  'cfg.hook.pause': ['중지', 'Pause'],
  'cfg.hook.resume': ['재개', 'Resume'],
  'cfg.hook.revokeTip': [
    '이 토큰을 폐기합니다 (되돌릴 수 없음)',
    'Revokes this token (cannot be undone)',
  ],
  'cfg.hook.revokeAria': ['{name} 창구 삭제', 'Delete endpoint {name}'],
  'cfg.hook.namePh': ['창구 이름 (예: 주문시스템)', 'Endpoint name (e.g. Order system)'],
  'cfg.hook.defaultName': ['기본', 'default'],
  'cfg.hook.issue': ['발급', 'Issue'],
  'cfg.hook.issueFailed': ['발급에 실패했습니다', 'Failed to issue a token'],
  'cfg.hook.onceWarn': [
    '토큰은 **지금 한 번만** 보입니다. 서버는 해시만 저장하므로 다시 볼 수 없습니다 — 지금 복사해 두세요.',
    'The token is shown **only once**. The server keeps just a hash, so it cannot be shown again — copy it now.',
  ],
  'cfg.hook.headerHint': [
    '토큰을 URL 대신 `{header}` 헤더로 보내면 액세스 로그·프록시에 남지 않습니다. 위 예시가 그 방식입니다.',
    'Sending the token in the `{header}` header instead of the URL keeps it out of access logs and proxies. The example above does that.',
  ],
  'cfg.hook.copied': ['복사했습니다 — 닫기', 'Copied — close'],

  // ---- 배치 소스 ----
  'cfg.src.customSql': ['커스텀 SQL 사용', 'Use custom SQL'],
  'cfg.src.expandEdit': ['큰 화면에서 편집', 'Edit in a larger view'],
  'cfg.src.expand': ['크게 편집', 'Expand'],
  'cfg.src.editorLoading': ['에디터를 불러오는 중…', 'Loading the editor…'],
  'cfg.src.sqlHint': [
    '소스에서 실행할 `{select}` 문입니다. 커스텀 SQL 모드에서는 증분 워터마크가 적용되지 않습니다 — 전량을 읽습니다.',
    'The `{select}` statement to run against the source. Custom SQL ignores the incremental watermark — it reads everything.',
  ],
  'cfg.src.table': ['테이블', 'Table'],
  'cfg.src.tableViewAria': ['테이블 보기 방식', 'Table view mode'],
  'cfg.src.viewList': ['목록', 'List'],
  'cfg.src.viewTree': ['트리', 'Tree'],
  'cfg.src.schemaError': [
    '스키마를 읽지 못했습니다. 연결 상태를 확인하세요.',
    'Could not read the schema. Check the connection.',
  ],
  'cfg.src.allSchemas': ['전체 스키마', 'All schemas'],
  'cfg.src.defaultSchema': ['(기본)', '(default)'],
  'cfg.src.schemaPh': ['스키마 선택 또는 검색…', 'Pick or search a schema…'],
  'cfg.src.schemaEmpty': ['스키마가 없습니다', 'No schemas'],
  'cfg.src.tablePh': ['테이블 선택 또는 검색…', 'Pick or search a table…'],
  'cfg.src.pickConnFirst': ['먼저 연결을 고르세요', 'Pick a connection first'],
  'cfg.src.tableEmpty': ['일치하는 테이블이 없습니다', 'No matching table'],
  'cfg.src.watermark': ['증분 컬럼 (watermark)', 'Incremental column (watermark)'],
  'cfg.src.fullLoad': ['— 전체 적재 —', '— full load —'],
  'cfg.src.columnEmpty': ['컬럼이 없습니다', 'No columns'],
  'cfg.src.watermarkHint': [
    '지정하면 이 컬럼이 마지막 실행값보다 큰 행만 읽습니다 (updated_at, id 등).',
    'When set, only rows whose value in this column is greater than the last run\'s are read (updated_at, id, …).',
  ],
  'cfg.src.batchSize': ['배치 크기', 'Batch size'],
  'cfg.src.batchSizeHint': [
    '한 번에 읽어 흘려보낼 행 수. 클수록 빠르지만 메모리를 더 씁니다.',
    'Rows read and streamed at a time. Larger is faster but uses more memory.',
  ],

  // ---- CDC 소스 (모드 id 인 initial·never·when_needed·soft·hard·ignore 는 값이라 그대로 둔다) ----
  'cfg.cdc.tables': ['캡처할 테이블', 'Tables to capture'],
  'cfg.cdc.tablesCount': ['({n}개)', '({n})'],
  'cfg.cdc.tablesLoading': ['테이블을 불러오는 중…', 'Loading tables…'],
  'cfg.cdc.schemaError': [
    '스키마를 읽지 못했습니다. 연결·CDC 전제조건을 확인하세요.',
    'Could not read the schema. Check the connection and the CDC prerequisites.',
  ],
  'cfg.cdc.tablesHint': [
    '변경을 실시간으로 잡아낼 테이블입니다. 최소 1개가 필요합니다.',
    'Tables whose changes are captured in real time. At least one is required.',
  ],
  'cfg.cdc.tablesManual': [
    ' 목록을 못 불러오면 한 줄에 하나씩 직접 입력하세요.',
    ' If the list cannot load, type one table per line.',
  ],
  'cfg.cdc.snapshot': ['초기 스냅샷', 'Initial snapshot'],
  'cfg.cdc.snapInitial': [
    'initial — 기존 데이터를 먼저 전량 적재 후 변경 추적',
    'initial — load everything first, then track changes',
  ],
  'cfg.cdc.snapNever': ['never — 지금 이후 변경만 추적', 'never — track changes from now on only'],
  'cfg.cdc.snapWhenNeeded': [
    'when_needed — 필요할 때만 스냅샷',
    'when_needed — snapshot only when required',
  ],
  'cfg.cdc.snapInitialHint': [
    '처음 켤 때 테이블 전체를 한 번 읽고 이후 변경분을 잇습니다.',
    'Reads each table once on first start, then follows the changes.',
  ],
  'cfg.cdc.snapNeverHint': [
    '과거 데이터는 건너뛰고 켠 시점 이후의 변경만 반영합니다. SQL Server 는 no_data 로 대체됩니다.',
    'Skips existing data and applies only changes made after it starts. SQL Server falls back to no_data.',
  ],
  'cfg.cdc.snapWhenNeededHint': [
    'PostgreSQL 은 이 모드가 없어 initial 로 대체됩니다.',
    'PostgreSQL has no such mode and falls back to initial.',
  ],
  'cfg.cdc.deleteMode': ['삭제(DELETE) 이벤트 처리', 'DELETE event handling'],
  'cfg.cdc.delSoft': [
    'soft — __deleted 플래그로 표시 (기본·안전)',
    'soft — flag with __deleted (default, safe)',
  ],
  'cfg.cdc.delHard': ['hard — 타깃에서도 실제 삭제', 'hard — really delete on the target too'],
  'cfg.cdc.delIgnore': ['ignore — 삭제 이벤트 무시', 'ignore — drop delete events'],
  'cfg.cdc.delSoftHint': [
    '삭제된 행을 지우지 않고 __deleted=true 로 남깁니다. 이력 보존에 안전합니다.',
    'Deleted rows are kept and marked __deleted=true. Safe for keeping history.',
  ],
  'cfg.cdc.delHardHint': [
    '소스에서 지워지면 타깃에서도 지웁니다. upsert 타깃 + 키 컬럼이 필요합니다.',
    'A row deleted at the source is deleted on the target too. Needs an upsert target with key columns.',
  ],
  'cfg.cdc.delIgnoreHint': [
    '삽입·수정만 반영하고 삭제는 흘려보냅니다.',
    'Applies inserts and updates only; deletes are dropped.',
  ],

  // ---- 실시간 동기화 소스 (SymmetricDS) ----
  'cfg.sync.srcSchema': ['소스 스키마', 'Source schema'],
  'cfg.sync.srcSchemaHint': [
    '테이블마다 따로 적지 않으면 이 스키마를 씁니다.',
    'Used for every table that does not name its own schema.',
  ],
  'cfg.sync.configDb': ['SymmetricDS 설정 DB (선택)', 'SymmetricDS config DB (optional)'],
  'cfg.sync.configDbPh': ['비우면 소스와 같은 DB', 'Empty = the same DB as the source'],
  'cfg.sync.configDbHint': [
    'SymmetricDS 는 자기 테이블 **45개**를 만듭니다. 여기에 DB 이름을 적으면 업무 DB 대신 그쪽에 만들어져 **dbo 가 깨끗해집니다.** 동기화 대상이 1개든 200개든 45개로 고정입니다. **같은 인스턴스**여야 하고, 그 DB 에 테이블 생성 권한이 필요합니다. 트리거는 그래도 업무 테이블에 붙고, 이 DB 가 꽉 차면 업무 쓰기가 실패하므로 장애가 격리되는 것은 아닙니다.',
    'SymmetricDS creates **45 tables** of its own. Naming a DB here puts them there instead of your business DB, which **keeps dbo clean.** It is 45 tables whether you sync 1 table or 200. It must be the **same instance**, and you need permission to create tables in that DB. The triggers still sit on the business tables, and business writes fail if this DB fills up — it is not fault isolation.',
  ],
  'cfg.sync.tables': ['동기화할 테이블', 'Tables to sync'],
  'cfg.sync.tableNamePh': ['테이블명', 'Table name'],
  'cfg.sync.channelTip': ['전송 채널', 'Transport channel'],
  'cfg.sync.loadOrderTip': [
    '초기 적재 순서 — 작을수록 먼저',
    'Initial load order — lower goes first',
  ],
  'cfg.sync.excludeTable': ['테이블 제외', 'Remove table'],
  'cfg.sync.rowFilterPh': [
    "행 필터 (선택) — 예) c.WAREHOUSE_CD = 'WH01'",
    "Row filter (optional) — e.g. c.WAREHOUSE_CD = 'WH01'",
  ],
  'cfg.sync.addTable': ['테이블 추가', 'Add table'],
  'cfg.sync.tablesHint': [
    '채널은 전송 단위이자 우선순위입니다. **대량 배치가 발생하는 테이블을 실시간 채널에 넣지 마세요** — 한 번의 대량 작업이 채널을 점유해 다른 테이블의 실시간성을 망칩니다. 숫자는 초기 적재 순서로, FK 의존을 고려해 마스터 테이블을 작은 값으로 둡니다.',
    'A channel is both the transport unit and the priority. **Keep tables with bulk batches off the real-time channel** — one bulk job occupies the channel and ruins latency for every other table. The number is the initial load order; give master tables a lower one to respect FK dependencies.',
  ],
  'cfg.sync.purpose': ['복제 데이터의 최종 용도', 'What the replica is used for'],
  'cfg.sync.purposeWarn': [
    '복제본은 아무리 빨라도 원본과 **순간적으로 다를 수 있습니다.** 출고·재고 판단에 쓰면 이중 출고 같은 사고로 이어집니다 — 원본 직접 조회나 API 연동이 맞는지 먼저 확인하세요.',
    'However fast it is, a replica **can momentarily differ from the source.** Basing shipping or stock decisions on it leads to accidents like double shipping — check first whether querying the source directly, or an API integration, is the right answer.',
  ],
  'cfg.sync.initialLoad': [
    '시작할 때 기존 데이터를 전량 적재',
    'Load all existing data on start',
  ],
  'cfg.sync.initialLoadHint': [
    '끄면 켠 시점 이후의 변경만 반영됩니다. 운영계는 업무 저부하 시간대에 켜세요.',
    'Off means only changes made after it starts are applied. On production, turn it on during a low-load window.',
  ],
  'cfg.sync.loadTestAck': ['부하 테스트를 마쳤습니다', 'Load testing is done'],
  'cfg.sync.loadTestHint': [
    '동기화를 켜면 **원본 테이블에 트리거가 생겨** 쓰기 트랜잭션이 느려집니다. 현장에서 스캐너로 실시간 처리하는 시스템이라면 응답 지연이 파이프라인 지연보다 훨씬 민감합니다. 현장 스캔 응답이 0.3초 이상 느려지면 재검토하세요. 이 확인이 없어도 시작은 되지만 점검 결과에 경고가 남습니다 — **운영 적용 전에는 필수**입니다.',
    'Turning sync on **puts triggers on the source tables**, slowing write transactions. For a system handling scanner traffic in real time, response latency matters far more than pipeline latency. Reconsider if scan responses slow by more than 0.3 s. You can start without ticking this, but the preflight will warn — it is **required before production use**.',
  ],

  // ---- 실시간 동기화 타깃 ----
  'cfg.synct.schema': ['타깃 스키마', 'Target schema'],
  'cfg.synct.mappings': ['테이블명 매핑', 'Table name mapping'],
  'cfg.synct.srcTablePh': ['소스 테이블', 'Source table'],
  'cfg.synct.tgtTablePh': ['타깃 테이블', 'Target table'],
  'cfg.synct.deleteMapping': ['매핑 삭제', 'Delete mapping'],
  'cfg.synct.importFromSource': [
    '소스에서 가져오기 ({n}개)',
    'Import from source ({n})',
  ],
  'cfg.synct.hint': [
    'PostgreSQL 은 인용하지 않은 식별자를 **소문자로 접습니다** (INVENTORY → inventory). 비워 두면 서버가 소문자로 확정하지만, 여기에 적어 두면 무엇으로 들어갔는지 보입니다.',
    'PostgreSQL **folds unquoted identifiers to lower case** (INVENTORY → inventory). Left empty, the server settles on lower case; filling it in makes the actual name visible.',
  ],
  'cfg.synct.pickSourceFirst': [
    ' 소스 노드에서 테이블을 먼저 고르세요.',
    ' Pick the tables on the source node first.',
  ],

  // ---- 필터 노드 ----
  'cfg.flt.match': ['결합 방식', 'Combine with'],
  'cfg.flt.matchAll': ['모든 조건 만족 (AND)', 'All conditions (AND)'],
  'cfg.flt.matchAny': ['하나라도 만족 (OR)', 'Any condition (OR)'],
  'cfg.flt.conditions': ['조건', 'Conditions'],
  'cfg.flt.columnPh': ['컬럼', 'Column'],
  'cfg.flt.valuePh': ['값', 'Value'],
  'cfg.flt.deleteCond': ['조건 삭제', 'Delete condition'],
  'cfg.flt.addCond': ['조건 추가', 'Add condition'],

  // ---- 스위치(분기) 노드 ----
  'cfg.sw.lead': [
    '각 행을 **위에서부터 처음 맞는 분기**로 보냅니다.',
    'Each row goes to the **first branch that matches, top down**.',
  ],
  'cfg.sw.deleteCase': ['분기 삭제', 'Delete branch'],
  'cfg.sw.noCond': [
    '조건을 추가하세요. 없으면 모든 행이 이 분기로 갑니다.',
    'Add a condition. Without one, every row goes to this branch.',
  ],
  'cfg.sw.columnPh': ['컬럼명', 'Column name'],
  'cfg.sw.joinAll': ['모두 만족(AND)', 'All (AND)'],
  'cfg.sw.joinAny': ['하나라도(OR)', 'Any (OR)'],
  'cfg.sw.addCase': ['분기 추가', 'Add branch'],
  'cfg.sw.otherwise': [
    '**그 외** — 위 분기에 하나도 안 맞는 행이 나가는 출력 (자동)',
    '**Otherwise** — the outlet for rows matching none of the branches above (automatic)',
  ],

  // ---- 필드 매핑 노드 ----
  'cfg.map.label': ['필드 매핑', 'Field mapping'],
  'cfg.map.sourcePh': ['원본', 'Source'],
  'cfg.map.targetPh': ['대상', 'Target'],
  'cfg.map.noCast': ['변환없음', 'no cast'],
  'cfg.map.deleteMapping': ['매핑 삭제', 'Delete mapping'],
  'cfg.map.addMapping': ['매핑 추가', 'Add mapping'],
  'cfg.map.dropUnmapped': ['매핑에 없는 컬럼 버리기', 'Drop columns that are not mapped'],

  // ---- Python 변환 노드 ----
  'cfg.py.label': ['Python 코드', 'Python code'],
  'cfg.py.modeAria': ['처리 모드', 'Processing mode'],
  'cfg.py.rowTip': ['각 행마다 transform(row) 호출', 'Calls transform(row) for every row'],
  'cfg.py.rowMode': ['행 단위', 'Per row'],
  'cfg.py.batchTip': [
    '전체 행을 transform_batch(df) 로 한 번에',
    'Hands every row to transform_batch(df) at once',
  ],
  'cfg.py.batchMode': ['배치 단위', 'Per batch'],
  'cfg.py.swapWarn': [
    '작성한 코드를 **{mode}** 골격으로 교체합니다. 되돌릴 수 없어요.',
    'Replaces the code you wrote with the **{mode}** scaffold. This cannot be undone.',
  ],
  'cfg.py.swap': ['교체', 'Replace'],
  'cfg.py.rowHint': [
    '**행 단위** — `{fn}` 가 각 레코드마다 호출됩니다. 변환한 dict 를 반환하고, `{none}` 을 반환하면 그 행은 제외됩니다.',
    '**Per row** — `{fn}` is called for every record. Return the transformed dict; returning `{none}` drops that row.',
  ],
  'cfg.py.batchHint': [
    '**배치 단위** — `{fn}` 를 대신 정의하면 전체 행을 pandas DataFrame 으로 한 번에 받아 DataFrame 을 반환합니다(groupby·정렬·중복제거 등). 둘 중 하나만 정의하세요.',
    '**Per batch** — define `{fn}` instead to receive every row as one pandas DataFrame and return a DataFrame (groupby, sorting, dedupe, …). Define only one of the two.',
  ],
  'cfg.py.sandboxHint': [
    '코드는 격리된 프로세스에서 실행됩니다 — DB·시크릿·네트워크에 접근할 수 없습니다. `{import}` 및 표준 모듈 일부(datetime·re·json·math·hashlib·decimal 등)를 쓸 수 있습니다. 값은 JSON 기준으로 정규화됩니다(날짜→ISO 문자열, Decimal→숫자).',
    'The code runs in an isolated process — no access to the database, secrets or the network. `{import}` and some standard modules (datetime, re, json, math, hashlib, decimal, …) are available. Values are normalised to JSON (dates → ISO strings, Decimal → numbers).',
  ],

  // ---- 컬럼 매핑 팝업 ----
  'cfg.cm.title': ['컬럼 매핑', 'Column mapping'],
  'cfg.cm.srcTable': ['소스 테이블', 'Source table'],
  'cfg.cm.hint': [
    '설정하지 않은 컬럼은 **동일 이름**으로 자동 저장됩니다. 필요 없는 컬럼은 [비활성화]로 제외하세요.',
    'Columns you leave alone are written **under the same name**. Exclude the ones you do not need with [Disable].',
  ],
  'cfg.cm.srcLoading': ['소스 컬럼을 불러오는 중…', 'Loading source columns…'],
  'cfg.cm.srcFailed': [
    '소스 컬럼을 읽지 못했습니다. CDC 소스 연결·테이블을 확인하세요.',
    'Could not read the source columns. Check the CDC source connection and tables.',
  ],
  'cfg.cm.sameName': ['(동일 이름: {col})', '(same name: {col})'],
  'cfg.cm.include': ['다시 포함', 'Include again'],
  'cfg.cm.exclude': ['이 컬럼 제외', 'Exclude this column'],
  'cfg.cm.excluded': ['제외됨', 'Excluded'],
  'cfg.cm.disable': ['비활성화', 'Disable'],
  'cfg.cm.tgtFailed': [
    '타깃 테이블 컬럼을 못 읽었습니다. 직접 이름을 맞추려면 대상 테이블을 먼저 고르세요.',
    'Could not read the target table columns. Pick the target table first to map names by hand.',
  ],
  'cfg.cm.apply': ['적용', 'Apply'],

  // ---- DB 타깃 (모드 id 인 upsert·append·overwrite 는 값이라 그대로 둔다) ----
  'cfg.tgt.table': ['대상 테이블', 'Target table'],
  'cfg.tgt.mode': ['적재 모드', 'Load mode'],
  'cfg.tgt.upsert': ['Upsert (키 기준 갱신)', 'Upsert (update by key)'],
  'cfg.tgt.append': ['Append (단순 추가)', 'Append (just add)'],
  'cfg.tgt.overwrite': ['Overwrite (전체 교체)', 'Overwrite (replace everything)'],
  'cfg.tgt.upsertHint': ['재실행해도 결과가 같습니다 (멱등).', 'Re-running gives the same result (idempotent).'],
  'cfg.tgt.appendHint': ['재실행하면 행이 중복될 수 있습니다.', 'Re-running can duplicate rows.'],
  'cfg.tgt.overwriteHint': [
    '적재 전에 대상 테이블을 비웁니다.',
    'Empties the target table before loading.',
  ],
  'cfg.tgt.keyColumns': ['키 컬럼', 'Key columns'],
  'cfg.tgt.keyColumnsHint': [
    '이 컬럼들이 같으면 같은 행으로 보고 갱신합니다.',
    'Rows matching on these columns are treated as the same row and updated.',
  ],
  'cfg.tgt.colMap': ['컬럼 매핑 (옵션)', 'Column mapping (optional)'],
  'cfg.tgt.colMapSet': ['● 설정됨 · {n}개', '● configured · {n}'],
  'cfg.tgt.colMapUnset': ['○ 미설정', '○ not configured'],
  'cfg.tgt.colMapEdit': ['편집', 'Edit'],
  'cfg.tgt.colMapConfigure': ['설정', 'Configure'],
  'cfg.tgt.colMapResetTip': [
    '컬럼 매핑 초기화 (전부 동일 이름으로)',
    'Reset the column mapping (everything back to the same name)',
  ],
  'cfg.tgt.colMapReset': ['초기화', 'Reset'],
  'cfg.tgt.colMapSetHint': [
    '지정한 컬럼만 이름 변경/제외되고, **나머지는 동일 이름으로 자동 저장**됩니다.',
    'Only the columns you name are renamed or excluded; **the rest are written under the same name**.',
  ],
  'cfg.tgt.colMapUnsetHint': [
    '설정하지 않으면 모든 컬럼이 소스와 **동일한 이름**으로 자동 저장됩니다.',
    'Left unconfigured, every column is written under the **same name** as at the source.',
  ],

  // ---- S3 / 파일 타깃 ----
  'cfg.s3.prefix': ['경로 prefix', 'Path prefix'],
  'cfg.s3.prefixOptional': ['경로 prefix (선택)', 'Path prefix (optional)'],
  'cfg.s3.prefixHint': [
    '실제 경로는 prefix/run_id=<실행ID>/part-00000.parquet 입니다.',
    'The actual path is prefix/run_id=<run id>/part-00000.parquet.',
  ],
  'cfg.s3.format': ['파일 포맷', 'File format'],
  'cfg.s3.parquet': ['Parquet (권장)', 'Parquet (recommended)'],
  'cfg.s3.jsonl': ['JSON Lines (권장)', 'JSON Lines (recommended)'],
  'cfg.s3.mode': ['적재 모드', 'Load mode'],
  'cfg.s3.overwrite': ['Overwrite (실행 경로 선정리)', 'Overwrite (clears the run path first)'],
  'cfg.s3.modeHint': [
    'S3 는 upsert 를 지원하지 않습니다. 실행별 경로 분리로 멱등성을 확보합니다.',
    'S3 has no upsert. Idempotency comes from giving each run its own path.',
  ],

  // ---- 편집기 변수 패널의 종류 배지 ----
  'cfg.var.firstRow': ['첫 행', 'First row'],
  'cfg.var.allRows': ['모든 행', 'All rows'],

  // ---- 메모 / 영역 노드 ----
  'cfg.memo.color': ['색상', 'Colour'],
  'cfg.memo.text': ['메모 내용', 'Note text'],
  'cfg.memo.textPh': [
    '이 파이프라인에 대한 설명, 할 일, 주의사항 등을 적어두세요.',
    'Describe this pipeline, list to-dos, note caveats…',
  ],
  'cfg.memo.hint': [
    '메모는 문서용 주석입니다 — 실행되지 않고 다른 노드와 연결할 수 없습니다.',
    'A note is documentation only — it never runs and cannot connect to other nodes.',
  ],
  'cfg.grp.title': ['영역 제목', 'Group title'],
  'cfg.grp.titlePh': ['예: 수집 · 적재', 'e.g. Extract · Load'],
  'cfg.grp.hint': [
    '노드를 사각형으로 묶어 구분하는 영역입니다. 모서리를 끌어 크기를 조절하세요 — 실행·연결과 무관합니다.',
    'A rectangle that groups nodes visually. Drag a corner to resize — it affects neither execution nor connections.',
  ],

  // ---- 로컬 파일 타깃 ----
  'cfg.file.pathHint': [
    '실제 경로: {root}<연결 폴더>/{prefix}run_id=<실행ID>/part-00000.{fmt}',
    'Actual path: {root}<connection folder>/{prefix}run_id=<run id>/part-00000.{fmt}',
  ],
  'cfg.file.modeHint': [
    '로컬 파일은 upsert 를 지원하지 않습니다. 실행별 경로 분리로 멱등성을 확보합니다.',
    'Local files have no upsert. Idempotency comes from giving each run its own path.',
  ],

  // ---- MongoDB 소스·타깃 ----
  'cfg.mgo.collection': ['컬렉션', 'Collection'],
  'cfg.mgo.loading': ['컬렉션을 불러오는 중…', 'Loading collections…'],
  'cfg.mgo.readError': [
    '읽지 못했습니다. 연결 상태를 확인하세요.',
    'Could not read it. Check the connection.',
  ],
  'cfg.mgo.filter': ['필터 (JSON)', 'Filter (JSON)'],
  'cfg.mgo.filterHint': [
    '비우면 전체 조회. Mongo 필터는 증분 컬럼과 함께 쓸 수 있습니다.',
    'Empty reads everything. A Mongo filter can be combined with an incremental column.',
  ],
  'cfg.mgo.watermark': ['증분 필드 (watermark)', 'Incremental field (watermark)'],
  'cfg.mgo.watermarkHint': [
    '표본 문서에서 추론한 필드 목록입니다.',
    'Fields inferred from sample documents.',
  ],
  'cfg.mgo.targetCollection': ['대상 컬렉션', 'Target collection'],
  'cfg.mgo.targetHint': [
    '목록에 없으면 직접 입력하세요 — 없는 컬렉션은 적재 시 생성됩니다.',
    'Type it in if it is not listed — a missing collection is created on load.',
  ],
  'cfg.mgo.targetPh': ['컬렉션 이름 직접 입력', 'Type a collection name'],
  'cfg.mgo.upsert': ['Upsert (키 기준 교체)', 'Upsert (replace by key)'],
  'cfg.mgo.keyFields': ['키 필드', 'Key fields'],
  'cfg.mgo.keyFieldsPh': ['_id 또는 order_no, tenant_id', '_id, or order_no, tenant_id'],
  'cfg.mgo.keyFieldsHint': [
    '이 필드들이 같으면 같은 문서로 보고 교체합니다.',
    'Documents matching on these fields are treated as the same one and replaced.',
  ],
  'cfg.json.mustBeObject': ['JSON 객체여야 합니다', 'It must be a JSON object'],
  'cfg.json.invalid': ['올바른 JSON 이 아닙니다: {detail}', 'Not valid JSON: {detail}'],

  // ---- SAP 소스 ----
  'cfg.sap.mode': ['읽기 방식', 'Read method'],
  'cfg.sap.bapi': ['BAPI 호출 (권장)', 'BAPI call (recommended)'],
  'cfg.sap.bapiHint': [
    'BAPI 는 512자 행폭 제약이 없고 결과가 구조화되어 있습니다.',
    'A BAPI has no 512-character row-width limit and returns structured results.',
  ],
  'cfg.sap.readTableHint': [
    'RFC_READ_TABLE 은 행폭 512자 제약이 있어 넓은 테이블은 나눠 호출합니다.',
    'RFC_READ_TABLE has a 512-character row-width limit, so wide tables are split across calls.',
  ],
  'cfg.sap.functionName': ['함수 이름', 'Function name'],
  'cfg.sap.resultTable': ['결과 테이블 (선택)', 'Result table (optional)'],
  'cfg.sap.resultTablePh': [
    'MATNRLIST — 비우면 자동 판별',
    'MATNRLIST — left empty, it is detected',
  ],
  'cfg.sap.resultTableHint': [
    '결과 테이블 후보가 여러 개면 반드시 지정해야 합니다.',
    'It must be named when several result tables are possible.',
  ],
  'cfg.sap.parameters': ['파라미터 (JSON)', 'Parameters (JSON)'],
  'cfg.sap.table': ['테이블', 'Table'],
  'cfg.sap.fieldsLoading': ['필드를 불러오는 중…', 'Loading fields…'],
  'cfg.sap.tableReadFailed': ['테이블을 읽지 못했습니다', 'Could not read the table'],
  'cfg.sap.tableHint': [
    'SAP 테이블 이름을 입력하면 필드를 조회합니다 (예: MARA, MAKT, CSKT).',
    'Type an SAP table name to look up its fields (e.g. MARA, MAKT, CSKT).',
  ],
  'cfg.sap.tableMeta': [
    '{name} · 필드 {n}개 · 전체 폭 {width}자',
    '{name} · {n} field{n||s} · {width} characters wide',
  ],
  'cfg.sap.fields': ['필드', 'Fields'],
  'cfg.sap.fieldsChosen': ['({n}개 선택)', '({n} selected)'],
  'cfg.sap.fieldsAll': ['(전체)', '(all)'],
  'cfg.sap.widthMeter': [
    '선택 폭 {width}자 / 한계 512자',
    'Selected width {width} / limit 512 characters',
  ],
  'cfg.sap.willSplit': [
    ' — 512자를 넘어 나눠 호출합니다. 필드를 줄이거나 BAPI 를 쓰세요.',
    ' — over 512, so the call is split. Pick fewer fields or use a BAPI.',
  ],
  'cfg.sap.where': ['WHERE 조건', 'WHERE clause'],
  'cfg.sap.whereHint': [
    'ABAP OpenSQL 문법. 72자 단위 분할은 서버가 처리합니다.',
    'ABAP OpenSQL syntax. The server handles splitting it into 72-character lines.',
  ],
  'cfg.sap.watermarkHint': [
    'SAP 날짜(YYYYMMDD)는 사전순 비교가 곧 크기순 비교입니다.',
    'For SAP dates (YYYYMMDD), comparing lexically is the same as comparing chronologically.',
  ],
  'cfg.sap.batchHint': [
    'SAP 게이트웨이 타임아웃을 피하려면 한 번에 다 읽지 않습니다.',
    'Reading in chunks avoids SAP gateway timeouts.',
  ],
} as const
