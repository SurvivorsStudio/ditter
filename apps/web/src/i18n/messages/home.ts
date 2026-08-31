/** home 화면 문구.
 *  값은 [한국어, 영어] 쌍이다. ko 문구는 기존 리터럴과 바이트 동일하게 유지한다 —
 *  기존 테스트의 한글 단언이 그 문구를 본다. */
export const home = {
  // 상단 통계 카드
  'home.statPipelines': ['전체 파이프라인', 'Total pipelines'],
  'home.statPipelinesSub': [
    '활성 {active} · 비활성 {inactive}',
    'Active {active} · Inactive {inactive}',
  ],
  'home.statSuccessToday': ['오늘 성공', 'Succeeded today'],
  'home.statSuccessSub': ['24시간 성공률 {rate}%', '24h success rate {rate}%'],
  'home.statNeedsCheck': ['확인 필요', 'Needs attention'],
  'home.statAllClear': ['이상 없음', 'All clear'],
  'home.statRecords': ['처리 레코드', 'Records processed'],
  'home.statLast24h': ['지난 24시간', 'Last 24 hours'],

  // 파이프라인 목록
  'home.viewRunHistory': ['실행 이력 보기 →', 'View run history →'],
  'home.dismissNotice': ['알림 닫기', 'Dismiss notice'],
  'home.loadFailed': ['목록을 불러오지 못했습니다', 'Failed to load the list'],
  'home.emptyTitle': ['아직 파이프라인이 없습니다', 'No pipelines yet'],
  'home.emptyBody': [
    '상단의 [새 파이프라인] 버튼으로 첫 파이프라인을 만들어 보세요.',
    'Create your first pipeline with the [New pipeline] button above.',
  ],
  'home.flowFallback': ['버전 관리 · {flow}', 'Versioned · {flow}'],
  'home.noNodes': ['노드 없음', 'No nodes'],
  'home.deletePipeline': ['파이프라인 삭제', 'Delete pipeline'],
  'home.deleteAria': ['{name} 삭제', 'Delete {name}'],
  'home.deletedNotice': ["'{name}' 을(를) 삭제했습니다.", "'{name}' was deleted."],
  // 앞 문장에 그대로 이어 붙는다 — 선두 공백까지가 문구다
  'home.deletedRunsNotice': [
    ' 실행 이력 {n}건도 함께 지워졌습니다.',
    ' Its run history ({n}) was deleted too.',
  ],

  // 삭제 확인 대화상자
  'home.deleteFailed': ['삭제에 실패했습니다', 'Failed to delete'],
  'home.impactLoading': ['삭제 영향을 확인하는 중…', 'Checking deletion impact…'],
  'home.cdcBlockedLead': [
    'CDC 스트림이 살아 있어 지울 수 없습니다',
    'Cannot delete while the CDC stream is alive',
  ],
  'home.cdcBlockedRest': [
    '모니터에서 스트림을 먼저 중지하세요. 여기서 지우면 Debezium 커넥터가 주인 없이 남아 계속 토픽에 씁니다.',
    'Stop the stream in Monitor first. Deleting it here leaves the Debezium connector orphaned, still writing to the topic.',
  ],
  'home.runBlockedLead': ['지금 실행이 진행 중입니다', 'A run is in progress right now'],
  'home.runBlockedRest': [
    '그래도 지우면 그 실행은 중간에 끊깁니다. 끝나기를 기다리는 편이 안전합니다.',
    'Deleting anyway will cut that run off midway. It is safer to wait for it to finish.',
  ],
  'home.deleteWarn': [
    '삭제하면 되돌릴 수 없습니다. 아래 이력도 함께 사라집니다.',
    'Deletion cannot be undone. The history below is deleted with it.',
  ],
  'home.lastAt': ['마지막 {at}', 'Last {at}'],
  'home.checkpoints': ['증분 체크포인트', 'Incremental checkpoints'],
  'home.itemCount': ['{n}개', '{n}'],
  'home.watermarkReset': ['워터마크 초기화됨', 'Watermark reset'],
  'home.versionSnapshots': ['버전 스냅샷', 'Version snapshots'],
  'home.ackRun': [
    '진행 중인 실행이 끊긴다는 것을 이해했고, 그래도 삭제합니다.',
    'I understand the in-progress run will be cut off, and still want to delete.',
  ],
  'home.ackHistory': [
    '실행 이력과 체크포인트가 함께 지워진다는 것을 이해했습니다.',
    'I understand the run history and checkpoints will be deleted with it.',
  ],
  'home.deleteAnyway': ['그래도 삭제', 'Delete anyway'],
  'home.delete': ['삭제', 'Delete'],
} as const
