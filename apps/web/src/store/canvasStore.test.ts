import { beforeEach, describe, expect, it } from 'vitest'
import type { NodeSample, PipelineDefinition } from '../api/types'
import { resultEntries, useCanvasStore } from './canvasStore'

function reset() {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    selectedId: null,
    dirty: false,
    nodeResults: {},
    groupDrag: null,
    clipboard: null,
    pasteCount: 0,
    past: [],
    future: [],
    historyGuard: null,
    lastEditKey: null,
    lastEditAt: 0,
  })
}

const DEFINITION: PipelineDefinition = {
  nodes: [
    {
      id: 'src',
      kind: 'source.postgres',
      label: 'customers',
      position: { x: 100, y: 50 },
      params: { connection_id: 'c1', table: 'customers' },
    },
    {
      id: 'tgt',
      kind: 'target.s3',
      label: 'S3',
      position: { x: 400, y: 50 },
      params: { connection_id: 'c2', path_prefix: 'raw' },
    },
  ],
  edges: [{ id: 'src->tgt', source: 'src', target: 'tgt' }],
  variables: {},
}

beforeEach(reset)

describe('정의 적재/직렬화', () => {
  it('서버 정의를 React Flow 노드로 옮긴다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    const { nodes, edges, dirty } = useCanvasStore.getState()
    expect(nodes.map((n) => n.id)).toEqual(['src', 'tgt'])
    expect(nodes[0].data.kind).toBe('source.postgres')
    expect(edges).toHaveLength(1)
    expect(dirty).toBe(false) // 갓 불러온 상태는 저장 대상이 아니다
  })

  it('왕복해도 정의가 보존된다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    const out = useCanvasStore.getState().toDefinition()
    expect(out.nodes).toEqual(DEFINITION.nodes)
    expect(out.edges).toEqual([{ id: 'src->tgt', source: 'src', target: 'tgt' }])
  })

  it('직렬화 시 좌표를 정수로 반올림한다', () => {
    useCanvasStore.getState().loadDefinition({
      ...DEFINITION,
      nodes: [{ ...DEFINITION.nodes[0], position: { x: 10.7, y: 20.2 } }],
      edges: [],
    })
    expect(useCanvasStore.getState().toDefinition().nodes[0].position).toEqual({ x: 11, y: 20 })
  })

  it('실행 상태(runState)는 저장 대상에서 빠진다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    useCanvasStore.getState().applyRunStates({
      src: { status: 'success', records: 100, message: '', location: null },
    })
    const serialized = useCanvasStore.getState().toDefinition()
    expect(JSON.stringify(serialized)).not.toContain('runState')
    expect(JSON.stringify(serialized)).not.toContain('success')
  })
})

describe('편집', () => {
  it('노드를 추가하면 기본 파라미터가 채워진다', () => {
    useCanvasStore.getState().addNode('transform.filter', { x: 0, y: 0 })
    const node = useCanvasStore.getState().nodes[0]
    expect(node.data.kind).toBe('transform.filter')
    expect(node.data.params).toEqual({ match: 'all', conditions: [] })
    expect(useCanvasStore.getState().dirty).toBe(true)
  })

  it('Python 노드를 추가하면 기본 코드가 채워진다', () => {
    useCanvasStore.getState().addNode('transform.python', { x: 0, y: 0 })
    const node = useCanvasStore.getState().nodes[0]
    expect(node.data.kind).toBe('transform.python')
    expect(String(node.data.params.code)).toContain('def transform(row)')
  })

  it('알 수 없는 종류는 추가되지 않는다', () => {
    useCanvasStore.getState().addNode('source.oracle', { x: 0, y: 0 })
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('추가된 노드는 고유 id 를 갖는다', () => {
    const { addNode } = useCanvasStore.getState()
    addNode('transform.filter', { x: 0, y: 0 })
    addNode('transform.filter', { x: 0, y: 0 })
    const ids = useCanvasStore.getState().nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('같은 종류를 여러 개 놓으면 이름에 번호가 붙는다', () => {
    const { addNode } = useCanvasStore.getState()
    addNode('transform.filter', { x: 0, y: 0 })
    addNode('transform.filter', { x: 0, y: 0 })
    addNode('transform.filter', { x: 0, y: 0 })
    const labels = useCanvasStore.getState().nodes.map((n) => n.data.label)
    expect(new Set(labels).size).toBe(3)
    expect(labels[1]).toBe(`${labels[0]} 2`)
    expect(labels[2]).toBe(`${labels[0]} 3`) // "필터 2 2" 가 아니라 번호만 오른다
  })

  it('메모는 이름 유일성 대상이 아니다', () => {
    const { addNode } = useCanvasStore.getState()
    addNode('note.memo', { x: 0, y: 0 })
    addNode('note.memo', { x: 0, y: 0 })
    const labels = useCanvasStore.getState().nodes.map((n) => n.data.label)
    expect(labels[0]).toBe(labels[1])
  })

  it('이름을 다른 노드와 같게 바꾸면 무시된다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    useCanvasStore.getState().updateLabel('tgt', ' Customers ') // 공백·대소문자만 다른 것도 중복
    expect(useCanvasStore.getState().nodes[1].data.label).toBe('S3')
    expect(useCanvasStore.getState().dirty).toBe(false)
  })

  it('이름을 비우면 무시된다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    useCanvasStore.getState().updateLabel('tgt', '   ')
    expect(useCanvasStore.getState().nodes[1].data.label).toBe('S3')
  })

  it('이름은 앞뒤 공백을 지우고 저장된다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    useCanvasStore.getState().updateLabel('tgt', '  적재  ')
    expect(useCanvasStore.getState().nodes[1].data.label).toBe('적재')
  })

  it('겹친 이름으로 저장된 정의는 열 때 이름이 갈린다', () => {
    useCanvasStore.getState().loadDefinition({
      ...DEFINITION,
      nodes: DEFINITION.nodes.map((n) => ({ ...n, label: '같은이름' })),
    })
    expect(useCanvasStore.getState().nodes.map((n) => n.data.label)).toEqual([
      '같은이름',
      '같은이름 2',
    ])
  })

  it('파라미터는 병합된다 (기존 값을 날리지 않는다)', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    useCanvasStore.getState().updateParams('src', { incremental_column: 'updated_at' })
    expect(useCanvasStore.getState().nodes[0].data.params).toEqual({
      connection_id: 'c1',
      table: 'customers',
      incremental_column: 'updated_at',
    })
  })

  it('노드를 지우면 딸린 엣지도 함께 사라진다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    useCanvasStore.getState().removeNode('src')
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['tgt'])
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('선택된 노드를 지우면 선택도 해제된다', () => {
    useCanvasStore.getState().loadDefinition(DEFINITION)
    useCanvasStore.getState().select('src')
    useCanvasStore.getState().removeNode('src')
    expect(useCanvasStore.getState().selectedId).toBeNull()
  })
})

