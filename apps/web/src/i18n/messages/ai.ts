/** ai 문구 — AiFixPanel(AI 수정·AI 튜닝) · AiChart · AiDefaultSelect. */
export const ai = {
  // AiFixPanel — 모드별 머리·본문 (MODE_CFG)
  'ai.fixTitle': ['AI 수정', 'AI Fix'],
  'ai.tuneTitle': ['AI 튜닝', 'AI Tuning'],
  'ai.fixLoading': ['오류를 분석하는 중…', 'Analyzing the error…'],
  'ai.tuneLoading': ['실행 계획을 분석하는 중…', 'Analyzing the execution plan…'],
  'ai.fixApply': ['편집기에 적용', 'Apply to editor'],
  'ai.tuneApply': ['튜닝된 쿼리 적용', 'Apply tuned query'],

  // 모델사 칩
  'ai.vendorsAria': ['모델사', 'AI vendors'],
  'ai.vendorActiveTitle': [
    '{name} · 지금 이 모델사로 실행되었습니다',
    '{name} · this vendor produced the current answer',
  ],
  'ai.vendorRerunTitle': ['{name} 로 다시 분석', 'Re-analyze with {name}'],

  // 빈 상태·오류 폴백
  'ai.registerFirst': [
    '「연결 관리」에서 AI 모델(Gemini·Bedrock)을 먼저 등록하세요.',
    'Register an AI model (Gemini·Bedrock) in Connections first.',
  ],
  'ai.callFailed': ['AI 호출에 실패했습니다.', 'The AI call failed.'],
  'ai.perfAnalyzeFailed': [
    '튜닝 쿼리 성능 분석에 실패했습니다.',
    'Failed to analyze the tuned query performance.',
  ],

  // 기본 모델사 변경 안내 — <b>이름</b> 을 사이에 끼우므로 앞뒤로 가른다
  'ai.defaultChangedPrefix': ['기본 모델사가 ', 'The default vendor changed to '],
  'ai.defaultChangedSuffix': [
    '(으)로 바뀌었습니다. 지금 답은 이전 모델사의 것입니다.',
    '. The current answer is from the previous vendor.',
  ],
  'ai.otherConn': ['다른 연결', 'another connection'],
  'ai.reanalyze': ['다시 분석', 'Re-analyze'],
  'ai.dismissNotice': ['이 안내 닫기', 'Dismiss this notice'],

  // 결과 액션
  'ai.applyTitle': [
    '결과 쿼리를 편집기에 넣습니다(되돌리기 가능)',
    'Insert the resulting query into the editor (undoable)',
  ],
  'ai.escalate': ['AI 탭에서 이어가기', 'Continue in AI tab'],
  'ai.escalateTitle': [
    'AI 어시스턴트 탭에서 대화로 이어갑니다',
    'Continue as a conversation in the AI assistant tab',
  ],
  'ai.perfCompare': ['성능 비교', 'Compare performance'],
  'ai.perfCompareTitle': [
    '튜닝된 쿼리를 EXPLAIN ANALYZE 로 재보고 원본과 비교합니다',
    'Re-run the tuned query with EXPLAIN ANALYZE and compare with the original',
  ],
  'ai.analyzing': ['분석 중…', 'Analyzing…'],
  'ai.again': ['다시', 'Again'],

  // 성능 비교 카드 (PerfCompare)
  'ai.slower': ['느려짐', 'slower'],
  'ai.grew': ['늘어남', 'higher'],
  'ai.noChange': ['변화 없음', 'No change'],
  'ai.perfAsis': ['AS-IS (원본)', 'AS-IS (original)'],
  'ai.perfTobe': ['TO-BE (튜닝)', 'TO-BE (tuned)'],
  'ai.perfImprove': ['개선', 'Improvement'],
  'ai.perfTime': ['실행 시간', 'Execution time'],
  'ai.perfCost': ['예상 비용', 'Estimated cost'],
  // 안내문도 <b>…</b> 를 끼우므로 세 토막이다
  'ai.perfNotePrefix': ['원본을 ', 'Run the original with '],
  'ai.perfNoteBold': ['성능 분석(EXPLAIN ANALYZE)', 'performance analysis (EXPLAIN ANALYZE)'],
  'ai.perfNoteSuffix': [
    ' 으로 실행하면 실제 실행 시간까지 비교됩니다',
    ' to compare actual execution times as well',
  ],
  'ai.perfNoteEstimated': [
    ' (지금은 추정 계획이라 비용만 비교).',
    ' (currently an estimated plan, so only costs are compared).',
  ],

  // AiChart — 이름 없는 계열의 폴백 라벨
  'ai.seriesN': ['계열 {n}', 'Series {n}'],

  // AiDefaultSelect
  'ai.defaultSelectTitle': [
    'AI 기본 연결 — 이 브라우저의 AI 어시스턴트·AI 수정·AI 튜닝이 이 연결로 답합니다',
    'Default AI connection — the AI assistant, AI Fix, and AI Tuning in this browser answer with this connection',
  ],
  'ai.connPlaceholder': ['AI 연결', 'AI connection'],
} as const
