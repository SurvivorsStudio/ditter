import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  usePipeline,
  useRunPipeline,
  useSavePipeline,
  useStartStream,
  useStartSync,
  useStreams,
  useSyncPreflight,
  useValidatePipeline,
} from '../api/hooks'
import { useRunStream, isTerminal } from '../api/useRunStream'
import { isCdcSource, isCdcTrigger, isSyncKind } from '../canvas/nodeCatalog'
import { SyncPreflightModal } from '../canvas/SyncPreflightModal'
import { ConfigPanel } from '../canvas/ConfigPanel'
import { EaiNode } from '../canvas/EaiNode'
import { GroupNode } from '../canvas/GroupNode'
import { MemoNode } from '../canvas/MemoNode'
import { NodeActionsContext } from '../canvas/nodeActions'
import { NodeSampleModal } from '../canvas/NodeSampleModal'
import { TestRunModal } from '../canvas/TestRunModal'
import { EdgeValueModal } from '../canvas/EdgeValueModal'
import type { TriggerVariable } from '../api/types'
import { NODE_H, NODE_W, Palette } from '../canvas/Palette'
import { ResultDrawer } from '../canvas/ResultDrawer'
import { ResultEdge } from '../canvas/ResultEdge'
import { Banner, EmptyState, Spinner, formatTime } from '../components/common'
import { Icon } from '../components/icons'
import { useT } from '../i18n'
import { useCanvasStore } from '../store/canvasStore'

const nodeTypes = { eai: EaiNode, memo: MemoNode, frame: GroupNode }
const edgeTypes = { result: ResultEdge }

/** 파이프라인 저작 캔버스.
 *
 *  라우트(`/canvas/:pipelineId`)로도 열리고 **SQL 편집기의 탭 안에서도** 열린다.
 *  탭에서는 경로 파라미터가 없으므로 `pipelineId` 를 prop 으로 받는다.
 *
 *  주의: 캔버스 상태(`useCanvasStore`)는 **모듈 전역 싱글턴**이다. 그래서 한 화면에
 *  둘 이상 띄우면 서로의 그래프를 덮어쓴다 — 탭에서 여는 쪽(`SqlEditorPage`)이
 *  "지금 편집 중인 탭" 하나만 마운트하도록 막고 있다. 그 전제를 깨면 조용히 깨진다. */