describe('연결(엣지)', () => {
  beforeEach(() => useCanvasStore.getState().loadDefinition({ ...DEFINITION, edges: [] }))

  it('노드를 잇는다', () => {
    useCanvasStore.getState().onConnect({ source: 'src', target: 'tgt', sourceHandle: null, targetHandle: null })
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })

  it('같은 쌍을 두 번 잇지 않는다', () => {
    const c = { source: 'src', target: 'tgt', sourceHandle: null, targetHandle: null }
    useCanvasStore.getState().onConnect(c)
    useCanvasStore.getState().onConnect(c)
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })

  it('자기 자신으로 가는 엣지는 만들지 않는다', () => {
    useCanvasStore
      .getState()
      .onConnect({ source: 'src', target: 'src', sourceHandle: null, targetHandle: null })
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('출력 포트(sourceHandle)가 다르면 같은 쌍이라도 별개 엣지', () => {
    useCanvasStore.getState().onConnect({ source: 'src', target: 'tgt', sourceHandle: 'a', targetHandle: null })
    useCanvasStore.getState().onConnect({ source: 'src', target: 'tgt', sourceHandle: 'b', targetHandle: null })
    expect(useCanvasStore.getState().edges).toHaveLength(2)
  })

  it('sourceHandle 은 직렬화·역직렬화로 보존된다', () => {
    useCanvasStore.getState().onConnect({ source: 'src', target: 'tgt', sourceHandle: 'case_x', targetHandle: null })
    const def = useCanvasStore.getState().toDefinition()
    expect(def.edges[0].source_handle).toBe('case_x')
    // 다시 적재해도 유지
    useCanvasStore.getState().loadDefinition(def)
    expect(useCanvasStore.getState().edges[0].sourceHandle).toBe('case_x')
  })
})

describe('저장 필요 표시(dirty)', () => {
  beforeEach(() => useCanvasStore.getState().loadDefinition(DEFINITION))

  it('드래그 중에는 dirty 로 보지 않는다', () => {
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'src', type: 'position', position: { x: 5, y: 5 }, dragging: true }])
    expect(useCanvasStore.getState().dirty).toBe(false)
  })

  it('드래그가 끝나면 dirty 가 된다', () => {
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'src', type: 'position', position: { x: 5, y: 5 }, dragging: false }])
    expect(useCanvasStore.getState().dirty).toBe(true)
  })

  it('markClean 으로 초기화된다', () => {
    useCanvasStore.getState().updateLabel('src', '이름 변경')
    expect(useCanvasStore.getState().dirty).toBe(true)
    useCanvasStore.getState().markClean()
    expect(useCanvasStore.getState().dirty).toBe(false)
  })

  it('실행 상태 반영은 dirty 를 만들지 않는다', () => {
    useCanvasStore.getState().applyRunStates({
      src: { status: 'running', records: 10, message: '', location: null },
    })
    expect(useCanvasStore.getState().dirty).toBe(false)
  })
})

