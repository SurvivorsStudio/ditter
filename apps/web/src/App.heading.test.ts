import { describe, expect, it } from 'vitest'
import { headingFor } from './App'

/** 경로 → 상단 머리글.
 *
 *  예전에는 홈이 `/^\//` 라 **모든 경로에** 맞았다. 없는 주소로 가면 본문은 비어 있는데
 *  머리글만 「대시보드」로 남아, 경로가 틀린 것이 아니라 홈이 깨진 것으로 보였다.
 *  화면을 봐야만 드러나는 종류라 여기서 못박는다.
 *
 *  아래 경로별 기대값은 **`App.tsx` 의 `<Routes>` 가 실제로 무엇을 렌더링하는지**에 맞춘 것이다
 *  (react-router `matchRoutes` 로 확인). 머리글 규칙이 라우트보다 넓어지면 본문과 갈린다.
 */
describe('headingFor', () => {
  it('알려진 경로는 그 화면의 머리글이다', () => {
    expect(headingFor('/').title).toBe('nav.title.home')
    expect(headingFor('/canvas').title).toBe('nav.title.canvas')
    expect(headingFor('/canvas/p1').title).toBe('nav.title.canvas')
    expect(headingFor('/sql').title).toBe('nav.title.sql')
    expect(headingFor('/monitor').title).toBe('nav.title.monitor')
    expect(headingFor('/connections').title).toBe('nav.title.connections')
  })

  it('없는 경로는 홈이 아니라 「찾을 수 없음」이다', () => {
    for (const path of ['/nonexistent-route', '/canvasx', '/sqlite', '/한글', '/a/b/c']) {
      expect(headingFor(path).title, path).toBe('nav.title.notFound')
      expect(headingFor(path).crumb, path).toBe('nav.crumb.notFound')
    }
  })

  it('한 칸 더 들어간 주소는 라우트가 없으므로 「찾을 수 없음」이다', () => {
    // 전에는 `/^\/sql(\/|$)/` 라 여기서 머리글만 「SQL」로 남았다 — 본문은 404 인데.
    // `<Route path="/sql">` 은 `/sql` 하나만 잡는다(`/sql/foo` 는 `path="*"` 로 간다).
    for (const path of ['/sql/foo', '/monitor/1', '/connections/2', '/canvas/p1/x']) {
      expect(headingFor(path).title, path).toBe('nav.title.notFound')
      expect(headingFor(path).crumb, path).toBe('nav.crumb.notFound')
    }
  })

  it('꼬리 슬래시는 라우터가 무시하므로 머리글도 같아야 한다', () => {
    // 좁히면서 이쪽으로 어긋나면 방향만 뒤집힌 같은 버그다 — 본문은 그 화면인데 머리글만 404.
    expect(headingFor('/canvas/').title).toBe('nav.title.canvas')
    expect(headingFor('/canvas/p1/').title).toBe('nav.title.canvas')
    expect(headingFor('/sql/').title).toBe('nav.title.sql')
    expect(headingFor('/monitor/').title).toBe('nav.title.monitor')
    expect(headingFor('/connections/').title).toBe('nav.title.connections')
  })

  it('홈은 정확히 "/" 일 때만이다', () => {
    // `/^\/$/` 가 아니라 `/^\//` 로 되돌리면 이 단언이 깨진다 — 그게 원래 버그였다.
    expect(headingFor('/x').title).not.toBe('nav.title.home')
  })
})
