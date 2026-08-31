import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SavedQueriesPanel } from './SavedQueries'
import type { SavedFolder } from '../api/savedStore'
import type { PipelineSummary } from '../api/types'

/** 쿼리와 파이프라인이 한 트리에 산다 — 재귀 렌더라 눈으로만 보고 넘기기 쉽다.
 *  특히 「미분류」: 서버에는 있는데 폴더에 안 넣은 파이프라인이 화면에서 사라지면
 *  "왜 안 보이지"부터 시작하게 된다. */

// React 18 의 act() 가 테스트 환경임을 알아야 경고 없이 갱신을 흘려보낸다
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const pipeline = (id: string, name: string): PipelineSummary => ({
  id,
  name,
  description: null,
  status: 'active',
  schedule: null,
  schedule_enabled: false,
  flow: [],
  last_run_status: null,
  last_run_at: null,
  updated_at: '2026-08-18T00:00:00Z',
})

const folder = (id: string, name: string, pipelineIds: string[] = []): SavedFolder => ({
  id,
  name,
  folders: [],
  queries: [],
  pipelines: pipelineIds.map((pipelineId, i) => ({ id: `it${i}-${id}`, pipelineId, createdAt: 0 })),
})

const noop = () => {}
const handlers = {
  onOpen: noop,
  onDeleteQuery: noop,
  onRenameQuery: noop,
  onDeleteFolder: noop,
  onRenameFolder: noop,
  onNewFolder: noop,
  onNewQuery: noop,
  onMoveQuery: noop,
  onMoveFolder: noop,
  onNewPipeline: noop,
  onOpenPipeline: noop,
  onOpenRun: noop,
  onRemovePipeline: noop,
  onMovePipeline: noop,
  onPlacePipeline: noop,
}

let container: HTMLDivElement
let root: Root

const render = (ui: React.ReactElement) => {
  act(() => {
    root.render(ui)
  })
}
const names = () => [...container.querySelectorAll('.sq-query-name')].map((el) => el.textContent ?? '')
const buttonByText = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
/** 추가 입력줄 안의 버튼 — 헤더의 [폴더] 와 글자가 겹쳐서 범위를 좁혀야 한다. */
const addButton = (text: string) =>
  [...container.querySelectorAll('.sq-addfolder button')].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLElement | undefined
const addInput = () => container.querySelector<HTMLInputElement>('.sq-addfolder input')
const typeAdd = (value: string) => {
  const el = addInput()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, value)
    el?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** 종류 버튼 위에 포인터를 올린다 — 손대지 않은 이름은 그 종류를 따라간다.
 *  React 는 onPointerEnter 를 pointerover 에서 합성하므로 그쪽을 쏜다. */
const hoverAdd = (text: string) =>
  act(() => {
    addButton(text)?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  })
/** 종류 버튼에서 포인터가 벗어난다 — 미리보기는 [폴더](=Enter 가 하는 일)로 돌아가야 한다.
 *  React 는 onPointerLeave 를 pointerout 에서 합성한다. */
const leaveAdd = (text: string) =>
  act(() => {
    addButton(text)?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
  })