describe('그룹 영역 드래그', () => {
  // 프레임 (0,0)~(400,300). 노드 기본 크기는 172x80 이므로 중심으로 포함 여부를 판정한다.
  const GROUPED: PipelineDefinition = {
    nodes: [
      {
        id: 'g',
        kind: 'note.group',
        label: '그룹 영역',
        position: { x: 0, y: 0 },
        params: { title: '변환 영역', color: 'green', w: 400, h: 300 },
      },
      // 중심 (186,140) → 프레임 안
      { id: 'in', kind: 'transform.filter', label: '필터', position: { x: 100, y: 100 }, params: {} },
      // 중심 (586,140) → 프레임 밖
      { id: 'out', kind: 'target.mongo', label: 'Mongo', position: { x: 500, y: 100 }, params: {} },
    ],
    edges: [],
    variables: {},
  }

  const posOf = (id: string) => useCanvasStore.getState().nodes.find((n) => n.id === id)!.position

  beforeEach(() => useCanvasStore.getState().loadDefinition(GROUPED))

  it('프레임을 끌면 안에 든 노드도 같이 움직인다', () => {
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'g', type: 'position', position: { x: 50, y: 30 }, dragging: true }])
    expect(posOf('g')).toEqual({ x: 50, y: 30 })
    expect(posOf('in')).toEqual({ x: 150, y: 130 }) // 같은 델타만큼 따라옴
  })

  it('밖에 있는 노드는 따라오지 않는다', () => {
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'g', type: 'position', position: { x: 50, y: 30 }, dragging: true }])
    expect(posOf('out')).toEqual({ x: 500, y: 100 })
  })

  it('멤버는 드래그 시작 시점에 정해진다 — 지나가며 훑은 노드는 딸려오지 않는다', () => {
    const { onNodesChange } = useCanvasStore.getState()
    onNodesChange([{ id: 'g', type: 'position', position: { x: 50, y: 0 }, dragging: true }])
    // 프레임이 'out' 위를 덮도록 크게 이동해도 'out' 은 멤버가 아니다
    onNodesChange([{ id: 'g', type: 'position', position: { x: 400, y: 0 }, dragging: true }])
    expect(posOf('in')).toEqual({ x: 500, y: 100 }) // 100 + 400
    expect(posOf('out')).toEqual({ x: 500, y: 100 }) // 그대로
  })

  it('드래그가 끝나면 멤버 확정이 풀린다', () => {
    const { onNodesChange } = useCanvasStore.getState()
    onNodesChange([{ id: 'g', type: 'position', position: { x: 50, y: 0 }, dragging: true }])
    expect(useCanvasStore.getState().groupDrag).not.toBeNull()
    onNodesChange([{ id: 'g', type: 'position', position: { x: 50, y: 0 }, dragging: false }])
    expect(useCanvasStore.getState().groupDrag).toBeNull()
  })

  it('리사이즈(드래그 아닌 위치 변경)는 안쪽 노드를 옮기지 않는다', () => {
    // 위쪽/왼쪽 핸들로 크기를 줄이면 position 이 바뀌지만 dragging 이 아니다
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'g', type: 'position', position: { x: 20, y: 20 }, dragging: false }])
    expect(posOf('g')).toEqual({ x: 20, y: 20 })
    expect(posOf('in')).toEqual({ x: 100, y: 100 }) // 그대로
  })

  it('일반 노드를 끄는 것은 다른 노드에 영향이 없다', () => {
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'in', type: 'position', position: { x: 120, y: 110 }, dragging: true }])
    expect(posOf('in')).toEqual({ x: 120, y: 110 })
    expect(posOf('g')).toEqual({ x: 0, y: 0 })
    expect(posOf('out')).toEqual({ x: 500, y: 100 })
  })

  it('그룹 이동 후 저장 정의에 옮겨진 좌표가 반영된다', () => {
    const { onNodesChange } = useCanvasStore.getState()
    onNodesChange([{ id: 'g', type: 'position', position: { x: 50, y: 30 }, dragging: true }])
    onNodesChange([{ id: 'g', type: 'position', position: { x: 50, y: 30 }, dragging: false }])
    const out = useCanvasStore.getState().toDefinition()
    expect(out.nodes.find((n) => n.id === 'in')!.position).toEqual({ x: 150, y: 130 })
    expect(useCanvasStore.getState().dirty).toBe(true)
  })
})

