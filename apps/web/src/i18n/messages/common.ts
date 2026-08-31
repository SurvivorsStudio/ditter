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
  'common.rowCount': ['{n}행', '{n} row{n||s}'],
  'common.count': ['{n}건', '{n} record{n||s}'],
  'common.pipelineNamePlaceholder': ['고객 마스터 → S3 (일배치)', 'Customer master → S3 (daily batch)'],
  'common.pipelineDescPlaceholder': [
    'MySQL.customers · 증분(updated_at)',
    'MySQL.customers · incremental (updated_at)',
  ],
} as const
