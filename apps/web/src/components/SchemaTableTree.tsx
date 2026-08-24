import { useMemo, useState } from 'react'
import { Icon } from './icons'

export type TreeTable = { name: string; namespace: string | null }

/** 스키마 → 테이블 트리 뷰. DB IDE 처럼 스키마를 펼쳐 테이블을 고른다.
 *
 * 값 인코딩은 SearchSelect 와 동일하게 ``namespace|name``. 검색하면 일치하는 테이블이
 * 있는 스키마만 펼쳐 보여준다.
 */
export function SchemaTableTree({
  tables,
  value,
  onChange,
  loading = false,
  embedded = false,
  hideSearch = false,
  filter = '',
}: {
  tables: TreeTable[]
  value: string
  onChange: (value: string) => void
  loading?: boolean
  /** 다른 트리(커넥션 내비게이터) 안에 끼워 넣을 때 — 카드 테두리·고정 높이를 없앤다. */
  embedded?: boolean
  /** 자체 검색창을 숨기고 상위(내비게이터)의 검색어를 쓴다. */
  hideSearch?: boolean
  /** hideSearch 일 때 외부에서 내려주는 검색어. */
  filter?: string
}) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const m = new Map<string, TreeTable[]>()
    for (const t of tables) {
      const ns = t.namespace ?? ''
      if (!m.has(ns)) m.set(ns, [])
      m.get(ns)!.push(t)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tables])

  const selectedNs = value.split('|')[0]
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedNs ? [selectedNs] : []))
  const toggle = (ns: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(ns)) n.delete(ns)
      else n.add(ns)
      return n
    })

  const q = (hideSearch ? filter : query).trim().toLowerCase()

  return (
    <div className={`tree${embedded ? ' embedded' : ''}`}>
      {!hideSearch && (
        <div className="tree-search">
          <Icon.search />
          <input value={query} placeholder="테이블 검색…" onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      <div className="tree-body">
        {loading && <div className="tree-empty">불러오는 중…</div>}
        {!loading && groups.length === 0 && <div className="tree-empty">테이블이 없습니다</div>}
        {!loading &&
          groups.map(([ns, ts]) => {
            const matched = q ? ts.filter((t) => t.name.toLowerCase().includes(q)) : ts
            if (q && matched.length === 0) return null
            const open = q ? true : expanded.has(ns)
            return (
              <div key={ns} className="tree-schema">
                <button
                  type="button"
                  className={`tree-row schema ${open ? 'open' : ''}`}
                  onClick={() => !q && toggle(ns)}
                >
                  <span className={`tree-caret ${open ? 'open' : ''}`}>
                    <Icon.chevron />
                  </span>
                  <Icon.stack />
                  <span className="tree-name">{ns || '(기본)'}</span>
                  <span className="tree-count">{q ? matched.length : ts.length}</span>
                </button>
                {open && (
                  <div className="tree-tables">
                    {matched.map((t) => {
                      const v = `${t.namespace ?? ''}|${t.name}`
                      return (
                        <button
                          key={v}
                          type="button"
                          className={`tree-row table ${v === value ? 'sel' : ''}`}
                          onClick={() => onChange(v)}
                          title={t.name}
                        >
                          <Icon.table />
                          <span className="tree-name">{t.name}</span>
                          {v === value && <Icon.check />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