export function Canvas({ pipelineId, embedded }: { pipelineId?: string; embedded?: boolean } = {}) {
  return (
    <ReactFlowProvider>
      <CanvasInner pipelineId={pipelineId} embedded={embedded ?? false} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ pipelineId: propId, embedded }: { pipelineId?: string; embedded: boolean }) {
  const t = useT()
  const params = useParams<{ pipelineId: string }>()
  const pipelineId = propId ?? params.pipelineId
  const navigate = useNavigate()
  const { screenToFlowPosition } = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)

  const { data: pipeline, isLoading, error } = usePipeline(pipelineId)
  const save = useSavePipeline()
  const run = useRunPipeline()
  const startStream = useStartStream()
  const startSync = useStartSync()
  const syncPreflight = useSyncPreflight()
  const { data: validation, refetch: revalidate } = useValidatePipeline(pipelineId)

  const {
    nodes,
    edges,
    dirty,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    select,
    loadDefinition,
    toDefinition,
    applyRunStates,
    clearRunStates,
    runVariables,
    setRunVariables,
    markClean,
  } = useCanvasStore()

  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runNodeId, setRunNodeId] = useState<string | null>(null)
  const [resultNodeId, setResultNodeId] = useState<string | null>(null)
  /** 값 입력 모달 — `triggerId` 는 변수 선언을 읽어올 트리거, `target` 은 실제로 돌릴 노드.
   *  둘이 같으면 "값 확인만", 다르면 그 노드까지의 부분 실행이다. */
  const [testRun, setTestRun] = useState<{ triggerId: string; target: string } | null>(null)
  /** 값 보기 모달을 띄운 엣지 (상류→하류) */
  const [edgeValues, setEdgeValues] = useState<{ sourceId: string; targetId: string } | null>(null)
  // 노드를 끄는 동안에만 나타나는 하단 휴지통
  const [draggingNode, setDraggingNode] = useState(false)
  const [overTrash, setOverTrash] = useState(false)
  const trashRef = useRef<HTMLDivElement>(null)
  /** 드래그 시작 시점의 전체 노드 위치 — 그룹 영역을 버릴 때 멤버를 되돌리는 데 쓴다 */
  const dragSnapshot = useRef<Record<string, { x: number; y: number }> | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const stream = useRunStream(activeRunId)

  // 이 파이프라인에 실행 중(또는 일시정지)인 CDC 스트림이 있는가.
  // 있으면 편집·저장이 그 스트림에 자동 반영되지 않으므로 경고한다.
  const { data: allStreams } = useStreams()
  const activeStream = (allStreams ?? []).find(
    (s) => s.pipeline_id === pipelineId && ['provisioning', 'running', 'paused'].includes(s.status),
  )
  const [streamWarn, setStreamWarn] = useState(false)

  // 서버 정의를 캔버스로 적재 (파이프라인이 바뀔 때만)
  const loadedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (pipeline && loadedIdRef.current !== pipeline.id) {
      loadedIdRef.current = pipeline.id
      loadDefinition(pipeline.definition)
      clearRunStates()
      setActiveRunId(null)
    }
  }, [pipeline, loadDefinition, clearRunStates])

  // 실행 중 노드 상태를 캔버스 뱃지에 반영 (설계 문서 §8)
  useEffect(() => {
    if (Object.keys(stream.nodeStates).length > 0) applyRunStates(stream.nodeStates)
  }, [stream.nodeStates, applyRunStates])

  useEffect(() => {
    if (activeRunId && isTerminal(stream.status)) {
      const scope = runNodeId ? t('canvasPage.nodeScope', { id: runNodeId }) : ''
      setMessage(
        stream.status === 'success'
          ? { kind: 'ok', text: t('canvasPage.runDone', { scope, n: stream.records }) }
          : {
              kind: 'error',
              text: t('canvasPage.runEnded', {
                scope,
                status: stream.status,
                error: stream.error ?? t('canvasPage.unknownCause'),
              }),
            },
      )
      setRunNodeId(null)
    }
  }, [stream.status, stream.records, stream.error, activeRunId, runNodeId, t])

  /** 포인터가 휴지통 위인가 (드래그 중에만 의미 있음) */
  const isOverTrash = useCallback((event: MouseEvent | TouchEvent) => {
    const el = trashRef.current
    if (!el) return false
    const point =
      'clientX' in event ? event : (event.changedTouches[0] ?? event.touches[0] ?? null)
    if (!point) return false
    const r = el.getBoundingClientRect()
    return (
      point.clientX >= r.left &&
      point.clientX <= r.right &&
      point.clientY >= r.top &&
      point.clientY <= r.bottom
    )
  }, [])

  const onNodeDragStart = useCallback(() => {
    setDraggingNode(true)
    dragSnapshot.current = Object.fromEntries(
      useCanvasStore.getState().nodes.map((n) => [n.id, { ...n.position }]),
    )
  }, [])

  const onNodeDrag = useCallback(
    (event: MouseEvent | TouchEvent) => setOverTrash(isOverTrash(event)),
    [isOverTrash],
  )

  const onNodeDragStop = useCallback(
    (event: MouseEvent | TouchEvent, node: { id: string }) => {
      if (isOverTrash(event)) {
        useCanvasStore.getState().deleteNodeRestoring(node.id, dragSnapshot.current)
      }
      setDraggingNode(false)
      setOverTrash(false)
      dragSnapshot.current = null
    },
    [isOverTrash],
  )

  // 복사(Ctrl/Cmd+C) · 붙여넣기(Ctrl/Cmd+V). 입력창에 포커스가 있거나 텍스트를
  // 드래그 선택한 상태면 브라우저 기본 동작을 방해하지 않는다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'c') {
        if (window.getSelection()?.toString()) return // 텍스트 복사는 그대로 둔다
        const store = useCanvasStore.getState()
        store.copySelection()
        const count = useCanvasStore.getState().clipboard?.nodes.length ?? 0
        if (count > 0) {
          setMessage({ kind: 'ok', text: t('canvasPage.copiedNodes', { n: count }) })
        }
      } else if (key === 'v') {
        if (!useCanvasStore.getState().clipboard) return
        event.preventDefault()
        useCanvasStore.getState().pasteClipboard()
      } else if (key === 'z') {
        // Ctrl/⌘+Z 되돌리기, Shift 를 같이 누르면 다시하기
        event.preventDefault()
        const store = useCanvasStore.getState()
        if (event.shiftKey) {
          if (store.future.length === 0) return
          store.redo()
        } else {
          if (store.past.length === 0) {
            setMessage({ kind: 'warn', text: t('canvasPage.nothingToUndo') })
            return
          }
          store.undo()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [t])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const kind = event.dataTransfer.getData('application/eai-node')
      if (!kind) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      // 고스트 중앙이 커서였으니, 놓은 지점에 노드 중앙이 오도록 좌상단을 절반만큼 당긴다
      addNode(kind, { x: position.x - NODE_W / 2, y: position.y - NODE_H / 2 })
    },
    [screenToFlowPosition, addNode],
  )

  const handleSave = async () => {
    if (!pipelineId) return
    setMessage(null)
    try {
      await save.mutateAsync({ id: pipelineId, body: { definition: toDefinition() } })
      markClean()
      const result = await revalidate()
      const issues = result.data?.issues ?? []
      const errors = issues.filter((i) => i.level === 'error')
      setMessage(
        errors.length > 0
          ? { kind: 'warn', text: t('canvasPage.savedButIssues', { message: errors[0].message }) }
          : { kind: 'ok', text: t('canvasPage.saved') },
      )
      // 실행 중인 스트림이 있으면 변경이 자동 반영되지 않는다 — 중지 후 재시작을 안내한다
      if (activeStream) setStreamWarn(true)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : t('canvasPage.saveFailed') })
    }
  }

  const handleRun = async (fullRefresh: boolean) => {
    if (!pipelineId) return
    setMessage(null)
    try {
      if (dirty) await save.mutateAsync({ id: pipelineId, body: { definition: toDefinition() } })
      markClean()
      clearRunStates()
      setResultNodeId(null)
      const created = await run.mutateAsync({ id: pipelineId, fullRefresh })
      setActiveRunId(created.id)
      setShowLogs(true)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : t('canvasPage.runFailed') })
    }
  }

  // CDC 파이프라인은 "실행"이 아니라 "스트림 시작"이다 (기획안 §2·§7).
  // 노드에 CDC 소스나 CDC 트리거가 하나라도 있으면 스트리밍으로 취급한다.
  const isCdcPipeline = nodes.some(
    (n) => isCdcSource(n.data.kind) || isCdcTrigger(n.data.kind),
  )

  // 실시간 동기화도 "실행"이 아니라 "켜기"다. CDC 와 갈라 두는 이유는 시작 경로가 다르기
  // 때문이다 — 이쪽은 원본에 트리거를 심는 일이라 착수 점검을 한 번 거친다.
  const isSyncPipeline = nodes.some((n) => isSyncKind(n.data.kind))
  const [preflightOpen, setPreflightOpen] = useState(false)

  /** 점검 창을 연다. 저장·검증을 먼저 하는 이유는, 화면의 편집 내용이 아니라
   *  **서버에 저장된 정의**를 기준으로 점검하기 때문이다 — 안 그러면 점검한 것과 켜지는
   *  것이 달라진다. */
  const handleOpenPreflight = async () => {
    if (!pipelineId) return
    setMessage(null)
    try {
      if (dirty) await save.mutateAsync({ id: pipelineId, body: { definition: toDefinition() } })
      markClean()
      const result = await revalidate()
      const errors = (result.data?.issues ?? []).filter((i) => i.level === 'error')
      if (errors.length > 0) {
        setMessage({
          kind: 'warn',
          text: t('canvasPage.syncIssuesBeforeStart', { message: errors[0].message }),
        })
        return
      }
      setPreflightOpen(true)
      syncPreflight.reset()
      await syncPreflight.mutateAsync(pipelineId)
    } catch (e) {
      setMessage({
        kind: 'error',
        text: e instanceof Error ? e.message : t('canvasPage.preflightFailed'),
      })
    }
  }

  const handleStartSync = async () => {
    if (!pipelineId) return
    try {
      const stream = await startSync.mutateAsync({ pipelineId })
      setPreflightOpen(false)
      const notes = ((stream.config as { notes?: string[] } | undefined)?.notes ?? []).join(' / ')
      setMessage({
        kind: notes ? 'warn' : 'ok',
        text:
          t('canvasPage.syncStarted', { status: stream.status }) + (notes ? ` — ${notes}` : ''),
      })
    } catch (e) {
      setMessage({
        kind: 'error',
        text: e instanceof Error ? e.message : t('canvasPage.syncStartFailed'),
      })
    }
  }

  const handleStartStream = async () => {
    if (!pipelineId) return
    setMessage(null)
    try {
      if (dirty) await save.mutateAsync({ id: pipelineId, body: { definition: toDefinition() } })
      markClean()
      const result = await revalidate()
      const errors = (result.data?.issues ?? []).filter((i) => i.level === 'error')
      if (errors.length > 0) {
        setMessage({
          kind: 'warn',
          text: t('canvasPage.streamIssuesBeforeStart', { message: errors[0].message }),
        })
        return
      }
      const stream = await startStream.mutateAsync(pipelineId)
      setMessage({
        kind: 'ok',
        text: t('canvasPage.streamStarted', { status: stream.status }),
      })
    } catch (e) {
      setMessage({
        kind: 'error',
        text: e instanceof Error ? e.message : t('canvasPage.streamStartFailed'),
      })
    }
  }

  /** 이 파이프라인의 API 트리거 노드와 그 변수 선언 */
  const apiTrigger = nodes.find((n) => n.data.kind === 'trigger.api')
  // 참조가 매 렌더 바뀌면 아래 useCallback 이 계속 새로 만들어진다
  const declaredVariables: TriggerVariable[] = useMemo(
    () =>
      Array.isArray(apiTrigger?.data.params.variables)
        ? (apiTrigger.data.params.variables as TriggerVariable[]).filter((v) => v.name)
        : [],
    [apiTrigger],
  )

  // 노드 하나만 독립 실행 — 저장 후 그 노드까지 필요한 상류만 돌린다.
  //
  // 변수를 쓰는 파이프라인이면 값도 함께 보내야 한다. 노드는 개별 실행되지만 `$이름` 은
  // 트리거가 건네주는 것이라, 값 없이 돌리면 엔진이 "변수 값이 없습니다"로 끊는다.
  // 직전에 쓴 값이 있으면 그대로 쓰고, 없으면 값을 채우는 모달을 먼저 띄운다.
  const handleRunNode = useCallback(
    async (nodeId: string) => {
      if (!pipelineId) return
      setMessage(null)

      const supplied = useCanvasStore.getState().runVariables
      const needsValues = declaredVariables.some(
        (v) => v.required !== false && supplied[v.name] === undefined,
      )

      try {
        if (useCanvasStore.getState().dirty) {
          await save.mutateAsync({ id: pipelineId, body: { definition: toDefinition() } })
          markClean()
        }

        if (needsValues && apiTrigger) {
          setTestRun({ triggerId: apiTrigger.id, target: nodeId })
          return
        }

        clearRunStates()
        setResultNodeId(null)
        setRunNodeId(nodeId)
        const created = await run.mutateAsync({
          id: pipelineId,
          onlyNode: nodeId,
          ...(declaredVariables.length > 0
            ? { trigger: 'api' as const, variables: supplied }
            : {}),
        })
        setActiveRunId(created.id)
        setShowLogs(true)
      } catch (e) {
        setRunNodeId(null)
        setMessage({
          kind: 'error',
          text: e instanceof Error ? e.message : t('canvasPage.nodeRunFailed'),
        })
      }
    },
    [pipelineId, save, toDefinition, markClean, clearRunStates, run, declaredVariables, apiTrigger, t],
  )

  // API 트리거 테스트 실행 — 값을 채우는 모달을 먼저 연다.
  // 저장은 모달이 아니라 여기서 먼저 한다: 모달이 읽는 변수 선언이 서버 정의와 같아야
  // "화면에선 되는데 호출하면 안 되는" 상태를 안 만든다.
  const handleTestRun = useCallback(
    async (nodeId: string) => {
      if (!pipelineId) return
      setMessage(null)
      try {
        if (useCanvasStore.getState().dirty) {
          await save.mutateAsync({ id: pipelineId, body: { definition: toDefinition() } })
          markClean()
        }
        setTestRun({ triggerId: nodeId, target: nodeId })
      } catch (e) {
        setMessage({
          kind: 'error',
          text: e instanceof Error ? e.message : t('canvasPage.saveFailed'),
        })
      }
    },
    [pipelineId, save, toDefinition, markClean, t],
  )

  // 모달이 값을 다 채우면 실행한다.
  //
  // ``onlyNode`` 가 있으면 **부분 실행**이다 — 트리거가 값을 넘겨줄 다음 노드까지만 돌린다.
  // 전체 실행은 파이프라인 전부(타깃 유무·모든 노드 설정)를 검사하므로, 아직 그리는 중인
  // 파이프라인에서는 "타깃 노드가 최소 1개 필요합니다" 같은 이유로 막힌다. 값이 제대로
  // 꽂히는지 보려는 게 테스트 실행의 목적이라 부분 실행이 기본이다.
  const handleTestRunSubmit = useCallback(
    async (variables: Record<string, string | number | boolean>, onlyNode?: string) => {
      if (!pipelineId) return
      clearRunStates()
      setResultNodeId(null)
      setRunNodeId(onlyNode ?? null)
      // 편집기 왼쪽 패널이 "지금 무슨 값이 들어오나"로 쓴다
      setRunVariables(variables)
      const created = await run.mutateAsync({ id: pipelineId, trigger: 'api', variables, onlyNode })
      setActiveRunId(created.id)
      setShowLogs(true)
      setTestRun(null)
    },
    [pipelineId, run, clearRunStates, setRunVariables],
  )

  const testRunNode = testRun ? nodes.find((n) => n.id === testRun.triggerId) : undefined

  /** 값 입력 모달이 고를 수 있는 실행 대상.
   *
   *  트리거 바로 다음 노드들 + 지금 돌리려던 노드. 후자를 따로 넣는 이유는 하류 두 단계
   *  떨어진 노드의 재생 버튼으로 들어올 수 있기 때문이다 — 그때도 그 노드가 목록에 있어야
   *  사용자가 고른 대상이 그대로 유지된다. */
  const testRunTargets = useMemo(() => {
    if (!testRun) return []
    const ids = new Set(edges.filter((e) => e.source === testRun.triggerId).map((e) => e.target))
    if (testRun.target !== testRun.triggerId) ids.add(testRun.target)
    return [...ids]
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is (typeof nodes)[number] => Boolean(n))
      .map((n) => ({ id: n.id, label: n.data.label || n.id }))
  }, [testRun, edges, nodes])

  // 노드 카드의 실행 버튼에 내려줄 액션 (다른 실행이 도는 중이면 canRun=false)
  const runActive = activeRunId !== null && !isTerminal(stream.status)
  const nodeActions = useMemo(
    () => ({
      runNode: handleRunNode,
      testRun: handleTestRun,
      runningNodeId: runNodeId,
      canRun: !runActive && !run.isPending,
      openResult: setResultNodeId,
      openEdgeValues: (sourceId: string, targetId: string) =>
        setEdgeValues({ sourceId, targetId }),
    }),
    [handleRunNode, handleTestRun, runNodeId, runActive, run.isPending],
  )

  if (!pipelineId) {
    return (
      <div className="view">
        <div className="pad">
          <EmptyState title={t('canvasPage.selectPipeline')}>
            {t('canvasPage.selectPipelineHint')}
          </EmptyState>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="view">
        <div className="pad">
          <EmptyState title={t('runs.loading')} />
        </div>
      </div>
    )
  }

  if (error || !pipeline) {
    return (
      <div className="view">
        <div className="pad">
          <EmptyState title={t('canvasPage.notFound')}>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/')}>
              {t('canvasPage.goHome')}
            </button>
          </EmptyState>
        </div>
      </div>
    )
  }

  const running = runActive
  const errorIssues = validation?.issues.filter((i) => i.level === 'error') ?? []

  return (
    <NodeActionsContext.Provider value={nodeActions}>
    <div className={`view ${embedded ? 'canvas-embed' : ''}`} style={{ overflow: 'hidden' }}>
      <div className="editor">
        <Palette />

        <div className="canvas-wrap" ref={wrapRef}>
          <div className="canvas-toolbar">
            <div className="ctool">
              <b>{pipeline.name}</b>
            </div>
            <div className="ctool" style={{ color: dirty ? 'var(--amber)' : 'var(--muted)' }}>
              {dirty
                ? t('canvasPage.unsavedDot')
                : t('canvasPage.savedVersion', { version: String(pipeline.version) })}
            </div>
            {activeStream && (
              <div
                className="ctool"
                style={{ color: 'var(--amber)', cursor: 'pointer' }}
                onClick={() => setStreamWarn(true)}
                title={t('canvasPage.streamRunningWarnTitle')}
              >
                {t('canvasPage.streamRunningWarn')}
              </div>
            )}
            {running && (
              <div className="ctool" style={{ color: 'var(--blue)' }}>
                <Spinner />{' '}
                {t('canvasPage.runningProgress', { progress: stream.progress, n: stream.records })}
              </div>
            )}
          </div>

          <div className="canvas-run">
            {!isCdcPipeline && !isSyncPipeline && (
              <button className="btn" onClick={() => setShowLogs((v) => !v)} disabled={!activeRunId}>
                {t('canvasPage.logs')}
              </button>
            )}
            <button className="btn" onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : <Icon.save />}
              {t('canvasPage.save')}
            </button>
            {isSyncPipeline ? (
              <button
                className="btn primary"
                onClick={handleOpenPreflight}
                disabled={syncPreflight.isPending || save.isPending}
                title={t('canvasPage.startSyncTitle')}
              >
                {syncPreflight.isPending ? <Spinner /> : <Icon.broadcast />}
                {t('canvasPage.startSync')}
              </button>
            ) : isCdcPipeline ? (
              <button
                className="btn primary"
                onClick={handleStartStream}
                disabled={startStream.isPending || save.isPending}
                title={t('canvasPage.startStreamTitle')}
              >
                {startStream.isPending ? <Spinner /> : <Icon.broadcast />}
                {t('canvasPage.startStream')}
              </button>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={() => handleRun(true)}
                  disabled={running || run.isPending}
                  title={t('canvasPage.fullRefreshTitle')}
                >
                  <Icon.refresh />
                  {t('canvasPage.fullRefresh')}
                </button>
                <button
                  className="btn primary"
                  onClick={() => handleRun(false)}
                  disabled={running || run.isPending}
                >
                  {run.isPending ? <Spinner /> : <Icon.play />}
                  {t('canvasPage.run')}
                </button>
              </>
            )}
          </div>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => select(node.id)}
            onPaneClick={() => select(null)}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            // 선택한 노드를 Del(과 기존 기본값 Backspace)로 지운다.
            // React Flow 가 입력창에 포커스가 있을 때는 무시해 준다.
            deleteKeyCode={['Delete', 'Backspace']}
            // 다중 선택: Shift+드래그로 영역 선택, Ctrl/⌘+클릭으로 하나씩 추가
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Meta', 'Control']}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            fitView
            // 선택된 노드를 z-index 1000 으로 띄우는 기본 동작을 끈다.
            // 켜두면 그룹 영역을 선택하는 순간 프레임이 노드들 위로 올라와,
            // 영역 안의 노드를 클릭해도 프레임이 클릭을 가로챈다 (바깥을 한 번 눌러야 풀림).
            // 층위는 store 가 정한 zIndex(프레임 0 · 일반 노드 1)로만 정한다.
            elevateNodesOnSelect={false}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true, style: { stroke: '#b9bece', strokeWidth: 2 } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#d3d6e2" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ background: '#fff' }} />
          </ReactFlow>

          {/* 노드를 끌 때만 떠오르는 휴지통. 항상 DOM 에 두어야 드래그 중 위치를 잴 수 있다. */}
          <div
            ref={trashRef}
            className={`canvas-trash ${draggingNode ? 'visible' : ''} ${overTrash ? 'over' : ''}`}
            aria-hidden={!draggingNode}
          >
            <Icon.trash />
            <span>{overTrash ? t('canvasPage.trashDrop') : t('canvasPage.trashHint')}</span>
          </div>

          {(message || errorIssues.length > 0) && (
            <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 5 }}>
              {message && <Banner kind={message.kind}>{message.text}</Banner>}
              {!message && errorIssues.length > 0 && (
                <Banner kind="warn">
                  {t('canvasPage.issuesBeforeRun', {
                    n: errorIssues.length,
                    message: errorIssues[0].message,
                  })}
                  {errorIssues[0].node_id ? ` (${errorIssues[0].node_id})` : ''}
                </Banner>
              )}
            </div>
          )}

          {/* 캔버스 아래에 쌓이는 것들. 한 상자에 넣어 로그와 결과 서랍이 서로를 덮지 않게 한다. */}
          <div className="canvas-bottom">
          {showLogs && activeRunId && (
            <div
              style={{
                zIndex: 6,
                background: '#1e1f2b',
                maxHeight: '42vh',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 14px',
                  color: '#d7dae7',
                  fontSize: 12,
                  fontWeight: 700,
                  borderBottom: '1px solid #2f3142',
                }}
              >
                {t('canvasPage.runLogTitle', { id: activeRunId.slice(0, 8) })}
                <span style={{ color: stream.connected ? '#7fd6ac' : '#ff9a9a', fontWeight: 600 }}>
                  {stream.connected ? t('canvasPage.liveDot') : t('canvasPage.disconnectedDot')}
                </span>
                <button
                  className="btn sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setShowLogs(false)}
                >
                  {t('common.close')}
                </button>
              </div>
              <div className="logbox" style={{ borderRadius: 0, maxHeight: 'none', flex: 1 }}>
                {stream.logs.length === 0 && (
                  <div style={{ color: '#6f7590' }}>{t('canvasPage.waitingLogs')}</div>
                )}
                {stream.logs.map((log) => (
                  <div key={log.id} className={`lvl-${log.level}`}>
                    <span className="ts">{formatTime(log.ts)}</span>
                    {log.nodeId && <span style={{ color: '#8f96b8' }}>[{log.nodeId}] </span>}
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <ResultDrawer />
          </div>
        </div>

        <ConfigPanel />
      </div>

      {testRun && testRunNode && (
        <TestRunModal
          variables={declaredVariables}
          triggerNodeId={testRunNode.id}
          initialTarget={testRun.target}
          initialValues={runVariables}
          targets={testRunTargets}
          onClose={() => setTestRun(null)}
          onRun={handleTestRunSubmit}
        />
      )}

      {edgeValues && (
        <EdgeValueModal
          sourceId={edgeValues.sourceId}
          targetId={edgeValues.targetId}
          onClose={() => setEdgeValues(null)}
        />
      )}

      {resultNodeId && (
        <NodeSampleModal nodeId={resultNodeId} onClose={() => setResultNodeId(null)} />
      )}

      {preflightOpen && (
        <SyncPreflightModal
          result={syncPreflight.data ?? null}
          loading={syncPreflight.isPending}
          starting={startSync.isPending}
          error={
            syncPreflight.error instanceof Error
              ? syncPreflight.error.message
              : startSync.error instanceof Error
                ? startSync.error.message
                : null
          }
          onStart={handleStartSync}
          onClose={() => setPreflightOpen(false)}
        />
      )}

      {streamWarn && activeStream && (
        <div className="overlay" onClick={() => setStreamWarn(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <h3>{t('canvasPage.streamWarnHead')}</h3>
              <button className="x" onClick={() => setStreamWarn(false)} aria-label={t('common.close')}>
                ×
              </button>
            </div>
            <div className="mb" style={{ padding: '18px 22px' }}>
              <Banner kind="warn">
                {t('canvasPage.streamWarnBody1')}<b>{t('canvasPage.streamWarnBody1b')}</b>
                {t('canvasPage.streamWarnBody2')}<b>{t('canvasPage.streamWarnBody2b')}</b>
                {t('canvasPage.streamWarnBody3')}<b>{t('canvasPage.streamWarnBody3b')}</b>
              </Banner>
              <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 14, lineHeight: 1.7 }}>
                {t('canvasPage.streamWarnFix1')}<b>{t('canvasPage.streamWarnFix1b')}</b>
                {t('canvasPage.streamWarnFix2')}
              </p>
              <ol style={{ fontSize: 14, color: 'var(--ink)', margin: '10px 0 0', paddingLeft: 20, lineHeight: 1.9 }}>
                <li>
                  {t('canvasPage.streamWarnStep1')}<b>{t('canvasPage.streamWarnStep1b')}</b>
                  {t('canvasPage.streamWarnStep1c')}
                </li>
                <li>
                  {t('canvasPage.streamWarnStep2')}<b>{t('canvasPage.streamWarnStep2b')}</b>
                </li>
              </ol>
            </div>
            <div className="mf">
              <button className="btn" onClick={() => setStreamWarn(false)}>
                {t('canvasPage.keepEditing')}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setStreamWarn(false)
                  navigate('/monitor')
                }}
              >
                {t('canvasPage.goMonitor')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </NodeActionsContext.Provider>
  )
}
