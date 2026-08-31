import type { Edge, Node } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { EdgeChange, NodeChange, Connection as RFConnection } from '@xyflow/react'
import { create } from 'zustand'
import type { NodeSample, NodeState, PipelineDefinition } from '../api/types'
import {
  SPEC_BY_KIND,
  defaultParamsFor,
  isFrame,
  isNote,
  isSource,
  isSyncSource,
  isSyncTarget,
  isTrigger,
  nodeTypeForKind,
} from '../canvas/nodeCatalog'
import { t } from '../i18n'

export type EaiNodeData = {
  kind: string
  label: string
  params: Record<string, unknown>
  /** 실행 중 WebSocket 으로 들어오는 상태 — 저장 대상이 아니다 */
  runState?: NodeState
}

export type EaiNode = Node<EaiNodeData>

/** 노드가 마지막으로 내놓은 결과 한 건.
 *
 * ``runState.sample`` 과 같은 데이터지만 **수명이 다르다.** 실행 상태는 새 실행을 시작할 때
 * 지워지고(낡은 성공 뱃지가 거짓말을 하면 안 되므로), 결과는 남는다 — "각 노드가 무엇을
 * 내보냈나"를 모아 두는 것이 결과 서랍의 요지라 매번 비면 쓸모가 없다.
 */
export type NodeResult = {
  sample: NodeSample
  /** 언제 받은 결과인가 (epoch ms) — 낡은 값을 최신값으로 착각하지 않게 한다 */
  at: number
}

/** 그룹 영역을 끄는 동안 함께 움직일 노드들. 드래그 시작 때 한 번 정해 끝까지 유지한다 —
 *  매 틱 다시 판정하면 프레임이 지나가며 훑은 노드까지 딸려온다. */
type GroupDrag = { frameId: string; memberIds: string[] }

/** 캔버스 내부 클립보드. OS 클립보드를 쓰지 않아 권한·형식 문제가 없다. */
type Clipboard = { nodes: EaiNode[]; edges: Edge[] }

/** 붙여넣을 때마다 원본에서 밀어내는 간격(px) */
const PASTE_OFFSET = 40
/** 영역을 붙여넣을 때 원본 영역과 벌려 둘 간격(px) */
const PASTE_GAP = 60

/** 되돌리기 한 칸 = 그 편집 **직전**의 그래프 */
type HistoryEntry = { nodes: EaiNode[]; edges: Edge[] }
/** 되돌리기 보관 한도 (메모리 상한) */
const HISTORY_LIMIT = 50
/** 이 시간 안에 같은 대상을 연달아 고치면 한 단계로 묶는다 — 글자마다 되돌리면 못 쓴다 */
const COALESCE_MS = 800

type CanvasState = {
  nodes: EaiNode[]
  edges: Edge[]
  selectedId: string | null
  dirty: boolean
  /** 마지막 실행에 넘긴 `$변수` 값 {이름: 값}. 저장 대상이 아니다. */
  runVariables: Record<string, string | number | boolean>
  /** 노드 id → 그 노드가 마지막으로 내놓은 결과. 결과 서랍과 `${이름.컬럼}` 자동완성의 근거다. */
  nodeResults: Record<string, NodeResult>
  /** 저장 대상이 아닌 일시 상태 */
  groupDrag: GroupDrag | null
  clipboard: Clipboard | null
  /** 연속으로 붙여넣을 때 계단식으로 밀어내기 위한 횟수 */
  pasteCount: number

  /** 되돌리기/다시하기 스택 */
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** 드래그·리사이즈 한 번을 한 단계로 묶기 위한 진행 표시 */
  historyGuard: 'drag' | 'resize' | null
  /** 연속 편집 묶기용 (대상 키 + 시각) */
  lastEditKey: string | null
  lastEditAt: number

  loadDefinition: (definition: PipelineDefinition) => void
  toDefinition: () => PipelineDefinition

  onNodesChange: (changes: NodeChange<EaiNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: RFConnection) => void

  addNode: (kind: string, position: { x: number; y: number }) => void
  updateParams: (id: string, params: Record<string, unknown>) => void
  updateLabel: (id: string, label: string) => void
  removeNode: (id: string) => void
  /** 휴지통에 떨어뜨려 삭제. ``snapshot`` 이 있으면 나머지 노드를 드래그 시작 위치로 되돌린다 —
   *  그룹 영역을 끌면 안의 노드들이 따라오는데, 영역만 버릴 때 그것들까지 딸려가면 안 되기 때문. */
  deleteNodeRestoring: (id: string, snapshot: Record<string, { x: number; y: number }> | null) => void
  select: (id: string | null) => void

  /** 선택된 노드를 클립보드에 담는다. 그룹 영역을 고르면 그 안의 노드도 함께 담긴다. */
  copySelection: () => void
  /** 클립보드 내용을 새 id 로 붙여넣고, 붙여넣은 것들을 선택 상태로 만든다. */
  pasteClipboard: () => void

  applyRunStates: (states: Record<string, NodeState>) => void
  clearRunStates: () => void
  /** 모아 둔 노드 결과를 비운다 (결과 서랍의 '비우기'). */
  clearNodeResults: () => void
  /** 마지막 실행에 넘긴 `$변수` 값. SQL 편집기 왼쪽 패널이 "지금 무슨 값이 들어오나"로 쓴다.
   *  실행 결과가 아니라 **투입값**이라 runState 와 달리 노드에 붙지 않는다. */
  setRunVariables: (variables: Record<string, string | number | boolean>) => void
  markClean: () => void

  /** 직전 편집 한 단계를 되돌린다 */
  undo: () => void
  /** 되돌린 것을 다시 적용한다 */
  redo: () => void
}

