import { CATEGORIES, NODE_SPECS, type NodeSpec } from './nodeCatalog'

/** 노드 카드 크기 (px). 드래그 고스트·드롭 위치 보정에서 공유한다 —
 *  고스트 중앙이 커서를 따라오고, 놓은 지점에 노드 중앙이 오도록 맞춘다. */
export const NODE_W = 172
export const NODE_H = 80

/** 팔레트에서 끌 때 커서를 따라올 "노드 모양" 고스트를 만든다.
 *
 * 기본 HTML5 드래그 이미지는 팔레트 행(작은 목록)이라 실제로 생길 노드와 달라
 * 어디에 떨어질지 감이 안 온다. 실제 노드처럼 생긴 고스트를 스냅샷으로 쓰면
 * "이 모양이 여기 놓인다"가 그대로 보인다. 아이콘은 팔레트 항목의 SVG 를 복제해 쓴다.
 */
function makeDragGhost(spec: NodeSpec, iconSvg: SVGElement | null): HTMLElement {
  const ghost = document.createElement('div')
  ghost.className = 'rf-node drag-ghost'
  ghost.style.width = `${NODE_W}px`
  ghost.innerHTML = `
    <div class="nhd">
      <div class="nic" style="background:${spec.color}"></div>
      <div style="min-width:0">
        <div class="ntt">${spec.title}</div>
        <div class="nsub">${spec.hint}</div>
      </div>
    </div>
    <div class="nfoot"><span class="st idle"></span><span>${spec.category}</span></div>`
  if (iconSvg) ghost.querySelector('.nic')?.appendChild(iconSvg.cloneNode(true))
  document.body.appendChild(ghost)
  return ghost
}

/** 좌측 노드 팔레트 — 캔버스로 드래그해 노드를 추가한다 (설계 문서 §8) */
export function Palette() {
  return (
    <div className="palette">
      <div className="ph">노드</div>
      {CATEGORIES.map((category) => (
        <div className="pcat" key={category}>
          <div className="ct">{category}</div>
          {NODE_SPECS.filter((s) => s.category === category).map((spec, index, list) => {
            const IconComp = spec.icon
            // 소분류가 처음 나오는 자리에 작은 구분 라벨을 끼운다 (예: 실시간(CDC))
            const showGroup = spec.group && list[index - 1]?.group !== spec.group
            return (
              <div key={spec.kind}>
                {showGroup && <div className="pgroup">{spec.group}</div>}
                <div
                  className="node-item"
                  draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/eai-node', spec.kind)
                  event.dataTransfer.effectAllowed = 'move'
                  // 실제 노드 모양 고스트를 커서 중앙에 붙여 끌리게 한다
                  const iconSvg = event.currentTarget.querySelector<SVGElement>('.ni-ic svg')
                  const ghost = makeDragGhost(spec, iconSvg)
                  event.dataTransfer.setDragImage(ghost, NODE_W / 2, NODE_H / 2)
                  // 스냅샷은 이 시점에 이미 떠졌으니 다음 프레임에 정리한다
                  requestAnimationFrame(() => ghost.remove())
                }}
                title={`${spec.title} — 캔버스로 드래그하세요`}
              >
                  <div className="ni-ic" style={{ background: spec.color }}>
                    <IconComp />
                  </div>
                  <div>
                    <div className="nt">{spec.title}</div>
                    <div className="nd">{spec.hint}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