describe('노드 삭제 (휴지통 · Del 키)', () => {
  const WITH_GROUP: PipelineDefinition = {
    nodes: [
      {
        id: 'g',
        kind: 'note.group',
        label: '그룹 영역',
        position: { x: 0, y: 0 },
        params: { title: '영역', color: 'blue', w: 400, h: 300 },
      },
      { id: 'in', kind: 'transform.filter', label: '필터', position: { x: 100, y: 100 }, params: {} },
      { id: 'out', kind: 'target.mongo', label: 'Mongo', position: { x: 500, y: 100 }, params: {} },
    ],
    edges: [{ id: 'in->out', source: 'in', target: 'out' }],
    variables: {},
  }
  const posOf = (id: string) => useCanvasStore.getState().nodes.find((n) => n.id === id)!.position

  it('휴지통에 버리면 노드와 딸린 엣지가 사라진다', () => {
    useCanvasStore.getState().loadDefinition(WITH_GROUP)
    useCanvasStore.getState().deleteNodeRestoring('out', null)
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['g', 'in'])
    expect(useCanvasStore.getState().edges).toHaveLength(0)
    expect(useCanvasStore.getState().dirty).toBe(true)
  })

  it('그룹 영역을 버리면 따라온 노드는 원래 자리로 되돌아간다', () => {
    useCanvasStore.getState().loadDefinition(WITH_GROUP)
    const snapshot = Object.fromEntries(
      useCanvasStore.getState().nodes.map((n) => [n.id, { ...n.position }]),
    )
    // 영역을 끌어 'in' 이 함께 이동한 상태
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'g', type: 'position', position: { x: 200, y: 150 }, dragging: true }])
    expect(posOf('in')).toEqual({ x: 300, y: 250 })

    // 휴지통에 떨어뜨리면 영역만 사라지고 'in' 은 제자리로
    useCanvasStore.getState().deleteNodeRestoring('g', snapshot)
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['in', 'out'])
    expect(posOf('in')).toEqual({ x: 100, y: 100 })
    expect(posOf('out')).toEqual({ x: 500, y: 100 })
  })

  it('선택된 노드를 휴지통에 버리면 선택이 풀린다', () => {
    useCanvasStore.getState().loadDefinition(WITH_GROUP)
    useCanvasStore.getState().select('in')
    useCanvasStore.getState().deleteNodeRestoring('in', null)
    expect(useCanvasStore.getState().selectedId).toBeNull()
  })

  it('Del 키 삭제(remove 변경)로도 선택이 풀린다', () => {
    useCanvasStore.getState().loadDefinition(WITH_GROUP)
    useCanvasStore.getState().select('in')
    useCanvasStore.getState().onNodesChange([{ id: 'in', type: 'remove' }])
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['g', 'out'])
    expect(useCanvasStore.getState().selectedId).toBeNull()
    expect(useCanvasStore.getState().dirty).toBe(true)
  })

  it('다른 노드가 지워져도 선택은 유지된다', () => {
    useCanvasStore.getState().loadDefinition(WITH_GROUP)
    useCanvasStore.getState().select('in')
    useCanvasStore.getState().onNodesChange([{ id: 'out', type: 'remove' }])
    expect(useCanvasStore.getState().selectedId).toBe('in')
  })
})

