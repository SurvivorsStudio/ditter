/** connections 화면 문구. */
export const connections = {
  'connections.secretNote': [
    '🔒 연결 시크릿은 암호화되어 저장되며 화면에 다시 표시되지 않습니다',
    '🔒 Connection secrets are stored encrypted and never shown on screen again',
  ],
  'connections.title': ['연결 (Connections)', 'Connections'],
  'connections.loadFailed': [
    '연결 목록을 불러오지 못했습니다: {error}',
    'Failed to load connections: {error}',
  ],
  'connections.testBanner': ['연결 테스트: {text}', 'Connection test: {text}'],
  'connections.testOk': ['정상 · {latency}ms', 'OK · {latency}ms'],
  'connections.testFailed': ['연결 실패', 'Connection failed'],
  'connections.newOfKind': ['새 {name} 연결', 'New {name} connection'],
  'connections.deleted': ["'{name}' 을(를) 삭제했습니다.", "Deleted '{name}'."],
  'connections.deletedAffected': [
    "'{name}' 을(를) 삭제했습니다. 다음 파이프라인은 연결을 다시 지정해야 합니다: {pipelines}",
    "Deleted '{name}'. These pipelines need a new connection: {pipelines}",
  ],

  // 카드
  'connections.pool': ['풀 {n}', 'Pool {n}'],
  'connections.secretTag': ['🔒 시크릿', '🔒 Secret'],
  'connections.writeEnabled': ['쓰기 허용', 'Writes allowed'],
  'connections.stmtTitle': ['허용 명령: {list}', 'Allowed statements: {list}'],
  'connections.usageTitle': ['사용 파이프라인', 'Used by pipelines'],
  'connections.usageBtnTitle': [
    '이 연결을 사용하는 파이프라인 보기',
    'View pipelines using this connection',
  ],
  'connections.test': ['테스트', 'Test'],
  'connections.edit': ['편집', 'Edit'],
  'connections.editTitle': ['설정 편집', 'Edit settings'],
  'connections.deleteTitle': ['연결 삭제', 'Delete connection'],

  // 추가·편집 폼
  'connections.pickAgainTitle': ['커넥터 타입 다시 고르기', 'Choose a different connector type'],
  'connections.pickTypeOfCategory': ['{name} — 타입 선택', '{name} — choose a type'],
  'connections.pickType': ['커넥터 타입 선택', 'Choose a connector type'],
  'connections.editOf': ['{name} 편집', 'Edit {name}'],
  'connections.saveFailed': ['저장에 실패했습니다', 'Failed to save'],
  'connections.typeLead': [
    '연결할 시스템 종류를 고르세요. 종류에 따라 필요한 설정이 달라집니다.',
    'Choose the kind of system to connect. Required settings differ by kind.',
  ],
  'connections.namePh': ['{name} 운영', '{name} production'],
  'connections.save': ['저장', 'Save'],
  'connections.register': ['등록', 'Create'],
  'connections.missingRequired': [
    '필수 항목이 비어 있습니다: {list}',
    'Required fields are empty: {list}',
  ],
  'connections.needStatement': [
    '허용 명령을 하나 이상 선택하세요 (읽기만 하려면 SELECT).',
    'Select at least one allowed statement (SELECT for read-only).',
  ],
  'connections.keepExistingHint': [
    '비워두면 기존 값을 그대로 유지합니다.',
    'Leave empty to keep the current value.',
  ],
  'connections.secretSavedPh': [
    '●●●●●●●● 저장됨 — 바꿀 때만 입력',
    '●●●●●●●● saved — enter only to change',
  ],
  'connections.emptyDefault': ['비워두면 {value}', 'Empty = {value}'],

  // Bedrock 모델 불러오기
  'connections.pickModel': ['모델을 선택하세요', 'Select a model'],
  'connections.currentValue': ['{name} (현재)', '{name} (current)'],
  'connections.manualInput': ['직접 입력', 'Enter manually'],
  'connections.loadModels': ['모델 불러오기', 'Load models'],
  'connections.bedrockNeedCreds': [
    '먼저 리전 · Access Key ID · Secret Access Key 를 입력하세요.',
    'Enter the region, Access Key ID, and Secret Access Key first.',
  ],
  'connections.noModels': [
    '사용 가능한 모델이 없습니다 — 리전·모델 액세스 권한을 확인하세요.',
    'No models available — check the region and model access permissions.',
  ],
  'connections.modelsFailed': [
    '모델 목록을 불러오지 못했습니다.',
    'Failed to load the model list.',
  ],

  // CDC 전제조건 점검
  'connections.preflightTitle': ['CDC 전제조건 점검', 'CDC prerequisite checks'],
  'connections.preflightHint': ['실시간 소스로 쓸 준비 상태', 'Readiness as a real-time source'],
  'connections.preflightDirty': [
    '「CDC 사용」 변경은 아직 저장되지 않았습니다. 먼저 저장한 뒤 점검하세요.',
    'The "Enable CDC" change is not saved yet. Save first, then run the checks.',
  ],
  'connections.preflightRun': ['전제조건 점검', 'Run checks'],
  'connections.preflightFailed': ['점검 실패: {error}', 'Check failed: {error}'],
  'connections.preflightReady': ['CDC 소스로 사용할 수 있습니다.', 'Ready to use as a CDC source.'],
  'connections.preflightNotReady': ['아직 준비되지 않았습니다.', 'Not ready yet.'],

  // 사용처·삭제
  'connections.usagesLoadFailed': [
    '사용처를 불러오지 못했습니다: {error}',
    'Failed to load usages: {error}',
  ],
  'connections.usagesLoading': ['사용처를 확인하는 중…', 'Checking usages…'],
  'connections.noUsages': [
    '이 연결을 사용하는 파이프라인이 없습니다.',
    'No pipelines use this connection.',
  ],
  'connections.inUseSummary': [
    '파이프라인 {pipelines}개 · 노드 {nodes}개가 이 연결을 사용 중입니다.',
    '{pipelines} pipeline{pipelines||s} · {nodes} node{nodes||s} use this connection.',
  ],
  'connections.openPipeline': ['이 파이프라인 열기', 'Open this pipeline'],
  'connections.deleteFailed': ['삭제에 실패했습니다', 'Failed to delete'],
  'connections.deleteSecretWarn': [
    '삭제하면 저장된 시크릿도 함께 지워지며 되돌릴 수 없습니다.',
    'Deleting also removes the stored secret and cannot be undone.',
  ],
  'connections.deleteWarnPre': [
    '삭제하면 해당 노드는 연결을 잃고 ',
    'If deleted, those nodes lose the connection and ',
  ],
  'connections.deleteWarnBold': ['다음 실행에서 실패', 'fail on the next run'],
  'connections.deleteWarnPost': ['합니다.', '.'],
  'connections.deleteAck': [
    '위 파이프라인이 깨진다는 것을 이해했고, 그래도 삭제합니다.',
    'I understand the pipelines above will break — delete anyway.',
  ],
  'connections.deleteAnyway': ['그래도 삭제', 'Delete anyway'],
  'connections.delete': ['삭제', 'Delete'],
} as const
