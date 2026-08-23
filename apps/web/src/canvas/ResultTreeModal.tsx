import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/icons'
import { resultEntries, useCanvasStore, type ResultEntry } from '../store/canvasStore'
import { SPEC_BY_KIND, isTrigger } from './nodeCatalog'
import { nodeRefText } from './variables'

/** 결과 전체를 트리로 펼쳐 보는 팝업 — `{노드이름: {컬럼: 값}}` 의 구조 그대로.
 *
 * 서랍은 한 번에 노드 하나만 보여준다(표 하나). 여러 노드를 견주거나, Mongo 문서처럼
 * 값 안에 값이 든 결과를 훑을 때는 접었다 펴는 트리가 낫다.
 *
 * 참조 표기(`${이름.컬럼}`)는 **첫 행의 최상위 컬럼에만** 붙는다. 참조가 가리키는 것이
 * 첫 행이고, 중첩된 안쪽 값은 `${노드.a.b}` 로 적어도 노드 `노드.a` 의 컬럼 `b` 로 읽혀
 * 엉뚱한 곳을 가리키기 때문이다 — 쓸 수 없는 표기를 눌러 볼 수 있게 두지 않는다.
 */
export function ResultTreeModal({ onClose }: { onClose: () => void }) {
  const nodes = useCanvasStore((s) => s.nodes)
  const nodeResults = useCanvasStore((s) => s.nodeResults)
  const entries = resultEntries(nodes, nodeResults)

  // 열자마자 첫 노드의 첫 행까지 펴 둔다 — 접힌 이름만 늘어놓으면 서랍의 칩과 다를 게 없다
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const first = entries[0]
    return first ? new Set([first.nodeId, `${first.nodeId}/0`]) : new Set<string>()
  })
  const [copied, setCopied] = useState<string | null>(null)

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(text)
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1200)
  }

  const allOpen = entries.length > 0 && entries.every((e) => expanded.has(e.nodeId))
  const toggleAll = () => {
    if (allOpen) {
      setExpanded(new Set())
      return
    }
    // 노드와 각 행까지만 편다. 중첩 값까지 전부 펴면 첫 화면이 벽이 된다.
    const next = new Set<string>()
    for (const entry of entries) {
      next.add(entry.nodeId)
      entry.sample.rows.forEach((_, i) => next.add(`${entry.nodeId}/${i}`))
    }
    setExpanded(next)
  }

  // 서랍은 z-index 를 가진 상자(.canvas-bottom) 안에 있다. 그 안에서 뜨는 모달은
  // position:fixed 여도 그 상자의 쌓임 맥락에 갇혀 옆 패널에 덮인다 — body 로 내보낸다.
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>노드 결과 — 트리</h3>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={toggleAll}>
            {allOpen ? '모두 접기' : '모두 펼치기'}
          </button>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="rt-scroll">
          {entries.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>
              아직 모인 결과가 없습니다.
            </div>
          ) : (
            entries.map((entry) => (
              <NodeBranch
                key={entry.nodeId}
                entry={entry}
                expanded={expanded}
                toggle={toggle}
                copied={copied}
                onCopy={copy}
              />
            ))
          )}
        </div>

        <div className="rt-note">
          <code>{'${이름.컬럼}'}</code> 은 <b>첫 행</b>의 값 하나, <code>{'${이름.컬럼[]}'}</code> 는{' '}
          <b>모든 행</b>을 쉼표로 이어 붙인 것입니다 — <code>WHERE id IN (${'{'}이름.컬럼[]{'}'})</code>{' '}
          처럼 씁니다(문자값의 따옴표는 자동으로 붙습니다). 중첩된 안쪽 값은 참조할 수 없습니다.
        </div>
      </div>
    </div>,
    document.body,
  )
}

