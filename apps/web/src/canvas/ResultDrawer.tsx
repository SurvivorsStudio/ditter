import { useState } from 'react'
import { resultEntries, useCanvasStore, type ResultEntry } from '../store/canvasStore'
import { SPEC_BY_KIND, isTrigger } from './nodeCatalog'
import { ResultTreeButton, ResultTreeModal } from './ResultTreeModal'
import { nodeRefText } from './variables'
import { useT } from '../i18n'

/** 캔버스 하단 결과 서랍 — `{노드이름: 출력결과}`.
 *
 * 노드가 무엇을 내보냈는지 보고, 그 값을 다른 노드에서 쓰기 위한 화면이다.
 * 아이콘+이름 칩을 누르면 그 노드의 결과가 펼쳐지고, 컬럼을 누르면 `${이름.컬럼}` 이
 * 복사된다 — 그 표기를 다른 노드 설정에 붙여 넣으면 **실행할 때마다** 그 노드를 먼저
 * 돌려 첫 행의 값이 꽂힌다.
 *
 * 이름으로 가리키기 때문에 이름이 유일해야 한다 (스토어의 uniqueLabel 이 그것을 지킨다).
 */
export function ResultDrawer() {
  const nodes = useCanvasStore((s) => s.nodes)
  const nodeResults = useCanvasStore((s) => s.nodeResults)
  const clearNodeResults = useCanvasStore((s) => s.clearNodeResults)
  const select = useCanvasStore((s) => s.select)

  const [openId, setOpenId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const tr = useT()
  const [copied, setCopied] = useState<string | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)

  const entries = resultEntries(nodes, nodeResults)
  if (entries.length === 0) return null

  // 펼쳐 둔 노드가 사라졌으면(삭제·다른 파이프라인) 첫 칸으로 되돌린다
  const open = entries.find((e) => e.nodeId === openId) ?? null

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(text)
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1200)
  }

  return (
    <div className={`result-drawer ${collapsed ? 'collapsed' : ''}`}>
      <div className="rd-bar">
        <button
          className="rd-toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? tr('cui.rd.expandResults') : tr('cui.rd.collapseResults')}
        >
          {collapsed ? '▲' : '▼'} {tr('cui.rd.title')} <b>{entries.length}</b>
        </button>

        {!collapsed && (
          <div className="rd-chips">
            {entries.map((entry) => (
              <ResultChip
                key={entry.nodeId}
                entry={entry}
                active={open?.nodeId === entry.nodeId}
                onClick={() => {
                  setOpenId(open?.nodeId === entry.nodeId ? null : entry.nodeId)
                  select(entry.nodeId)
                }}
              />
            ))}
          </div>
        )}

        {!collapsed && (
          <div className="rd-actions">
            <button className="btn sm" onClick={clearNodeResults} title={tr('cui.rd.clearTitle')}>
              {tr('cui.rd.clear')}
            </button>
            <ResultTreeButton onClick={() => setTreeOpen(true)} />
          </div>
        )}
      </div>

      {!collapsed && open && <ResultBody entry={open} copied={copied} onCopy={copy} />}

      {treeOpen && <ResultTreeModal onClose={() => setTreeOpen(false)} />}
    </div>
  )
}

/** 아이콘 + 이름 칩. 노드 종류 색을 그대로 써서 캔버스의 그 노드와 눈으로 이어진다. */
function ResultChip({
  entry,
  active,
  onClick,
}: {
  entry: ResultEntry
  active: boolean
  onClick: () => void
}) {
  const tr = useT()
  const spec = SPEC_BY_KIND[entry.kind]
  const IconComp = spec?.icon
  // 트리거는 행이 아니라 **값**을 내보낸다 — 1행이라고 세면 아무 뜻이 없다
  const handed = isTrigger(entry.kind)
  const count = handed ? entry.sample.columns.length : entry.sample.rows.length
  return (
    <button
      className={`rd-chip ${active ? 'active' : ''}`}
      onClick={onClick}
      title={tr(handed ? 'cui.rd.chipTitleHanded' : 'cui.rd.chipTitleRows', {
        label: entry.label,
        n: count,
      })}
    >
      <span className="rd-chip-ic" style={{ background: spec?.color ?? 'var(--muted)' }}>
        {IconComp ? <IconComp /> : null}
      </span>
      <span className="rd-chip-name">{entry.label}</span>
      <span className="rd-chip-count">
        {count}
        {!handed && entry.sample.truncated ? '+' : ''}
      </span>
    </button>
  )
}

