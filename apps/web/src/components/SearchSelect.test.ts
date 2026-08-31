/** 드롭다운 패널 자리 계산.
 *
 *  노트북 셀의 연결 알약처럼 **좁은 트리거**가 생기면서 드러난 문제다 — 패널 너비를
 *  트리거에서 그대로 가져오면 항목 이름이 전부 잘려 무엇을 고르는지 알 수 없다. */
import { describe, expect, it } from 'vitest'
import { panelPlacement } from './SearchSelect'

const VP = { width: 1280, height: 900 }
const rect = (o: Partial<{ left: number; top: number; bottom: number; width: number }> = {}) => ({
  left: 100,
  top: 200,
  bottom: 221,
  width: 98,
  ...o,
})

describe('panelPlacement', () => {
  it('좁은 트리거에서도 패널은 하한 너비를 지킨다', () => {
    // 셀의 연결 알약은 100px 남짓이다 — 그대로 쓰면 「PostgreSQL」도 안 들어간다.
    expect(panelPlacement(rect({ width: 98 }), VP).width).toBe(240)
  })

  it('넓은 트리거는 그 너비를 그대로 쓴다 (툴바 드롭다운)', () => {
    expect(panelPlacement(rect({ width: 320 }), VP).width).toBe(320)
  })

  it('트리거보다 넓어져도 오른쪽 화면 밖으로 나가지 않는다', () => {
    const p = panelPlacement(rect({ left: 1200, width: 98 }), VP)
    expect(p.left + p.width).toBeLessThanOrEqual(VP.width)
  })

  it('왼쪽으로도 화면 밖으로 밀리지 않는다', () => {
    expect(panelPlacement(rect({ left: -40 }), VP).left).toBeGreaterThanOrEqual(0)
  })

  it('트리거가 여유로우면 왼쪽을 그대로 맞춘다', () => {
    expect(panelPlacement(rect({ left: 100 }), VP).left).toBe(100)
  })

  it('아래 공간이 모자라고 위가 더 넓으면 위로 띄운다', () => {
    const p = panelPlacement(rect({ top: 700, bottom: 721 }), VP)
    expect(p.above).toBe(true)
    expect(p.top).toBe(700)
  })

  it('아래가 넉넉하면 아래로 띄운다', () => {
    const p = panelPlacement(rect({ top: 200, bottom: 221 }), VP)
    expect(p.above).toBe(false)
    expect(p.top).toBe(221)
  })

  it('위아래 둘 다 좁으면 아래로 둔다 (위가 더 좁으므로)', () => {
    const p = panelPlacement(rect({ top: 100, bottom: 121 }), { width: 1280, height: 300 })
    expect(p.above).toBe(false)
  })
})
