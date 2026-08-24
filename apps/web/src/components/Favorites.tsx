import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'
import { Icon } from './icons'
import { SearchSelect, type SelectOption } from './SearchSelect'
import { specFor } from '../api/connectorFields'
import type { Favorite } from '../api/favoritesStore'
import type { Connection } from '../api/types'

/** 즐겨찾기 추가/편집용 작은 SQL 에디터 — 구문 색상 강조가 되는 입력창.
 *  자동완성·라인번호 없이 가볍게, 편집 중에도 미리보기와 같은 색으로 보이게 한다. */
function FavSqlInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const extensions = useMemo(() => [sql(), EditorView.lineWrapping], [])
  return (
    <CodeMirror
      className="fav-cm"
      value={value}
      onChange={onChange}
      theme="light"
      height="120px"
      extensions={extensions}
      placeholder={placeholder}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        autocompletion: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        bracketMatching: true,
      }}
    />
  )
}

/** 가벼운 SQL 하이라이트 — CodeMirror 를 항목마다 띄우지 않고 span 으로 색만 입힌다.
 *  문자열·주석·숫자·키워드를 구분한다(엄밀한 파서는 아니지만 미리보기엔 충분). */
const SQL_KEYWORDS = new Set(
  (
    'select from where group by order having limit offset join inner left right full outer on ' +
    'as and or not in is null like between union all distinct insert into values update set delete ' +
    'create table view index drop alter add count sum avg min max case when then else end asc desc ' +
    'with exists any some cast coalesce over partition using cross natural'
  )
    .toUpperCase()
    .split(' '),
)

type SqlTok = { t: string; s: string }
function tokenizeSql(sql: string): SqlTok[] {
  const out: SqlTok[] = []
  const n = sql.length
  let i = 0
  const push = (t: string, s: string) => s && out.push({ t, s })
  while (i < n) {
    const ch = sql[i]
    if (ch === '/' && sql[i + 1] === '*') {
      let j = i + 2
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j++
      j = Math.min(j + 2, n)
      push('comment', sql.slice(i, j))
      i = j
    } else if (ch === '-' && sql[i + 1] === '-') {
      let j = i
      while (j < n && sql[j] !== '\n') j++
      push('comment', sql.slice(i, j))
      i = j
    } else if (ch === "'") {
      let j = i + 1
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          j++
          break
        }
        j++
      }
      push('str', sql.slice(i, j))
      i = j
    } else if (ch === '"') {
      let j = i + 1
      while (j < n && sql[j] !== '"') j++
      j = Math.min(j + 1, n)
      push('str', sql.slice(i, j))
      i = j
    } else if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < n && /[0-9.]/.test(sql[j])) j++
      push('num', sql.slice(i, j))
      i = j
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++
      const w = sql.slice(i, j)
      push(SQL_KEYWORDS.has(w.toUpperCase()) ? 'kw' : 'id', w)
      i = j
    } else if ('(),.;*=<>!+-/%|&{}[]:'.includes(ch)) {
      push('punct', ch)
      i++
    } else {
      push('ws', ch)
      i++
    }
  }
  return out
}

/** 즐겨찾기 항목이 속한 연결의 배지(PG/MG…). 연결이 지워졌으면 회색 물음표. */
function ConnBadge({ conn }: { conn?: Connection }) {
  if (!conn) return <span className="fav-conn-badge missing" title="삭제된 연결">?</span>
  const spec = specFor(conn.type)
  return (
    <span className="fav-conn-badge" style={{ background: spec.color }} title={conn.name}>
      {spec.abbr}
    </span>
  )
}

/** 즐겨찾기 탭 본문 — 자주 쓰는 단일 쿼리를 이름 붙여 등록/관리한다.
 *
 *  편집기에서 `/loadQueryList` 팝업이나 `/loadQuery.이름` 으로 커서 위치에 SQL 을 불러온다.
 *  (폴더 트리인 "저장됨"과는 별개. 여기엔 SQL 텍스트만 담고 연결은 저장하지 않는다.) */
