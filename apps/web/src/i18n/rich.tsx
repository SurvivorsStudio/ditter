/** 사전 문구 안의 최소 표기를 React 노드로 바꾼다 — `**굵게**` → <b>, `` `코드` `` → <code>.
 *
 *  한 문장을 키 하나로 유지하기 위한 장치다. 문장을 조각내 여러 키로 쪼개면 번역할 때
 *  어순이 다른 언어에서 조립이 불가능해진다.
 *
 *  **짝이 맞는 마커만** 바꾼다. 예전 구현(`split('**')`)은 마커가 홀수면 뒤쪽 꼬리를
 *  통째로 굵게 만들고 아무 신호도 내지 않았다 — 번역문 한 줄을 고치는 것만으로 깨지고
 *  그 사실이 화면에서만 드러난다. 짝이 없으면 그냥 글자로 남는다.
 *
 *  보간(`t()` 의 `{slot}`)이 **먼저** 끝난 뒤에 여기로 온다. 그래서 `` `{code}` `` 처럼
 *  자리표시자를 마커로 감싸면 꽂힌 값이 <code> 안에 들어간다.
 */
const RICH = /\*\*([^*]+)\*\*|`([^`]+)`/g

export function rich(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  RICH.lastIndex = 0
  while ((m = RICH.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      m[1] !== undefined ? <b key={key++}>{m[1]}</b> : <code key={key++}>{m[2]}</code>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