function NodeBranch({
  entry,
  expanded,
  toggle,
  copied,
  onCopy,
}: {
  entry: ResultEntry
  expanded: Set<string>
  toggle: (key: string) => void
  copied: string | null
  onCopy: (text: string) => void
}) {
  const spec = SPEC_BY_KIND[entry.kind]
  const IconComp = spec?.icon
  const handed = isTrigger(entry.kind)
  const open = expanded.has(entry.nodeId)
  const columns = entry.sample.columns.length
    ? entry.sample.columns
    : Array.from(new Set(entry.sample.rows.flatMap((r) => Object.keys(r))))
  // 행이 여럿이면 목록 참조(`[]`)가 쓸모 있다. 샘플이 잘렸어도 마찬가지 —
  // 실행할 때는 상한까지 전부 읽으므로 화면에 보이는 행 수가 전부는 아니다.
  const multiRow = !handed && (entry.sample.rows.length > 1 || entry.sample.truncated)

  return (
    <div className="rt-node">
      <button className="rt-row rt-node-row" onClick={() => toggle(entry.nodeId)}>
        <Caret open={open} />
        <span className="rt-ic" style={{ background: spec?.color ?? 'var(--muted)' }}>
          {IconComp ? <IconComp /> : null}
        </span>
        <span className="rt-name">{entry.label}</span>
        <span className="rt-meta">
          {handed
            ? `넘긴 값 ${columns.length}개`
            : `${entry.sample.rows.length.toLocaleString()}행${
                entry.sample.truncated ? '+' : ''
              } · 컬럼 ${columns.length}개`}
        </span>
      </button>

      {open &&
        (entry.sample.rows.length === 0 ? (
          <div className="rt-row rt-empty" style={{ paddingLeft: 46 }}>
            결과 행이 없습니다.
          </div>
        ) : handed ? (
          // 트리거는 행이 아니라 값이다 — 행 층을 두면 없는 구조를 만들어 낸다
          columns.map((column) => (
            <Field
              key={column}
              depth={1}
              name={column}
              value={entry.sample.rows[0]?.[column]}
              refText={`$${column}`}
              path={`${entry.nodeId}/0/${column}`}
              expanded={expanded}
              toggle={toggle}
              copied={copied}
              onCopy={onCopy}
            />
          ))
        ) : (
          entry.sample.rows.map((row, i) => {
            const rowKey = `${entry.nodeId}/${i}`
            const rowOpen = expanded.has(rowKey)
            return (
              <div key={i}>
                <button
                  className={`rt-row rt-row-row ${i === 0 ? 'first' : ''}`}
                  onClick={() => toggle(rowKey)}
                  style={{ paddingLeft: 26 }}
                >
                  <Caret open={rowOpen} />
                  <span className="rt-index">[{i}]</span>
                  {i === 0 && <span className="rt-badge">참조되는 행</span>}
                  {!rowOpen && <span className="rt-preview">{preview(row, columns)}</span>}
                </button>
                {rowOpen &&
                  columns.map((column) => (
                    <Field
                      key={column}
                      depth={2}
                      name={column}
                      value={row[column]}
                      // 낱값 참조는 첫 행을 가리킨다 — 다른 행에 표기를 붙이면 거짓말이 된다
                      refText={i === 0 ? nodeRefText({ node: entry.label, column }) : undefined}
                      // 행이 여럿이면 목록 표기도 함께 준다 (`IN (...)` 자리)
                      listText={
                        i === 0 && multiRow
                          ? nodeRefText({ node: entry.label, column, many: true })
                          : undefined
                      }
                      path={`${rowKey}/${column}`}
                      expanded={expanded}
                      toggle={toggle}
                      copied={copied}
                      onCopy={onCopy}
                    />
                  ))}
              </div>
            )
          })
        ))}
    </div>
  )
}

/** 컬럼 한 칸. 값이 객체·배열이면 그 안을 다시 트리로 편다 (Mongo 중첩 문서). */
function Field({
  depth,
  name,
  value,
  refText,
  listText,
  path,
  expanded,
  toggle,
  copied,
  onCopy,
}: {
  depth: number
  name: string
  value: unknown
  refText?: string
  /** 여러 행이 있을 때의 목록 표기 `${이름.컬럼[]}` — `IN (...)` 자리에 쓴다 */
  listText?: string
  path: string
  expanded: Set<string>
  toggle: (key: string) => void
  copied: string | null
  onCopy: (text: string) => void
}) {
  const pad = 26 + depth * 20
  const children = branchEntries(value)

  if (!children) {
    return (
      <div className="rt-row rt-leaf" style={{ paddingLeft: pad }}>
        <span className="rt-key">{name}</span>
        <span className={`rt-val ${value === null || value === undefined ? 'null' : ''}`}>
          {scalarText(value)}
        </span>
        {refText && (
          <button
            className={`rt-ref ${copied === refText ? 'copied' : ''}`}
            onClick={() => onCopy(refText)}
            title={`${refText} — 이 행의 값 하나. 누르면 복사됩니다`}
          >
            <code>{refText}</code>
          </button>
        )}
        {listText && (
          <button
            className={`rt-ref list ${copied === listText ? 'copied' : ''}`}
            onClick={() => onCopy(listText)}
            title={`${listText} — 모든 행을 쉼표로 이어 붙입니다. IN (...) 자리에 씁니다`}
          >
            <code>{listText}</code>
          </button>
        )}
      </div>
    )
  }

  const open = expanded.has(path)
  return (
    <>
      <button className="rt-row rt-leaf" style={{ paddingLeft: pad - 16 }} onClick={() => toggle(path)}>
        <Caret open={open} />
        <span className="rt-key">{name}</span>
        <span className="rt-val muted">
          {Array.isArray(value) ? `배열 ${children.length}개` : `객체 ${children.length}개`}
        </span>
      </button>
      {open &&
        children.map(([key, child]) => (
          <Field
            key={key}
            depth={depth + 1}
            name={key}
            value={child}
            path={`${path}/${key}`}
            expanded={expanded}
            toggle={toggle}
            copied={copied}
            onCopy={onCopy}
          />
        ))}
    </>
  )
}

function Caret({ open }: { open: boolean }) {
  return <span className={`rt-caret ${open ? 'open' : ''}`}>▸</span>
}

/** 펼 수 있는 값이면 [키, 값] 목록, 아니면 null */
function branchEntries(value: unknown): [string, unknown][] | null {
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) return value.map((v, i) => [String(i), v])
  const pairs = Object.entries(value as Record<string, unknown>)
  return pairs.length > 0 ? pairs : null
}

/** 접힌 행 옆에 붙는 한 줄 미리보기 — 무엇이 든 행인지 펴지 않고도 알아보게 */
function preview(row: Record<string, unknown>, columns: string[]): string {
  const text = columns
    .slice(0, 4)
    .map((c) => `${c}=${scalarText(row[c])}`)
    .join('  ')
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

/** 서랍의 「비우기」 옆에 서는 버튼 */
export function ResultTreeButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn sm rd-tree-btn" onClick={onClick} title="결과 전체를 트리로 봅니다">
      <Icon.branch />
      트리 보기
    </button>
  )
}