export function FavoritesPanel({
  favorites,
  connections,
  activeConnId,
  onAdd,
  onUpdate,
  onDelete,
}: {
  favorites: Favorite[]
  connections: Connection[]
  /** 활성 쿼리 탭의 연결 — 연결 필터가 이 값을 자동으로 따라간다. */
  activeConnId?: string
  onAdd: (name: string, sql: string, connId: string) => void
  onUpdate: (id: string, patch: { name?: string; sql?: string; connId?: string }) => void
  onDelete: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [sql, setSql] = useState('')
  const [connId, setConnId] = useState(connections[0]?.id ?? '')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSql, setEditSql] = useState('')
  const [editConnId, setEditConnId] = useState('')
  const [search, setSearch] = useState('')
  const [filterConnId, setFilterConnId] = useState(activeConnId ?? '') // '' = 전체 연결
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 활성 쿼리 탭의 연결이 바뀌면 필터도 그 연결로 자동 전환한다(그 사이엔 수동 변경 가능).
  useEffect(() => {
    if (activeConnId !== undefined) setFilterConnId(activeConnId)
  }, [activeConnId])

  const copySql = async (f: Favorite) => {
    try {
      await navigator.clipboard.writeText(f.sql)
    } catch {
      // 클립보드 API 가 막힌 환경 폴백
      const ta = document.createElement('textarea')
      ta.value = f.sql
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* 무시 */
      }
      document.body.removeChild(ta)
    }
    setCopiedId(f.id)
    window.setTimeout(() => setCopiedId((id) => (id === f.id ? null : id)), 1200)
  }

  const connById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections])
  const connOptions: SelectOption[] = connections.map((c) => ({
    value: c.id,
    label: c.name,
    hint: specFor(c.type).label,
  }))

  const resetAdd = () => {
    setAdding(false)
    setName('')
    setSql('')
  }
  const submitAdd = () => {
    const n = name.trim()
    if (!n || !sql.trim() || !connId) return
    onAdd(n, sql, connId)
    resetAdd()
  }
  const startEdit = (f: Favorite) => {
    setEditId(f.id)
    setEditName(f.name)
    setEditSql(f.sql)
    setEditConnId(f.connId ?? connections[0]?.id ?? '')
  }
  const commitEdit = () => {
    if (editId) onUpdate(editId, { name: editName.trim() || undefined, sql: editSql, connId: editConnId })
    setEditId(null)
  }
  const connLead = (id: string) => {
    const c = connById.get(id)
    return c ? (
      <span className="ss-badge" style={{ background: specFor(c.type).color }}>
        {specFor(c.type).abbr}
      </span>
    ) : null
  }

  const term = search.trim().toLowerCase()
  const shown = favorites.filter((f) => {
    // 연결 필터 — 특정 DB 를 지정하면 그 연결의 즐겨찾기만 본다.
    if (filterConnId && f.connId !== filterConnId) return false
    if (!term) return true
    const conn = f.connId ? connById.get(f.connId) : undefined
    const connText = conn ? `${conn.name} ${specFor(conn.type).label}`.toLowerCase() : ''
    return (
      f.name.toLowerCase().includes(term) ||
      f.sql.toLowerCase().includes(term) ||
      connText.includes(term)
    )
  })
  const filterOptions: SelectOption[] = [
    { value: '', label: '전체 연결' },
    ...connOptions,
  ]

  return (
    <div className="fav-panel">
      <div className="fav-head">
        <span className="fav-title">즐겨찾기</span>
        <button className="fav-newbtn" onClick={() => setAdding((a) => !a)} title="즐겨찾기 추가">
          <Icon.plus />
          추가
        </button>
      </div>
      <div className="fav-hint">
        편집기에서 <code>/loadQueryList</code> 로 목록 팝업을, <code>/loadQuery.이름</code> 으로 바로 불러옵니다.
      </div>

      {adding && (
        <div className="fav-form">
          <div className="fav-conn-row">
            <span className="fav-conn-label">연결</span>
            {connections.length === 0 ? (
              <span className="fav-conn-none">등록된 연결이 없습니다</span>
            ) : (
              <SearchSelect
                value={connId}
                onChange={setConnId}
                options={connOptions}
                placeholder="연결 선택…"
                leading={connLead(connId)}
              />
            )}
          </div>
          <input
            className="fav-name-input"
            value={name}
            placeholder="이름 (예: 일일집계)"
            onChange={(e) => setName(e.target.value)}
          />
          <FavSqlInput value={sql} onChange={setSql} placeholder="SELECT * FROM ..." />
          <div className="fav-form-actions">
            <button
              className="btn sm primary"
              onClick={submitAdd}
              disabled={!name.trim() || !sql.trim() || !connId}
            >
              <Icon.save />
              저장
            </button>
            <button className="btn sm" onClick={resetAdd}>
              취소
            </button>
          </div>
        </div>
      )}

      {favorites.length > 0 && (
        <div className="fav-filters">
          {connections.length > 0 && (
            <div className="fav-connfilter">
              <SearchSelect
                value={filterConnId}
                onChange={setFilterConnId}
                options={filterOptions}
                placeholder="전체 연결"
                leading={filterConnId ? connLead(filterConnId) : null}
              />
            </div>
          )}
          <div className="tree-search fav-search">
            <Icon.search />
            <input
              value={search}
              placeholder="이름·SQL 로 검색…"
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="tree-search-x" onClick={() => setSearch('')} aria-label="지우기">
                ×
              </button>
            )}
          </div>
        </div>
      )}

      <div className="fav-body">
        {favorites.length === 0 && !adding ? (
          <div className="fav-empty">
            등록된 즐겨찾기가 없습니다.
            <br />
            <b>추가</b> 를 눌러 자주 쓰는 쿼리를 이름과 함께 담아 두세요.
          </div>
        ) : shown.length === 0 ? (
          <div className="fav-empty">
            {term ? `“${search.trim()}” 검색 결과가 없습니다.` : '이 연결의 즐겨찾기가 없습니다.'}
          </div>
        ) : (
          shown.map((f) =>
            editId === f.id ? (
              <div key={f.id} className="fav-form">
                <div className="fav-conn-row">
                  <span className="fav-conn-label">연결</span>
                  {connections.length === 0 ? (
                    <span className="fav-conn-none">등록된 연결이 없습니다</span>
                  ) : (
                    <SearchSelect
                      value={editConnId}
                      onChange={setEditConnId}
                      options={connOptions}
                      placeholder="연결 선택…"
                      leading={connLead(editConnId)}
                    />
                  )}
                </div>
                <input
                  className="fav-name-input"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <FavSqlInput value={editSql} onChange={setEditSql} placeholder="SELECT * FROM ..." />
                <div className="fav-form-actions">
                  <button className="btn sm primary" onClick={commitEdit} disabled={!editName.trim()}>
                    <Icon.save />
                    저장
                  </button>
                  <button className="btn sm" onClick={() => setEditId(null)}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div key={f.id} className="fav-item">
                <div className="fav-item-top">
                  <ConnBadge conn={f.connId ? connById.get(f.connId) : undefined} />
                  <span className="fav-item-name" title={f.name}>
                    {f.name}
                  </span>
                  <button
                    className={`fav-icon-btn ${copiedId === f.id ? 'copied' : ''}`}
                    title={copiedId === f.id ? '복사됨' : 'SQL 복사'}
                    onClick={() => copySql(f)}
                  >
                    {copiedId === f.id ? <Icon.check /> : <Icon.copy />}
                  </button>
                  <button className="fav-icon-btn" title="편집" onClick={() => startEdit(f)}>
                    <Icon.edit />
                  </button>
                  <button
                    className="fav-icon-btn"
                    title="삭제"
                    onClick={() => {
                      if (confirm(`즐겨찾기 "${f.name}" 를 삭제할까요?`)) onDelete(f.id)
                    }}
                  >
                    <Icon.trash />
                  </button>
                </div>
                {(() => {
                  const isOpen = expanded.has(f.id)
                  // 대략 5줄/260자 넘으면 길다고 보고 접는다(측정 없이 휴리스틱).
                  const long = f.sql.split('\n').length > 5 || f.sql.length > 260
                  return (
                    <>
                      <pre
                        className={`fav-item-sql sqlhl ${long && !isOpen ? 'clamped' : ''} ${isOpen ? 'expanded' : ''}`}
                      >
                        {tokenizeSql(f.sql).map((tk, ti) => (
                          <span key={ti} className={`sqlhl-${tk.t}`}>
                            {tk.s}
                          </span>
                        ))}
                      </pre>
                      {long && (
                        <button className="fav-sql-toggle" onClick={() => toggleExpand(f.id)}>
                          {isOpen ? '접기' : '더 보기'}
                        </button>
                      )}
                    </>
                  )
                })()}
              </div>
            ),
          )
        )}
      </div>
    </div>
  )
}

