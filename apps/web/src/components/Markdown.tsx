/** 아주 작은 마크다운 렌더러 — AI 답변이 쓰는 부분집합만 다룬다.
 *
 *  react-markdown(remark/micromark) 대신 이걸 두는 이유: 의존성을 늘리지 않고, 렌더가
 *  **React 엘리먼트**라 dangerouslySetInnerHTML 없이 XSS 걱정이 없다. 다루는 문법은
 *  단락·글머리표(-,*,•)·번호목록(1.)·헤딩(#~###)·인라인(**굵게**, `코드`, *기울임*) 뿐.
 *  코드펜스(```)는 이 자리에서 다루지 않는다 — SQL 은 호출부가 코드 박스로 따로 뗀다.
 */
import { Fragment, type ReactNode } from 'react'

const INLINE = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*)/g

/** 한 줄 안의 인라인 마크(**굵게**·`코드`·*기울임*)를 엘리먼트로 바꾼다. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>)
    else if (m[3] !== undefined) nodes.push(<code key={key++}>{m[3]}</code>)
    else if (m[4] !== undefined) nodes.push(<em key={key++}>{m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l)
const isNumbered = (l: string) => /^\s*\d+[.)]\s+/.test(l)
const heading = (l: string) => l.match(/^(#{1,3})\s+(.*)$/)

// GFM 표 — 헤더 줄 다음이 `|---|:--:|` 형태의 구분선이면 표로 본다.
const isTableSep = (l: string) =>
  l.includes('-') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l)

/** 표 한 줄을 셀로 가른다. 앞뒤 파이프는 벗기고, `\|` 이스케이프는 보존한다. */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function cellAlign(sep: string): 'left' | 'right' | 'center' | undefined {
  const s = sep.trim()
  const l = s.startsWith(':')
  const r = s.endsWith(':')
  if (l && r) return 'center'
  if (r) return 'right'
  if (l) return 'left'
  return undefined
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    // 코드펜스 ```lang … ``` — 읽기 전용 코드 블록(액션 버튼 없음). 안은 마크다운을 적용하지 않는다.
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // 닫는 ```
      blocks.push(
        <pre key={key++} className="md-code" data-lang={lang || undefined}>
          <code>{buf.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // 표 — 헤더 줄 + 구분선(|---|) + 이어지는 |…| 본문 줄들
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line)
      const aligns = splitRow(lines[i + 1]).map(cellAlign)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push(
        <div key={key++} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {header.map((c, ci) => (
                  <th key={ci} style={{ textAlign: aligns[ci] }}>
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci} style={{ textAlign: aligns[ci] }}>
                      {renderInline(r[ci] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const h = heading(line)
    if (h) {
      blocks.push(
        <div key={key++} className="md-h">
          {renderInline(h[2])}
        </div>,
      )
      i++
      continue
    }

    if (isBullet(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && isBullet(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*[-*•]\s+/, ''))}</li>)
        i++
      }
      blocks.push(
        <ul key={key++} className="md-ul">
          {items}
        </ul>,
      )
      continue
    }

    if (isNumbered(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(
          <li key={items.length}>{renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>,
        )
        i++
      }
      blocks.push(
        <ol key={key++} className="md-ol">
          {items}
        </ol>,
      )
      continue
    }

    // 단락 — 빈 줄이나 다른 블록이 나올 때까지 모으고, 줄바꿈은 <br/> 로 보존한다.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isBullet(lines[i]) &&
      !isNumbered(lines[i]) &&
      !heading(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(
      <p key={key++} className="md-p">
        {para.map((l, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(l)}
          </Fragment>
        ))}
      </p>,
    )
  }

  return <div className={`md${className ? ` ${className}` : ''}`}>{blocks}</div>
}