/** 편집 직전 상태를 히스토리에 적는다. 스토어가 전부 불변 갱신이라 배열 참조만 담아도 안전하다. */
function recordHistory(state: CanvasState) {
  return {
    past: [...state.past, { nodes: state.nodes, edges: state.edges }].slice(-HISTORY_LIMIT),
    future: [], // 새 편집이 생기면 다시하기 줄기는 버린다
    lastEditKey: null,
  }
}

/** 같은 대상을 짧은 간격으로 계속 고치는 중인가 (한 단계로 묶을지 판단) */
function isCoalescing(state: CanvasState, key: string): boolean {
  return state.lastEditKey === key && Date.now() - state.lastEditAt < COALESCE_MS
}

/** 삭제 하나를 한 단계로 묶는 시간(ms) — 같은 틱에 들어오는 변경만 잡을 짧은 창 */
const REMOVE_COALESCE_MS = 100

/** 삭제를 히스토리에 적는다.
 *
 * 노드 하나를 지워도 React Flow 는 **엣지 변경과 노드 변경을 따로** 보내온다.
 * 각각 한 단계로 적으면 Ctrl+Z 한 번에 절반만 되돌아가므로(노드만 살고 엣지는 안 살아남),
 * 같은 순간에 들어온 삭제는 한 단계로 묶는다. 먼저 적힌 스냅샷이 삭제 직전의 온전한 상태다.
 */
function recordRemoval(state: CanvasState) {
  if (state.lastEditKey === 'remove' && Date.now() - state.lastEditAt < REMOVE_COALESCE_MS) {
    return { lastEditAt: Date.now() }
  }
  return { ...recordHistory(state), lastEditKey: 'remove', lastEditAt: Date.now() }
}

/** 숫자로 쓸 수 있으면 그 값, 아니면 기본값 (Number() 는 실패 시 NaN 이라 ?? 로는 못 거른다) */
function numberOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 프레임이 차지하는 사각형 (절대 좌표). 크기는 리사이즈 결과(width/height) 우선. */
function frameRect(frame: EaiNode) {
  const w = numberOr(frame.width ?? frame.data.params.w, 320)
  const h = numberOr(frame.height ?? frame.data.params.h, 200)
  return { x0: frame.position.x, y0: frame.position.y, x1: frame.position.x + w, y1: frame.position.y + h }
}

/** 노드가 차지하는 크기. 프레임은 리사이즈 결과를, 일반 노드는 측정값을 쓴다. */
function nodeSize(node: EaiNode): { w: number; h: number } {
  if (isFrame(node.data.kind)) {
    const r = frameRect(node)
    return { w: r.x1 - r.x0, h: r.y1 - r.y0 }
  }
  return {
    w: node.measured?.width ?? node.width ?? 172,
    h: node.measured?.height ?? node.height ?? 80,
  }
}

/** 노드 중심점 — 모서리가 살짝 걸친 정도로는 그룹에 넣지 않으려고 중심으로 판정한다. */
function nodeCenter(node: EaiNode) {
  const { w, h } = nodeSize(node)
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 }
}

