/** 메모(스티키 노트) 색상 프리셋.
 *
 * hex 하나만 저장하고 음영을 계산하는 대신, 손으로 맞춘 팔레트를 프리셋 키로 둔다 —
 * 스티키 노트는 배경·테두리·헤더·글자 대비가 함께 어울려야 보기 좋기 때문이다.
 * 저장은 `params.color` 에 키만 넣는다(예: "yellow"). 키를 모르면 노랑으로 되돌린다.
 */

export type MemoColor = {
  key: string
  label: string
  /** 노트 배경 */
  bg: string
  /** 테두리 */
  border: string
  /** 상단 그립 배경 */
  header: string
  /** 본문 글자색 */
  text: string
  /** 그립 점 색 */
  dot: string
  /** 선택 시 바깥 링 (rgba) */
  ring: string
}

export const MEMO_COLORS: MemoColor[] = [
  { key: 'yellow', label: '노랑', bg: '#fff6da', border: '#f0d488', header: '#ffefc0', text: '#5b4a12', dot: '#d9ab3e', ring: 'rgba(244,183,64,0.4)' },
  { key: 'pink', label: '분홍', bg: '#ffe9ef', border: '#f3b6c7', header: '#ffd9e2', text: '#7a2740', dot: '#e06a8b', ring: 'rgba(224,106,139,0.4)' },
  { key: 'blue', label: '파랑', bg: '#e6f0ff', border: '#a9c6f0', header: '#d5e4ff', text: '#1f3d6b', dot: '#5b8ee0', ring: 'rgba(91,142,224,0.4)' },
  { key: 'green', label: '초록', bg: '#e6f7ec', border: '#a6dcbb', header: '#d3f0de', text: '#1c5236', dot: '#3ea96b', ring: 'rgba(62,169,107,0.4)' },
  { key: 'purple', label: '보라', bg: '#f0e9ff', border: '#c8b6f0', header: '#e4d9ff', text: '#3f2a6b', dot: '#8b6ae0', ring: 'rgba(139,106,224,0.4)' },
  { key: 'gray', label: '회색', bg: '#eef0f4', border: '#cfd4de', header: '#e2e6ee', text: '#3a4150', dot: '#9aa2b2', ring: 'rgba(120,130,150,0.4)' },
]

export const DEFAULT_MEMO_COLOR = 'yellow'

export function memoColor(key: unknown): MemoColor {
  return MEMO_COLORS.find((c) => c.key === key) ?? MEMO_COLORS[0]
}

/** 팔레트를 CSS 변수 묶음으로 — .rf-memo 스타일이 이 변수를 읽는다 */
export function memoColorVars(key: unknown): React.CSSProperties {
  const c = memoColor(key)
  return {
    '--memo-bg': c.bg,
    '--memo-border': c.border,
    '--memo-header': c.header,
    '--memo-text': c.text,
    '--memo-dot': c.dot,
    '--memo-ring': c.ring,
  } as React.CSSProperties
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 영역 그룹(프레임) 색 변수. 배경은 대부분 투명(옅은 tint)하게 둔다. */
export function frameColorVars(key: unknown): React.CSSProperties {
  const c = memoColor(key)
  return {
    '--frame-border': c.dot,
    '--frame-bg': hexToRgba(c.dot, 0.07),
    '--frame-title-bg': c.header,
    '--frame-title-text': c.text,
    '--frame-ring': c.ring,
  } as React.CSSProperties
}