describe('복사 / 붙여넣기', () => {
  const COPYABLE: PipelineDefinition = {
    nodes: [
      {
        id: 'g',
        kind: 'note.group',
        label: '그룹 영역',
        position: { x: 0, y: 0 },
        params: { title: '영역', color: 'blue', w: 400, h: 300 },
      },
      // 중심 (186,140) → 프레임 안
      { id: 'in', kind: 'transform.filter', label: '필터', position: { x: 100, y: 100 }, params: { match: 'all' } },
      // 중심 (586,140) → 프레임 밖
      { id: 'out', kind: 'target.mongo', label: 'Mongo', position: { x: 500, y: 100 }, params: { table: 'o' } },
    ],
    edges: [{ id: 'in->out', source: 'in', target: 'out' }],
    variables: {},
  }

  /** React Flow 는 선택 상태를 노드에 심는다 — 그걸 흉내낸다 */
  const selectNodes = (...ids: string[]) =>
    useCanvasStore.setState({
      nodes: useCanvasStore.getState().nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
    })
  const byId = (id: string) => useCanvasStore.getState().nodes.find((n) => n.id === id)!

  beforeEach(() => useCanvasStore.getState().loadDefinition(COPYABLE))

  it('선택이 없으면 복사해도 클립보드가 비어 있다', () => {
    useCanvasStore.getState().copySelection()
    expect(useCanvasStore.getState().clipboard).toBeNull()
  })

  it('단일 노드를 복사해 붙여넣으면 새 id 로 하나 늘어난다', () => {
    selectNodes('out')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()

    const nodes = useCanvasStore.getState().nodes
    expect(nodes).toHaveLength(4)
    const pasted = nodes.filter((n) => n.selected)
    expect(pasted).toHaveLength(1)
    expect(pasted[0].id).not.toBe('out')
    expect(pasted[0].data.kind).toBe('target.mongo')
    expect(pasted[0].data.params).toEqual({ table: 'o' })
    // 원본에서 밀려나 겹치지 않는다
    expect(pasted[0].position).toEqual({ x: 540, y: 140 })
    expect(useCanvasStore.getState().dirty).toBe(true)
  })

  it('붙여넣은 노드는 원본과 이름이 겹치지 않는다', () => {
    selectNodes('out')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    useCanvasStore.getState().pasteClipboard()

    const labels = useCanvasStore.getState().nodes.map((n) => n.data.label)
    expect(labels).toContain('Mongo 2')
    expect(labels).toContain('Mongo 3')
  })

  it('여러 노드를 복사하면 사이의 엣지도 함께 복제된다', () => {
    selectNodes('in', 'out')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()

    const { nodes, edges } = useCanvasStore.getState()
    expect(nodes).toHaveLength(5)
    expect(edges).toHaveLength(2)
    const pasted = nodes.filter((n) => n.selected).map((n) => n.id)
    const newEdge = edges.find((e) => e.id !== 'in->out')!
    // 새 엣지는 복제본끼리 이어져야 한다 (원본을 가리키면 안 된다)
    expect(pasted).toContain(newEdge.source)
    expect(pasted).toContain(newEdge.target)
  })

  it('한쪽 끝만 복사하면 그 엣지는 따라오지 않는다', () => {
    selectNodes('in')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    expect(useCanvasStore.getState().edges).toHaveLength(1) // 원본 엣지만
  })

  it('그룹 영역을 복사하면 안에 든 노드도 함께 복사된다', () => {
    selectNodes('g')
    useCanvasStore.getState().copySelection()
    expect(useCanvasStore.getState().clipboard!.nodes.map((n) => n.id).sort()).toEqual(['g', 'in'])

    useCanvasStore.getState().pasteClipboard()
    const pasted = useCanvasStore.getState().nodes.filter((n) => n.selected)
    expect(pasted).toHaveLength(2)
    expect(pasted.map((n) => n.data.kind).sort()).toEqual(['note.group', 'transform.filter'])
    // 영역 안팎의 상대 위치가 유지된다
    const frame = pasted.find((n) => n.data.kind === 'note.group')!
    const inner = pasted.find((n) => n.data.kind === 'transform.filter')!
    expect(inner.position.x - frame.position.x).toBe(100)
    expect(inner.position.y - frame.position.y).toBe(100)
  })

  it('연속으로 붙여넣으면 계단식으로 밀리고 id 가 겹치지 않는다', () => {
    selectNodes('out')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    useCanvasStore.getState().pasteClipboard()

    const nodes = useCanvasStore.getState().nodes
    expect(nodes).toHaveLength(5)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(5) // 전부 고유
    const added = nodes.filter((n) => n.id !== 'g' && n.id !== 'in' && n.id !== 'out')
    expect(added.map((n) => n.position.x).sort((a, b) => a - b)).toEqual([540, 580])
  })

  it('복사본은 원본의 실행 상태를 가져오지 않는다', () => {
    useCanvasStore.getState().applyRunStates({
      out: { status: 'success', records: 42, message: '', location: null },
    })
    selectNodes('out')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    const pasted = useCanvasStore.getState().nodes.find((n) => n.selected)!
    expect(pasted.data.runState).toBeUndefined()
    expect(byId('out').data.runState?.records).toBe(42) // 원본은 그대로
  })

  it('붙여넣으면 이전 선택은 풀리고 복사본만 선택된다', () => {
    selectNodes('out')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    expect(byId('out').selected).toBe(false)
    expect(useCanvasStore.getState().nodes.filter((n) => n.selected)).toHaveLength(1)
  })

  it('복사본은 저장 정의에 그대로 포함된다', () => {
    selectNodes('out')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    const def = useCanvasStore.getState().toDefinition()
    expect(def.nodes).toHaveLength(4)
    expect(JSON.stringify(def)).not.toContain('selected')
  })
})

