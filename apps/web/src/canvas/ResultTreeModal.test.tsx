import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeSample, PipelineDefinition } from '../api/types'
import { useCanvasStore } from '../store/canvasStore'
import { ResultTreeModal } from './ResultTreeModal'

/** 트리 팝업은 재귀 렌더라 눈으로만 보고 넘기기 쉬운 자리다 — 실제로 그려 보고 확인한다.
 *  (모달은 document.body 로 포탈된다 — 컨테이너가 아니라 body 에서 찾아야 한다.) */

// React 18 의 act() 가 테스트 환경임을 알아야 경고 없이 갱신을 흘려보낸다
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEFINITION: PipelineDefinition = {
  nodes: [
    {
      id: 'trg',
      kind: 'trigger.api',
      label: '웹훅',
      position: { x: 0, y: 0 },
      params: {},
    },
    {
      id: 'agg',
      kind: 'source.postgres',
      label: '집계',
      position: { x: 200, y: 0 },
      params: { connection_id: 'c1', table: 'a' },
    },
  ],
  edges: [],
  variables: {},
}

const sample = (rows: Record<string, unknown>[], columns: string[]): NodeSample => ({
  columns,
  rows,
  truncated: false,
})

let container: HTMLDivElement
let root: Root

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<ResultTreeModal onClose={() => {}} />)
  })
}

function text(): string {
  return document.body.textContent ?? ''
}

function clickWithText(needle: string) {
  const button = [...document.body.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(needle),
  )
  if (!button) throw new Error(`버튼을 찾지 못했습니다: ${needle}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  useCanvasStore.getState().loadDefinition(DEFINITION)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('결과 트리 팝업', () => {
  it('결과가 없으면 그렇다고 말한다', () => {
    render()
    expect(text()).toContain('아직 모인 결과가 없습니다')
  })

  it('첫 노드는 첫 행까지 펼쳐서 연다 — 접힌 이름만 늘어놓으면 칩과 다를 게 없다', () => {
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 1,
        message: '',
        location: null,
        sample: sample([{ max_dt: '2026-08-01' }], ['max_dt']),
      },
    })
    render()
    expect(text()).toContain('집계')
    expect(text()).toContain('참조되는 행')
    expect(text()).toContain('2026-08-01')
  })

  it('낱값 표기는 첫 행에만 붙인다 — 다른 행에 붙이면 거짓말이 된다', () => {
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 2,
        message: '',
        location: null,
        sample: sample([{ v: 1 }, { v: 2 }], ['v']),
      },
    })
    render()
    clickWithText('[1]') // 둘째 행도 펼친다
    const refs = [...document.body.querySelectorAll('.rt-ref')].map((e) => e.textContent)
    expect(refs).toEqual(['${집계.v}', '${집계.v[]}']) // [1] 행에는 없다
  })

  it('행이 여럿이면 목록 표기도 함께 준다', () => {
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 2,
        message: '',
        location: null,
        sample: sample([{ v: 1 }, { v: 2 }], ['v']),
      },
    })
    render()
    expect(document.body.querySelector('.rt-ref.list')?.textContent).toBe('${집계.v[]}')
  })

  it('한 행뿐이면 목록 표기를 주지 않는다', () => {
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 1,
        message: '',
        location: null,
        sample: sample([{ v: 1 }], ['v']),
      },
    })
    render()
    expect(document.body.querySelector('.rt-ref.list')).toBeNull()
  })

  it('샘플이 잘렸으면 한 행만 보여도 목록 표기를 준다', () => {
    // 화면에 보이는 행 수가 전부는 아니다 — 실행할 때는 상한까지 읽는다
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 999,
        message: '',
        location: null,
        sample: { columns: ['v'], rows: [{ v: 1 }], truncated: true },
      },
    })
    render()
    expect(document.body.querySelector('.rt-ref.list')?.textContent).toBe('${집계.v[]}')
  })

  it('중첩된 값은 다시 트리로 펼친다 (Mongo 문서)', () => {
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 1,
        message: '',
        location: null,
        sample: sample([{ doc: { inner: '속값' } }], ['doc']),
      },
    })
    render()
    expect(text()).toContain('객체 1개')
    expect(text()).not.toContain('속값') // 아직 접혀 있다
    clickWithText('doc')
    expect(text()).toContain('속값')
  })

  it('중첩 값에는 참조 표기를 붙이지 않는다 — ${노드.a.b} 는 엉뚱한 곳을 가리킨다', () => {
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 1,
        message: '',
        location: null,
        sample: sample([{ doc: { inner: 1 } }], ['doc']),
      },
    })
    render()
    clickWithText('doc')
    expect([...document.body.querySelectorAll('.rt-ref')]).toHaveLength(0)
  })

  it('트리거는 행 층 없이 값만 늘어놓고 $이름 으로 쓴다', () => {
    useCanvasStore.getState().applyRunStates({
      trg: {
        status: 'success',
        records: 0,
        message: '값 전달',
        location: null,
        handed: { since: '2026-08-01' },
      },
    })
    render()
    expect(text()).toContain('넘긴 값 1개')
    expect(text()).not.toContain('참조되는 행')
    expect(document.body.querySelector('.rt-ref')?.textContent).toBe('$since')
  })

  it('모두 접기/펼치기가 모든 행을 여닫는다', () => {
    useCanvasStore.getState().applyRunStates({
      agg: {
        status: 'success',
        records: 2,
        message: '',
        location: null,
        sample: sample([{ v: 1 }, { v: 2 }], ['v']),
      },
    })
    render()
    // 처음에는 첫 행만 열려 있다
    expect(document.body.querySelectorAll('.rt-leaf')).toHaveLength(1)
    clickWithText('모두 접기')
    expect(document.body.querySelectorAll('.rt-leaf')).toHaveLength(0)
    clickWithText('모두 펼치기')
    expect(document.body.querySelectorAll('.rt-leaf')).toHaveLength(2)
  })
})
