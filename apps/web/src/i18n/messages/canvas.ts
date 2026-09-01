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

  // canvas/variables.ts — 변수·노드 결과 치환 오류. `${{ref}}` 는 리터럴 `${` + 값 + `}` 로 그려진다.
  'vars.noNodeValue': ['노드 결과 값이 없습니다: ${{ref}}', 'No node result value: ${{ref}}'],
  'vars.noVarValue': ['변수 값이 없습니다: ${name}', 'No value for variable: ${name}'],
  'vars.mustBeList': ['${{name}} 는 목록이어야 합니다', '${{name}} must be a list'],
  'vars.emptyList': [
    '${{name}} 가 빈 목록입니다 — 참조한 노드가 행을 내지 않았습니다',
    '${{name}} is an empty list — the referenced node produced no rows',
  ],
  'vars.sqlUnsafe': [
    '${name} 의 값에 SQL 로 해석될 수 있는 문자가 있습니다: {token}. 쿼리·조건절에 꽂는 값에는 따옴표·세미콜론·주석을 넣을 수 없습니다.',
    'The value of ${name} contains characters interpretable as SQL: {token}. Values injected into queries cannot contain quotes, semicolons, or comments.',
  ],
  'vars.controlChars': [
    '${name} 의 값에 제어문자가 있습니다.',
    'The value of ${name} contains control characters.',
  ],
} as const