/** 이 노드를 소유하는 영역 하나를 정한다.
 *
 * 영역이 겹치면 한 노드가 여러 사각형 안에 들어간다. 그대로 두면 겹친 영역을 끌 때
 * 남의 노드까지 딸려가므로(복사 직후가 대표적), **소유권을 하나로 못 박는다**:
 * 더 작은 영역이 우선(중첩이면 안쪽), 크기가 같으면 나중에 추가된 영역이 가져간다.
 */
function owningFrameId(nodes: EaiNode[], node: EaiNode): string | null {
  const c = nodeCenter(node)
  let ownerId: string | null = null
  let ownerArea = Infinity
  for (const frame of nodes) {
    if (!isFrame(frame.data.kind) || frame.id === node.id) continue
    const r = frameRect(frame)
    if (c.x < r.x0 || c.x > r.x1 || c.y < r.y0 || c.y > r.y1) continue
    const area = (r.x1 - r.x0) * (r.y1 - r.y0)
    if (area <= ownerArea) {
      ownerArea = area
      ownerId = frame.id
    }
  }
  return ownerId
}

/** 이 영역이 소유한 노드들 (프레임 자신·다른 프레임 제외) */
function membersInside(nodes: EaiNode[], frame: EaiNode): string[] {
  return nodes
    .filter(
      (n) =>
        n.id !== frame.id &&
        !isFrame(n.data.kind) &&
        owningFrameId(nodes, n) === frame.id,
    )
    .map((n) => n.id)
}

/** 이름 비교 기준 — 앞뒤 공백을 지우고 대소문자를 무시한다.
 *  눈으로 구분되지 않는 두 이름은 같은 이름으로 본다. */
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase()
}

/** 이름이 겹치는가 (``exceptId`` 는 자기 자신을 뺄 때 쓴다).
 *
 * 메모·영역은 캔버스 주석이라 이름을 쓰지도, 보여주지도 않는다 — 유일성 대상에서 뺀다. */
export function isLabelTaken(nodes: EaiNode[], label: string, exceptId?: string): boolean {
  const key = normalizeLabel(label)
  return nodes.some(
    (n) => n.id !== exceptId && !isNote(n.data.kind) && normalizeLabel(n.data.label) === key,
  )
}

/** 겹치지 않는 이름을 만든다.
 *
 * 겹치면 뒤에 번호를 붙이고, 이미 번호가 붙어 있으면 그 번호를 올린다
 * ("MySQL 소스" → "MySQL 소스 2" → "MySQL 소스 3"). 번호를 무조건 덧붙이면
 * "MySQL 소스 2 2" 처럼 길어지기만 한다. */
export function uniqueLabel(nodes: EaiNode[], desired: string, exceptId?: string): string {
  const base = desired.trim() || t('node.defaultLabel')
  if (!isLabelTaken(nodes, base, exceptId)) return base

  const numbered = /^(.*\S)\s+(\d+)$/.exec(base)
  const stem = numbered ? numbered[1] : base
  let n = numbered ? Number(numbered[2]) : 1
  let candidate: string
  do {
    n += 1
    candidate = `${stem} ${n}`
  } while (isLabelTaken(nodes, candidate, exceptId))
  return candidate
}

