import type { NodeProps } from '@xyflow/react'
import type { EaiNode as EaiNodeType } from '../store/canvasStore'
import { useCanvasStore } from '../store/canvasStore'
import { memoColorVars } from './memoColors'

/** 캔버스 메모 — 실행 흐름과 무관한 주석용 스티키 노트.
 *
 * 소스/타깃 핸들이 없어 엣지로 이을 수 없다 (백엔드도 연결을 거부한다).
 * 본문 textarea 는 `nodrag` 라 여기서 타이핑해도 노드가 끌려가지 않고,
 * 상단 그립을 잡아 위치를 옮긴다.
 */
export function MemoNode({ id, data, selected }: NodeProps<EaiNodeType>) {
  const updateParams = useCanvasStore((s) => s.updateParams)
  const select = useCanvasStore((s) => s.select)
  const text = String(data.params.text ?? '')

  return (
    <div className={`rf-memo ${selected ? 'selected' : ''}`} style={memoColorVars(data.params.color)}>
      <div className="memo-grip" title="드래그해 이동">
        <span className="memo-dot" />
        <span className="memo-dot" />
        <span className="memo-dot" />
        <span className="memo-cap">메모</span>
      </div>
      <textarea
        className="nodrag memo-text"
        value={text}
        placeholder="메모를 입력하세요…"
        onChange={(e) => updateParams(id, { text: e.target.value })}
        onFocus={() => select(id)}
      />
    </div>
  )
}
