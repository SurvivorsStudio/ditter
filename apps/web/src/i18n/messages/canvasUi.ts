/** canvasUi 문구 — 캔버스 부속 화면(결과 서랍·트리·샘플/엣지/계획 팝업·테스트 실행·
 *  동기화 점검·메모/그룹/노드 카드·Python 편집기).
 *  ko 문구는 기존 리터럴과 바이트 동일하게 유지한다 — ResultTreeModal.test.tsx 의
 *  한글 단언이 그 문구를 본다. `${이름.컬럼}` 류는 참조 표기(문법)라 감싸는 말만 번역한다. */
export const canvasUi = {
  // 공용
  'cui.copy': ['복사', 'Copy'],
  'cui.copied': ['복사됨', 'Copied'],
  'cui.noResultRows': ['결과 행이 없습니다.', 'No result rows.'],
  'cui.handedCount': ['넘긴 값 {n}개', '{n} handed value{n||s}'],
  'cui.rowsMeta': ['{rows}행 · 컬럼 {cols}개', '{rows} row{rows||s} · {cols} column{cols||s}'],
  'cui.rowsMetaPartial': [
    '{rows}행 (앞부분만) · 컬럼 {cols}개',
    '{rows} row{rows||s} (first rows only) · {cols} column{cols||s}',
  ],
  'cui.rowsMetaPlus': ['{rows}행+ · 컬럼 {cols}개', '{rows}+ rows · {cols} column{cols||s}'],

  // 참조 표기의 자리표시 낱말 — `${}`·`[]`·`$` 는 문법이라 그대로, 낱말만 번역한다
  'cui.ref.varName': ['$이름', '$name'],
  'cui.ref.nodeCol': ['${이름.컬럼}', '${name.column}'],
  'cui.ref.nodeColList': ['${이름.컬럼[]}', '${name.column[]}'],
  'cui.ref.whereIn': ['WHERE id IN (${이름.컬럼[]})', 'WHERE id IN (${name.column[]})'],

  // 결과 서랍 (ResultDrawer)
  'cui.rd.expandResults': ['결과 펼치기', 'Expand results'],
  'cui.rd.collapseResults': ['결과 접기', 'Collapse results'],
  'cui.rd.title': ['노드 결과', 'Node results'],
  'cui.rd.clear': ['비우기', 'Clear'],
  'cui.rd.clearTitle': ['모아 둔 결과를 비웁니다', 'Clears the collected results'],
  'cui.rd.chipTitleHanded': [
    '{label} — {n}개 값 · 누르면 결과가 펼쳐집니다',
    '{label} — {n} value{n||s} · click to expand',
  ],
  'cui.rd.chipTitleRows': [
    '{label} — {n}행 · 누르면 결과가 펼쳐집니다',
    '{label} — {n} row{n||s} · click to expand',
  ],
  'cui.rd.asOf': ['{time} 기준', 'as of {time}'],
  'cui.rd.varsHd': ['변수로 쓰기 — 누르면 복사됩니다', 'Use as a variable — click to copy'],
  'cui.rd.varTitleHanded': [
    '{ref} — 호출 본문으로 받은 값이 꽂힙니다',
    '{ref} — inserts the value received in the call body',
  ],
  'cui.rd.varTitleFirst': [
    '{ref} — 첫 행의 {column} 값이 꽂힙니다',
    "{ref} — inserts the first row's {column} value",
  ],
  'cui.rd.listHd': ['여러 행을 한 번에 — IN (…) 자리', 'All rows at once — for IN (…)'],
  'cui.rd.listTitle': [
    '{ref} — 모든 행의 {column} 을 쉼표로 이어 붙입니다',
    "{ref} — joins every row's {column} with commas",
  ],
  'cui.rd.noteHanded1': [
    '「{label}」 가 호출 본문으로 받아 하류에 넘긴 값입니다. 다른 노드에서는 ',
    'Values 「{label}」 received in the call body and handed downstream. In other nodes, write ',
  ],
  'cui.rd.noteHanded2': [
    ' 으로 씁니다 — 노드 결과가 아니라 트리거 변수입니다.',
    ' — these are trigger variables, not node results.',
  ],
  'cui.rd.noteFirst1': ['첫 행(', 'The first row ('],
  'cui.rd.noteFirst2': [
    ')의 값이 변수로 꽂힙니다. 실행할 때마다 「{label}」 를 먼저 돌려 그 시점의 값을 씁니다.',
    ') supplies the variable values. Every run executes 「{label}」 first and uses the values from that moment.',
  ],

  // 결과 트리 팝업 (ResultTreeModal)
  'cui.rt.title': ['노드 결과 — 트리', 'Node results — tree'],
  'cui.rt.collapseAll': ['모두 접기', 'Collapse all'],
  'cui.rt.expandAll': ['모두 펼치기', 'Expand all'],
  'cui.rt.empty': ['아직 모인 결과가 없습니다.', 'No results collected yet.'],
  'cui.rt.refRow': ['참조되는 행', 'Referenced row'],
  'cui.rt.refTitle': [
    '{ref} — 이 행의 값 하나. 누르면 복사됩니다',
    '{ref} — one value from this row. Click to copy',
  ],
  'cui.rt.listRefTitle': [
    '{ref} — 모든 행을 쉼표로 이어 붙입니다. IN (...) 자리에 씁니다',
    '{ref} — joins all rows with commas. Use it inside IN (...)',
  ],
  'cui.rt.arrayCount': ['배열 {n}개', 'array · {n} item{n||s}'],
  'cui.rt.objectCount': ['객체 {n}개', 'object · {n} entr{n|y|ies}'],
  'cui.rt.note1': [' 은 ', ' is '],
  'cui.rt.noteFirstRow': ['첫 행', 'the first row'],
  'cui.rt.note2': ['의 값 하나, ', "'s single value; "],
  'cui.rt.note3': [' 는 ', ' is '],
  'cui.rt.noteAllRows': ['모든 행', 'all rows'],
  'cui.rt.note4': ['을 쉼표로 이어 붙인 것입니다 — ', ' joined with commas — used like '],
  'cui.rt.note5': [
    ' 처럼 씁니다(문자값의 따옴표는 자동으로 붙습니다). 중첩된 안쪽 값은 참조할 수 없습니다.',
    ' (quotes around string values are added automatically). Nested inner values cannot be referenced.',
  ],
  'cui.rt.btn': ['트리 보기', 'Tree view'],
  'cui.rt.btnTitle': ['결과 전체를 트리로 봅니다', 'View all results as a tree'],

  // 노드 실행 결과 샘플 (NodeSampleModal)
  'cui.sample.title': ['{label} · 실행 결과', '{label} · run result'],
  'cui.sample.meta': [
    '{rows}행 미리보기 · 컬럼 {cols}개',
    'Preview of {rows} row{rows||s} · {cols} column{cols||s}',
  ],
  'cui.sample.metaPartial': [
    '{rows}행 미리보기 (앞부분만 · 실제로는 더 많습니다) · 컬럼 {cols}개',
    'Preview of {rows} row{rows||s} (first rows only · more exist) · {cols} column{cols||s}',
  ],

  // 엣지로 넘어간 값 (EdgeValueModal)
  'cui.edge.title': ['넘어간 값 — {source} → {target}', 'Handed values — {source} → {target}'],
  'cui.edge.empty': ['이 선으로 넘어간 값이 없습니다.', 'No values were handed over this edge.'],
  'cui.edge.handed': ['넘어간 값', 'Handed values'],
  'cui.edge.handedHint1': [
    '호출 본문 그대로입니다. 하류 노드는 이 값을 ',
    'This is the call body as received. Downstream nodes read these values as ',
  ],
  'cui.edge.handedHint2': [' 으로 받습니다.', '.'],
  'cui.edge.applied1': ['이 값으로 ', 'With these values, '],
  'cui.edge.applied2': [
    ' 의 설정이 아래와 같이 바뀐 상태로 실행됩니다.',
    ' runs with its settings changed as shown below.',
  ],
  'cui.edge.authored': ['저작', 'Authored'],
  'cui.edge.executed': ['실행', 'Executed'],
  'cui.edge.noValue': ['(없음)', '(none)'],

  // 실행 계획 (ExplainModal)
  'cui.explain.planTime': ['계획 시간', 'Planning time'],
  'cui.explain.execTime': ['실행 시간', 'Execution time'],
  'cui.explain.cost': ['예상 비용', 'Estimated cost'],
  'cui.explain.rows': ['예상 행수', 'Estimated rows'],
  'cui.explain.plan': ['실행 계획', 'Execution plan'],
  'cui.explain.tuneTitle': [
    '이 계획을 근거로 AI 가 쿼리를 튜닝합니다',
    'AI tunes the query based on this plan',
  ],
  'cui.explain.tuneClose': ['AI 튜닝 닫기', 'Close AI tuning'],
  'cui.explain.tune': ['AI 튜닝', 'AI tuning'],
  'cui.explain.note1': [
    '추정 계획입니다. 실제 실행 시간·행수를 보려면 ',
    'This is an estimated plan. To see actual execution times and row counts, use ',
  ],
  'cui.explain.noteAnalyze': ['성능 분석(EXPLAIN ANALYZE)', 'Analyze (EXPLAIN ANALYZE)'],
  'cui.explain.note2': [' 을 쓰세요.', '.'],

  // 연합 조회 → 파이썬 스크립트 (DuckScriptModal)
  'cui.duck.title': ['파이썬 코드', 'Python code'],
  'cui.duck.genFailed': ['코드를 만들지 못했습니다.', 'Could not generate the code.'],
  'cui.duck.download': ['내려받기', 'Download'],
  'cui.duck.envsBold': ['비밀번호는 코드에 없습니다.', 'Passwords are not in the code.'],
  'cui.duck.envsRest': [
    '돌리기 전에 환경변수를 설정하세요 —',
    'Set these environment variables before running —',
  ],
  'cui.duck.generating': ['코드를 만드는 중…', 'Generating code…'],

  // API 트리거 테스트 실행 (TestRunModal)
  'cui.test.title': ['테스트 실행', 'Test run'],
  'cui.test.jsonTopLevel': [
    '최상위는 객체여야 합니다 — { "이름": 값 } 형태',
    'Top level must be an object — { "name": value }',
  ],
  'cui.test.jsonInvalid': ['JSON 을 해석할 수 없습니다', 'Cannot parse the JSON'],
  'cui.test.runFailed': ['실행에 실패했습니다', 'Run failed'],
  'cui.test.scopeLabel': ['어디까지 실행할까요', 'How far should this run?'],
  'cui.test.scopeTrigger': ['값 확인만 (트리거)', 'Check values only (trigger)'],
  'cui.test.scopeUpTo': ['{label} 까지 (부분 실행)', 'Up to {label} (partial run)'],
  'cui.test.scopeFull': ['파이프라인 전체 (실제 적재)', 'Whole pipeline (real load)'],
  'cui.test.hintTrigger': [
    '데이터를 옮기지 않고, 받은 값이 다음 노드 설정에 어떻게 꽂히는지만 보여줍니다. 하류 노드 설정이 비어 있어도 됩니다.',
    'Moves no data — only shows how the received values plug into the next node settings. Downstream node settings may be left empty.',
  ],
  'cui.test.hintFull': [
    '타깃까지 실제로 적재합니다. 파이프라인 전체가 검증을 통과해야 합니다.',
    'Actually loads into the targets. The whole pipeline must pass validation.',
  ],
  'cui.test.hintPartial': [
    '그 노드까지 실제로 돌려 출력을 훑습니다 (적재 없음, 워터마크 미변경). 그 노드의 연결·테이블 설정이 갖춰져 있어야 합니다.',
    "Actually runs up to that node and inspects its output (no load, watermark unchanged). That node's connection and table settings must be in place.",
  ],
  'cui.test.noVars': [
    '선언된 입력 변수가 없습니다. 값 없이 그대로 실행합니다 — 값을 받으려면 API 트리거 노드 설정에서 변수를 추가하세요.',
    'No input variables are declared. Runs as-is with no values — to receive values, add variables in the API trigger node settings.',
  ],
  'cui.test.modeAria': ['값 입력 방식', 'Value input mode'],
  'cui.test.modeForm': ['폼으로 입력', 'Form input'],
  'cui.test.modeJson': ['JSON 붙여넣기', 'Paste JSON'],
  'cui.test.typeString': ['문자', 'String'],
  'cui.test.typeNumber': ['숫자', 'Number'],
  'cui.test.typeBoolean': ['참/거짓', 'True/false'],
  'cui.test.optional': ['선택', 'optional'],
  'cui.test.jsonLabel': ['호출 본문 (JSON)', 'Call body (JSON)'],
  'cui.test.payloadLabel': ['실제로 보낼 값', 'Values to be sent'],
  'cui.test.missing': [
    '필수 값이 비어 있습니다: {names}',
    'Required values are empty: {names}',
  ],

  // 실시간 동기화 착수 점검 (SyncPreflightModal) — 점검 항목의 label/detail 은 서버 문구라 손대지 않는다
  'cui.sync.title': ['실시간 동기화 착수 점검', 'Real-time sync preflight check'],
  'cui.sync.checking': [
    '원본을 점검하는 중입니다 — 읽기만 하므로 아무것도 바뀌지 않습니다.',
    'Checking the source — read-only, nothing changes.',
  ],
  'cui.sync.source': ['소스', 'Source'],
  'cui.sync.target': ['타깃', 'Target'],
  'cui.sync.tableCount': ['대상 테이블 {n}개', '{n} target table{n||s}'],
  'cui.sync.thTable': ['테이블', 'Table'],
  'cui.sync.thChannel': ['채널', 'Channel'],
  'cui.sync.thExists': ['존재', 'Exists'],
  'cui.sync.thPk': ['기본키', 'Primary key'],
  'cui.sync.pkNote': [
    '기본키가 없으면 갱신·삭제를 어느 행에 적용할지 정할 수 없어 동기화가 성립하지 않습니다. 기본키를 추가하거나 대상에서 빼세요.',
    'Without a primary key there is no way to tell which row an update or delete applies to, so sync cannot work. Add a primary key or remove the table from the targets.',
  ],
  'cui.sync.warn1': ['시작하면 ', 'Starting will '],
  'cui.sync.warnBold': ['원본 테이블에 트리거가 생깁니다.', 'create triggers on the source tables.'],
  'cui.sync.warn2': [
    ' 쓰기 트랜잭션이 느려지고, 변경분이 원본 DB 의 SYM_DATA 에 쌓입니다. 전송이 밀리면 원본 용량이 늘어나므로 모니터에서 미전송 건수를 지켜보세요.',
    ' Write transactions slow down, and changes pile up in SYM_DATA on the source DB. If delivery falls behind, source storage grows — watch the pending count in Monitor.',
  ],
  'cui.sync.unmet': ['확인이 필요한 항목 {n}건', '{n} item{n||s} need{n|s|} review'],
  'cui.sync.startTitle': [
    '원본에 트리거를 심고 동기화를 시작합니다',
    'Plants triggers on the source and starts sync',
  ],
  'cui.sync.blockedTitle': [
    '통과하지 못한 점검이 있어 시작할 수 없습니다',
    'Cannot start — some checks did not pass',
  ],
  'cui.sync.start': ['동기화 시작', 'Start sync'],

  // 메모·그룹 (MemoNode · GroupNode)
  'cui.memo.dragTitle': ['드래그해 이동', 'Drag to move'],
  'cui.memo.placeholder': ['메모를 입력하세요…', 'Type a memo…'],
  'cui.group.titlePlaceholder': ['영역 제목', 'Frame title'],

  // 노드 카드 (EaiNode)
  'cui.node.statusDone': ['완료', 'Done'],
  'cui.node.statusSkipped': ['건너뜀', 'Skipped'],
  'cui.node.ready': ['준비', 'Ready'],
  'cui.node.cronUnset': ['cron 미설정', 'cron not set'],
  'cui.node.buttonRun': ['버튼 실행', 'Button run'],
  'cui.node.customQuery': ['커스텀 쿼리', 'Custom query'],
  'cui.node.noTable': ['테이블 미지정', 'No table set'],
  'cui.node.incremental': ['{table} · 증분', '{table} · incremental'],
  'cui.node.connFolder': ['연결 폴더', 'Connection folder'],
  'cui.node.noPath': ['경로 미지정', 'No path set'],
  'cui.node.condCount': ['조건 {n}개', '{n} condition{n||s}'],
  'cui.node.noCond': ['조건 없음', 'No conditions'],
  'cui.node.codeLines': ['코드 {n}줄', '{n} line{n||s} of code'],
  'cui.node.noCode': ['코드 없음', 'No code'],
  'cui.node.caseCount': ['분기 {n}개 + 그 외', '{n} branch{n||es} + otherwise'],
  'cui.node.noCase': ['분기 없음', 'No branches'],
  'cui.node.mapCount': ['매핑 {n}개', '{n} mapping{n||s}'],
  'cui.node.noMap': ['매핑 없음', 'No mappings'],
  'cui.node.inTitle': ['입구 — 여기로 값이 들어옵니다', 'Inlet — values come in here'],
  'cui.node.testRunTitle': [
    '테스트 실행 — 값을 채워 파이프라인 전체를 돌립니다',
    'Test run — fill in values and run the whole pipeline',
  ],
  'cui.node.runOneTitle': [
    '이 노드만 실행 (그 노드까지 필요한 상류만)',
    'Run this node only (with just the upstream it needs)',
  ],
  'cui.node.recordsTitle': ['이 노드가 내놓은 값 보기', 'View what this node produced'],
  'cui.node.outBranchTitle': [
    '출구 ({label}) — 이 분기의 값이 나갑니다',
    "Outlet ({label}) — this branch's values go out",
  ],
  'cui.node.outTitle': [
    '출구 — 이 노드의 결과값이 나갑니다',
    "Outlet — this node's results go out",
  ],

  // Python 코드 편집 팝업 (PyCodeEditor)
  'cui.py.title': ['Python 전처리 코드', 'Python preprocessing code'],
  'cui.py.hint1': [
    ' 는 각 레코드마다 호출됩니다(None 반환 시 제외). 전체 행을 한 번에 다루려면 ',
    ' is called for each record (rows are dropped when it returns None). To process all rows at once, define ',
  ],
  'cui.py.hint2': [
    ' 를 정의하세요 — pandas DataFrame 을 받아 DataFrame 을 반환합니다(둘 중 하나만). 코드는 격리된 프로세스에서 실행됩니다 — DB·시크릿·네트워크에 접근할 수 없고, ',
    ' — it takes a pandas DataFrame and returns a DataFrame (define only one of the two). Code runs in an isolated process — no access to DBs, secrets, or the network; ',
  ],
  'cui.py.hint3': [
    ' 및 표준 모듈 일부를 쓸 수 있습니다.',
    ' and a subset of the standard library are available.',
  ],
  'cui.py.done': ['완료', 'Done'],
} as const