describe('영역 복사 시 원본과 충돌하지 않는다', () => {
  const WITH_FRAME: PipelineDefinition = {
    nodes: [
      {
        id: 'g',
        kind: 'note.group',
        label: '그룹 영역',
        position: { x: 0, y: 0 },
        params: { title: 'SAP 수집', color: 'blue', w: 400, h: 300 },
      },
      { id: 'a', kind: 'source.postgres', label: 'A', position: { x: 40, y: 60 }, params: {} },
      { id: 'b', kind: 'target.file', label: 'B', position: { x: 200, y: 60 }, params: {} },
    ],
    edges: [{ id: 'a->b', source: 'a', target: 'b' }],
    variables: {},
  }
  const posOf = (id: string) => useCanvasStore.getState().nodes.find((n) => n.id === id)!.position
  const selectNodes = (...ids: string[]) =>
    useCanvasStore.setState({
      nodes: useCanvasStore.getState().nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
    })
  const copyPasteFrame = () => {
    selectNodes('g')
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    const pasted = useCanvasStore.getState().nodes.filter((n) => n.selected)
    return {
      frame: pasted.find((n) => n.data.kind === 'note.group')!,
      members: pasted.filter((n) => n.data.kind !== 'note.group'),
    }
  }

  beforeEach(() => useCanvasStore.getState().loadDefinition(WITH_FRAME))

  it('복사된 영역은 원본 영역과 겹치지 않는다', () => {
    const { frame } = copyPasteFrame()
    // 원본 영역은 x 0~400. 복사본은 그 오른쪽으로 완전히 비켜나야 한다.
    expect(frame.position.x).toBeGreaterThanOrEqual(400)
    expect(frame.position.y).toBe(0)
  })

  it('복사된 영역을 끌어도 원본 노드는 움직이지 않는다', () => {
    const { frame } = copyPasteFrame()
    const before = { a: { ...posOf('a') }, b: { ...posOf('b') } }

    useCanvasStore.getState().onNodesChange([
      { id: frame.id, type: 'position', position: { x: frame.position.x + 90, y: 70 }, dragging: true },
    ])

    expect(posOf('a')).toEqual(before.a) // 원본은 그대로
    expect(posOf('b')).toEqual(before.b)
  })

  it('복사된 영역을 끌면 복사된 노드들만 따라온다', () => {
    const { frame, members } = copyPasteFrame()
    const before = members.map((m) => ({ id: m.id, pos: { ...m.position } }))

    useCanvasStore.getState().onNodesChange([
      { id: frame.id, type: 'position', position: { x: frame.position.x + 50, y: 30 }, dragging: true },
    ])

    for (const m of before) {
      expect(posOf(m.id)).toEqual({ x: m.pos.x + 50, y: m.pos.y + 30 })
    }
  })

  it('영역이 겹쳐 있어도 노드는 한 영역에만 속한다', () => {
    // 원본 위에 살짝 겹치는 두 번째 영역을 손으로 올려 둔 상황
    useCanvasStore.setState({
      nodes: [
        ...useCanvasStore.getState().nodes,
        {
          id: 'g2',
          type: 'frame',
          position: { x: 20, y: 20 },
          width: 400,
          height: 300,
          zIndex: 0,
          data: { kind: 'note.group', label: '겹친 영역', params: { w: 400, h: 300 } },
        },
      ],
    })
    // 'a','b' 는 두 영역 사각형 안에 모두 들어가지만 소유는 하나뿐이어야 한다
    const beforeA = { ...posOf('a') }
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'g', type: 'position', position: { x: 500, y: 0 }, dragging: true }])
    const movedByG = posOf('a').x !== beforeA.x

    useCanvasStore.getState().loadDefinition(WITH_FRAME) // 초기화 후 반대쪽 확인
    useCanvasStore.setState({
      nodes: [
        ...useCanvasStore.getState().nodes,
        {
          id: 'g2',
          type: 'frame',
          position: { x: 20, y: 20 },
          width: 400,
          height: 300,
          zIndex: 0,
          data: { kind: 'note.group', label: '겹친 영역', params: { w: 400, h: 300 } },
        },
      ],
    })
    const beforeA2 = { ...posOf('a') }
    useCanvasStore
      .getState()
      .onNodesChange([{ id: 'g2', type: 'position', position: { x: 520, y: 20 }, dragging: true }])
    const movedByG2 = posOf('a').x !== beforeA2.x

    // 둘 중 정확히 하나만 'a' 를 데려간다 (양쪽 다 데려가면 원본이 끌려다닌다)
    expect(movedByG !== movedByG2).toBe(true)
  })
})

