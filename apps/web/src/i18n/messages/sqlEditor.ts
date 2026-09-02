/** sqlEditor 문구 — canvas/SqlEditor.tsx (에디터·워크벤치·결과 그리드·SqlModal).
 *  값은 [한국어, 영어] 쌍이다. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다 —
 *  connCompletion.test.ts 등의 한글 단언이 그 문구를 본다.
 *
 *  「연합 조회」 라는 이름 자체는 여기 없다 — `connMarker.DUCK_MARKER_NAME` 이
 *  두 언어 공통의 고정 표기(마커·드롭다운 프로토콜 값)라 번역하지 않는다.
 *  그 이름이 문장 안에 나올 때도(en 포함) 리터럴 그대로 둔다. */
export const sqlEditor = {
  // ---- 슬래시 명령 (`/…`) ----
  'sqlEd.cmdLoadQuery': ['즐겨찾기 바로 불러오기 (이름)', 'Load a favorite inline (by name)'],
  'sqlEd.cmdLoadQueryList': ['즐겨찾기 목록 팝업', 'Favorites list popup'],
  'sqlEd.cmdAiQuery': ['AI 로 SQL 생성', 'Generate SQL with AI'],
  'sqlEd.cmdConn': [
    '이 문장만 다른 연결로 (-- @conn)',
    'Run only this statement on another connection (-- @conn)',
  ],
  'sqlEd.command': ['명령', 'Command'],

  // ---- `/conn` 연결 고르기 ----
  'sqlEd.followDefaultConn': ['기본 연결 따르기', 'Follow the default connection'],
  'sqlEd.removeMarker': ['마커 제거', 'Removes the marker'],
  'sqlEd.noConnMatch': ['일치하는 연결 없음', 'No matching connection'],

  // ---- `/loadQuery` 즐겨찾기 ----
  'sqlEd.noFavorites': ['등록된 즐겨찾기가 없습니다', 'No favorites registered'],
  'sqlEd.noFavMatch': ['일치하는 즐겨찾기 없음', 'No matching favorite'],
  'sqlEd.favorite': ['즐겨찾기', 'Favorite'],

  // ---- 자동완성 부제 ----
  'sqlEd.table': ['테이블', 'Table'],
  'sqlEd.collection': ['컬렉션', 'Collection'],
  'sqlEd.mongoFindDetail': ['{ 필터 }', '{ filter }'],
  'sqlEd.mongoAggDetail': ['[ 파이프라인 ]', '[ pipeline ]'],

  // ---- 변수 패널 ----
  'sqlEd.varTriggerHd': [
    'API 트리거 변수 — 클릭하면 삽입됩니다',
    'API trigger variables — click to insert',
  ],
  'sqlEd.varNodeHd': [
    '노드 결과 — 그 노드 첫 행의 값',
    'Node results — values from that node’s first row',
  ],
  'sqlEd.varExample': [' · 아직 실행 전이라 예시 값입니다', ' · example value — not run yet'],
  'sqlEd.varNoValue': ['값 없음', 'No value'],
  // <code>WHERE dt >= '$since'</code> 를 사이에 끼우므로 앞뒤로 가른다
  'sqlEd.varNotePre': ['따옴표는 직접 넣으세요 — ', 'Add the quotes yourself — '],
  'sqlEd.varNotePost': [
    '. 값에 따옴표·세미콜론이 있으면 실행이 거부됩니다.',
    '. Values containing quotes or semicolons are rejected at run time.',
  ],

  // ---- 실행 실패 폴백 (서버 오류 문구는 detail 그대로 표시) ----
  'sqlEd.mongoRunFailed': ['조회에 실패했습니다.', 'The query failed.'],
  'sqlEd.queryRunFailed': ['쿼리 실행에 실패했습니다.', 'Query execution failed.'],
  'sqlEd.varSubstFailed': ['변수 치환에 실패했습니다.', 'Variable substitution failed.'],
  'sqlEd.duckNoExplain': [
    '연합 조회 문장은 실행 계획을 볼 수 없습니다.',
    '연합 조회 statements cannot show an execution plan.',
  ],
  'sqlEd.explainFailed': ['실행 계획 조회에 실패했습니다.', 'Failed to fetch the execution plan.'],
  'sqlEd.exportFailed': ['내보내기에 실패했습니다.', 'Export failed.'],
  'sqlEd.loadMoreFailed': ['추가 로딩에 실패했습니다.', 'Failed to load more rows.'],

  // ---- 툴바 ----
  'sqlEd.saveTip': ['이 쿼리를 폴더에 저장 (⌘/Ctrl+S)', 'Save this query to a folder (⌘/Ctrl+S)'],
  'sqlEd.save': ['저장', 'Save'],
  'sqlEd.cancelRun': ['실행 취소', 'Cancel run'],
  'sqlEd.runTip': ['소스에서 실행 (⌘/Ctrl + Enter)', 'Run on the source (⌘/Ctrl + Enter)'],
  'sqlEd.runTipShort': ['실행 (⌘/Ctrl + Enter)', 'Run (⌘/Ctrl + Enter)'],
  'sqlEd.pickConnFirst': ['먼저 연결을 고르세요', 'Pick a connection first'],
  'sqlEd.run': ['실행', 'Run'],
  'sqlEd.runMongo': ['조회', 'Query'],
  'sqlEd.cancelRunElapsed': ['실행 취소 ({s}초 경과)', 'Cancel run ({s}s elapsed)'],
  'sqlEd.explainTip': [
    '실행 계획 (EXPLAIN) — 추정 계획만, 실행하지 않음',
    'Execution plan (EXPLAIN) — estimated plan only, does not run',
  ],
  'sqlEd.explain': ['실행 계획', 'Explain'],
  'sqlEd.analyzeTip': [
    '성능 분석 (EXPLAIN ANALYZE) — 실제 실행 후 계획+시간 (롤백됨)',
    'Performance analysis (EXPLAIN ANALYZE) — actually runs, plan + timing (rolled back)',
  ],
  'sqlEd.analyze': ['성능 분석', 'Analyze'],
  'sqlEd.fsExitTip': ['전체 화면 해제 (Esc)', 'Exit full screen (Esc)'],
  'sqlEd.fsTip': ['전체 화면으로 작성', 'Write in full screen'],
  'sqlEd.fsExit': ['전체 화면 해제', 'Exit full screen'],
  'sqlEd.fs': ['전체 화면', 'Full screen'],

  // ---- 에디터 자리표시자 (duck 예시의 「연결이름.…」 표기는 en 도 문법 안내다) ----
  'sqlEd.mongoPlaceholder': [
    'collection.find({ })   또는   collection.aggregate([ ... ])',
    'collection.find({ })   or   collection.aggregate([ ... ])',
  ],
  'sqlEd.duckPlaceholder': [
    'SELECT * FROM 연결이름.데이터베이스.테이블 …',
    'SELECT * FROM connection.database.table …',
  ],

  // ---- 결과 영역 ----
  'sqlEd.cancelledToast': ['실행을 취소했습니다', 'Run cancelled'],
  'sqlEd.findPlaceholder': ['결과에서 검색…', 'Search results…'],
  'sqlEd.matchCount': ['{n}개 일치', '{n} match{n||es}'],
  'sqlEd.ranOnTip': [
    '이 문장은 「{name}」 으로 실행되었습니다',
    'This statement ran on "{name}"',
  ],
  'sqlEd.perStmtConn': ['문장별 연결', 'Per-statement connection'],
  'sqlEd.varsSubstituted': ['변수 치환됨', 'Variables substituted'],
  'sqlEd.aiFixTip': [
    '수행된 쿼리와 오류를 AI 가 보고 고칩니다',
    'AI reads the executed query and its error, then fixes it',
  ],
  'sqlEd.aiFix': ['AI로 고치기', 'Fix with AI'],
  'sqlEd.executed': ['실행했습니다', 'Executed'],
  'sqlEd.rowsApplied': ['{n}행이 적용되었습니다', 'Applied to {n} row{n||s}'],
  'sqlEd.sortFilterHint': ['전체 데이터 기준 정렬·필터', 'Sort/filter over the full dataset'],
  'sqlEd.viewModeAria': ['결과 보기 방식', 'Result view mode'],
  'sqlEd.filterTip': ['컬럼별 필터 (전체 데이터 기준)', 'Per-column filters (full dataset)'],
  'sqlEd.filter': ['필터', 'Filter'],
  'sqlEd.exportTip': ['결과를 파일로 저장 (전체 데이터)', 'Save results to a file (full dataset)'],
  'sqlEd.saving': ['저장 중…', 'Saving…'],
  'sqlEd.exportFormat': ['파일 형식', 'File format'],
  'sqlEd.fmtCsv': ['엑셀·범용', 'Excel · general'],
  'sqlEd.fmtJson': ['구조 보존', 'Preserves structure'],
  'sqlEd.fmtTxt': ['탭 구분(TSV)', 'Tab-separated (TSV)'],
  'sqlEd.noRows': ['결과 행이 없습니다.', 'No result rows.'],
  'sqlEd.sortTip': ['클릭하면 정렬 (오름 → 내림 → 해제)', 'Click to sort (asc → desc → off)'],
  'sqlEd.colResizeTip': [
    '드래그해서 폭 조절 · 더블클릭하면 초기화',
    'Drag to resize · double-click to reset',
  ],
  'sqlEd.filterPlaceholder': ['필터…', 'Filter…'],
  'sqlEd.findNoRows': [
    '일치하는 행이 없습니다 (로드된 {n}행 기준)',
    'No matching rows (of {n} loaded)',
  ],
  'sqlEd.loadingMore': ['더 불러오는 중… {s}초', 'Loading more… {s}s'],
  // 전체 <b>1,234</b> 행 — 굵은 숫자를 사이에 끼우므로 앞뒤로 가른다
  'sqlEd.totalPre': ['전체 ', 'Total '],
  'sqlEd.totalPost': [' 행', ' rows'],
  'sqlEd.loadedSuffix': ['· {n} 로드됨', '· {n} loaded'],
  'sqlEd.rowCountSpaced': ['{n} 행', '{n} row{n||s}'],
  'sqlEd.stmtApplied': ['{stmt} {n}행 적용', '{stmt} applied to {n} row{n||s}'],
  'sqlEd.scrollMore': ['스크롤하면 더 불러옵니다', 'Scroll to load more'],
  // 실행 중… <b>3.5초</b> — 굵은 시간을 사이에 끼운다
  'sqlEd.runningPre': ['실행 중… ', 'Running… '],
  'sqlEd.secs': ['{s}초', '{s}s'],
  'sqlEd.emptyMongo': [
    '컬렉션.find({…}) 또는 컬렉션.aggregate([…]) 를 실행하면 여기에 표시됩니다 (⌘/Ctrl + Enter)',
    'Run collection.find({…}) or collection.aggregate([…]) to see results here (⌘/Ctrl + Enter)',
  ],
  'sqlEd.emptyResult': [
    '실행하면 결과가 여기에 표시됩니다 (⌘/Ctrl + Enter)',
    'Run a query to see results here (⌘/Ctrl + Enter)',
  ],

  // ---- 컨텍스트 메뉴 · 즐겨찾기 저장 ----
  'sqlEd.ctxExplain': ['실행 계획 (EXPLAIN)', 'Execution plan (EXPLAIN)'],
  'sqlEd.ctxAnalyze': ['성능 분석 (EXPLAIN ANALYZE)', 'Performance analysis (EXPLAIN ANALYZE)'],
  'sqlEd.saveFavorite': ['즐겨찾기 저장', 'Save as favorite'],
  'sqlEd.favNamePlaceholder': ['이름 (예: 일일 집계)', 'Name (e.g. daily rollup)'],

  // ---- SqlModal ----
  'sqlEd.customSql': ['커스텀 SQL', 'Custom SQL'],
  'sqlEd.customSqlHint': [
    '커스텀 SQL 모드에서는 증분 워터마크가 적용되지 않습니다 — 전량을 읽습니다.',
    'Custom SQL mode ignores the incremental watermark — it reads everything.',
  ],
  'sqlEd.done': ['완료', 'Done'],

  // ---- 이번 배선에서 드러난 것 (사전에 없던 문구) ----
  'sqlEd.multiConn': ['여러 연결', 'Multiple connections'],
  'sqlEd.treeHint': [
    '테이블을 클릭하면 SQL 에 삽입됩니다',
    'Click a table to insert it into the SQL',
  ],
  'sqlEd.analyzing': ['분석 중…', 'Analysing…'],
  'sqlEd.splitTip': ['드래그해서 위·아래 크기 조절', 'Drag to resize top/bottom'],
} as const