/** `/loadQueryList` 로 여는 큰 즐겨찾기 피커 모달 — 왼쪽 목록에서 고르고 오른쪽에서 SQL 을 보며 선택한다. */
export function FavoritePickerModal({
  favorites,
  onPick,
  onClose,
}: {
  favorites: Favorite[]
  onPick: (sql: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const shown = useMemo(
    () =>
      term
        ? favorites.filter(
            (f) => f.name.toLowerCase().includes(term) || f.sql.toLowerCase().includes(term),
          )
        : favorites,
    [favorites, term],
  )
  const [selId, setSelId] = useState(favorites[0]?.id ?? '')
  const sel = shown.find((f) => f.id === selId) ?? shown[0]
  // 갓 열린 직후의 Enter(모달을 연 그 Enter)를 무시해 첫 항목이 자동 선택되는 걸 막는다.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    // 검색으로 목록이 바뀌면 선택이 사라지지 않게 첫 항목으로 맞춘다.
    if (shown.length && !shown.some((f) => f.id === selId)) setSelId(shown[0].id)
  }, [shown, selId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (ready && sel) onPick(sel.sql)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!shown.length) return
        const i = Math.max(0, shown.findIndex((f) => f.id === (sel?.id ?? '')))
        const next = e.key === 'ArrowDown' ? Math.min(i + 1, shown.length - 1) : Math.max(i - 1, 0)
        setSelId(shown[next].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, sel, onPick, onClose, ready])

  return createPortal(
    <div className="fp-overlay" onMouseDown={onClose}>
      <div className="fp-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fp-head">
          <span className="fp-title">
            <Icon.star />
            즐겨찾기 불러오기
          </span>
          <button className="fp-x" onClick={onClose} aria-label="닫기" title="닫기 (Esc)">
            ×
          </button>
        </div>
        <div className="fp-search">
          <Icon.search />
          <input
            autoFocus
            value={search}
            placeholder="이름·SQL 로 검색…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {favorites.length === 0 ? (
          <div className="fp-empty">
            등록된 즐겨찾기가 없습니다.
            <br />
            좌측 <b>즐겨찾기</b> 탭에서 자주 쓰는 쿼리를 먼저 등록하세요.
          </div>
        ) : (
          <div className="fp-body">
            <div className="fp-list">
              {shown.length === 0 && <div className="fp-list-empty">검색 결과가 없습니다.</div>}
              {shown.map((f) => (
                <button
                  key={f.id}
                  className={`fp-item ${f.id === sel?.id ? 'active' : ''}`}
                  onClick={() => setSelId(f.id)}
                  onDoubleClick={() => onPick(f.sql)}
                >
                  <Icon.star />
                  <span className="fp-item-name">{f.name}</span>
                </button>
              ))}
            </div>
            <div className="fp-preview">
              {sel ? (
                <>
                  <div className="fp-preview-name">{sel.name}</div>
                  <pre className="fp-preview-sql sqlhl">
                    {tokenizeSql(sel.sql).map((tk, ti) => (
                      <span key={ti} className={`sqlhl-${tk.t}`}>
                        {tk.s}
                      </span>
                    ))}
                  </pre>
                </>
              ) : (
                <div className="fp-preview-empty">항목을 선택하세요.</div>
              )}
            </div>
          </div>
        )}
        <div className="fp-foot">
          <span className="fp-hint">↑↓ 이동 · Enter 불러오기 · Esc 닫기</span>
          <div className="fp-foot-actions">
            <button className="btn sm" onClick={onClose}>
              취소
            </button>
            <button className="btn sm primary" onClick={() => sel && onPick(sel.sql)} disabled={!sel}>
              <Icon.play />
              불러오기
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
