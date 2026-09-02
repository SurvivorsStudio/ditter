import { describe, expect, it } from 'vitest'
import { headingFor } from './App'

/** 경로 → 상단 머리글.
 *
 *  예전에는 홈이 `/^\//` 라 **모든 경로에** 맞았다. 없는 주소로 가면 본문은 비어 있는데
 *  머리글만 「대시보드」로 남아, 경로가 틀린 것이 아니라 홈이 깨진 것으로 보였다.
 *  화면을 봐야만 드러나는 종류라 여기서 못박는다.
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

  it('홈은 정확히 "/" 일 때만이다', () => {
    // `/^\/$/` 가 아니라 `/^\//` 로 되돌리면 이 단언이 깨진다 — 그게 원래 버그였다.
    expect(headingFor('/x').title).not.toBe('nav.title.home')
  })
})
