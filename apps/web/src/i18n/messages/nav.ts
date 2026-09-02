/** 좌측 레일·상단바 — 화면 이동과 머리글. */
export const nav = {
  'nav.home': ['홈', 'Home'],
  'nav.pipelines': ['파이프라인', 'Pipelines'],
  'nav.sql': ['SQL', 'SQL'],
  'nav.monitor': ['모니터링', 'Monitoring'],
  'nav.connections': ['연결', 'Connections'],

  'nav.title.home': ['대시보드', 'Dashboard'],
  'nav.title.canvas': ['파이프라인 편집기', 'Pipeline Editor'],
  'nav.title.sql': ['SQL 편집기', 'SQL Editor'],
  'nav.title.monitor': ['모니터링', 'Monitoring'],
  'nav.title.connections': ['연결 관리', 'Connections'],

  'nav.crumb.home': ['홈', 'Home'],
  'nav.crumb.canvas': ['파이프라인', 'Pipelines'],
  'nav.crumb.sql': ['SQL', 'SQL'],
  'nav.crumb.monitor': ['실행 이력', 'Run history'],
  'nav.crumb.connections': ['연결', 'Connections'],

  // 없는 경로 (`<Route path="*">`). 머리글이 「대시보드」로 남으면 홈이 깨진 것처럼 보인다.
  'nav.title.notFound': ['찾을 수 없음', 'Not found'],
  'nav.crumb.notFound': ['없는 경로', 'Unknown path'],
  'nav.notFound.title': ['그런 경로가 없습니다', 'No such page'],
  'nav.notFound.body': [
    '주소를 잘못 입력했거나, 예전 링크일 수 있습니다.',
    'The address may be mistyped, or the link may be out of date.',
  ],
  'nav.notFound.goHome': ['홈으로 가기', 'Go to home'],
} as const