let idCounter = 0
function nextId(kind: string): string {
  idCounter += 1
  return `${kind.split('.')[1] ?? 'node'}_${Date.now().toString(36)}${idCounter}`
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  dirty: false,
  runVariables: {},
  nodeResults: {},
  groupDrag: null,
  clipboard: null,
  pasteCount: 0,
  past: [],
  future: [],
  historyGuard: null,
  lastEditKey: null,
  lastEditAt: 0,

  loadDefinition: (definition) =>
    set({
      // 이름 유일성은 여기서도 지킨다 — 이름 규칙이 생기기 전에 저장된 정의나
      // API 로 직접 넣은 정의에는 같은 이름이 섞여 있을 수 있다.
      nodes: definition.nodes.reduce<EaiNode[]>((acc, n) => {
        const frame = isFrame(n.kind)
        const p = n.params as Record<string, unknown>
        const spec = SPEC_BY_KIND[n.kind]
        const desired = n.label || (spec ? t(spec.titleKey) : n.kind)
        acc.push({
          id: n.id,
          type: nodeTypeForKind(n.kind),
          position: n.position,
          // 그룹 프레임은 크기를 갖고 노드들보다 뒤에 깔린다 (zIndex 0 < 일반 노드 1)
          ...(frame
            ? { width: Number(p.w) || 320, height: Number(p.h) || 200 }
            : {}),
          zIndex: frame ? 0 : 1,
          data: {
            kind: n.kind,
            label: isNote(n.kind) ? desired : uniqueLabel(acc, desired),
            params: p,
          },
        })
        return acc
      }, []),
      edges: definition.edges.map((e) => ({
        id: e.id || `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        // 스위치 등 다중 출력 노드의 출력 포트 (백엔드 source_handle 과 짝)
        sourceHandle: e.source_handle ?? undefined,
        type: 'result',
        animated: true,
      })),
      selectedId: null,
      dirty: false,
      // 다른 파이프라인을 열면 이전 파이프라인의 결과·되돌리기 기록은 무의미하다
      // (노드 id 부터 다르다)
      nodeResults: {},
      past: [],
      future: [],
      historyGuard: null,
      lastEditKey: null,
    }),

  toDefinition: () => {
    const { nodes, edges } = get()
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data.kind as PipelineDefinition['nodes'][number]['kind'],
        label: n.data.label,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        params: n.data.params,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        // 스위치 등 다중 출력에서만 포함한다 — 단일 출력 엣지는 깔끔하게 유지
        ...(e.sourceHandle ? { source_handle: e.sourceHandle } : {}),
      })),
      variables: {},
    }
  },

  onNodesChange: (changes) =>
    set((state) => {
      let nodes = applyNodeChanges(changes, state.nodes)
      let groupDrag = state.groupDrag

      // 되돌리기 한 단계 기록. 드래그·리사이즈는 매 틱이 아니라 **시작할 때 한 번**만 적어야
      // Ctrl+Z 한 번에 이동 전체가 되돌아간다. 측정용 dimensions 변경은 편집이 아니라 제외.
      const hasRemoval = changes.some((c) => c.type === 'remove')
      const dragging = changes.some((c) => c.type === 'position' && c.dragging === true)
      const resizing = changes.some((c) => c.type === 'dimensions' && c.resizing === true)
      const settled =
        changes.some((c) => c.type === 'position' && c.dragging === false) ||
        changes.some((c) => c.type === 'dimensions' && c.resizing === false)

      let history: Partial<CanvasState> = {}
      let historyGuard = state.historyGuard
      if (hasRemoval) {
        history = recordRemoval(state)
      } else if (dragging && historyGuard !== 'drag') {
        history = recordHistory(state)
        historyGuard = 'drag'
      } else if (resizing && historyGuard !== 'resize') {
        history = recordHistory(state)
        historyGuard = 'resize'
      }
      if (settled) historyGuard = null

      // 그룹 영역을 끌면 그 안의 노드들도 같은 만큼 따라 움직인다.
      // 리사이즈도 position 변경을 내지만 dragging 이 아니므로 여기 걸리지 않는다.
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue
        const frame = state.nodes.find((n) => n.id === change.id)
        if (!frame || !isFrame(frame.data.kind)) continue

        if (change.dragging !== true) {
          if (groupDrag?.frameId === change.id) groupDrag = null // 드래그 종료
          continue
        }

        const delta = {
          x: change.position.x - frame.position.x,
          y: change.position.y - frame.position.y,
        }
        if (delta.x === 0 && delta.y === 0) continue

        // 첫 틱에 멤버를 확정하고 드래그 내내 유지한다
        if (groupDrag?.frameId !== change.id) {
          groupDrag = { frameId: change.id, memberIds: membersInside(state.nodes, frame) }
        }
        const members = new Set(groupDrag.memberIds)
        if (members.size === 0) continue
        nodes = nodes.map((n) =>
          members.has(n.id)
            ? { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } }
            : n,
        )
      }

      // Del 키 삭제는 React Flow 가 remove 변경으로 알려온다 — 지워진 노드가
      // 선택 상태였다면 설정 패널이 유령 노드를 붙들지 않도록 선택을 푼다.
      const removed = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => c.id),
      )
      const selectedId =
        state.selectedId && removed.has(state.selectedId) ? null : state.selectedId

      // 위치 이동(dragging 중 제외)이나 삭제만 저장이 필요한 변경으로 본다
      const meaningful = changes.some(
        (c) => c.type === 'remove' || (c.type === 'position' && !c.dragging),
      )
      return {
        ...history,
        nodes,
        groupDrag,
        historyGuard,
        selectedId,
        dirty: state.dirty || meaningful,
      }
    }),

  onEdgesChange: (changes) =>
    set((state) => {
      const removed = changes.some((c) => c.type === 'remove')
      return {
        ...(removed ? recordRemoval(state) : {}),
        edges: applyEdgeChanges(changes, state.edges),
        dirty: state.dirty || removed,
      }
    }),

  onConnect: (connection) =>
    set((state) => {
      if (!connection.source || !connection.target) return state
      if (connection.source === connection.target) return state
      // 소스는 받을 것이 없다 — 트리거만 예외로 "언제 도는지"를 정해 준다.
      // 엔진은 소스를 만나면 상류를 조립하지 않고 곧장 읽으므로, 이어 두어도 데이터가
      // 닿지 않고 조용히 사라진다. 못 하는 일은 애초에 그릴 수 없게 한다.
      const from = state.nodes.find((n) => n.id === connection.source)
      const to = state.nodes.find((n) => n.id === connection.target)
      if (to && isSource(to.data.kind) && from && !isTrigger(from.data.kind)) return state
      // 실시간 동기화는 데이터가 워커를 지나지 않는다 — SymmetricDS 가 타깃 DB 로 직송한다.
      // 사이에 변환 노드를 끼우면 화면에는 이어져 보이는데 아무 일도 일어나지 않으므로,
      // 소스는 동기화 타깃에만, 타깃은 동기화 소스에서만 받게 한다 (위 규칙과 같은 계열).
      if (from && isSyncSource(from.data.kind) && to && !isSyncTarget(to.data.kind)) return state
      if (to && isSyncTarget(to.data.kind) && from && !isSyncSource(from.data.kind)) return state
      // 같은 쌍을 두 번 잇지 않는다. 단, 스위치처럼 출력 포트(sourceHandle)가 다르면
      // 같은 노드 쌍이라도 별개의 엣지로 허용한다.
      const exists = state.edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          (e.sourceHandle ?? null) === (connection.sourceHandle ?? null),
      )
      if (exists) return state
      return {
        ...recordHistory(state),
        edges: addEdge({ ...connection, type: 'result', animated: true }, state.edges),
        dirty: true,
      }
    }),

  addNode: (kind, position) =>
    set((state) => {
      const spec = SPEC_BY_KIND[kind]
      if (!spec) return state
      const id = nextId(kind)
      const frame = isFrame(kind)
      const node: EaiNode = {
        id,
        type: nodeTypeForKind(kind),
        position,
        ...(frame
          ? { width: Number(spec.defaultParams.w) || 320, height: Number(spec.defaultParams.h) || 200 }
          : {}),
        zIndex: frame ? 0 : 1,
        // 같은 종류를 여러 개 놓으면 이름이 겹친다 — 뒤에 번호를 붙여 유일하게 만든다
        data: {
          kind,
          label: isNote(kind) ? t(spec.titleKey) : uniqueLabel(state.nodes, t(spec.titleKey)),
          params: defaultParamsFor(spec),
        },
      }
      return { ...recordHistory(state), nodes: [...state.nodes, node], selectedId: id, dirty: true }
    }),

  updateParams: (id, params) =>
    set((state) => {
      const key = `params:${id}`
      return {
        // 같은 노드를 연달아 고치는 중이면 한 단계로 묶는다 (글자마다 되돌리지 않도록)
        ...(isCoalescing(state, key) ? {} : recordHistory(state)),
        lastEditKey: key,
        lastEditAt: Date.now(),
        nodes: state.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } } : n,
        ),
        dirty: true,
      }
    }),

  updateLabel: (id, label) =>
    set((state) => {
      const trimmed = label.trim()
      // 빈 이름·이미 있는 이름은 받지 않는다. 입력 중인 글자는 설정 패널이 들고 있으므로
      // 여기서 거절해도 타이핑이 막히지 않는다 — 그래프에는 마지막으로 유효했던 이름만 남는다.
      if (!trimmed || isLabelTaken(state.nodes, trimmed, id)) return state
      const key = `label:${id}`
      return {
        ...(isCoalescing(state, key) ? {} : recordHistory(state)),
        lastEditKey: key,
        lastEditAt: Date.now(),
        nodes: state.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, label: trimmed } } : n,
        ),
        dirty: true,
      }
    }),

  removeNode: (id) =>
    set((state) => ({
      ...recordHistory(state),
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      groupDrag: null,
      dirty: true,
    })),

  deleteNodeRestoring: (id, snapshot) =>
    set((state) => ({
      ...recordHistory(state),
      nodes: state.nodes
        .filter((n) => n.id !== id)
        // 드래그 시작 위치로 되돌린다. 함께 끌려온 그룹 멤버만 실제로 바뀐다.
        .map((n) => (snapshot?.[n.id] ? { ...n, position: { ...snapshot[n.id] } } : n)),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      groupDrag: null,
      dirty: true,
    })),

  select: (id) => set({ selectedId: id }),

  copySelection: () =>
    set((state) => {
      const selected = state.nodes.filter((n) => n.selected)
      if (selected.length === 0) return state

      // 그룹 영역을 복사하면 그 안의 노드까지 담는다 — 빈 상자만 복제하면 쓸모가 없다
      const ids = new Set(selected.map((n) => n.id))
      for (const n of selected) {
        if (isFrame(n.data.kind)) membersInside(state.nodes, n).forEach((id) => ids.add(id))
      }

      const nodes = state.nodes
        .filter((n) => ids.has(n.id))
        // 원본이 나중에 바뀌어도 클립보드가 따라 변하지 않도록 복제하고,
        // 실행 상태(runState)는 복사 대상이 아니다
        .map((n) => ({
          ...n,
          selected: false,
          data: { ...n.data, params: { ...n.data.params }, runState: undefined },
        }))
      // 복사한 노드끼리 이어진 엣지만 가져간다 (한쪽 끝이 밖이면 의미가 없다)
      const edges = state.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
      return { clipboard: { nodes, edges }, pasteCount: 0 }
    }),

  pasteClipboard: () =>
    set((state) => {
      const clip = state.clipboard
      if (!clip || clip.nodes.length === 0) return state

      const step = state.pasteCount + 1
      // 영역을 붙여넣을 때 살짝만 밀면 원본 영역과 겹쳐, 겹친 영역이 원본 노드까지
      // 자기 멤버로 끌고 간다. 복사본 전체 폭만큼 옆으로 비켜 놓는다.
      const hasFrame = clip.nodes.some((n) => isFrame(n.data.kind))
      let dx = PASTE_OFFSET * step
      let dy = PASTE_OFFSET * step
      if (hasFrame) {
        const left = Math.min(...clip.nodes.map((n) => n.position.x))
        const right = Math.max(...clip.nodes.map((n) => n.position.x + nodeSize(n).w))
        dx = (right - left + PASTE_GAP) * step
        dy = 0
      }
      const idMap = new Map<string, string>()

      // 붙여넣은 것끼리도 이름이 겹치면 안 되므로, 지어 준 이름을 그때그때 목록에 더한다
      const taken = [...state.nodes]
      const pasted = clip.nodes.map((n) => {
        const id = nextId(n.data.kind)
        idMap.set(n.id, id)
        const copy = {
          ...n,
          id,
          position: { x: n.position.x + dx, y: n.position.y + dy },
          selected: true,
          data: {
            ...n.data,
            label: isNote(n.data.kind) ? n.data.label : uniqueLabel(taken, n.data.label),
            params: { ...n.data.params },
          },
        }
        taken.push(copy)
        return copy
      })
      const pastedEdges = clip.edges.map((e) => {
        const source = idMap.get(e.source) as string
        const target = idMap.get(e.target) as string
        return { ...e, id: `${source}->${target}`, source, target, selected: false }
      })

      return {
        ...recordHistory(state),
        // 기존 선택은 풀고 새로 붙여넣은 것만 선택 — 바로 끌어 옮길 수 있게
        nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), ...pasted],
        edges: [...state.edges, ...pastedEdges],
        selectedId: pasted.length === 1 ? pasted[0].id : null,
        pasteCount: step,
        dirty: true,
      }
    }),

  applyRunStates: (states) =>
    set((state) => {
      // 결과가 실린 상태만 서랍에 쌓는다. 상태 갱신은 실행 중 수십 번 오는데 대부분
      // sample 이 없다 — 그때마다 덮어쓰면 방금 받은 결과가 빈 값으로 지워진다.
      const nodeResults = { ...state.nodeResults }
      const now = Date.now()
      for (const [id, s] of Object.entries(states)) {
        if (s.sample) nodeResults[id] = { sample: s.sample, at: now }
        else if (s.handed && Object.keys(s.handed).length > 0) {
          nodeResults[id] = { sample: handedAsSample(s.handed), at: now }
        }
      }
      return {
        nodes: state.nodes.map((n) =>
          states[n.id] ? { ...n, data: { ...n.data, runState: states[n.id] } } : n,
        ),
        nodeResults,
      }
    }),

  clearRunStates: () =>
    set((state) => ({
      nodes: state.nodes.map((n) => ({ ...n, data: { ...n.data, runState: undefined } })),
    })),

  clearNodeResults: () => set({ nodeResults: {} }),

  // 투입값은 지우지 않는다 — 다음 실행 전까지 "직전에 무슨 값으로 돌렸나"가 남아야
  // 편집기에서 쿼리를 고칠 때 참고할 수 있다.
  setRunVariables: (variables) => set({ runVariables: variables }),

  markClean: () => set({ dirty: false }),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        past: state.past.slice(0, -1),
        future: [...state.future, { nodes: state.nodes, edges: state.edges }],
        nodes: previous.nodes,
        edges: previous.edges,
        // 되돌린 뒤 사라진 노드를 설정 패널이 붙들고 있으면 안 된다
        selectedId: previous.nodes.some((n) => n.id === state.selectedId) ? state.selectedId : null,
        groupDrag: null,
        historyGuard: null,
        lastEditKey: null,
        dirty: true,
      }
    }),

  redo: () =>
    set((state) => {
      const next = state.future[state.future.length - 1]
      if (!next) return state
      return {
        past: [...state.past, { nodes: state.nodes, edges: state.edges }].slice(-HISTORY_LIMIT),
        future: state.future.slice(0, -1),
        nodes: next.nodes,
        edges: next.edges,
        selectedId: next.nodes.some((n) => n.id === state.selectedId) ? state.selectedId : null,
        groupDrag: null,
        historyGuard: null,
        lastEditKey: null,
        dirty: true,
      }
    }),
}))

/** 트리거가 하류로 넘긴 값 `{이름: 값}` 을 한 행짜리 결과로 본다.
 *
 * 트리거는 데이터를 내보내지 않지만 **값은 내보낸다** — 결과 서랍에서 다른 노드와 같은
 * 모양으로 다루기 위한 변환이다. 다만 이 값을 쓰는 표기는 다르다: 노드 결과가 아니라
 * 트리거 변수라 `${이름.컬럼}` 이 아니라 `$이름` 으로 쓴다 (서랍이 노드 종류를 보고 가른다).
 */
function handedAsSample(handed: Record<string, unknown>): NodeSample {
  return { columns: Object.keys(handed), rows: [handed], truncated: false }
}

/** 결과 서랍 한 칸 — `{노드이름: 출력결과}` 의 한 항목. */
export type ResultEntry = {
  nodeId: string
  /** 노드 이름. 그대로 `${이름.컬럼}` 의 이름 자리에 들어간다 (그래서 이름이 유일해야 한다) */
  label: string
  kind: string
  sample: NodeSample
  at: number
}

/** 모아 둔 결과를 캔버스 순서대로 늘어놓는다.
 *
 * 최신순으로 정렬하지 않는 것은 의도다 — 실행이 진행될 때마다 칩이 자리를 바꾸면
 * 방금 누르려던 것을 놓친다. 언제 받은 결과인지는 ``at`` 으로 따로 보여준다.
 */
export function resultEntries(
  nodes: EaiNode[],
  nodeResults: Record<string, NodeResult>,
): ResultEntry[] {
  return nodes
    .filter((n) => nodeResults[n.id])
    .map((n) => ({
      nodeId: n.id,
      label: n.data.label,
      kind: n.data.kind,
      sample: nodeResults[n.id].sample,
      at: nodeResults[n.id].at,
    }))
}

/** 트리거·메모는 실행 대상이 아니므로 진행률 계산에서 뺀다 */
export function executableNodeIds(nodes: EaiNode[]): string[] {
  return nodes.filter((n) => !isTrigger(n.data.kind) && !isNote(n.data.kind)).map((n) => n.id)
}
