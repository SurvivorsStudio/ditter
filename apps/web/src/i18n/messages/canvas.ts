/** 캔버스(파이프라인 편집기) 문구. */
export const canvas = {
  'sync.channel.realtime.label': ['실시간', 'Real-time'],
  'sync.channel.realtime.hint': ['재고·출고 등 지연 민감', 'Latency-sensitive (inventory, shipping)'],
  'sync.channel.standard.label': ['일반', 'Standard'],
  'sync.channel.standard.hint': ['마스터 테이블', 'Master tables'],
  'sync.channel.bulk.label': ['대량', 'Bulk'],
  'sync.channel.bulk.hint': ['배치 작업이 몰리는 테이블', 'Tables with heavy batch writes'],
  'sync.purpose.readonly': ['조회/분석', 'Read / analytics'],
  'sync.purpose.operational': ['업무 판단 근거', 'Operational decisions'],
} as const
