import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { EaiNode as EaiNodeType } from '../store/canvasStore'
import { useCanvasStore } from '../store/canvasStore'
import { frameColorVars, memoColor } from './memoColors'

/** 영역 그룹(프레임) — 노드들을 사각형으로 묶어 시각적으로 구분하는 주석.
 *
 * 실행·연결과 무관하고(note.group), 배경은 대부분 투명하며 일반 노드보다 **뒤에** 깔린다
 * (store 에서 zIndex 0, 일반 노드 1). 크기는 모서리를 끌어 조절하고 params.w/h 로 저장된다.
 */
export function GroupNode({ id, data, selected }: NodeProps<EaiNodeType>) {
  const updateParams = useCanvasStore((s) => s.updateParams)
  const color = memoColor(data.params.color)
  const title = String(data.params.title ?? '').trim()

  return (
    <div className={`rf-frame ${selected ? 'selected' : ''}`} style={frameColorVars(data.params.color)}>
      <NodeResizer
        color={color.dot}
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        onResizeEnd={(_, p) =>
          updateParams(id, { w: Math.round(p.width), h: Math.round(p.height) })
        }
      />
      {/* 제목은 캔버스에서 편집하지 않는다 — 우측 설정 패널에서만 수정한다.
          nodrag 를 빼서 이 라벨을 잡고도 영역을 끌 수 있게 둔다. */}
      <div className={`frame-title ${title ? '' : 'empty'}`} title={title || undefined}>
        {title || '영역 제목'}
      </div>
    </div>
  )
}
