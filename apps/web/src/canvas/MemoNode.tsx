import type { NodeProps } from '@xyflow/react'
import type { EaiNode as EaiNodeType } from '../store/canvasStore'
import { useCanvasStore } from '../store/canvasStore'
import { memoColorVars } from './memoColors'
import { useT } from '../i18n'

/** 캔버스 메모 — 실행 흐름과 무관한 주석용 스티키 노트.
 *
 * 소스/타깃 핸들이 없어 엣지로 이을 수 없다 (백엔드도 연결을 거부한다).
 * 본문 textarea 는 `nodrag` 라 여기서 타이핑해도 노드가 끌려가지 않고,
 * 상단 그립을 잡아 위치를 옮긴다.
 */
export function MemoNode({ id, data, selected }: NodeProps<EaiNodeType>) {
  const tr = useT()
  const updateParams = useCanvasStore((s) => s.updateParams)
  const select = useCanvasStore((s) => s.select)
  const text = String(data.params.text ?? '')

  return (
    <div className={`rf-memo ${selected ? 'selected' : ''}`} style={memoColorVars(data.params.color)}>
      <div className="memo-grip" title={tr('cui.memo.dragTitle')}>
        <span className="memo-dot" />
        <span className="memo-dot" />
        <span className="memo-dot" />
        <span className="memo-cap">{tr('cui.memo.cap')}</span>
      </div>
      <textarea
        className="nodrag memo-text"
        value={text}
        placeholder={tr('cui.memo.placeholder')}
        onChange={(e) => updateParams(id, { text: e.target.value })}
        onFocus={() => select(id)}
      />
    </div>
  )
}