describe('되돌리기 (Ctrl+Z)', () => {
  const idsNow = () => useCanvasStore.getState().nodes.map((n) => n.id).sort()
  const posOf = (id: string) => useCanvasStore.getState().nodes.find((n) => n.id === id)!.position

  beforeEach(() => useCanvasStore.getState().loadDefinition(DEFINITION))

  it('갓 불러온 상태에서는 되돌릴 것이 없다', () => {
    expect(useCanvasStore.getState().past).toHaveLength(0)
    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
  })

  it('노드를 삭제한 뒤 되돌리면 노드와 엣지가 살아난다', () => {
    useCanvasStore.getState().removeNode('tgt')
    expect(idsNow()).toEqual(['src'])
    expect(useCanvasStore.getState().edges).toHaveLength(0)

    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })

  it('Del 키 삭제도 되돌릴 수 있다', () => {
    useCanvasStore.getState().onNodesChange([{ id: 'tgt', type: 'remove' }])
    expect(idsNow()).toEqual(['src'])
    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
  })

  it('휴지통 삭제도 되돌릴 수 있다', () => {
    useCanvasStore.getState().deleteNodeRestoring('tgt', null)
    expect(idsNow()).toEqual(['src'])
    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
  })

  it('노드 추가를 되돌리면 사라진다', () => {
    useCanvasStore.getState().addNode('transform.filter', { x: 10, y: 10 })
    expect(useCanvasStore.getState().nodes).toHaveLength(3)
    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
  })

  it('붙여넣기를 되돌리면 복사본만 사라진다', () => {
    useCanvasStore.setState({
      nodes: useCanvasStore.getState().nodes.map((n) => ({ ...n, selected: n.id === 'tgt' })),
    })
    useCanvasStore.getState().copySelection()
    useCanvasStore.getState().pasteClipboard()
    expect(useCanvasStore.getState().nodes).toHaveLength(3)
    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
  })

  it('드래그 이동 한 번은 되돌리기 한 단계다 (틱마다 쌓이지 않는다)', () => {
    const { onNodesChange } = useCanvasStore.getState()
    const before = { ...posOf('src') }
    // 드래그 중 여러 틱 → 마지막에 dragging:false
    onNodesChange([{ id: 'src', type: 'position', position: { x: 150, y: 60 }, dragging: true }])
    onNodesChange([{ id: 'src', type: 'position', position: { x: 200, y: 80 }, dragging: true }])
    onNodesChange([{ id: 'src', type: 'position', position: { x: 200, y: 80 }, dragging: false }])
    expect(useCanvasStore.getState().past).toHaveLength(1)

    useCanvasStore.getState().undo()
    expect(posOf('src')).toEqual(before)
  })

  it('연속 편집은 한 단계로 묶인다', () => {
    const { updateParams } = useCanvasStore.getState()
    updateParams('src', { table: 'a' })
    updateParams('src', { table: 'ab' })
    updateParams('src', { table: 'abc' })
    expect(useCanvasStore.getState().past).toHaveLength(1)

    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().nodes[0].data.params.table).toBe('customers')
  })

  it('다른 노드를 고치면 새 단계가 된다', () => {
    useCanvasStore.getState().updateParams('src', { table: 'a' })
    useCanvasStore.getState().updateParams('tgt', { path_prefix: 'b' })
    expect(useCanvasStore.getState().past).toHaveLength(2)
  })

  it('여러 번 되돌리면 단계별로 거슬러 올라간다', () => {
    useCanvasStore.getState().removeNode('tgt')
    useCanvasStore.getState().removeNode('src')
    expect(idsNow()).toEqual([])

    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src'])
    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
  })

  it('되돌린 뒤 다시하기로 복구된다', () => {
    useCanvasStore.getState().removeNode('tgt')
    useCanvasStore.getState().undo()
    expect(idsNow()).toEqual(['src', 'tgt'])
    useCanvasStore.getState().redo()
    expect(idsNow()).toEqual(['src'])
  })

  it('되돌린 뒤 새로 편집하면 다시하기 줄기는 버려진다', () => {
    useCanvasStore.getState().removeNode('tgt')
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().future).toHaveLength(1)
    useCanvasStore.getState().addNode('transform.filter', { x: 0, y: 0 })
    expect(useCanvasStore.getState().future).toHaveLength(0)
  })

  it('되돌려서 사라진 노드가 선택돼 있었다면 선택이 풀린다', () => {
    useCanvasStore.getState().addNode('transform.filter', { x: 0, y: 0 })
    const added = useCanvasStore.getState().selectedId!
    expect(added).toBeTruthy()
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().selectedId).toBeNull()
  })

  it('실행 상태 반영은 되돌리기 단계가 아니다', () => {
    useCanvasStore.getState().applyRunStates({
      src: { status: 'success', records: 5, message: '', location: null },
    })
    expect(useCanvasStore.getState().past).toHaveLength(0)
  })

  it('보관 한도를 넘으면 오래된 단계부터 버린다', () => {
    for (let i = 0; i < 60; i++) useCanvasStore.getState().addNode('transform.filter', { x: i, y: 0 })
    expect(useCanvasStore.getState().past.length).toBeLessThanOrEqual(50)
  })
})

