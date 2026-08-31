/** 상태·트리거 라벨 — components/common.tsx 의 Tag 등이 키로 조회한다. */
export const status = {
  'status.pending': ['대기', 'Pending'],
  'status.running': ['실행중', 'Running'],
  'status.success': ['성공', 'Success'],
  'status.failed': ['실패', 'Failed'],
  'status.cancelled': ['취소', 'Cancelled'],
  'status.active': ['활성', 'Active'],
  'status.inactive': ['비활성', 'Inactive'],
  'status.draft': ['초안', 'Draft'],
  'status.ok': ['정상', 'OK'],
  'status.warn': ['지연', 'Delayed'],
  'status.error': ['오류', 'Error'],
  'status.unknown': ['미확인', 'Unknown'],
  // CDC 스트림 상태 (Phase 4)
  'status.provisioning': ['준비중', 'Provisioning'],
  'status.paused': ['일시정지', 'Paused'],
  'status.stopped': ['중지됨', 'Stopped'],

  'trigger.manual': ['수동', 'Manual'],
  'trigger.schedule': ['스케줄', 'Schedule'],
  'trigger.cdc': ['CDC', 'CDC'],
} as const