/** 입력줄에서 Enter — 언제나 [폴더] 를 만든다. */
const enterAdd = () =>
  act(() => {
    addInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SavedQueriesPanel', () => {
  it('폴더에 담긴 파이프라인과 쿼리를 한 트리에 그린다', () => {
    const f: SavedFolder = {
      ...folder('f1', '일배치', ['p1']),
      queries: [{ id: 'q1', name: '알람 조회', mode: 'sql', text: 'select 1', createdAt: 0 }],
    }
    render(
      <SavedQueriesPanel folders={[f]} connections={[]} pipelines={[pipeline('p1', '고객 마스터')]} {...handlers} />,
    )
    expect(container.querySelector('.sq-folder-name')?.textContent).toBe('일배치')
    expect(names()).toEqual(['고객 마스터', '알람 조회'])
    expect(container.querySelector('.sq-count')?.textContent).toBe('2')
  })

  it('어느 폴더에도 없는 파이프라인은 「미분류」로 보인다', () => {
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '일배치', ['p1'])]}
        connections={[]}
        pipelines={[pipeline('p1', '고객 마스터'), pipeline('p2', '주문 적재')]}
        {...handlers}
      />,
    )
    expect(container.querySelector('.pl-loose-label')?.textContent).toContain('미분류')
    expect(names()).toEqual(['고객 마스터', '주문 적재'])
  })

  it('트리에만 남은 참조(서버에서 지워진 것)는 그리지 않는다', () => {
    render(
      <SavedQueriesPanel folders={[folder('f1', '일배치', ['ghost'])]} connections={[]} pipelines={[]} {...handlers} />,
    )
    expect(names()).toEqual([])
  })

  it('폴더의 + 를 누르면 [폴더]·[쿼리]·[파이프라인] 이 함께 나온다', () => {
    render(<SavedQueriesPanel folders={[folder('f1', '일배치')]} connections={[]} pipelines={[]} {...handlers} />)
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    expect(buttonByText('폴더')).toBeTruthy()
    expect(buttonByText('쿼리')).toBeTruthy()
    expect(buttonByText('파이프라인')).toBeTruthy()
  })

  it('최상위에서는 폴더만 만들 수 있다 — 쿼리·파이프라인은 폴더 안에만 산다', () => {
    render(<SavedQueriesPanel folders={[]} connections={[]} pipelines={[]} {...handlers} />)
    act(() => {
      container.querySelector<HTMLElement>('.sq-head .sq-newfolder')?.click()
    })
    expect(buttonByText('파이프라인')).toBeUndefined()
    expect(buttonByText('쿼리')).toBeUndefined()
  })

  it('[파이프라인] 은 이름과 폴더 id 로 onNewPipeline 을 부른다', () => {
    const onNewPipeline = vi.fn()
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '일배치')]}
        connections={[]}
        pipelines={[]}
        {...handlers}
        onNewPipeline={onNewPipeline}
      />,
    )
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    typeAdd('주문 적재')
    act(() => {
      addButton('파이프라인')?.click()
    })
    expect(onNewPipeline).toHaveBeenCalledWith('f1', '주문 적재')
  })

  it('입력줄은 만들어질 이름이 채워진 채로 열린다', () => {
    render(<SavedQueriesPanel folders={[folder('f1', '일배치')]} connections={[]} pipelines={[]} {...handlers} />)
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    // 주 버튼(=Enter)이 [폴더] 라 폴더 이름으로 열린다
    expect(addInput()?.value).toBe('새 폴더')
    // 다른 종류를 가리키면 그 종류의 이름으로 바뀐다 — 보이는 이름과 만들어질 이름이 같아야 한다
    hoverAdd('파이프라인')
    expect(addInput()?.value).toBe('새 파이프라인')
    hoverAdd('쿼리')
    expect(addInput()?.value).toBe('새 쿼리')
  })

  it('Enter 는 [폴더] 를 만든다 — 채워진 이름 그대로', () => {
    const onNewFolder = vi.fn()
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '일배치')]}
        connections={[]}
        pipelines={[]}
        {...handlers}
        onNewFolder={onNewFolder}
      />,
    )
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    enterAdd()
    expect(onNewFolder).toHaveBeenCalledWith('f1', '새 폴더')
  })

  it('가리키다 벗어나면 [폴더] 이름으로 되돌아온다 — Enter 가 만드는 것과 갈리면 안 된다', () => {
    const onNewFolder = vi.fn()
    const onNewPipeline = vi.fn()
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '일배치')]}
        connections={[]}
        pipelines={[]}
        {...handlers}
        onNewFolder={onNewFolder}
        onNewPipeline={onNewPipeline}
      />,
    )
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    hoverAdd('파이프라인')
    expect(addInput()?.value).toBe('새 파이프라인')
    leaveAdd('파이프라인')
    // 화면이 「새 파이프라인」인 채로 Enter 를 받으면 폴더가 생겨 종류가 갈린다
    expect(addInput()?.value).toBe('새 폴더')
    enterAdd()
    expect(onNewFolder).toHaveBeenCalledWith('f1', '새 폴더')
    expect(onNewPipeline).not.toHaveBeenCalled()
  })

  it('직접 고친 이름은 다른 종류를 가리켜도 그대로 둔다', () => {
    render(<SavedQueriesPanel folders={[folder('f1', '일배치')]} connections={[]} pipelines={[]} {...handlers} />)
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    typeAdd('주문 적재')
    hoverAdd('파이프라인')
    expect(addInput()?.value).toBe('주문 적재')
  })

  it('채워진 이름 그대로 누르면 그 이름으로 만들어진다', () => {
    const onNewQuery = vi.fn()
    const onNewPipeline = vi.fn()
    const onNewFolder = vi.fn()
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '일배치')]}
        connections={[]}
        pipelines={[]}
        {...handlers}
        onNewQuery={onNewQuery}
        onNewPipeline={onNewPipeline}
        onNewFolder={onNewFolder}
      />,
    )
    // hover 없이 곧장 누르는 길(터치·키보드)에서도 누른 종류의 이름이어야 한다
    for (const [text, spy, name] of [
      ['쿼리', onNewQuery, '새 쿼리'],
      ['파이프라인', onNewPipeline, '새 파이프라인'],
    ] as const) {
      act(() => {
        container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
      })
      act(() => {
        addButton(text)?.click()
      })
      expect(spy).toHaveBeenCalledWith('f1', name)
    }
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    act(() => {
      addButton('폴더')?.click()
    })
    expect(onNewFolder).toHaveBeenCalledWith('f1', '새 폴더')
  })

  it('기본 이름은 형제·떠 있는 탭 이름을 피한다', () => {
    const onNewQuery = vi.fn()
    const onNewPipeline = vi.fn()
    const f: SavedFolder = {
      ...folder('f1', '일배치'),
      queries: [{ id: 'q1', name: '새 쿼리', mode: 'sql', text: '', createdAt: 0 }],
    }
    render(
      <SavedQueriesPanel
        folders={[f]}
        connections={[]}
        pipelines={[pipeline('p1', '새 파이프라인')]}
        openTitles={['새 쿼리 2', '새 파이프라인 2']}
        {...handlers}
        onNewQuery={onNewQuery}
        onNewPipeline={onNewPipeline}
      />,
    )
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    hoverAdd('쿼리')
    expect(addInput()?.value).toBe('새 쿼리 3')
    act(() => {
      addButton('쿼리')?.click()
    })
    expect(onNewQuery).toHaveBeenCalledWith('f1', '새 쿼리 3')
    act(() => {
      container.querySelector<HTMLElement>('.sq-folder-row .sq-edit')?.click()
    })
    act(() => {
      addButton('파이프라인')?.click()
    })
    expect(onNewPipeline).toHaveBeenCalledWith('f1', '새 파이프라인 3')
  })

  it('최상위 입력줄도 폴더 이름이 채워진 채로 열린다', () => {
    const onNewFolder = vi.fn()
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '새 폴더')]}
        connections={[]}
        pipelines={[]}
        {...handlers}
        onNewFolder={onNewFolder}
      />,
    )
    act(() => {
      container.querySelector<HTMLElement>('.sq-head .sq-newfolder')?.click()
    })
    expect(addInput()?.value).toBe('새 폴더 2')
    act(() => {
      addButton('폴더')?.click()
    })
    expect(onNewFolder).toHaveBeenCalledWith(null, '새 폴더 2')
  })

  it('파이프라인을 누르면 onOpenPipeline 이 불린다', () => {
    const onOpenPipeline = vi.fn()
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '일배치', ['p1'])]}
        connections={[]}
        pipelines={[pipeline('p1', '고객 마스터')]}
        {...handlers}
        onOpenPipeline={onOpenPipeline}
      />,
    )
    act(() => {
      container.querySelector<HTMLElement>('.pl-item')?.click()
    })
    expect(onOpenPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('파이프라인의 × 는 트리에서만 뺀다 (onRemovePipeline)', () => {
    const onRemovePipeline = vi.fn()
    render(
      <SavedQueriesPanel
        folders={[folder('f1', '일배치', ['p1'])]}
        connections={[]}
        pipelines={[pipeline('p1', '고객 마스터')]}
        {...handlers}
        onRemovePipeline={onRemovePipeline}
      />,
    )
    act(() => {
      container.querySelector<HTMLElement>('.pl-item .sq-del')?.click()
    })
    expect(onRemovePipeline).toHaveBeenCalledWith('it0-f1')
  })

  it('검색은 쿼리와 파이프라인을 함께 훑는다', () => {
    const f: SavedFolder = {
      ...folder('f1', '일배치', ['p1']),
      queries: [{ id: 'q1', name: '알람 조회', mode: 'sql', text: 'select 1', createdAt: 0 }],
    }
    render(
      <SavedQueriesPanel folders={[f]} connections={[]} pipelines={[pipeline('p1', '고객 마스터')]} {...handlers} />,
    )
    const input = container.querySelector<HTMLInputElement>('.sq-search input')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '고객')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(names()).toEqual(['고객 마스터'])
  })
})
