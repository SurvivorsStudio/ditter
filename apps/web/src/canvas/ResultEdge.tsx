import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import { useNodeActions } from './nodeActions'
import { useT } from '../i18n'

/** 노드 사이 엣지. 한쪽 끝 노드에 실행 결과 샘플이 있으면 가운데에 "결과" 칩을 띄운다.
 *
 * 소스/변환 노드는 자신의 **출력**을, 타깃 노드는 들어온 **입력**을 샘플로 남긴다 —
 * 어느 쪽이든 그 데이터는 이 엣지 위를 흐른 값이므로 여기에 보여주는 게 자연스럽다.
 */
/** 엣지 칩에 들어갈 한 줄 표현. 긴 SQL 이 캔버스를 덮지 않도록 자른다 — 전문은 title 로 본다. */
function format(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const oneLine = (text ?? '').replace(/\s+/g, ' ').trim()
  return oneLine.length > 40 ? oneLine.slice(0, 39) + '…' : oneLine
}

export function ResultEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const tr = useT()
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const actions = useNodeActions()

  // 이 선에 뜨는 결과는 **출구 쪽 노드가 내놓은 것**뿐이다.
  //
  // 예전에는 상류에 샘플이 없으면 하류의 입력 샘플로 대신 채웠는데, 그러면 같은 칩이
  // 어떤 때는 "위 노드의 출력", 어떤 때는 "아래 노드의 입력"을 뜻해 방향이 흐려진다.
  // 결과값은 출구에서만 나온다 — 규칙을 하나로 둔다.
  const srcSample = useCanvasStore(
    (s) => s.nodes.find((n) => n.id === source)?.data.runState?.sample,
  )
  const picked = srcSample ? { nodeId: source, sample: srcSample } : null

  // API 트리거가 이 선으로 넘긴 **값 그 자체** — 사용자가 보낸 {"since": "kim"} 이 그대로다.
  // 데이터 샘플(행)과 성격이 달라 별도 칩으로 보여준다. 눌러야 이 값이 하류 설정을
  // 무엇으로 바꿨는지(치환 결과)까지 볼 수 있다.
  const handed = useCanvasStore((s) => s.nodes.find((n) => n.id === source)?.data.runState?.handed)
  const handedEntries = handed ? Object.entries(handed) : []

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {handedEntries.length > 0 && actions && (
        <EdgeLabelRenderer>
          <button
            className="edge-var-chip nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(e) => {
              e.stopPropagation()
              actions.openEdgeValues(source, target)
            }}
            title={tr('cui.edge.viewHanded')}
          >
            {handedEntries.slice(0, 2).map(([key, value]) => (
              <span className="evc-row" key={key}>
                <span className="evc-key">{key}</span>
                <span className="evc-val">{format(value)}</span>
              </span>
            ))}
            {handedEntries.length > 2 && (
              <span className="evc-more">{tr('cui.edge.morePlus', { n: handedEntries.length - 2 })}</span>
            )}
          </button>
        </EdgeLabelRenderer>
      )}
      {picked && actions && (
        <EdgeLabelRenderer>
          <button
            className="edge-result-chip nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(e) => {
              e.stopPropagation()
              actions.openResult(picked.nodeId)
            }}
            title={tr('cui.edge.viewFlow')}
          >
            <span className="erc-ic">▤</span>
            {tr('cui.rowsPlus', {
              n: picked.sample.rows.length,
              plus: picked.sample.truncated ? '+' : '',
            })}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
