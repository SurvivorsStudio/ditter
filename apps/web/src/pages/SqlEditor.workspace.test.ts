import { describe, expect, it } from 'vitest'
import { contentDock, stripDeadPipeTab, type Workspace } from './SqlEditor'

/** 없앤 특수 탭을 저장된 워크스페이스에서 빼내는 마이그레이션.
 *
 *  짧게 존재했던 「파이프라인」 탭(-3)이 이미 배치에 박힌 브라우저가 있다. 남기면 본문
 *  없는 빈 탭이 뜨고, 워크스페이스를 통째로 버리면 애써 만든 배치가 날아간다. */

const CONN = 0
const SAVED = -1
const FAV = -2
const DEAD = -3

const ws = (columns: Workspace['columns']): Workspace => ({
  sessions: [],
  columns,
  focused: columns[0]?.docks[0]?.id ?? 1,
  colWeights: {},
  rowWeights: {},
  lastFocused: null,
})

const tabsOf = (w: Workspace) => w.columns.map((c) => c.docks.map((d) => d.tabs))

describe('stripDeadPipeTab', () => {
  it('없앤 탭을 빼낸다', () => {
    const out = stripDeadPipeTab(ws([{ id: 1, docks: [{ id: 1, tabs: [CONN, DEAD, SAVED], active: CONN }] }]))
    expect(tabsOf(out)).toEqual([[[CONN, SAVED]]])
  })

  it('그 탭이 활성이었으면 활성을 옮긴다 — 없는 탭이 활성이면 본문이 빈다', () => {
    const out = stripDeadPipeTab(ws([{ id: 1, docks: [{ id: 1, tabs: [CONN, DEAD], active: DEAD }] }]))
    expect(out.columns[0].docks[0].active).toBe(CONN)
  })

  it('그 탭만 있던 도크·컬럼은 통째로 걷어낸다', () => {
    const out = stripDeadPipeTab(
      ws([
        { id: 1, docks: [{ id: 1, tabs: [CONN, SAVED, FAV], active: CONN }] },
        { id: 2, docks: [{ id: 2, tabs: [DEAD], active: DEAD }] },
      ]),
    )
    expect(tabsOf(out)).toEqual([[[CONN, SAVED, FAV]]])
  })

  it('없으면 그대로 둔다', () => {
    const out = stripDeadPipeTab(ws([{ id: 1, docks: [{ id: 1, tabs: [CONN, SAVED], active: SAVED }] }]))
    expect(tabsOf(out)).toEqual([[[CONN, SAVED]]])
    expect(out.columns[0].docks[0].active).toBe(SAVED)
  })
})

describe('contentDock — 새 본문 탭이 들어갈 도크', () => {
  const dock = (id: number, tabs: number[]) => ({ id, docks: [{ id, tabs, active: tabs[0] }] })

  it('본문 탭이 가장 많은 도크를 고른다', () => {
    // 트리 도크에 포커스가 있어도 편집기가 모인 쪽으로 간다 — 패널에 본문이 끼면 둘 다 못 쓴다.
    const cols = [dock(1, [CONN, SAVED, FAV]), dock(2, [10, 11])]
    expect(contentDock(cols, 1)).toBe(2)
  })

  it('같은 수면 포커스한 도크를 고른다', () => {
    const cols = [dock(1, [10]), dock(2, [11])]
    expect(contentDock(cols, 2)).toBe(2)
    expect(contentDock(cols, 1)).toBe(1)
  })

  it('본문 탭이 하나도 없으면 패널만 든 도크는 피한다', () => {
    const cols = [dock(1, [CONN, SAVED, FAV]), { id: 2, docks: [{ id: 2, tabs: [], active: -1 }] }]
    expect(contentDock(cols, 1)).toBe(2)
  })

  it('갈 곳이 패널 도크뿐이면 거기라도 넣는다 — 탭을 잃는 것보다 낫다', () => {
    const cols = [dock(1, [CONN, SAVED, FAV])]
    expect(contentDock(cols, 1)).toBe(1)
  })

  it('포커스가 없어진 도크를 가리켜도 첫 도크로 떨어진다', () => {
    const cols = [dock(1, [CONN, SAVED, FAV])]
    expect(contentDock(cols, 99)).toBe(1)
  })

  it('패널과 본문이 섞인 도크도 본문 수로만 센다', () => {
    const cols = [dock(1, [CONN, SAVED, FAV, 10, 11, 12]), dock(2, [20])]
    expect(contentDock(cols, 2)).toBe(1)
  })
})
