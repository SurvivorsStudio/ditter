import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, useConnectionObjects } from '../api/hooks'
import { api } from '../api/client'
import { specFor } from '../api/connectorFields'
import { Icon } from './icons'
import { ObjectDetailModal, type DetailTarget } from './ObjectDetailModal'
import { objectDetailSchema, type Connection, type DbObject } from '../api/types'

type CtxMenu = { x: number; y: number; target: DetailTarget }
export type OpenQueryPayload = { connId: string; mode: 'sql' | 'mongo'; text: string; title: string }
/** 정의(스크립트)로 여는 종류 — 나머지는 SELECT/find 로 연다. */
const DEFINITION_KINDS = new Set(['view', 'materialized_view', 'function', 'procedure'])

/** 데이터 소스 내비게이터 — DataGrip/DBeaver 처럼 연결이 트리의 최상위.
 *  연결을 펼치면 DB → 스키마 → 카테고리(테이블·뷰·구체화뷰·함수·프로시저·시퀀스) → 객체
 *  순으로 지연 로딩되고, 객체를 클릭하면 그 연결을 활성으로 바꾸고 편집기에 삽입한다. */
export function ConnectionNavigator({
  connections,
  activeConnId,
  onActivate,
  onPickTable,
  onOpenQuery,
}: {
  connections: Connection[]
  activeConnId?: string
  onActivate: (id: string) => void
  onPickTable: (connId: string, encoded: string) => void
  /** 우클릭 → "쿼리 탭으로 열기". 없으면 그 메뉴 항목을 숨긴다. */
  onOpenQuery?: (payload: OpenQueryPayload) => void
}) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<CtxMenu | null>(null)
  const [detail, setDetail] = useState<DetailTarget | null>(null)

  // 우클릭 메뉴는 바깥 클릭·Esc·스크롤로 닫는다.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const onObjContext = (e: React.MouseEvent, target: DetailTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }
  const copyName = (t: DetailTarget) => {
    const qn = t.schema ? `${t.schema}.${t.name}` : t.name
    navigator.clipboard?.writeText(qn).catch(() => {})
  }

  // "쿼리 탭으로 열기" — 정의가 있는 종류(뷰·함수…)는 스크립트를, 나머지는 SELECT/find 를 연다.
  const openInTab = async (t: DetailTarget) => {
    setMenu(null)
    if (!onOpenQuery) return
    const qn = t.schema ? `${t.schema}.${t.name}` : t.name
    if (DEFINITION_KINDS.has(t.kind)) {
      let text = `-- 정의를 가져오지 못했습니다: ${qn}`
      try {
        const p = new URLSearchParams({ kind: t.kind, name: t.name })
        if (t.schema) p.set('schema', t.schema)
        const d = await qc.fetchQuery({
          queryKey: ['object-detail', t.connId, t.kind, t.schema, t.name],
          queryFn: () =>
            api.parsed(objectDetailSchema, `/connections/${t.connId}/object?${p.toString()}`),
          staleTime: 60 * 1000,
        })
        if (d.definition) text = d.definition
      } catch {
        /* 폴백 주석 유지 */
      }
      onOpenQuery({ connId: t.connId, mode: 'sql', text, title: t.name })
      return
    }
    if (t.kind === 'collection') {
      onOpenQuery({ connId: t.connId, mode: 'mongo', text: `${t.name}.find({}).limit(100)`, title: t.name })
      return
    }
    // 테이블·시퀀스·기타 → SELECT
    onOpenQuery({ connId: t.connId, mode: 'sql', text: `SELECT *\nFROM ${qn}\nLIMIT 100;`, title: t.name })
  }

  return (
    <div className="sql-nav">
      <div className="tree-search sql-nav-search">
        <Icon.search />
        <input value={query} placeholder="객체 검색…" onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="tree-search-x" onClick={() => setQuery('')} aria-label="지우기">
            ×
          </button>
        )}
      </div>
      <div className="sql-nav-body">
        {connections.length === 0 && <div className="tree-empty">DB 연결이 없습니다</div>}
        {connections.map((c) => (
          <ConnectionNode
            key={c.id}
            conn={c}
            active={c.id === activeConnId}
            filter={query}
            onActivate={onActivate}
            onPickTable={onPickTable}
            onObjContext={onObjContext}
          />
        ))}
      </div>

      {menu &&
        createPortal(
          <div
            className="sql-ctxmenu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="sql-ctxmenu-item"
              onClick={() => {
                setDetail(menu.target)
                setMenu(null)
              }}
            >
              <Icon.table />
              {menu.target.kind === 'table' || menu.target.kind === 'collection'
                ? '구조 보기 (팝업)'
                : menu.target.kind === 'view' || menu.target.kind === 'materialized_view'
                  ? '뷰 스크립트 (팝업)'
                  : menu.target.kind === 'function' || menu.target.kind === 'procedure'
                    ? '소스 보기 (팝업)'
                    : '상세 보기 (팝업)'}
            </button>
            {onOpenQuery && (
              <button className="sql-ctxmenu-item" onClick={() => openInTab(menu.target)}>
                <Icon.code />
                쿼리 탭으로 열기
              </button>
            )}
            <button
              className="sql-ctxmenu-item"
              onClick={() => {
                copyName(menu.target)
                setMenu(null)
              }}
            >
              <Icon.copy />
              이름 복사
            </button>
          </div>,
          document.body,
        )}

      {detail && <ObjectDetailModal target={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** 스키마 안(schema-level) 카테고리 — 표시 순서와 라벨. 엔진마다 있는 종류만 나타난다. */
const CATEGORIES: { kind: string; label: string }[] = [
  { kind: 'table', label: '테이블' },
  { kind: 'view', label: '뷰' },
  { kind: 'materialized_view', label: '구체화 뷰' },
  { kind: 'function', label: '함수' },
  { kind: 'procedure', label: '프로시저' },
  { kind: 'sequence', label: '시퀀스' },
  { kind: 'collection', label: '컬렉션' },
]
const SCHEMA_KINDS = new Set(CATEGORIES.map((c) => c.kind))

/** DB/클러스터 레벨 카테고리 — 스키마에 속하지 않고 DB 노드 바로 아래 온다(PostgreSQL). */
const DB_CATEGORIES: { kind: string; label: string }[] = [
  { kind: 'extension', label: '확장 (Extensions)' },
  { kind: 'event_trigger', label: '이벤트 트리거' },
  { kind: 'tablespace', label: '테이블스페이스' },
  { kind: 'role', label: '롤 (Roles)' },
]

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'view') return <Icon.frame />
  if (kind === 'materialized_view') return <Icon.frame />
  if (kind === 'function') return <Icon.code />
  if (kind === 'procedure') return <Icon.bolt />
  if (kind === 'sequence') return <Icon.stack />
  if (kind === 'collection') return <Icon.leaf />
  if (kind === 'extension') return <Icon.branch />
  if (kind === 'event_trigger') return <Icon.broadcast />
  if (kind === 'tablespace') return <Icon.cloud />
  if (kind === 'role') return <Icon.star />
  return <Icon.table />
}

