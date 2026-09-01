/** notebook 문구 — components/Notebook.tsx · NotebookAi.tsx.
 *  값은 [한국어, 영어] 쌍이다. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다.
 *
 *  주의: 셀 직렬화 마커(`/*md … *​/`, `-- @conn "…"`)와 `연합 조회`(DUCK_MARKER_NAME)는
 *  프로토콜 값이라 여기 없다 — 번역 대상이 아니다. */
export const notebook = {
  // 마크다운(메모) 셀
  'nb.mdEmpty': ['빈 메모 — 더블클릭하면 편집', 'Empty note — double-click to edit'],
  'nb.mdPlaceholder': [
    '# 메모 (마크다운) — **굵게**, `코드`, - 목록',
    '# Note (markdown) — **bold**, `code`, - list',
  ],
  'nb.mdEditHint': ['더블클릭(또는 Enter)하면 편집', 'Double-click (or Enter) to edit'],
  'nb.preview': ['미리보기', 'Preview'],
  'nb.edit': ['편집', 'Edit'],

  // 셀 연결 칩 (라벨은 표시 전용 — 마커에 쓰이는 이름 자체는 번역하지 않는다)
  'nb.defaultConn': ['기본 연결', 'Default connection'],
  'nb.tabSetting': ['탭 설정', 'tab setting'],
  'nb.multiConn': ['여러 연결', 'multiple connections'],
  'nb.missingConn': ['없는 연결', 'missing connection'],
  'nb.runsAs': ['이 셀은 「{name}」 으로 실행됩니다', 'This cell runs against "{name}"'],
  'nb.followsDefault': ['기본 연결({name})을 따릅니다', 'Follows the default connection ({name})'],

  // 셀 접기·도구
  'nb.expand': ['펼치기', 'Expand'],
  'nb.collapse': ['접기', 'Collapse'],
  'nb.expandCell': ['셀 펼치기', 'Expand cell'],
  'nb.collapseCell': ['셀 접기', 'Collapse cell'],
  'nb.cancelRun': ['실행 취소', 'Cancel run'],
  'nb.runShortcut': ['실행 (⌘/Ctrl+Enter)', 'Run (⌘/Ctrl+Enter)'],
  'nb.addCellBelow': ['아래에 셀 추가', 'Add cell below'],
  'nb.moveUp': ['위로', 'Move up'],
  'nb.moveDown': ['아래로', 'Move down'],
  'nb.duplicate': ['복제', 'Duplicate'],
  'nb.delete': ['삭제', 'Delete'],
  'nb.duckPlaceholder': [
    'SELECT * FROM 연결이름.데이터베이스.테이블 …',
    'SELECT * FROM connection.database.table …',
  ],

  // 실행 결과
  'nb.running': ['실행 중…', 'Running…'],
  'nb.executed': ['실행됨', 'Executed'],
  'nb.affected': ['{n}행 적용', '{n} row{n||s} affected'],
  'nb.totalRows': ['{n} 행', '{n} row{n||s}'],
  'nb.loaded': ['{n} 로드됨', '{n} loaded'],
  'nb.runFailed': ['실행에 실패했습니다.', 'The run failed.'],
  'nb.loadAllFailed': ['전체 로드에 실패했습니다.', 'Failed to load all rows.'],
  'nb.copyJson': ['JSON 복사', 'Copy JSON'],
  'nb.copyTsv': [
    '표(TSV) 복사 — 엑셀·시트에 붙여넣기',
    'Copy table (TSV) — paste into Excel/Sheets',
  ],
  'nb.copied': ['복사됨', 'Copied'],
  'nb.copy': ['복사', 'Copy'],
  'nb.stopLoad': ['중단', 'Stop'],
  'nb.loadAllTitle': ['전체 데이터를 모두 불러옵니다', 'Loads every remaining row'],
  'nb.loadAll': ['전체 로드', 'Load all'],
  'nb.viewTable': ['표로 보기', 'View as table'],
  'nb.viewJson': ['JSON 으로 보기', 'View as JSON'],
  'nb.viewChart': ['차트로 보기', 'View as chart'],
  'nb.colFilter': ['컬럼 필터', 'Column filters'],
  'nb.sortHint': ['클릭하면 정렬 (오름 → 내림 → 해제)', 'Click to sort (asc → desc → off)'],
  'nb.filterPlaceholder': ['필터…', 'Filter…'],
  'nb.aiFixTitle': [
    '수행된 쿼리와 오류를 AI 가 보고 고칩니다',
    'AI looks at the executed query and its error, then fixes it',
  ],
  'nb.aiFix': ['AI로 고치기', 'Fix with AI'],
  'nb.loadingMore': ['더 불러오는 중…', 'Loading more…'],
  'nb.loadMoreHint': ['스크롤하거나 눌러 더 불러오기', 'Scroll or click to load more'],
  'nb.noRows': ['결과 행이 없습니다.', 'No result rows.'],

  // 노트북 툴바
  'nb.addSqlCellTitle': ['SQL 셀 추가', 'Add an SQL cell'],
  'nb.sqlCell': ['SQL 셀', 'SQL cell'],
  'nb.addMdCellTitle': ['메모 셀 추가', 'Add a note cell'],
  'nb.mdCell': ['메모 셀', 'Note cell'],
  'nb.runAllTitle': ['모든 SQL 셀 실행', 'Run every SQL cell'],
  'nb.runAll': ['전체 실행', 'Run all'],
  'nb.resetTitle': [
    '세션 초기화 — 실행 번호와 모든 셀 출력을 지웁니다',
    'Reset session — clears run numbers and every cell output',
  ],
  'nb.reset': ['세션 초기화', 'Reset session'],
  'nb.saveTitle': [
    '저장 (⌘/Ctrl+S) — 셀을 하나의 쿼리로 저장',
    'Save (⌘/Ctrl+S) — saves the cells as one query',
  ],
  'nb.save': ['저장', 'Save'],
  'nb.shortcutsTitle': [
    'Shift+Enter 실행·다음 · ⌘/Ctrl+Enter 실행 · Alt+Enter 실행·삽입 · Esc 커맨드 · Enter 편집 · A/B 위·아래 추가 · DD 삭제 · M/Y 메모·코드 · Z 되돌리기',
    'Shift+Enter run·next · ⌘/Ctrl+Enter run · Alt+Enter run·insert · Esc command · Enter edit · A/B add above·below · DD delete · M/Y note·code · Z undo',
  ],
  'nb.shortcuts': ['단축키 ⓘ', 'Shortcuts ⓘ'],
  'nb.emptyHint': [
    '셀이 없습니다. 아래에서 SQL 또는 메모 셀을 추가하세요.',
    'No cells yet. Add an SQL or note cell below.',
  ],

  // 셀 AI 챗 (NotebookAi.tsx)
  'nb.ai.title': ['AI 어시스턴트', 'AI assistant'],
  'nb.ai.convCount': ['{n}개 대화', '{n} conversation{n||s}'],
  'nb.ai.model': ['AI 모델', 'AI model'],
  'nb.ai.clear': ['대화 비우기', 'Clear conversation'],
  'nb.ai.close': ['AI 챗 닫기', 'Close AI chat'],
  'nb.ai.failed': ['AI 호출에 실패했습니다.', 'The AI call failed.'],
  'nb.ai.insertTitle': ["이 셀의 SQL 을 이 결과로 바꿉니다", "Replaces this cell's SQL with this result"],
  'nb.ai.insert': ['이 셀에 넣기', 'Insert into this cell'],
  'nb.ai.insertBelowTitle': ['아래에 새 셀을 만들어 넣습니다', 'Creates a new cell below and inserts it there'],
  'nb.ai.insertBelow': ['아래 새 셀', 'New cell below'],
  'nb.ai.generating': ['생성 중…', 'Generating…'],
  'nb.ai.editPlaceholder': ['이 SQL 을 어떻게 바꿀까요…', 'How should this SQL change…'],
  'nb.ai.newPlaceholder': ['SQL 로 만들 내용을 적어주세요…', 'Describe what to turn into SQL…'],
  'nb.ai.sendTitle': ['전송 (Enter)', 'Send (Enter)'],
} as const