describe('노드 결과 모으기', () => {
  const sample = (v: unknown): NodeSample => ({
    columns: ['v'],
    rows: [{ v }],
    truncated: false,
  })

  const state = (nodeId: string, extra: Record<string, unknown> = {}) => ({
    [nodeId]: {
      status: 'success',
      records: 1,
      message: '',
      location: null,
      ...extra,
    } as never,
  })

  beforeEach(() => useCanvasStore.getState().loadDefinition(DEFINITION))

  it('결과가 실린 상태만 모은다', () => {
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(1) }))
    useCanvasStore.getState().applyRunStates(state('tgt'))
    expect(Object.keys(useCanvasStore.getState().nodeResults)).toEqual(['src'])
  })

  it('결과 없는 상태 갱신이 이미 받은 결과를 지우지 않는다', () => {
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(1) }))
    useCanvasStore.getState().applyRunStates(state('src'))
    expect(useCanvasStore.getState().nodeResults.src.sample.rows).toEqual([{ v: 1 }])
  })

  it('새 결과는 덮어쓴다', () => {
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(1) }))
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(2) }))
    expect(useCanvasStore.getState().nodeResults.src.sample.rows).toEqual([{ v: 2 }])
  })

  it('실행 상태를 지워도 결과는 남는다', () => {
    // 실행마다 비우면 서랍이 매번 빈다 — 모아 두는 것이 이 기능의 요지다
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(1) }))
    useCanvasStore.getState().clearRunStates()
    expect(useCanvasStore.getState().nodeResults.src).toBeDefined()
    expect(useCanvasStore.getState().nodes[0].data.runState).toBeUndefined()
  })

  it('비우기로 지운다', () => {
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(1) }))
    useCanvasStore.getState().clearNodeResults()
    expect(useCanvasStore.getState().nodeResults).toEqual({})
  })

  it('다른 파이프라인을 열면 비워진다 (노드 id 부터 다르다)', () => {
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(1) }))
    useCanvasStore.getState().loadDefinition(DEFINITION)
    expect(useCanvasStore.getState().nodeResults).toEqual({})
  })

  it('resultEntries 는 캔버스 순서를 지키고 이름을 함께 준다', () => {
    useCanvasStore.getState().applyRunStates({
      ...state('tgt', { sample: sample(2) }),
      ...state('src', { sample: sample(1) }),
    })
    const { nodes, nodeResults } = useCanvasStore.getState()
    const entries = resultEntries(nodes, nodeResults)
    expect(entries.map((e) => e.nodeId)).toEqual(['src', 'tgt'])
    expect(entries[0].label).toBe('customers') // `${customers.컬럼}` 의 이름 자리
  })

  it('결과가 없는 노드는 목록에 없다', () => {
    useCanvasStore.getState().applyRunStates(state('src', { sample: sample(1) }))
    const { nodes, nodeResults } = useCanvasStore.getState()
    expect(resultEntries(nodes, nodeResults)).toHaveLength(1)
  })
})

describe('트리거가 넘긴 값도 결과로 모은다', () => {
  const WITH_TRIGGER: PipelineDefinition = {
    nodes: [
      {
        id: 'trg',
        kind: 'trigger.api',
        label: '웹훅',
        position: { x: 0, y: 0 },
        params: { variables: [{ name: 'since', type: 'string' }] },
      },
      ...DEFINITION.nodes,
    ],
    edges: [{ id: 'trg->src', source: 'trg', target: 'src' }, ...DEFINITION.edges],
    variables: {},
  }

  const handedState = (handed: Record<string, unknown> | undefined) => ({
    trg: { status: 'success', records: 0, message: '값 전달', location: null, handed } as never,
  })

  beforeEach(() => useCanvasStore.getState().loadDefinition(WITH_TRIGGER))

  it('트리거는 행이 아니라 값을 내보낸다 — 한 행짜리 결과로 담는다', () => {
    useCanvasStore.getState().applyRunStates(handedState({ since: '2026-08-01' }))
    const entry = resultEntries(useCanvasStore.getState().nodes, useCanvasStore.getState().nodeResults)
    expect(entry).toHaveLength(1)
    expect(entry[0].label).toBe('웹훅')
    expect(entry[0].sample.columns).toEqual(['since'])
    expect(entry[0].sample.rows).toEqual([{ since: '2026-08-01' }])
  })

  it('넘긴 값이 없으면 담지 않는다', () => {
    useCanvasStore.getState().applyRunStates(handedState({}))
    expect(useCanvasStore.getState().nodeResults).toEqual({})
  })

  it('결과 샘플이 있으면 그쪽이 이긴다', () => {
    useCanvasStore.getState().applyRunStates({
      trg: {
        status: 'success',
        records: 0,
        message: '',
        location: null,
        handed: { since: 'x' },
        sample: { columns: ['v'], rows: [{ v: 1 }], truncated: false },
      } as never,
    })
    expect(useCanvasStore.getState().nodeResults.trg.sample.columns).toEqual(['v'])
  })
})

describe('소스는 입력을 받지 않는다', () => {
  const TWO_SOURCES: PipelineDefinition = {
    nodes: [
      { id: 'trg', kind: 'trigger.schedule', label: '스케줄', position: { x: 0, y: 0 }, params: {} },
      { id: 'b', kind: 'source.mysql', label: 'B', position: { x: 100, y: 0 }, params: {} },
      { id: 'c', kind: 'source.mysql', label: 'C', position: { x: 200, y: 0 }, params: {} },
      { id: 'py', kind: 'transform.python', label: '전처리', position: { x: 300, y: 0 }, params: {} },
    ],
    edges: [],
    variables: {},
  }

  const connect = (source: string, target: string) =>
    useCanvasStore.getState().onConnect({ source, target, sourceHandle: null, targetHandle: null })

  beforeEach(() => useCanvasStore.getState().loadDefinition(TWO_SOURCES))

  it('소스 → 소스는 이어지지 않는다 — 이어도 데이터가 닿지 않는다', () => {
    connect('b', 'c')
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('변환 → 소스도 이어지지 않는다', () => {
    connect('py', 'b')
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('트리거 → 소스는 예외다 — 언제 도는지를 정해 준다', () => {
    connect('trg', 'b')
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })

  it('소스 → 변환은 정상이다', () => {
    connect('b', 'py')
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })
})
