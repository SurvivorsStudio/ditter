/** 공통 UI 문구 — 버튼·모달·툴바 등 화면을 가리지 않는 것들.
 *  값은 [한국어, 영어] 쌍이다. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다 —
 *  기존 테스트의 한글 단언이 그 문구를 본다. */
export const common = {
  'common.refresh': ['새로고침', 'Refresh'],
  'common.newPipeline': ['새 파이프라인', 'New pipeline'],
  'common.close': ['닫기', 'Close'],
  'common.cancel': ['취소', 'Cancel'],
  'common.create': ['만들기', 'Create'],
  'common.name': ['이름', 'Name'],
  'common.descriptionOptional': ['설명 (선택)', 'Description (optional)'],
  'common.createFailed': ['생성에 실패했습니다', 'Failed to create'],
  'common.logoutConfirm': ['로그아웃할까요?', 'Log out?'],
  'common.logoutTitle': ['{who} — 클릭하면 로그아웃', '{who} — click to log out'],
  'common.statusDot': ['로컬 환경 · 연결됨', 'Local environment · connected'],
  'common.langToggle': ['English 로 보기', '한국어로 보기'],
  'common.untitled': ['무제', 'Untitled'],
  'common.rowCount': ['{n}행', '{n} row{n||s}'],
  'common.count': ['{n}건', '{n} record{n||s}'],
  'common.pipelineNamePlaceholder': ['고객 마스터 → S3 (일배치)', 'Customer master → S3 (daily batch)'],
  'common.pipelineDescPlaceholder': [
    'MySQL.customers · 증분(updated_at)',
    'MySQL.customers · incremental (updated_at)',
  ],

  // api/client.ts — 서버가 응답하지 못했을 때의 폴백 (서버 오류 문구는 detail 그대로 표시)
  'api.noServer': ['서버에 연결할 수 없습니다 ({base})', 'Cannot reach the server ({base})'],
  'api.requestFailed': ['요청 실패 ({status})', 'Request failed ({status})'],
  'api.badResponse': ['응답 형식이 올바르지 않습니다: {path}', 'Malformed response: {path}'],
  'api.exportFailed': ['내보내기 실패 ({status})', 'Export failed ({status})'],
} as const
