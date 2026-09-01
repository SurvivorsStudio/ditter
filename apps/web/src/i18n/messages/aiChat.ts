/** aiChat 문구 — AI 챗 탭(AiChatPane) · 인라인 프롬프트(AiInlinePrompt).
 *  값은 [한국어, 영어] 쌍이다. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다. */
export const aiChat = {
  // ── 빈 상태 · AI 연결 등록 안내 ──
  'chat.noAiTitle': ['등록된 AI 연결이 없습니다', 'No AI connection registered'],
  'chat.noAiDesc': [
    '「연결 관리」에서 AI 모델(Gemini)을 먼저 등록하세요.',
    'Register an AI model (Gemini) in Connections first.',
  ],
  'chat.registerAi': ['AI 모델 등록하기', 'Register an AI model'],
  'chat.inlineNoAi': ['등록된 AI 연결이 없습니다.', 'No AI connection registered.'],

  // ── 대상 DB · 모델 선택 ──
  'chat.noDbTarget': ['대상 DB 없음', 'No target DB'],
  'chat.plainSql': ['일반 SQL', 'Generic SQL'],
  'chat.targetDb': ['대상 DB', 'Target DB'],
  'chat.aiModel': ['AI 모델', 'AI model'],

  // ── 추천 시작 프롬프트 (클릭 즉시 전송 — 사용자가 보는 프롬프트라 번역한다) ──
  'chat.suggestTablesLabel': ['테이블 목록 보기', 'List tables'],
  'chat.suggestTablesPrompt': [
    '이 데이터베이스에 어떤 테이블들이 있는지 목록을 보여줘',
    'Show me a list of the tables in this database',
  ],
  'chat.suggestSchemaLabel': ['테이블 구조 설명', 'Explain table structures'],
  'chat.suggestSchemaPrompt': [
    '주요 테이블의 컬럼 구조와 의미를 설명해줘',
    'Explain the column structure and meaning of the main tables',
  ],
  'chat.suggestIdeasLabel': ['분석 아이디어 추천', 'Suggest analysis ideas'],
  'chat.suggestIdeasPrompt': [
    '이 데이터베이스로 할 수 있는 유용한 분석을 추천해줘',
    'Recommend useful analyses I could run on this database',
  ],

  // ── 초기 힌트 ──
  'chat.emptyHint': [
    '자연어로 물어보세요. 예: “최근 7일 주문을 고객별로 합계 내줘”.',
    'Ask in natural language. e.g. “Total the last 7 days of orders by customer”.',
  ],
  'chat.emptyHintDb': [
    '대상 DB 를 고르면 스키마에 맞춘 SQL 을 만듭니다.',
    'Pick a target DB to generate SQL matched to its schema.',
  ],

  // ── 호출 실패 ──
  'chat.callFailed': ['AI 호출에 실패했습니다.', 'The AI call failed.'],
  'chat.runFailed': [
    '쿼리 실행에 실패해 해석할 수 없습니다: {error}',
    'Cannot interpret — the query failed to run: {error}',
  ],

  // ── 결과 기반 작업 — AI 에 보내는 사용자 메시지 (사용자에게도 보인다) ──
  'chat.askInterpret': ['결과를 해석해 주세요.', 'Please interpret the result.'],
  'chat.askChart': [
    '이 결과를 가장 잘 드러내는 차트로 표현해 주세요.',
    'Please express this result as the chart that shows it best.',
  ],
  'chat.askReport': [
    '이 결과로 분석 보고서를 작성해 주세요.',
    'Please write an analysis report from this result.',
  ],
  'chat.runIntro': [
    '방금 실행한 SQL 과 그 결과입니다. {ask}',
    'Here is the SQL I just ran and its result. {ask}',
  ],
  'chat.runResultHead': ['실행 결과 ({rows}행{total}):', 'Result ({rows} row{rows||s}{total}):'],
  'chat.runTotalNote': [' / 총 {n}행', ' / {n} rows total'],
  'chat.tableTruncRows': ['(상위 {n}행만 표시)', '(showing top {n} rows only)'],
  'chat.tableTruncCols': ['(앞 {n}개 컬럼만 표시)', '(showing first {n} columns only)'],
  'chat.tableEmpty': [
    '(결과 0행 — 조건에 맞는 데이터가 없습니다)',
    '(0 rows — no data matched the conditions)',
  ],

  // ── @멘션 자동완성 ──
  'chat.pickDbFirst': ['대상 DB 를 먼저 고르세요', 'Pick a target DB first'],
  'chat.mentionLoading': ['스키마 불러오는 중…', 'Loading schema…'],
  'chat.mentionError': ['스키마를 불러오지 못했습니다', 'Failed to load the schema'],
  'chat.mentionNone': ['일치하는 항목이 없습니다', 'No matching items'],
  'chat.kindTable': ['테이블', 'Table'],
  'chat.kindColumn': ['컬럼', 'Column'],
  'chat.colCount': ['{n}열', '{n} column{n||s}'],

  // ── 입력창 · 하단 바 ──
  'chat.inputTune': ['튜닝할 SQL 과 요청을 적어주세요…', 'Paste the SQL to tune and your request…'],
  'chat.inputGenerate': [
    'SQL 로 만들 내용을 적어주세요… (@ 로 테이블·컬럼 참조 · Enter 전송)',
    'Describe what to turn into SQL… (@ to reference tables/columns · Enter to send)',
  ],
  'chat.generate': ['생성', 'Generate'],
  'chat.tune': ['튜닝', 'Tune'],
  'chat.samplesTitle': [
    '예시 데이터 {state} — 언급한 테이블의 실제 행을 AI 에 보내 정확도를 높입니다(데이터가 전송됩니다)',
    'Sample data {state} — sends real rows from mentioned tables to the AI for accuracy (data is transmitted)',
  ],
  'chat.on': ['켜짐', 'on'],
  'chat.off': ['꺼짐', 'off'],
  'chat.clear': ['대화 비우기', 'Clear conversation'],
  'chat.sendTitle': ['전송 (Enter)', 'Send (Enter)'],

  // ── 진행 단계 (AiProgress) ──
  'chat.stepRunningQuery': ['쿼리 실행 중', 'Running the query'],
  'chat.stepPreparing': ['요청 준비 중', 'Preparing the request'],
  'chat.stepCollectResult': ['실행 결과 정리 중', 'Organizing the result'],
  'chat.stepSchema': ['스키마 문맥 구성 중', 'Building schema context'],
  'chat.stepSamples': ['예시 데이터 읽는 중', 'Reading sample data'],
  'chat.stepAsking': ['AI 모델에 질의 중', 'Querying the AI model'],
  'chat.stepInterpreting': ['결과 해석 중', 'Interpreting the result'],
  'chat.stepGenerating': ['응답 생성 중', 'Generating the response'],

  // ── 말풍선 액션 ──
  'chat.otherOption': ['기타 — 직접 입력', 'Other — type your own'],
  'chat.otherPlaceholder': ['직접 답변을 입력하세요…', 'Type your answer…'],
  'chat.send': ['보내기', 'Send'],
  'chat.copied': ['복사됨', 'Copied'],
  'chat.copy': ['복사', 'Copy'],
  'chat.openTab': ['새 쿼리 탭', 'New query tab'],
  'chat.openTabTitle': ['새 쿼리 탭에서 실행', 'Run in a new query tab'],
  'chat.interpret': ['결과 해석', 'Interpret result'],
  'chat.interpretTitle': [
    '이 SQL 을 실행하고 결과를 AI 가 해석합니다',
    'Runs this SQL and has the AI interpret the result',
  ],
  'chat.chart': ['차트', 'Chart'],
  'chat.chartTitle': [
    '이 SQL 을 실행하고 결과를 차트로 그립니다',
    'Runs this SQL and charts the result',
  ],
  'chat.report': ['보고서', 'Report'],
  'chat.reportTitle': [
    '이 SQL 을 실행하고 결과로 보고서를 작성합니다',
    'Runs this SQL and writes a report from the result',
  ],

  // ── 인라인 프롬프트 (/aiQuery) ──
  'chat.inlineTitle': ['SQL 생성', 'Generate SQL'],
  'chat.inlineContinue': ['이어서 답하거나 더 구체적으로…', 'Answer back or be more specific…'],
  'chat.inlinePlaceholder': [
    '만들 SQL 을 자연어로… @ 로 테이블, 이후 . 로 컬럼 (Enter 생성 · Shift+Enter 줄바꿈)',
    'Describe the SQL in natural language… @ for tables, then . for columns (Enter to generate · Shift+Enter for newline)',
  ],
  'chat.generating': ['생성 중…', 'Generating…'],
  'chat.inlineHintDb': [
    '이 탭의 연결 스키마에 맞춰 만듭니다. @ 로 테이블, 이후 . 로 컬럼을 자동완성합니다.',
    "Generates against this tab's connection schema. @ autocompletes tables, then . their columns.",
  ],
  'chat.inlineHintNoDb': [
    '대상 연결이 없어 일반 SQL 로 만듭니다.',
    'No target connection — generates generic SQL.',
  ],
} as const