function ResultBody({
  entry,
  copied,
  onCopy,
}: {
  entry: ResultEntry
  copied: string | null
  onCopy: (text: string) => void
}) {
  const tr = useT()
  const columns = entry.sample.columns.length
    ? entry.sample.columns
    : Array.from(new Set(entry.sample.rows.flatMap((r) => Object.keys(r))))

  // 트리거가 넘긴 값은 노드 결과가 아니라 **트리거 변수**다 — 쓰는 표기가 다르다.
  // 같은 서랍에 나란히 두되 표기를 섞으면 안 된다: `${웹훅.since}` 는 검증이 거절한다.
  const handed = isTrigger(entry.kind)
  // 샘플이 잘렸어도 여러 행이다 — 실행할 때는 상한까지 전부 읽는다
  const multiRow = !handed && (entry.sample.rows.length > 1 || entry.sample.truncated)

  return (
    <div className="rd-body">
      <div className="rd-meta">
        <b>{entry.label}</b>
        <span>
          {handed ? (
            <>{tr('cui.handedCount', { n: columns.length })}</>
          ) : (
            <>
              {tr(entry.sample.truncated ? 'cui.rowsMetaPartial' : 'cui.rowsMeta', {
                rows: entry.sample.rows.length,
                cols: columns.length,
              })}
            </>
          )}
        </span>
        <span className="rd-at">
          {tr('cui.rd.asOf', { time: new Date(entry.at).toLocaleTimeString() })}
        </span>
      </div>

      <div className="rd-vars">
        <span className="rd-vars-hd">{tr('cui.rd.varsHd')}</span>
        {columns.map((column) => {
          const text = handed ? `$${column}` : nodeRefText({ node: entry.label, column })
          return (
            <button
              key={column}
              className={`rd-var ${copied === text ? 'copied' : ''}`}
              onClick={() => onCopy(text)}
              title={
                handed
                  ? tr('cui.rd.varTitleHanded', { ref: text })
                  : tr('cui.rd.varTitleFirst', { ref: text, column })
              }
            >
              <code>{text}</code>
              <span className="rd-var-val">{cellText(entry.sample.rows[0]?.[column])}</span>
            </button>
          )
        })}
      </div>

      {multiRow && (
        <div className="rd-vars">
          <span className="rd-vars-hd">{tr('cui.rd.listHd')}</span>
          {columns.map((column) => {
            const text = nodeRefText({ node: entry.label, column, many: true })
            return (
              <button
                key={column}
                className={`rd-var list ${copied === text ? 'copied' : ''}`}
                onClick={() => onCopy(text)}
                title={tr('cui.rd.listTitle', { ref: text, column })}
              >
                <code>{text}</code>
                <span className="rd-var-val">
                  {entry.sample.rows
                    .slice(0, 3)
                    .map((r) => cellText(r[column]))
                    .join(', ')}
                  {entry.sample.rows.length > 3 && ', …'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="rd-scroll">
        {entry.sample.rows.length === 0 ? (
          <div className="empty" style={{ padding: 20 }}>
            {tr('cui.noResultRows')}
          </div>
        ) : (
          <table className="sample-table">
            <thead>
              <tr>
                <th className="rownum">#</th>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entry.sample.rows.map((row, i) => (
                <tr key={i} className={i === 0 ? 'rd-first' : ''}>
                  <td className="rownum">{i + 1}</td>
                  {columns.map((c) => (
                    <td key={c} title={cellText(row[c])}>
                      {cellText(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="rd-note">
        {handed ? (
          <>
            {tr('cui.rd.noteHanded1', { label: entry.label })}
            <code>{tr('cui.ref.varName')}</code>
            {tr('cui.rd.noteHanded2')}
          </>
        ) : (
          <>
            {tr('cui.rd.noteFirst1')}
            <span className="rd-first-dot" />
            {tr('cui.rd.noteFirst2', { label: entry.label })}
          </>
        )}
      </div>
    </div>
  )
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}