/** 스키마를 가진 엔진(테이블이 스키마 안에 산다). MySQL·Mongo 는 namespace 가 곧 DB 다. */
const hasSchemas = (type: string) => type === 'postgres' || type === 'mssql'

/** 접기/펼치기 폴더 한 줄 — DB·"Schemas"·스키마 같은 중간 노드에 쓴다. */
function Folder({
  label,
  icon,
  count,
  rowClass,
  bodyClass,
  defaultOpen = false,
  forceOpen = false,
  children,
}: {
  label: string
  icon: ReactNode
  count?: number
  rowClass?: string
  bodyClass?: string
  defaultOpen?: boolean
  forceOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const expanded = forceOpen || open
  return (
    <div>
      <button type="button" className={`tree-row ${rowClass ?? ''}`} onClick={() => setOpen((o) => !o)}>
        <span className={`tree-caret ${expanded ? 'open' : ''}`}>
          <Icon.chevron />
        </span>
        <span className="folder-ic">{icon}</span>
        <span className="tree-name">{label}</span>
        {count != null && <span className="cat-count">{count}</span>}
      </button>
      {expanded && <div className={bodyClass}>{children}</div>}
    </div>
  )
}

function ConnectionNode({
  conn,
  active,
  filter,
  onActivate,
  onPickTable,
  onObjContext,
}: {
  conn: Connection
  active: boolean
  filter: string
  onActivate: (id: string) => void
  onPickTable: (connId: string, encoded: string) => void
  onObjContext: (e: React.MouseEvent, target: DetailTarget) => void
}) {
  const [open, setOpen] = useState(active)
  const { data, isLoading, isFetching } = useConnectionObjects(open ? conn.id : undefined)
  const spec = specFor(conn.type)
  const qc = useQueryClient()

  const q = filter.trim().toLowerCase()
  const searching = q.length > 0
  // 검색 중이면 일치 객체만 남긴다(빈 폴더가 안 생기게). 스키마 안 객체와 DB 레벨 객체를 가른다.
  const { schemas, dbByKind } = useMemo(() => {
    const objs = data?.objects ?? []
    const filtered = searching ? objs.filter((o) => o.name.toLowerCase().includes(q)) : objs
    return {
      schemas: groupBySchema(filtered.filter((o) => SCHEMA_KINDS.has(o.kind))),
      dbByKind: groupByKind(filtered.filter((o) => !SCHEMA_KINDS.has(o.kind))),
    }
  }, [data, searching, q])

  const dbName = (conn.config?.database as string | undefined) || conn.name
  const withSchemas = hasSchemas(conn.type)

  const toggle = () => {
    setOpen((o) => !o)
    onActivate(conn.id)
  }
  const refresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open) setOpen(true)
    onActivate(conn.id)
    qc.invalidateQueries({ queryKey: queryKeys.connectionSchema(conn.id) })
  }

  const categoriesFor = (byKind: Map<string, DbObject[]>) =>
    CATEGORIES.filter((c) => (byKind.get(c.kind)?.length ?? 0) > 0).map((c) => (
      <CategoryNode
        key={c.kind}
        connId={conn.id}
        label={c.label}
        kind={c.kind}
        items={byKind.get(c.kind) ?? []}
        forceOpen={searching}
        onPickTable={onPickTable}
        onObjContext={onObjContext}
      />
    ))

  return (
    <div className="tree-conn">
      <button type="button" className={`tree-row conn ${active ? 'active' : ''}`} onClick={toggle}>
        <span className={`tree-caret ${open ? 'open' : ''}`}>
          <Icon.chevron />
        </span>
        <span className="conn-abbr" style={{ background: spec.color }}>
          {spec.abbr}
        </span>
        <span className="tree-name">{conn.name}</span>
        <span
          className={`conn-refresh ${isFetching ? 'spinning' : ''}`}
          role="button"
          tabIndex={-1}
          title="스키마 새로고침"
          aria-label={`${conn.name} 스키마 새로고침`}
          onClick={refresh}
        >
          <Icon.refresh />
        </span>
        <span className="conn-type">{spec.label}</span>
      </button>
      {open && (
        <div className="tree-conn-body">
          {isLoading ? (
            <div className="tree-skel" aria-label="불러오는 중">
              {[72, 58, 84, 64, 76, 50, 68].map((w, i) => (
                <div key={i} className="tree-skel-row">
                  <span className="tree-skel-ic" />
                  <span className="tree-skel-bar" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          ) : schemas.length === 0 && dbByKind.size === 0 ? (
            <div className="tree-empty sm">객체가 없습니다</div>
          ) : withSchemas ? (
            // PostgreSQL·SQL Server: DB → ("Schemas" → 스키마 → 카테고리) + DB 레벨 항목
            <Folder
              label={dbName}
              icon={<Icon.db />}
              rowClass="db"
              bodyClass="tree-db-body"
              defaultOpen
              forceOpen={searching}
            >
              {schemas.length > 0 && (
                <Folder
                  label="스키마"
                  icon={<Icon.folder />}
                  count={schemas.length}
                  rowClass="schemas"
                  bodyClass="tree-schemas-body"
                  defaultOpen
                  forceOpen={searching}
                >
                  {schemas.map(([schema, byKind]) => (
                    <Folder
                      key={schema}
                      label={schema}
                      icon={<Icon.folder />}
                      rowClass="schema"
                      bodyClass="tree-schema-body"
                      defaultOpen={schemas.length === 1}
                      forceOpen={searching}
                    >
                      {categoriesFor(byKind)}
                    </Folder>
                  ))}
                </Folder>
              )}
              {DB_CATEGORIES.filter((c) => (dbByKind.get(c.kind)?.length ?? 0) > 0).map((c) => (
                <CategoryNode
                  key={c.kind}
                  connId={conn.id}
                  label={c.label}
                  kind={c.kind}
                  items={dbByKind.get(c.kind) ?? []}
                  forceOpen={searching}
                  onPickTable={onPickTable}
                  onObjContext={onObjContext}
                />
              ))}
            </Folder>
          ) : (
            // MySQL·Mongo: namespace 가 곧 DB — DB 노드 밑에 카테고리 바로
            schemas.map(([ns, byKind]) => (
              <Folder
                key={ns}
                label={ns || dbName}
                icon={<Icon.db />}
                rowClass="db"
                bodyClass="tree-db-body"
                defaultOpen={schemas.length === 1}
                forceOpen={searching}
              >
                {categoriesFor(byKind)}
              </Folder>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** 카테고리 폴더 — 항목 수를 함께 보이고, 펼치면 객체가 나온다. */
function CategoryNode({
  connId,
  label,
  kind,
  items,
  forceOpen,
  onPickTable,
  onObjContext,
}: {
  connId: string
  label: string
  kind: string
  items: DbObject[]
  forceOpen: boolean
  onPickTable: (connId: string, encoded: string) => void
  onObjContext: (e: React.MouseEvent, target: DetailTarget) => void
}) {
  const [open, setOpen] = useState(false)
  const expanded = forceOpen || open

  return (
    <div className="tree-cat">
      <button type="button" className="tree-row cat" onClick={() => setOpen((o) => !o)}>
        <span className={`tree-caret ${expanded ? 'open' : ''}`}>
          <Icon.chevron />
        </span>
        <span className="cat-ic">
          <KindIcon kind={kind} />
        </span>
        <span className="tree-name">{label}</span>
        <span className="cat-count">{items.length}</span>
      </button>
      {expanded && (
        <div className="tree-cat-body">
          {items.map((o) => (
            <button
              key={`${o.namespace ?? ''}.${o.name}`}
              type="button"
              className={`tree-row obj ${kind}`}
              title={o.qualified_name}
              onClick={() => onPickTable(connId, `${o.namespace ?? ''}|${o.name}`)}
              onContextMenu={(e) =>
                onObjContext(e, { connId, kind, schema: o.namespace, name: o.name })
              }
            >
              <span className="obj-ic">
                <KindIcon kind={kind} />
              </span>
              <span className="tree-name">{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 객체를 스키마(namespace)별로 묶고, 각 안에서 kind 별로 다시 묶는다. 스키마는 이름순. */
function groupBySchema(objects: DbObject[]): [string, Map<string, DbObject[]>][] {
  const m = new Map<string, Map<string, DbObject[]>>()
  for (const o of objects) {
    const ns = o.namespace ?? ''
    let byKind = m.get(ns)
    if (!byKind) {
      byKind = new Map()
      m.set(ns, byKind)
    }
    const list = byKind.get(o.kind)
    if (list) list.push(o)
    else byKind.set(o.kind, [o])
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

/** DB 레벨 객체(확장·이벤트 트리거·테이블스페이스·롤)를 kind 별로 묶는다. */
function groupByKind(objects: DbObject[]): Map<string, DbObject[]> {
  const m = new Map<string, DbObject[]>()
  for (const o of objects) {
    const list = m.get(o.kind)
    if (list) list.push(o)
    else m.set(o.kind, [o])
  }
  return m
}
