/** sqlPage 화면 문구 — SQL 편집기 페이지의 탭·도크·워크스페이스 크롬.
 *  값은 [한국어, 영어] 쌍이다. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다.
 *
 *  「연합 조회」 라는 이름 자체는 여기 없다 — `connMarker.DUCK_MARKER_NAME` 이
 *  두 언어 공통의 고정 표기(마커·드롭다운 프로토콜 값)라 번역하지 않는다. */
export const sqlPage = {
  // ---- 특수 탭 라벨 · 탭 바 ----
  'sqlPage.tabConnections': ['연결', 'Connections'],
  'sqlPage.tabSaved': ['저장됨', 'Saved'],
  'sqlPage.tabFavorites': ['즐겨찾기', 'Favorites'],
  'sqlPage.tabAi': ['AI 어시스턴트', 'AI Assistant'],
  'sqlPage.specialTabTip': ['{label} — 드래그해서 이동/분할', '{label} — drag to move or split'],
  'sqlPage.closeTab': ['탭 닫기', 'Close tab'],
  'sqlPage.newQueryTabTip': ['새 쿼리 탭 (Alt+T)', 'New query tab (Alt+T)'],
  'sqlPage.newQueryTab': ['새 쿼리 탭', 'New query tab'],
  'sqlPage.splitRightTip': ['오른쪽으로 분할', 'Split to the right'],
  'sqlPage.split': ['분할', 'Split'],

  // 새 탭의 기본 이름 — 생성 시점에 번역되어 세션에 저장된다(그 뒤로는 데이터).
  'sqlPage.queryTabTitle': ['쿼리 {n}', 'Query {n}'],
  'sqlPage.aiChatTitle': ['AI 챗', 'AI Chat'],

  // ---- 연결 선택 · 허용 명령 태그 ----
  'sqlPage.connSelectTitle': ['이 탭이 조회할 연결', 'Connection this tab queries'],
  'sqlPage.connSelectPlaceholder': ['연결 선택…', 'Select a connection…'],
  'sqlPage.duckOptionHint': ['여러 연결', 'Multiple connections'],
  'sqlPage.stmtSelectAlwaysOn': ['조회는 항상 켜져 있습니다', 'SELECT is always on'],
  'sqlPage.stmtMutedTip': [
    '{name} 를 꺼 두었습니다 — 눌러서 다시 켭니다',
    '{name} is muted — click to re-enable it',
  ],
  'sqlPage.stmtOnTip': [
    '{name} 를 실행할 수 있습니다 — 눌러서 잠시 끕니다 (실수 방지)',
    '{name} is allowed — click to mute it for now (mistake guard)',
  ],

  // ---- 편집기 ↔ 노트북 전환 ----
  'sqlPage.toEditorTip': ['단일 편집기로 전환', 'Switch to the single editor'],
  'sqlPage.toNotebookTip': ['노트북(블록)으로 전환', 'Switch to notebook (blocks)'],
  'sqlPage.viewEditor': ['편집기', 'Editor'],
  'sqlPage.viewNotebook': ['노트북', 'Notebook'],

  // ---- 연합 조회(duck) 툴바 ----
  'sqlPage.duckPyTip': [
    '이 조회를 그대로 돌릴 수 있는 파이썬 코드로 — 노트북·배치로 옮길 때',
    'Turn this query into runnable Python — for moving it to a notebook or batch job',
  ],
  'sqlPage.duckSyntaxTip': [
    '여러 연결의 테이블을 한 SQL 로 조회합니다',
    'Query tables from multiple connections in a single SQL statement',
  ],
  'sqlPage.duckSyntax': ['연결이름.데이터베이스[.스키마].테이블', 'connection.database[.schema].table'],
  'sqlPage.duckNotAttachable': [
    '「{name}」 은(는) 연합 조회에 쓸 수 없습니다 (MySQL·PostgreSQL·SQL Server 만).',
    '"{name}" cannot be used in 연합 조회 (MySQL·PostgreSQL·SQL Server only).',
  ],

  // ---- 파이프라인(캔버스) 탭 ----
  'sqlPage.canvasSingleTab': [
    '캔버스는 한 번에 한 탭에서만 편집할 수 있습니다',
    'The canvas can be edited in only one tab at a time',
  ],
  'sqlPage.canvasOwnedByPre': ['— 지금은 ', '— the '],
  'sqlPage.canvasOwnedByPost': [' 탭이 쓰고 있습니다', ' tab is using it now'],
  'sqlPage.editHere': ['여기서 편집', 'Edit here'],
  'sqlPage.canvasDirtyConfirm': [
    '「{tab}」 탭에 저장하지 않은 변경이 있습니다.\n버리고 여기서 편집할까요?',
    '"{tab}" tab has unsaved changes.\nDiscard them and edit here?',
  ],
  'sqlPage.otherPipeline': ['다른 파이프라인', 'another pipeline'],
  'sqlPage.createPipelineFailed': ['파이프라인을 만들지 못했습니다', 'Failed to create the pipeline'],

  // ---- AI 탭으로 이어가기 (씨앗 대화 — 챗 화면에 사용자 메시지로 보인다) ----
  'sqlPage.aiFixPrompt': [
    '다음 쿼리에서 오류가 났어요. 고쳐 주세요.\n\n```sql\n{sql}\n```\n\n오류:\n{error}',
    'This query failed. Please fix it.\n\n```sql\n{sql}\n```\n\nError:\n{error}',
  ],
  'sqlPage.aiTunePrompt': [
    '다음 쿼리를 튜닝하고 싶어요.\n\n```sql\n{sql}\n```',
    'I want to tune this query.\n\n```sql\n{sql}\n```',
  ],
  'sqlPage.aiTuneExplain': ['\n\n실행 계획:\n{explain}', '\n\nExecution plan:\n{explain}'],

  // ---- 드롭 존 · 크기 조절 ----
  'sqlPage.dzTop': ['▲ 위쪽에 분할', '▲ Split above'],
  'sqlPage.dzLeft': ['◧ 왼쪽', '◧ Left'],
  'sqlPage.dzRight': ['오른쪽 ◨', 'Right ◨'],
  'sqlPage.dzBottom': ['▼ 아래쪽에 분할', '▼ Split below'],
  'sqlPage.colResizeTip': ['드래그해서 좌·우 크기 조절', 'Drag to resize left/right'],
  'sqlPage.rowResizeTip': ['드래그해서 위·아래 크기 조절', 'Drag to resize up/down'],

  // ---- 연결 없음 빈 화면 ----
  'sqlPage.noDbTitle': ['DB 연결이 없습니다', 'No database connections'],
  'sqlPage.noDbBodyPre': [
    'SQL 편집기는 DB 연결(MySQL · PostgreSQL · MSSQL · MongoDB)이 필요합니다. 먼저 ',
    'The SQL editor needs a database connection (MySQL · PostgreSQL · MSSQL · MongoDB). Register one in the ',
  ],
  'sqlPage.noDbBodyConn': ['연결', 'Connections'],
  'sqlPage.noDbBodyPost': [' 메뉴에서 등록하세요.', ' menu first.'],
} as const
