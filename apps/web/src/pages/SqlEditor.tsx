import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  useConnections,
  useConnectionSchema,
  useCreatePipeline,
  useDuckTables,
  usePipelines,
} from '../api/hooks'
import { SqlWorkbench } from '../canvas/SqlEditor'
import { AiChatPane } from '../canvas/AiChatPane'
import { isChatConn, clearChat, saveChat, chatUid, type ChatState } from '../api/aiChatStore'
import { ConnectionNavigator } from '../components/ConnectionNavigator'
import { SearchSelect, type SelectOption } from '../components/SearchSelect'
import { specFor } from '../api/connectorFields'
import type { MutedMap, SqlStatement } from '../api/statements'
import {
  canMute,
  loadMuted,
  riskOf,
  statementsOf,
  storeMuted,
  toggleMuted,
} from '../api/statements'
import { Icon } from '../components/icons'
import { SavedQueriesPanel, SaveQueryDialog } from '../components/SavedQueries'
import { FavoritesPanel } from '../components/Favorites'
import { Canvas } from './Canvas'
import { RunDetail } from './RunDetail'
import { useCanvasStore } from '../store/canvasStore'
import { Notebook, cellUid, cellsToText, textToCells, type Cell } from '../components/Notebook'
import {
  addFolder,
  addPipeline,
  emptyFolder,
  loadSaved,
  movePipeline,
  removePipeline,
  moveFolder,
  moveQuery,
  removeFolder,
  removeQuery,
  storeSaved,
  uid,
  updateFolder,
  updateQuery,
  type SavedFolder,
  type SavedQuery,
} from '../api/savedStore'
import {
  addFavorite,
  loadFavorites,
  removeFavorite,
  storeFavorites,
  updateFavorite,
  type Favorite,
} from '../api/favoritesStore'
import type { Connection, PipelineSummary } from '../api/types'
import {
  DUCK_CONN,
  duckRef,
  duckStarter,
  isDuckConn,
  isDuckType,
  type DuckTable,
} from '../canvas/duckRefs'
import { DuckScriptModal } from '../canvas/DuckScriptModal'

// 이 페이지에서 조회 가능한 연결 타입 — SQL(mysql·postgres·mssql) + MongoDB(mongo)
const DB_TYPES = ['mysql', 'postgres', 'mssql', 'mongo']

// 특수 탭(예약 id ≤ 0). 세션(쿼리) 탭 id 는 1 부터 — 셋 다 같은 도크 시스템을 공유한다.
const CONN_TAB = 0 // 연결(내비게이터)
const SAVED_TAB = -1 // 저장된 쿼리
const FAV_TAB = -2 // 즐겨찾기(자주 쓰는 쿼리)
/** 잠깐 존재했던 별도 「파이프라인」 탭. 지금은 저장됨 트리가 파이프라인까지 담으므로
 *  없앴고, 이미 저장된 워크스페이스에서 지워 내기 위해서만 남는다. */
const DEAD_PIPE_TAB = -3
const AI_TAB = -4 // AI 어시스턴트 — 연결·저장됨처럼 고유의 특수 탭
const isSpecial = (id: number) => id <= 0

// 한 컬럼(세로 열)에 쌓을 수 있는 도크 최대 개수
const MAX_ROWS = 3

/** 쿼리 탭 하나 = 독립 세션. 자체 연결·쿼리 텍스트·결과를 갖는다 (DBeaver 식 탭). */
type Session = {
  id: number
  title: string
  /** 이 탭이 무엇을 조회하는가. 실제 연결 id, `''`(첫 연결로 폴백), 또는 `DUCK_CONN`.
   *
   *  연합 조회를 **탭 종류로 나누지 않고 연결 선택의 한 항목**으로 둔 이유는, 사용자가
   *  "이 탭이 무엇을 조회하는가"를 한 곳에서만 정하게 하려는 것이다. */
  connId: string
  sql: string
  mongoCmd: string
  mongoNs: string | null
  /** 저장됨(폴더 트리)에서 온/저장한 항목 id. 있으면 ⌘/Ctrl+S 가 팝업 없이 바로 덮어쓴다. */
  savedId?: string
  /** 있으면 이 탭은 **파이프라인 탭**이다 — SQL 편집기 대신 캔버스가 뜬다.
   *  (연합 조회를 `connId` 한 필드로 가른 것과 같은 방식 — 탭 '종류'를 따로 두지 않는다.) */
  pipelineId?: string
  /** 보기 방식 — 'editor'(단일 편집기, 기본) / 'notebook'(블록 실행). 없으면 'editor'. */
  view?: 'editor' | 'notebook'
  /** notebook 일 때의 셀 목록. 결과는 저장하지 않는다(재실행). */
  cells?: Cell[]
}

/** 파이프라인 탭인가 — SQL 세션을 찾을 때 이 탭들은 걸러야 한다 (편집기가 없다). */
const isPipelineSession = (s: Session) => Boolean(s.pipelineId)

const isDuckSession = (s: Session) => isDuckConn(s.connId)

/** 도크 = 탭 그룹. 탭은 CONN_TAB(연결) 과 세션 id 가 섞여 들어간다. */
type Dock = { id: number; tabs: number[]; active: number }

/** 컬럼 = 세로로 쌓인 도크들. 컬럼은 가로로 늘어놓는다 → 2차원 그리드 레이아웃. */
type Column = { id: number; docks: Dock[] }

/** 새 **본문 탭**(쿼리·파이프라인)을 놓을 도크 — 본문 탭이 가장 많이 모인 곳.
 *
 *  포커스한 도크에 그냥 넣으면, 방금 트리를 눌렀을 때 그 트리 옆에 편집기가 생긴다.
 *  패널(연결·저장됨·즐겨찾기)은 좁게 두고 쓰는 칸이라 본문이 끼어들면 둘 다 못 쓴다.
 *
 *  같은 수가 여럿이면 **지금 포커스한 도크**를 고른다 — 사용자가 마지막으로 본 쪽이다. */
export function contentDock(columns: Column[], focused: number): number {
  const docks = columns.flatMap((c) => c.docks)
  const bodyTabs = (d: Dock) => d.tabs.filter((t) => !isSpecial(t)).length
  const fallback = docks.some((d) => d.id === focused) ? focused : (docks[0]?.id ?? focused)
  const max = Math.max(0, ...docks.map(bodyTabs))
  if (max > 0) {
    const foc = docks.find((d) => d.id === focused)
    if (foc && bodyTabs(foc) === max) return foc.id
    return docks.find((d) => bodyTabs(d) === max)?.id ?? fallback
  }
  // 본문 탭이 하나도 없다 — 패널만 든 도크는 피하고, 그런 곳도 없으면 포커스 도크.
  return docks.find((d) => !d.tabs.some(isSpecial))?.id ?? fallback
}

type Layout = { sessions: Session[]; columns: Column[]; focused: number }

/** 손대지 않은 빈 편집기인가 — 연결을 바꿀 때 예시로 채워도 되는지 판단한다.
 *  쓰던 SQL 을 덮어쓰는 것이 더 나쁜 일이라, 기본값 그대로일 때만 바꾼다. */
const BLANK_SQL = ''
const isUntouched = (sql: string) => !sql.trim() || sql.trim() === BLANK_SQL.trim()

const blankSession = (id: number): Session => ({
  id,
  title: `쿼리 ${id}`,
  connId: '',
  sql: BLANK_SQL,
  mongoCmd: '',
  mongoNs: null,
  view: 'editor',
  cells: [],
})

// ---- 워크스페이스 지속 (탭 배치·도크 구성·pane 크기를 localStorage 에 자동 저장/복원) ----
export type Workspace = {
  sessions: Session[]
  columns: Column[]
  focused: number
  colWeights: Record<number, number>
  rowWeights: Record<number, number>
  lastFocused: number | null
}
const WS_KEY = 'eai_sql_workspace_v1'

const defaultWorkspace = (): Workspace => ({
  sessions: [blankSession(1)],
  columns: [
    { id: 1, docks: [{ id: 1, tabs: [CONN_TAB, SAVED_TAB, FAV_TAB, AI_TAB], active: CONN_TAB }] },
    { id: 2, docks: [{ id: 2, tabs: [1], active: 1 }] },
  ],
  focused: 2,
  colWeights: { 1: 0.55, 2: 1.45 },
  rowWeights: {},
  lastFocused: 1,
})

/** 저장된 워크스페이스가 구조적으로 온전한지 (연결·저장 특수탭 존재, 탭↔세션 정합). */
function validWorkspace(ws: Workspace): boolean {
  if (!Array.isArray(ws.sessions) || !Array.isArray(ws.columns) || ws.columns.length === 0) return false
  const sessionIds = new Set(ws.sessions.map((s) => s.id))
  const allTabs = ws.columns.flatMap((c) => c.docks.flatMap((d) => d.tabs))
  if (!allTabs.includes(CONN_TAB) || !allTabs.includes(SAVED_TAB)) return false
  // FAV_TAB 은 필수로 두지 않는다 — 기능 추가 전 워크스페이스를 무효화하지 않기 위해(마이그레이션으로 채운다).
  // DEAD_PIPE_TAB 은 없앤 탭이지만 여기서 걸러 내면 워크스페이스를 통째로 버리게 된다 —
  // 통과시킨 뒤 `stripDeadPipeTab` 이 조용히 빼낸다.
  return allTabs.every(
    (t) =>
      t === CONN_TAB ||
      t === SAVED_TAB ||
      t === FAV_TAB ||
      t === AI_TAB ||
      t === DEAD_PIPE_TAB ||
      sessionIds.has(t),
  )
}

/** 예전 워크스페이스에는 AI 탭이 없다 — 즐겨찾기(없으면 저장됨) 옆에 끼워 넣는다. */
function ensureAiTab(ws: Workspace): Workspace {
  const has = ws.columns.some((c) => c.docks.some((d) => d.tabs.includes(AI_TAB)))
  if (has) return ws
  let injected = false
  const columns = ws.columns.map((c) => ({
    ...c,
    docks: c.docks.map((d) => {
      if (injected) return d
      const anchor = d.tabs.includes(FAV_TAB) ? FAV_TAB : d.tabs.includes(SAVED_TAB) ? SAVED_TAB : null
      if (anchor === null) return d
      injected = true
      const at = d.tabs.indexOf(anchor) + 1
      return { ...d, tabs: [...d.tabs.slice(0, at), AI_TAB, ...d.tabs.slice(at)] }
    }),
  }))
  return { ...ws, columns }
}

/** 예전 워크스페이스에는 즐겨찾기 탭이 없다 — 저장됨 탭이 있는 도크에 끼워 넣는다. */
function ensureFavTab(ws: Workspace): Workspace {
  const has = ws.columns.some((c) => c.docks.some((d) => d.tabs.includes(FAV_TAB)))
  if (has) return ws
  let injected = false
  const columns = ws.columns.map((c) => ({
    ...c,
    docks: c.docks.map((d) => {
      if (!injected && d.tabs.includes(SAVED_TAB)) {
        injected = true
        const at = d.tabs.indexOf(SAVED_TAB) + 1
        return { ...d, tabs: [...d.tabs.slice(0, at), FAV_TAB, ...d.tabs.slice(at)] }
      }
      return d
    }),
  }))
  return { ...ws, columns }
}

/** 없앤 「파이프라인」 특수 탭을 저장된 워크스페이스에서 빼낸다.
 *
 *  짧게 존재했던 탭이라 이미 배치에 박힌 브라우저가 있다. 남겨 두면 본문이 없는 빈 탭이
 *  뜨고, `validWorkspace` 에서 걸러 내면 배치를 통째로 잃는다 — 조용히 빼는 편이 맞다. */
export function stripDeadPipeTab(ws: Workspace): Workspace {
  const columns = ws.columns
    .map((c) => ({
      ...c,
      docks: c.docks
        .map((d) => {
          if (!d.tabs.includes(DEAD_PIPE_TAB)) return d
          const tabs = d.tabs.filter((t) => t !== DEAD_PIPE_TAB)
          // 그 탭이 활성이었으면 첫 탭으로 옮긴다 — 없는 탭이 활성이면 본문이 빈다.
          return { ...d, tabs, active: d.active === DEAD_PIPE_TAB ? (tabs[0] ?? -1) : d.active }
        })
        .filter((d) => d.tabs.length > 0),
    }))
    .filter((c) => c.docks.length > 0)
  return { ...ws, columns }
}

/** 예전에는 연합 조회가 탭 종류(`kind: 'duck'`)였다. 지금은 연결 선택의 한 항목이므로
 *  저장돼 있던 탭을 그 형태로 옮긴다 — 열어 보니 일반 탭이 돼 있으면 곤란하다. */
function migrate(ws: Workspace): Workspace {
  return {
    ...ws,
    sessions: ws.sessions.map((s) => {
      const { kind, ...rest } = s as Session & { kind?: string }
      return kind === 'duck' ? { ...rest, connId: DUCK_CONN } : (rest as Session)
    }),
  }
}

function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(WS_KEY)
    if (raw) {
      const ws = JSON.parse(raw) as Workspace
      if (validWorkspace(ws)) return migrate(stripDeadPipeTab(ensureAiTab(ensureFavTab(ws))))
    }
  } catch {
    /* 손상된 값은 무시하고 기본값 */
  }
  return defaultWorkspace()
}

function storeWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify(ws))
  } catch {
    /* 용량 초과 등은 조용히 무시 */
  }
}

const maxOr = (nums: number[], floor: number) => nums.reduce((m, n) => Math.max(m, n), floor)

/** 이 연결에서 실행할 수 있는 SQL 명령 태그. 「연결 관리」의 허용 명령을 그대로 비춘다.
 *
 *  여기서 바꾸지 않는 이유는 자리 때문이다 — 편집기에서 바꾸면 다른 탭·다른 사람의 실행까지
 *  함께 바뀌는데 그 사실이 이 자리에서는 보이지 않는다. 바꾸는 곳은 「연결 관리」 하나다. */
function StatementTags({
  conn,
  muted,
  onToggle,
}: {
  conn: Connection
  muted: SqlStatement[]
  onToggle: (s: SqlStatement) => void
}) {
  const list = statementsOf(conn)
  return (
    <span className="stmt-tags">
      {list.map((s) => {
        const off = muted.includes(s)
        const name = s.toUpperCase()
        if (!canMute(s)) {
          // SELECT 는 끄지 않는다 — 실수로 조회하는 일은 없고, 끄면 편집기가 아무 일도 못 한다.
          return (
            <span key={s} className={`stmt-tag risk-${riskOf(s)}`} title="조회는 항상 켜져 있습니다">
              {name}
            </span>
          )
        }
        return (
          <button
            key={s}
            type="button"
            className={`stmt-tag toggle risk-${riskOf(s)} ${off ? 'off' : ''}`}
            aria-pressed={!off}
            onClick={() => onToggle(s)}
            title={
              off
                ? `${name} 를 꺼 두었습니다 — 눌러서 다시 켭니다`
                : `${name} 를 실행할 수 있습니다 — 눌러서 잠시 끕니다 (실수 방지)`
            }
          >
            {name}
          </button>
        )
      })}
    </span>
  )
}

/** 한 세션의 에디터 — 에디터+결과만 렌더(내비게이터는 별도 탭). 비활성 탭은 숨겨 상태를 보존한다. */
function SessionEditor({
  session,
  dbConns,
  connLoading,
  duckTables,
  duckLoading,
  hidden,
  onChange,
  onChangeConn,
  mutedOf,
  bindInsert,
  onFocus,
  onSave,
  favorites,
  onAddFavorite,
  muted,
  onToggleMuted,
  onAiEscalate,
}: {
  session: Session
  dbConns: Connection[]
  connLoading: boolean
  duckTables: DuckTable[]
  duckLoading: boolean
  hidden: boolean
  onChange: (patch: Partial<Session>) => void
  onChangeConn: (connId: string) => void
  bindInsert: (fn: (text: string) => void) => void
  onFocus: () => void
  onSave: (payload: {
    sessionId: number
    mode: 'sql' | 'mongo' | 'duck'
    text: string
    connId: string
    namespace: string | null
    defaultName: string
  }) => void
  favorites: Favorite[]
  onAddFavorite: (name: string, sql: string, connId: string) => void
  /** 이 연결에서 사용자가 잠시 꺼 둔 명령 (툴바 태그 클릭). */
  muted: SqlStatement[]
  /** 다른 연결에서 꺼 둔 명령 — 문장이 `-- @conn` 으로 그쪽으로 나갈 때 그 기준으로 막는다. */
  mutedOf: (connId: string) => SqlStatement[]
  onToggleMuted: (connId: string, s: SqlStatement) => void
  onAiEscalate: (payload: { sql: string; error?: string; explain?: string; assistant: string; dbConnId?: string }) => void
}) {
  const duck = isDuckSession(session)
  // 파이썬 코드 팝업 — 세션마다 따로 연다 (탭이 여럿이면 각자 자기 쿼리를 보여야 한다)
  const [showScript, setShowScript] = useState(false)
  const effConnId = duck ? '' : session.connId || dbConns[0]?.id || ''
  const active = dbConns.find((c) => c.id === effConnId)
  const isMongo = active?.type === 'mongo'
  const spec = active ? specFor(active.type) : null
  // pk=false — SQL 편집기 자동완성엔 PK 가 필요 없어 느린 PK 조회를 건너뛴다.
  const { data: schema, isLoading: schemaLoading } = useConnectionSchema(effConnId || undefined, false)
  const activeTables = schema?.tables ?? []

  // 「연합 조회」를 목록 맨 위에 둔다 — 연결 하나가 아니라 '여러 연결'이라 성격이 다르고,
  // 아래로 내려가면 연결이 많을 때 스크롤에 묻힌다.
  // AI 어시스턴트는 이제 고유의 특수 탭(AI_TAB)이라 여기 드롭다운에는 넣지 않는다.
  const connOptions: SelectOption[] = [
    { value: DUCK_CONN, label: '연합 조회', hint: '여러 연결', accent: true },
    ...dbConns.map((c) => ({ value: c.id, label: c.name, hint: specFor(c.type).label })),
  ]

  // 이 탭의 연결에 속한 즐겨찾기만 노출한다 — 다른 DB 의 즐겨찾기는 여기서 쓸 수 없다.
  const scopedFavorites = effConnId ? favorites.filter((f) => f.connId === effConnId) : []
  const wbMode: 'sql' | 'mongo' | 'duck' = duck ? 'duck' : isMongo ? 'mongo' : 'sql'
  const notebook = session.view === 'notebook'

  /* ── 문장별 연결(`-- @conn`) 후보 ──────────────────────────────
     이기종 DB 를 한 탭에서 보기 위한 것이다. 상단 드롭다운이 **기본 연결**이고, 문장
     앞에 마커를 두면 그 문장만 다른 연결로 나간다.

     **MongoDB 는 뺀다.** 마커가 `--` 주석인데 mongo 셀은 자바스크립트 문법이라
     `--` 가 주석이 아니다 — 넣는 순간 문법 오류이고, 한 문서에 두 문법을 섞으려면
     중첩 언어 파서가 필요하다. 그래서 후보에도 두지 않는다. */
  const markerConns = useMemo(
    () => dbConns.filter((c) => c.type !== 'mongo').map((c) => ({ id: c.id, name: c.name, type: c.type })),
    [dbConns],
  )

  // 연결 선택 슬롯 — 편집기·노트북 툴바가 공유한다. 연합 조회(duck)도 드롭다운의 한 항목이라
  // 여기서 그대로 고르고 되돌릴 수 있다(연결을 탭 종류로 나누지 않는다).
  const connSelector = (
    <div className="sql-conn-bar">
      <div className="sql-conn-select" title="이 탭이 조회할 연결">
        <SearchSelect
          value={duck ? DUCK_CONN : effConnId}
          onChange={onChangeConn}
          options={connOptions}
          placeholder="연결 선택…"
          loading={connLoading}
          leading={
            duck ? (
              <span className="ss-badge duck">
                <Icon.merge />
              </span>
            ) : (
              spec && (
                <span className="ss-badge" style={{ background: spec.color }}>
                  {spec.abbr}
                </span>
              )
            )
          }
        />
      </div>
      {/* 이 연결에서 무엇을 돌릴 수 있는지 — 실행하기 전에 보여야 한다.
          연합 조회(duck)는 READ_ONLY 로 붙어 늘 SELECT 뿐이라 띄우지 않는다. */}
      {!duck && active && (
        <StatementTags
          conn={active}
          muted={muted}
          onToggle={(s) => onToggleMuted(active.id, s)}
        />
      )}
    </div>
  )

  // 편집기 ↔ 노트북 전환 — 한쪽을 편집하면 반대쪽에도 반영되도록 내용을 합치고/나눈다.
  //  · 노트북 → 편집기: 셀을 하나의 SQL 로 합친다(메모 셀은 `/*md … *​/` 주석으로 보존). 셀은 비운다.
  //  · 편집기 → 노트북: `;`(문자열·주석 안 제외)과 `/*md*​/` 마커로 셀을 복원한다.
  //  셀을 그대로 보관해 두었다가(편집기에서 텍스트가 바뀌지 않았으면) 돌아올 때 그대로 되살린다.
  //  → 셀 id 가 유지되어 실행 결과 캐시([n]·그리드·필터)도 함께 살아남는다.
  const cellsAsText = (cs: Cell[]) =>
    isMongo ? cs.filter((c) => c.type === 'sql').map((c) => c.src).join('\n\n') : cellsToText(cs)
  const toggleView = () => {
    if (notebook) {
      if (isMongo) {
        onChange({ view: 'editor', mongoCmd: cellsAsText(session.cells ?? []) })
      } else {
        onChange({ view: 'editor', sql: cellsAsText(session.cells ?? []) })
      }
      return
    }
    const text = (isMongo ? session.mongoCmd : session.sql) || ''
    const prev = session.cells ?? []
    // 편집기에서 손대지 않았으면(보관해 둔 셀의 텍스트 == 현재 편집기 텍스트) 그 셀을 그대로 쓴다.
    const seeded: Cell[] =
      prev.length && cellsAsText(prev) === text
        ? prev
        : isMongo
          ? [{ id: cellUid(), type: 'sql', src: text }]
          : textToCells(text)
    onChange({
      view: 'notebook',
      cells: seeded.length ? seeded : [{ id: cellUid(), type: 'sql', src: text }],
    })
  }
  const viewToggle = (
    <button
      className="sql-view-toggle"
      onClick={toggleView}
      title={notebook ? '단일 편집기로 전환' : '노트북(블록)으로 전환'}
    >
      {notebook ? <Icon.code /> : <Icon.stack />}
      {notebook ? '편집기' : '노트북'}
    </button>
  )

  const editorEmpty = notebook
    ? !(session.cells ?? []).some((c) => (c.src ?? '').trim())
    : !(isMongo ? session.mongoCmd : session.sql)?.trim()

  return (
    <div
      className={`sql-tab-pane editor-pane ${editorEmpty ? 'is-empty' : ''}`}
      style={{ display: hidden ? 'none' : 'flex' }}
    >
      {notebook ? (
        <Notebook
          cells={session.cells ?? []}
          onChangeCells={(cells) => onChange({ cells })}
          mode={wbMode}
          connectionId={effConnId || undefined}
          namespace={session.mongoNs}
          tables={activeTables}
          duckTables={duckTables}
          favorites={scopedFavorites}
          markerConns={markerConns}
          mutedOf={mutedOf}
          toolbarLeft={connSelector}
          viewToggle={viewToggle}
          muted={muted}
          onAiEscalate={onAiEscalate}
          onSave={() =>
            onSave({
              sessionId: session.id,
              mode: wbMode,
              text: cellsAsText(session.cells ?? []),
              connId: effConnId,
              namespace: session.mongoNs,
              defaultName: session.title,
            })
          }
        />
      ) : (
        <>
          <SqlWorkbench
            className="sqlpage-body"
            sidebar={false}
            mode={wbMode}
            value={isMongo ? session.mongoCmd : session.sql}
            onChange={(v) => onChange(isMongo ? { mongoCmd: v } : { sql: v })}
            connectionId={effConnId || undefined}
            namespace={session.mongoNs}
            tables={activeTables}
            duckTables={duckTables}
            markerConns={markerConns}
            mutedOf={mutedOf}
            loading={duck ? duckLoading : schemaLoading}
            autoFocus={!hidden}
            floatingRun
            favorites={scopedFavorites}
            onAddFavorite={onAddFavorite}
            bindInsert={bindInsert}
            onFocusEditor={onFocus}
            viewToggle={viewToggle}
            muted={muted}
            onAiEscalate={onAiEscalate}
            onSave={() =>
              onSave({
                sessionId: session.id,
                mode: wbMode,
                text: isMongo ? session.mongoCmd : session.sql,
                connId: effConnId,
                namespace: session.mongoNs,
                defaultName: session.title,
              })
            }
            toolbarLeft={
              <div className="sql-duck-bar">
                {connSelector}
                {duck && (
                  <>
                    <button
                      className="btn sm sql-duck-py"
                      onClick={() => setShowScript(true)}
                      disabled={!session.sql.trim()}
                      title="이 조회를 그대로 돌릴 수 있는 파이썬 코드로 — 노트북·배치로 옮길 때"
                    >
                      <Icon.code />
                      Python
                    </button>
                    <code className="sql-duck-hint" title="여러 연결의 테이블을 한 SQL 로 조회합니다">
                      연결이름.데이터베이스[.스키마].테이블
                    </code>
                  </>
                )}
              </div>
            }
          />
          {showScript && (
            <DuckScriptModal sql={session.sql} onClose={() => setShowScript(false)} />
          )}
        </>
      )}
    </div>
  )
}

type DropTarget = { dock: number; side: 'left' | 'right' | 'top' | 'bottom' | null }

/** 한 도크: 탭 바(연결·쿼리 탭 섞임) + 본문. 모든 탭은 포인터 드래그로 도크 간 이동/분할된다. */
function DockView(props: {
  dock: Dock
  sessions: Session[]
  dbConns: Connection[]
  connLoading: boolean
  focused: boolean
  dragging: boolean
  dropTarget: DropTarget | null
  navConnections: Connection[]
  navActiveConnId?: string
  duckTables: DuckTable[]
  duckLoading: boolean
  onPickTable: (connId: string, encoded: string) => void
  onOpenObjectQuery: (payload: {
    connId: string
    mode: 'sql' | 'mongo'
    text: string
    title: string
  }) => void
  onStartTabDrag: (e: React.PointerEvent, tabId: number, dockId: number, label: string) => void
  onCloseTab: (tabId: number) => void
  onAddTab: () => void
  onSplit: () => void
  onFocusDock: () => void
  onUpdateSession: (sid: number, patch: Partial<Session>) => void
  onChangeConn: (sid: number, connId: string) => void
  bindInsert: (sid: number, fn: (text: string) => void) => void
  onFocusSession: (sid: number) => void
  onAiEscalate: (payload: { sql: string; error?: string; explain?: string; assistant: string; dbConnId?: string }) => void
  onSaveSession: (payload: {
    sessionId: number
    mode: 'sql' | 'mongo' | 'duck'
    text: string
    connId: string
    namespace: string | null
    defaultName: string
  }) => void
  saved: SavedFolder[]
  onOpenSaved: (q: SavedQuery) => void
  onDeleteSavedQuery: (queryId: string) => void
  onDeleteSavedFolder: (folderId: string) => void
  onNewSavedFolder: (parentId: string | null, name: string) => void
  onNewSavedQuery: (folderId: string, name: string) => void
  onRenameSavedQuery: (queryId: string, name: string) => void
  onRenameSavedFolder: (folderId: string, name: string) => void
  onMoveSavedQuery: (queryId: string, targetFolderId: string) => void
  onMoveSavedFolder: (folderId: string, targetParentId: string | null) => void
  favorites: Favorite[]
  /** 연결별로 잠시 꺼 둔 명령 (툴바 태그). 세션 탭들이 같은 값을 봐야 한다. */
  muted: MutedMap
  onToggleMuted: (connId: string, s: SqlStatement) => void
  onAddFavorite: (name: string, sql: string, connId: string) => void
  onUpdateFavorite: (id: string, patch: { name?: string; sql?: string; connId?: string }) => void
  onDeleteFavorite: (id: string) => void
  pipelines: PipelineSummary[]
  onOpenPipeline: (p: PipelineSummary) => void
  onOpenPipelineRun: (p: PipelineSummary, runId: string) => void
  onNewPipeline: (folderId: string, name: string) => void
  onRemovePipeline: (itemId: string) => void
  onMovePipeline: (itemId: string, targetFolderId: string) => void
  onPlacePipeline: (pipelineId: string, targetFolderId: string) => void
  /** 지금 캔버스를 띄우고 있는 탭. 캔버스 상태가 전역 싱글턴이라 하나만 살 수 있다. */
  canvasOwner: number | null
  canvasOwnerLabel: string
  onTakeCanvas: (sid: number) => void
}) {
  const { dock } = props
  const isDropStrip = props.dropTarget?.dock === dock.id && props.dropTarget?.side == null

  return (
    <div className={`sql-pane ${props.focused ? 'focused' : ''}`} onMouseDownCapture={props.onFocusDock}>
      <div className={`sql-tabs ${isDropStrip ? 'drop-target' : ''}`} role="tablist" data-dock-strip={dock.id}>
        {dock.tabs.map((tabId) => {
          const isConn = tabId === CONN_TAB
          const isSaved = tabId === SAVED_TAB
          const isFav = tabId === FAV_TAB
          const isAi = tabId === AI_TAB
          const special = isSpecial(tabId)
          const s = special ? null : props.sessions.find((x) => x.id === tabId)
          if (!special && !s) return null
          const label = isConn
            ? '연결'
            : isSaved
              ? '저장됨'
              : isFav
                ? '즐겨찾기'
                : isAi
                  ? 'AI 어시스턴트'
                  : (s?.title ?? '')
          // 쿼리 탭은 제목 앞에 그 탭이 선택한 연결의 DB 배지를 보여준다.
          // 아직 연결을 안 골랐으면 코드(<>) 아이콘으로 대체한다.
          const tabConn = !special && s?.connId ? props.navConnections.find((c) => c.id === s.connId) : null
          const tabSpec = tabConn ? specFor(tabConn.type) : null
          const tabIcon = isConn ? (
            <Icon.db />
          ) : isSaved ? (
            <Icon.save />
          ) : isFav ? (
            <Icon.star />
          ) : isAi ? (
            <Icon.bolt />
          ) : s && isPipelineSession(s) ? (
            <Icon.flow />
          ) : s && isDuckSession(s) ? (
            <Icon.merge />
          ) : tabSpec ? (
            <span className="conn-abbr sql-tab-abbr" style={{ background: tabSpec.color }}>
              {tabSpec.abbr}
            </span>
          ) : (
            <Icon.code />
          )
          return (
            <div
              key={tabId}
              role="tab"
              aria-selected={tabId === dock.active}
              className={`sql-tab ${tabId === dock.active ? 'active' : ''} ${special ? 'is-conn' : ''}`}
              onPointerDown={(e) => props.onStartTabDrag(e, tabId, dock.id, label)}
              onAuxClick={(e) => {
                if (e.button === 1 && !special) props.onCloseTab(tabId)
              }}
              title={special ? `${label} — 드래그해서 이동/분할` : undefined}
            >
              {tabIcon}
              <span className="sql-tab-title">{label}</span>
              {!special && (
                <button
                  className="sql-tab-x"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onCloseTab(tabId)
                  }}
                  aria-label="탭 닫기"
                  title="탭 닫기"
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
        <button
          className="sql-tab-add"
          onClick={props.onAddTab}
          title="새 쿼리 탭 (Alt+T)"
          aria-label="새 쿼리 탭"
        >
          <Icon.plus />
        </button>
        <div className="sql-tabs-spacer" />
        <button className="sql-tab-split" onClick={props.onSplit} title="오른쪽으로 분할" aria-label="분할">
          <Icon.split />
        </button>
      </div>
      <div className="sql-tab-body" data-dock-body={dock.id}>
        {dock.tabs.map((tabId) => {
          const hidden = tabId !== dock.active
          if (tabId === CONN_TAB) {
            return (
              <div key="conn" className="sql-tab-pane" style={{ display: hidden ? 'none' : 'flex' }}>
                <ConnectionNavigator
                  connections={props.navConnections}
                  activeConnId={props.navActiveConnId}
                  onActivate={() => {}}
                  onPickTable={props.onPickTable}
                  onOpenQuery={props.onOpenObjectQuery}
                />
              </div>
            )
          }
          if (tabId === AI_TAB) {
            // AI 어시스턴트 — 연결·저장됨과 같은 고유의 특수 탭. 대화는 이 탭 id 로 유지된다.
            return (
              <AiChatPane
                key="ai"
                sessionId={AI_TAB}
                hidden={hidden}
                onOpenAsQuery={props.onOpenObjectQuery}
                onFocus={props.onFocusDock}
              />
            )
          }
          if (tabId === SAVED_TAB) {
            return (
              <div key="saved" className="sql-tab-pane" style={{ display: hidden ? 'none' : 'flex' }}>
                <SavedQueriesPanel
                  folders={props.saved}
                  connections={props.navConnections}
                  pipelines={props.pipelines}
                  openTitles={props.sessions.map((x) => x.title)}
                  onOpen={props.onOpenSaved}
                  onDeleteQuery={props.onDeleteSavedQuery}
                  onDeleteFolder={props.onDeleteSavedFolder}
                  onNewFolder={props.onNewSavedFolder}
                  onNewQuery={props.onNewSavedQuery}
                  onRenameQuery={props.onRenameSavedQuery}
                  onRenameFolder={props.onRenameSavedFolder}
                  onMoveQuery={props.onMoveSavedQuery}
                  onMoveFolder={props.onMoveSavedFolder}
                  onNewPipeline={props.onNewPipeline}
                  onOpenPipeline={props.onOpenPipeline}
                  onOpenRun={props.onOpenPipelineRun}
                  onRemovePipeline={props.onRemovePipeline}
                  onMovePipeline={props.onMovePipeline}
                  onPlacePipeline={props.onPlacePipeline}
                />
              </div>
            )
          }
          if (tabId === FAV_TAB) {
            return (
              <div key="fav" className="sql-tab-pane" style={{ display: hidden ? 'none' : 'flex' }}>
                <FavoritesPanel
                  favorites={props.favorites}
                  connections={props.navConnections}
                  activeConnId={props.navActiveConnId}
                  onAdd={props.onAddFavorite}
                  onUpdate={props.onUpdateFavorite}
                  onDelete={props.onDeleteFavorite}
                />
              </div>
            )
          }
          const s = props.sessions.find((x) => x.id === tabId)
          if (!s) return null
          if (isChatConn(s.connId)) {
            // AI 챗 탭 — 파이프라인 탭이 Canvas 를 띄우는 자리와 같다. 캔버스와 달리
            // 상태가 세션마다 독립이라 싱글턴 소유권은 필요 없다.
            return (
              <AiChatPane
                key={tabId}
                sessionId={tabId}
                hidden={hidden}
                onOpenAsQuery={props.onOpenObjectQuery}
                onFocus={() => {
                  props.onFocusDock()
                  props.onFocusSession(tabId)
                }}
              />
            )
          }
          if (s.pipelineId) {
            // 캔버스 상태는 모듈 전역 싱글턴이라 **한 번에 하나만** 살 수 있다.
            // 둘을 띄우면 나중에 뜬 쪽이 앞의 그래프를 덮어써, 보고 있는 것과 저장되는 것이
            // 달라진다. 그래서 소유하지 않은 탭은 캔버스를 아예 마운트하지 않는다.
            const owns = props.canvasOwner === tabId
            return (
              <div
                key={tabId}
                className="sql-tab-pane pipe-pane"
                style={{ display: hidden ? 'none' : 'flex' }}
              >
                {owns ? (
                  <Canvas pipelineId={s.pipelineId} embedded />
                ) : (
                  <div className="canvas-busy">
                    <Icon.alert />
                    <p>
                      캔버스는 한 번에 한 탭에서만 편집할 수 있습니다
                      {props.canvasOwnerLabel && (
                        <>
                          {' '}
                          — 지금은 <b>{props.canvasOwnerLabel}</b> 탭이 쓰고 있습니다
                        </>
                      )}
                      .
                    </p>
                    <button className="btn primary" onClick={() => props.onTakeCanvas(tabId)}>
                      <Icon.flow />
                      여기서 편집
                    </button>
                  </div>
                )}
              </div>
            )
          }
          return (
            <SessionEditor
              key={tabId}
              session={s}
              dbConns={props.dbConns}
              connLoading={props.connLoading}
              duckTables={props.duckTables}
              duckLoading={props.duckLoading}
              hidden={hidden}
              onChange={(patch) => props.onUpdateSession(tabId, patch)}
              onChangeConn={(connId) => props.onChangeConn(tabId, connId)}
              bindInsert={(fn) => props.bindInsert(tabId, fn)}
              onFocus={() => {
                props.onFocusDock()
                props.onFocusSession(tabId)
              }}
              onSave={props.onSaveSession}
              favorites={props.favorites}
              onAddFavorite={props.onAddFavorite}
              muted={props.muted[s.connId || props.dbConns[0]?.id || ''] ?? []}
              mutedOf={(id) => props.muted[id] ?? []}
              onToggleMuted={props.onToggleMuted}
              onAiEscalate={props.onAiEscalate}
            />
          )
        })}
        {props.dragging && (
          <div className="sql-dz">
            <div
              data-dock-id={dock.id}
              data-dock-side="top"
              className={`sql-dz-zone t ${
                props.dropTarget?.dock === dock.id && props.dropTarget?.side === 'top' ? 'over' : ''
              }`}
            >
              <span className="sql-dz-hint">▲ 위쪽에 분할</span>
            </div>
            <div className="sql-dz-mid">
              <div
                data-dock-id={dock.id}
                data-dock-side="left"
                className={`sql-dz-zone l ${
                  props.dropTarget?.dock === dock.id && props.dropTarget?.side === 'left' ? 'over' : ''
                }`}
              >
                <span className="sql-dz-hint">◧ 왼쪽</span>
              </div>
              <div className="sql-dz-center" />
              <div
                data-dock-id={dock.id}
                data-dock-side="right"
                className={`sql-dz-zone r ${
                  props.dropTarget?.dock === dock.id && props.dropTarget?.side === 'right' ? 'over' : ''
                }`}
              >
                <span className="sql-dz-hint">오른쪽 ◨</span>
              </div>
            </div>
            <div
              data-dock-id={dock.id}
              data-dock-side="bottom"
              className={`sql-dz-zone b ${
                props.dropTarget?.dock === dock.id && props.dropTarget?.side === 'bottom' ? 'over' : ''
              }`}
            >
              <span className="sql-dz-hint">▼ 아래쪽에 분할</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 독립 SQL/NoSQL 편집기 페이지 — 완전 통합 도킹(DBeaver 식, 2차원 그리드).
 *  연결 탭과 쿼리 탭이 하나의 탭 시스템을 공유한다. 어느 탭이든 포인터로 끌어
 *  다른 도크의 탭 바에 놓으면 이동, 본문 좌/우/위/아래에 놓으면 그 방향으로 분할된다.
 *  내비게이터에서 테이블을 클릭하면 "마지막에 포커스한 쿼리 탭" 커서에 삽입된다. */
export function SqlEditorPage() {
  const { data: connections = [], isLoading: connLoading } = useConnections()
  const dbConns = useMemo(() => connections.filter((c) => DB_TYPES.includes(c.type)), [connections])
  const { data: pipelines = [] } = usePipelines()
  const createPipeline = useCreatePipeline()

  // 새로고침·재접속 시 이전 탭 배치·크기를 복원한다 (없으면 기본값).
  const wsRef = useRef<Workspace | null>(null)
  if (wsRef.current === null) wsRef.current = loadWorkspace()
  const ws0 = wsRef.current
  const seq = useRef(maxOr(ws0.sessions.map((s) => s.id), 1)) // 세션 id
  const dockSeq = useRef(maxOr(ws0.columns.flatMap((c) => c.docks.map((d) => d.id)), 1)) // 도크 id
  const colSeq = useRef(maxOr(ws0.columns.map((c) => c.id), 1)) // 컬럼 id
  const [L, setL] = useState<Layout>({
    sessions: ws0.sessions,
    columns: ws0.columns,
    focused: ws0.focused,
  })
  const [colWeights, setColWeights] = useState<Record<number, number>>(ws0.colWeights)
  const [rowWeights, setRowWeights] = useState<Record<number, number>>(ws0.rowWeights)
  const [lastFocused, setLastFocused] = useState<number | null>(ws0.lastFocused)
  // 배치·크기가 바뀌면 잠깐 뒤 자동 저장 (디바운스)
  useEffect(() => {
    const t = setTimeout(
      () =>
        storeWorkspace({
          sessions: L.sessions,
          columns: L.columns,
          focused: L.focused,
          colWeights,
          rowWeights,
          lastFocused,
        }),
      400,
    )
    return () => clearTimeout(t)
  }, [L, colWeights, rowWeights, lastFocused])
  const insertReg = useRef(new Map<number, (t: string) => void>())

  // 연합 조회 자동완성 — DuckDB 탭이 하나도 없으면 받지 않는다. 탭을 안 열었는데
  // 모든 DB 의 스키마를 끌어올 이유가 없다 (연결이 많으면 그 자체로 느리다).
  const hasDuckTab = L.sessions.some(isDuckSession)
  const { tables: duckTables, loading: duckLoading } = useDuckTables(connections, hasDuckTab)
  // 연합 조회에 못 쓰는 연결을 트리에서 골랐을 때의 안내 (잠깐 떴다 사라진다)
  const [duckHint, setDuckHint] = useState<string | null>(null)
  useEffect(() => {
    if (!duckHint) return
    const t = setTimeout(() => setDuckHint(null), 4000)
    return () => clearTimeout(t)
  }, [duckHint])

  // 저장된 쿼리(폴더 트리) — localStorage 지속. + 저장 대화상자 요청
  const [saved, setSaved] = useState<SavedFolder[]>(() => loadSaved())
  const [saveReq, setSaveReq] = useState<{
    sessionId: number
    mode: 'sql' | 'mongo' | 'duck'
    text: string
    connId: string
    namespace: string | null
    defaultName: string
  } | null>(null)
  const persistSaved = (next: SavedFolder[]) => {
    setSaved(next)
    storeSaved(next)
  }
  // 즐겨찾기(자주 쓰는 단일 쿼리) — "저장됨"과 별개 저장소. `/loadQuery` 자동완성이 참조한다.
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites())
  const persistFav = (next: Favorite[]) => {
    setFavorites(next)
    storeFavorites(next)
  }
  const addFav = (name: string, sql: string, connId: string) =>
    persistFav(addFavorite(favorites, name, sql, connId))
  const updateFav = (id: string, patch: { name?: string; sql?: string; connId?: string }) =>
    persistFav(updateFavorite(favorites, id, patch))
  const deleteFav = (id: string) => persistFav(removeFavorite(favorites, id))
  // 툴바 태그로 잠시 꺼 둔 명령 (연결별). 실수 방지용이라 기기 로컬에만 남긴다.
  const [muted, setMuted] = useState<MutedMap>(() => loadMuted())
  const toggleMutedStatement = (connId: string, s: SqlStatement) =>
    setMuted((cur) => {
      const next = toggleMuted(cur, connId, s)
      storeMuted(next)
      return next
    })
  // 캔버스는 전역 싱글턴이라 **한 탭만** 띄울 수 있다 — 그 탭의 세션 id.
  const [canvasOwner, setCanvasOwner] = useState<number | null>(null)
  // 트리에서 고른 실행 이력 — 실행 상세 팝업으로 연다 (모니터와 같은 화면)
  const [detailRunId, setDetailRunId] = useState<string | null>(null)
  const splitViewRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{
    tabId: number
    fromDock: number
    x: number
    y: number
    label: string
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dropRef = useRef<DropTarget | null>(null)

  // 파이프라인 탭에는 편집기가 없다 — 테이블 삽입·저장 쿼리 열기의 대상은 SQL 탭뿐이다.
  const sqlSessions = L.sessions.filter((s) => !isPipelineSession(s))
  const targetSqlSession = () => sqlSessions.find((s) => s.id === lastFocused) ?? sqlSessions[0]
  const lastSess = targetSqlSession() ?? null
  const navActiveConnId = lastSess ? lastSess.connId || dbConns[0]?.id || '' : dbConns[0]?.id || ''
  const canvasOwnerLabel = L.sessions.find((s) => s.id === canvasOwner)?.title ?? ''
  // 소유 탭이 닫혔거나(새로고침 직후처럼) 아무도 없으면, 앞에 나와 있는 파이프라인 탭이
  // 이어받는다. 안 그러면 탭 하나뿐인데도 매번 [여기서 편집]을 눌러야 한다.
  useEffect(() => {
    if (canvasOwner !== null && L.sessions.some((s) => s.id === canvasOwner)) return
    const actives = new Set(L.columns.flatMap((c) => c.docks.map((d) => d.active)))
    const next = L.sessions.find((s) => s.pipelineId && actives.has(s.id))
    setCanvasOwner(next ? next.id : null)
  }, [L, canvasOwner])

  // ---- 헬퍼 ----
  const removeFromDock = (d: Dock, tabId: number): Dock => {
    const i = d.tabs.indexOf(tabId)
    const tabs = d.tabs.filter((t) => t !== tabId)
    const active = d.active === tabId ? (tabs[i] ?? tabs[i - 1] ?? tabs[tabs.length - 1] ?? -1) : d.active
    return { ...d, tabs, active }
  }
  const cleanup = (cols: Column[]): Column[] =>
    cols
      .map((c) => ({ ...c, docks: c.docks.filter((d) => d.tabs.length > 0) }))
      .filter((c) => c.docks.length > 0)
  const findDock = (cols: Column[], dockId: number) => {
    for (let ci = 0; ci < cols.length; ci++) {
      const di = cols[ci].docks.findIndex((d) => d.id === dockId)
      if (di >= 0) return { ci, di }
    }
    return null
  }
  const allDocks = (cols: Column[]) => cols.flatMap((c) => c.docks)
  const mapDock = (cols: Column[], fn: (d: Dock) => Dock): Column[] =>
    cols.map((c) => ({ ...c, docks: c.docks.map(fn) }))
  const refocus = (cols: Column[], want: number) =>
    allDocks(cols).some((d) => d.id === want) ? want : (allDocks(cols)[0]?.id ?? want)


  // ---- 조작 ----
  const updateSession = (sid: number, patch: Partial<Session>) =>
    setL((L) => ({ ...L, sessions: L.sessions.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }))

  /** 탭의 조회 대상을 바꾼다. 「연합 조회」로 넘어갈 때는 **빈 편집기일 때만** 저장된
   *  연결 이름으로 채운 예시를 넣는다 — 표기를 설명으로 읽는 것보다 한 줄 보는 편이
   *  빠르지만, 쓰던 SQL 을 덮어쓰는 것은 그보다 훨씬 나쁘다. */
  const changeConn = (sid: number, connId: string) => {
    const target = L.sessions.find((s) => s.id === sid)
    const seed =
      isDuckConn(connId) && target && isUntouched(target.sql)
        ? { sql: duckStarter(connections) }
        : {}
    // AI 챗으로 바꾸면 탭 이름도 그렇게 — 아직 이름을 안 바꾼 기본 탭일 때만.
    const rename =
      isChatConn(connId) && target && /^쿼리 \d+$/.test(target.title) ? { title: 'AI 챗' } : {}
    updateSession(sid, { connId, mongoNs: null, ...seed, ...rename })
  }

  const addTab = (dockId: number) => {
    const id = ++seq.current
    setL((L) => ({
      sessions: [...L.sessions, blankSession(id)],
      columns: mapDock(L.columns, (d) => (d.id === dockId ? { ...d, tabs: [...d.tabs, id], active: id } : d)),
      focused: dockId,
    }))
    setLastFocused(id)
  }

  // Alt+T → 포커스된 도크에 새 쿼리 탭. (Cmd/Ctrl+T·N 은 브라우저가 가로채므로 웹 안전한 Alt 조합)
  const addTabToFocused = () => {
    const id = ++seq.current
    setL((L) => {
      const docks = allDocks(L.columns)
      const fid = docks.some((d) => d.id === L.focused) ? L.focused : docks[0]?.id
      if (fid == null) return L
      return {
        sessions: [...L.sessions, blankSession(id)],
        columns: mapDock(L.columns, (d) => (d.id === fid ? { ...d, tabs: [...d.tabs, id], active: id } : d)),
        focused: fid,
      }
    })
    setLastFocused(id)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // macOS 의 Option+T 는 '†' 를 내므로 layout 무관한 e.code 로 본다.
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyT') {
        e.preventDefault()
        addTabToFocused()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // addTabToFocused 는 ref·함수형 setState·지역 변수만 쓴다 — 캡처하는 상태가 없어
    // 첫 렌더의 것을 계속 불러도 결과가 같다. deps 에 넣으면 매 렌더마다 리스너를 다시 단다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectTab = (dockId: number, tabId: number) => {
    setL((L) => ({
      ...L,
      columns: mapDock(L.columns, (d) => (d.id === dockId ? { ...d, active: tabId } : d)),
      focused: dockId,
    }))
    if (tabId > 0) setLastFocused(tabId)
    // 파이프라인 탭으로 넘어올 때, **저장할 것이 없으면** 캔버스를 조용히 넘겨준다.
    // 잃을 것이 없는데도 [여기서 편집]을 누르게 하면 탭 전환마다 한 번씩 더 눌러야 한다.
    // 저장하지 않은 변경이 있으면 넘기지 않는다 — 그때는 묻고 넘기는 것이 맞다.
    const target = L.sessions.find((s) => s.id === tabId)
    if (target?.pipelineId && canvasOwner !== tabId && !useCanvasStore.getState().dirty) {
      setCanvasOwner(tabId)
    }
  }

  const focusDock = (dockId: number) => setL((L) => (L.focused === dockId ? L : { ...L, focused: dockId }))

  const closeTab = (tabId: number) => {
    if (isSpecial(tabId)) return // 연결·저장됨 탭은 닫지 않는다
    insertReg.current.delete(tabId)
    // AI 챗 탭이면 대화 이력을 정리한다 (설계 D6: 닫으면 폐기).
    if (L.sessions.find((s) => s.id === tabId && isChatConn(s.connId))) clearChat(tabId)
    setL((L) => {
      let columns = cleanup(mapDock(L.columns, (d) => (d.tabs.includes(tabId) ? removeFromDock(d, tabId) : d)))
      const referenced = new Set(allDocks(columns).flatMap((d) => d.tabs))
      const sessions = L.sessions.filter((s) => referenced.has(s.id))
      if (columns.length === 0)
        columns = [
          {
            id: ++colSeq.current,
            docks: [
              { id: ++dockSeq.current, tabs: [CONN_TAB, SAVED_TAB, FAV_TAB, AI_TAB], active: CONN_TAB },
            ],
          },
        ]
      return { sessions, columns, focused: refocus(columns, L.focused) }
    })
    setLastFocused((prev) => (prev === tabId ? null : prev))
  }

  const moveTab = (tabId: number, fromDock: number, toDock: number) => {
    if (fromDock === toDock) return
    setL((L) => {
      const columns = cleanup(
        mapDock(L.columns, (d) => {
          if (d.id === fromDock) return removeFromDock(d, tabId)
          if (d.id === toDock) return d.tabs.includes(tabId) ? d : { ...d, tabs: [...d.tabs, tabId], active: tabId }
          return d
        }),
      )
      return { ...L, columns, focused: refocus(columns, toDock) }
    })
    if (tabId > 0) setLastFocused(tabId)
  }

  // 좌/우 분할 → 대상 도크의 컬럼 옆에 새 컬럼
  const splitH = (tabId: number, fromDock: number, targetDock: number, side: 'left' | 'right') => {
    setL((L) => {
      const from = findDock(L.columns, fromDock)
      const fromObj = from ? L.columns[from.ci].docks[from.di] : null
      if (fromDock === targetDock && (!fromObj || fromObj.tabs.length < 2)) return L
      let columns = cleanup(mapDock(L.columns, (d) => (d.id === fromDock ? removeFromDock(d, tabId) : d)))
      const pos = findDock(columns, targetDock)
      if (!pos) return L
      const nc: Column = { id: ++colSeq.current, docks: [{ id: ++dockSeq.current, tabs: [tabId], active: tabId }] }
      const at = side === 'right' ? pos.ci + 1 : pos.ci
      columns = [...columns.slice(0, at), nc, ...columns.slice(at)]
      return { ...L, columns, focused: nc.docks[0].id }
    })
    if (tabId > 0) setLastFocused(tabId)
  }

  // 위/아래 분할 → 대상 도크의 컬럼 안, 위/아래에 새 도크
  const splitV = (tabId: number, fromDock: number, targetDock: number, side: 'top' | 'bottom') => {
    setL((L) => {
      const from = findDock(L.columns, fromDock)
      const fromObj = from ? L.columns[from.ci].docks[from.di] : null
      if (fromDock === targetDock && (!fromObj || fromObj.tabs.length < 2)) return L
      let columns = cleanup(mapDock(L.columns, (d) => (d.id === fromDock ? removeFromDock(d, tabId) : d)))
      const pos = findDock(columns, targetDock)
      if (!pos) return L
      if (columns[pos.ci].docks.length >= MAX_ROWS) return L // 한 컬럼에 최대 3개까지만 세로로 쌓는다
      const nd: Dock = { id: ++dockSeq.current, tabs: [tabId], active: tabId }
      columns = columns.map((c, ci) => {
        if (ci !== pos.ci) return c
        const at = side === 'bottom' ? pos.di + 1 : pos.di
        return { ...c, docks: [...c.docks.slice(0, at), nd, ...c.docks.slice(at)] }
      })
      return { ...L, columns, focused: nd.id }
    })
    if (tabId > 0) setLastFocused(tabId)
  }

  // 분할 버튼: 활성 탭을 오른쪽 새 컬럼으로 (탭 하나뿐이면 새 쿼리 탭)
  const splitButton = (dockId: number) =>
    setL((L) => {
      const pos = findDock(L.columns, dockId)
      if (!pos) return L
      const src = L.columns[pos.ci].docks[pos.di]
      if (src.tabs.length >= 2) {
        const sid = src.active
        const cols0 = mapDock(L.columns, (d) => (d.id === dockId ? removeFromDock(d, sid) : d))
        const nc: Column = { id: ++colSeq.current, docks: [{ id: ++dockSeq.current, tabs: [sid], active: sid }] }
        return { ...L, columns: [...cols0.slice(0, pos.ci + 1), nc, ...cols0.slice(pos.ci + 1)], focused: nc.docks[0].id }
      }
      const nid = ++seq.current
      const nc: Column = { id: ++colSeq.current, docks: [{ id: ++dockSeq.current, tabs: [nid], active: nid }] }
      return {
        sessions: [...L.sessions, blankSession(nid)],
        columns: [...L.columns.slice(0, pos.ci + 1), nc, ...L.columns.slice(pos.ci + 1)],
        focused: nc.docks[0].id,
      }
    })

  // 테이블 클릭 → 마지막 포커스한 쿼리 탭에 반영. 세션이 없으면 새로 만든다.
  const pickTable = (connId: string, encoded: string) => {
    const [ns, name] = encoded.split('|')
    const conn = dbConns.find((c) => c.id === connId)
    const qualified = ns ? `${ns}.${name}` : name
    const target = targetSqlSession()

    // 연합 조회 탭에는 **정규화된 이름**을 넣는다 — 연결 이름부터 시작해야 서버가
    // 어느 연결인지 안다. 연결이 이름을 만들 정보를 안 담고 있으면 넣지 않는다.
    if (target && isDuckSession(target)) {
      const ref =
        conn && isDuckType(conn.type)
          ? duckRef({
              connectionName: conn.name,
              connectionType: conn.type,
              database: (conn.config as Record<string, unknown>)?.database as string | undefined,
              namespace: ns || null,
              table: name,
            })
          : null
      if (ref) insertReg.current.get(target.id)?.(ref)
      else setDuckHint(conn ? `「${conn.name}」 은(는) 연합 조회에 쓸 수 없습니다 (MySQL·PostgreSQL·SQL Server 만).` : null)
      setLastFocused(target.id)
      return
    }

    if (target) {
      if (conn?.type === 'mongo') {
        updateSession(target.id, { connId, mongoNs: ns || null, mongoCmd: `${name}.find({})` })
      } else if ((target.connId || dbConns[0]?.id) === connId) {
        insertReg.current.get(target.id)?.(qualified)
      } else {
        updateSession(target.id, { connId, sql: `SELECT *\nFROM ${qualified}` })
      }
      setLastFocused(target.id)
      return
    }
    const id = ++seq.current
    const base = blankSession(id)
    const s =
      conn?.type === 'mongo'
        ? { ...base, connId, mongoNs: ns || null, mongoCmd: `${name}.find({})` }
        : { ...base, connId, sql: `SELECT *\nFROM ${qualified}` }
    setL((L) => {
      const fid = contentDock(L.columns, L.focused)
      return {
        sessions: [...L.sessions, s],
        columns: mapDock(L.columns, (d) => (d.id === fid ? { ...d, tabs: [...d.tabs, id], active: id } : d)),
        focused: fid,
      }
    })
    setLastFocused(id)
  }

  // ---- 저장된 쿼리 (폴더 트리) ----
  const newSavedFolder = (parentId: string | null, name: string) =>
    persistSaved(addFolder(saved, parentId, emptyFolder(name)))
  const deleteSavedFolder = (folderId: string) => persistSaved(removeFolder(saved, folderId))
  const deleteSavedQuery = (queryId: string) => persistSaved(removeQuery(saved, queryId))
  const renameSavedFolder = (folderId: string, name: string) =>
    persistSaved(updateFolder(saved, folderId, (f) => ({ ...f, name })))
  const renameSavedQuery = (queryId: string, name: string) =>
    persistSaved(updateQuery(saved, queryId, (q) => ({ ...q, name })))
  const moveSavedQuery = (queryId: string, targetFolderId: string) =>
    persistSaved(moveQuery(saved, queryId, targetFolderId))
  const moveSavedFolder = (folderId: string, targetParentId: string | null) =>
    persistSaved(moveFolder(saved, folderId, targetParentId))

  // 저장 트리에서 id 로 쿼리를 찾는다 (재귀). 링크가 살아있는지 확인용.
  const findSavedQuery = (folders: SavedFolder[], id: string): SavedQuery | null => {
    for (const f of folders) {
      const q = f.queries.find((x) => x.id === id)
      if (q) return q
      const sub = findSavedQuery(f.folders, id)
      if (sub) return sub
    }
    return null
  }

  // ⌘/Ctrl+S 또는 저장 버튼 — 이미 저장된 탭이면 팝업 없이 바로 덮어쓰고, 새 탭이면 저장 팝업을 연다.
  const saveSession = (payload: {
    sessionId: number
    mode: 'sql' | 'mongo' | 'duck'
    text: string
    connId: string
    namespace: string | null
    defaultName: string
  }) => {
    const session = L.sessions.find((s) => s.id === payload.sessionId)
    const savedId = session?.savedId
    if (savedId && findSavedQuery(saved, savedId)) {
      // 연결된 저장 항목이 살아있으면 내용만 갱신 (팝업 없음).
      persistSaved(
        updateQuery(saved, savedId, (q) => ({
          ...q,
          text: payload.text,
          mode: payload.mode,
          connId: payload.connId || undefined,
          namespace: payload.namespace,
        })),
      )
      return
    }
    setSaveReq(payload) // 새 탭(또는 링크 끊김) → 저장 팝업
  }

  const commitSave = (
    target: { folderId: string } | { newFolder: string; parentId: string | null },
    name: string,
    note: string,
  ) => {
    if (!saveReq) return
    const content = {
      mode: saveReq.mode,
      text: saveReq.text,
      note: note || undefined,
      connId: saveReq.connId || undefined,
      namespace: saveReq.namespace,
    }
    const fresh: SavedQuery = { id: uid(), name, createdAt: Date.now(), ...content }
    let next: SavedFolder[]
    let savedId = fresh.id
    if ('newFolder' in target) {
      next = addFolder(saved, target.parentId, { ...emptyFolder(target.newFolder), queries: [fresh] })
    } else {
      next = updateFolder(saved, target.folderId, (f) => {
        const existing = f.queries.find((q) => q.name === name)
        if (existing) {
          // 같은 이름이 있으면 덮어쓰기 — id·생성시각은 유지하고 내용만 갱신
          savedId = existing.id
          return { ...f, queries: f.queries.map((q) => (q.id === existing.id ? { ...q, ...content } : q)) }
        }
        return { ...f, queries: [...f.queries, fresh] }
      })
    }
    persistSaved(next)
    // 탭을 저장 항목에 연결한다 — 다음 ⌘/Ctrl+S 부터는 팝업 없이 바로 덮어쓴다.
    updateSession(saveReq.sessionId, { title: name, savedId })
    setSaveReq(null)
  }

  // 오류 수정·튜닝 패널의 「AI 탭에서 이어가기」 — AI 어시스턴트 탭에 대화를 심고 앞으로 가져온다.
  const escalateToAi = (p: { sql: string; error?: string; explain?: string; assistant: string; dbConnId?: string }) => {
    const outSql = p.assistant.match(/```sql\s*\n([\s\S]*?)```/i)?.[1].trim() || null
    // fix(오류)냐 tune(계획)이냐에 따라 첫 사용자 메시지를 다르게 짓는다.
    const userContent = p.error
      ? `다음 쿼리에서 오류가 났어요. 고쳐 주세요.\n\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n오류:\n${p.error}`
      : `다음 쿼리를 튜닝하고 싶어요.\n\n\`\`\`sql\n${p.sql}\n\`\`\`` +
        (p.explain ? `\n\n실행 계획:\n${p.explain}` : '')
    const seeded: ChatState = {
      dbConnId: p.dbConnId,
      intent: p.error ? 'sql.generate' : 'sql.tune',
      messages: [
        { id: chatUid(), role: 'user', content: userContent },
        { id: chatUid(), role: 'assistant', content: p.assistant, sql: outSql },
      ],
    }
    saveChat(AI_TAB, seeded)
    // 이미 마운트돼 있는 AI 탭 패널이 새로 심은 대화를 다시 읽게 알린다.
    window.dispatchEvent(new CustomEvent('eai-ai-seed', { detail: AI_TAB }))
    revealSession(AI_TAB)
  }

  // 세션 탭을 그 도크에서 활성으로 (앞으로 가져오기)
  const revealSession = (sid: number) =>
    setL((L) => {
      const columns = L.columns.map((c) => ({
        ...c,
        docks: c.docks.map((d) => (d.tabs.includes(sid) ? { ...d, active: sid } : d)),
      }))
      const dock = allDocks(columns).find((d) => d.tabs.includes(sid))
      return { ...L, columns, focused: dock ? dock.id : L.focused }
    })

  /** 저장된 쿼리를 **새 탭으로** 연다.
   *
   *  전에는 포커스한 탭에 덮어썼는데, 쓰던 쿼리가 소리 없이 사라졌다. 트리를 누르는 것은
   *  "이것도 열어 보자"이지 "지금 것을 버리자"가 아니다.
   *
   *  이미 그 항목을 연 탭이 있으면 그 탭을 앞으로 가져온다 — 같은 저장 쿼리를 두 탭에
   *  띄우면 어느 쪽 편집이 저장되는지 알 수 없다. */
  const openSaved = (q: SavedQuery) => {
    const existing = L.sessions.find((s) => s.savedId === q.id)
    if (existing) {
      revealSession(existing.id)
      setLastFocused(existing.id)
      return
    }
    // 저장할 때의 종류로 되돌린다 — 연합 쿼리를 일반 탭에 열면 연결이 없어 실행이 막힌다.
    const patch: Partial<Session> =
      q.mode === 'duck'
        ? { connId: DUCK_CONN, sql: q.text, savedId: q.id }
        : q.mode === 'mongo'
          ? { connId: q.connId || '', mongoNs: q.namespace ?? null, mongoCmd: q.text, savedId: q.id }
          : { connId: q.connId || '', sql: q.text, savedId: q.id }
    const id = ++seq.current
    const s: Session = { ...blankSession(id), ...patch, title: q.name }
    setL((L) => {
      const fid = contentDock(L.columns, L.focused)
      return {
        sessions: [...L.sessions, s],
        columns: mapDock(L.columns, (d) => (d.id === fid ? { ...d, tabs: [...d.tabs, id], active: id } : d)),
        focused: fid,
      }
    })
    setLastFocused(id)
  }

  // 연결 트리 우클릭 → "쿼리 탭으로 열기". 객체의 정의(뷰·함수…)나 SELECT 를 새 탭으로 연다.
  const openObjectQuery = (payload: {
    connId: string
    mode: 'sql' | 'mongo'
    text: string
    title: string
  }) => {
    const id = ++seq.current
    const patch: Partial<Session> =
      payload.mode === 'mongo'
        ? { connId: payload.connId, mongoCmd: payload.text }
        : { connId: payload.connId, sql: payload.text }
    const s: Session = { ...blankSession(id), ...patch, title: payload.title }
    setL((L) => {
      const fid = contentDock(L.columns, L.focused)
      return {
        sessions: [...L.sessions, s],
        columns: mapDock(L.columns, (d) =>
          d.id === fid ? { ...d, tabs: [...d.tabs, id], active: id } : d,
        ),
        focused: fid,
      }
    })
    setLastFocused(id)
  }

  // 폴더 안에 빈 쿼리 파일을 새로 만든다 (트리의 + 메뉴). 만든 뒤 편집기 탭으로 연다.
  const newSavedQuery = (folderId: string, name: string) => {
    const q: SavedQuery = { id: uid(), name, mode: 'sql', text: '', createdAt: Date.now() }
    persistSaved(updateFolder(saved, folderId, (f) => ({ ...f, queries: [...f.queries, q] })))
    openSaved(q)
  }

  // ---- 파이프라인 (저장됨 트리에 함께 산다) ----

  /** 캔버스를 이 탭이 쓰도록 넘긴다.
   *
   *  캔버스 상태는 모듈 전역 싱글턴이라 둘이 살 수 없다. 앞 탭에 저장하지 않은 변경이
   *  있으면 **먼저 묻는다** — 여기서 조용히 빼앗으면 그린 것이 사라지고, 사라졌다는
   *  사실조차 알 수 없다. */
  const takeCanvas = (sid: number) => {
    if (canvasOwner !== null && canvasOwner !== sid && useCanvasStore.getState().dirty) {
      const prev = L.sessions.find((s) => s.id === canvasOwner)
      const ok = confirm(
        `「${prev?.title ?? '다른 파이프라인'}」 탭에 저장하지 않은 변경이 있습니다.
` +
          '버리고 여기서 편집할까요?',
      )
      if (!ok) return
    }
    setCanvasOwner(sid)
  }

  /** 파이프라인을 탭으로 연다. **이미 열려 있으면 그 탭을 앞으로 가져온다** — 같은
   *  파이프라인 탭이 둘이면 어느 쪽 그래프가 저장되는지 알 수 없다.
   *
   *  저장된 쿼리와 달리 포커스한 SQL 탭을 재사용하지 않는다. 내용이 SQL 이 아니라
   *  캔버스라, 쓰던 쿼리를 덮어쓰는 셈이 되기 때문이다. */
  const openPipeline = (p: PipelineSummary) => {
    const existing = L.sessions.find((s) => s.pipelineId === p.id)
    if (existing) {
      updateSession(existing.id, { title: p.name })
      revealSession(existing.id)
      takeCanvas(existing.id)
      return
    }
    const id = ++seq.current
    const s: Session = { ...blankSession(id), title: p.name, pipelineId: p.id }
    setL((L) => {
      const fid = contentDock(L.columns, L.focused)
      return {
        sessions: [...L.sessions, s],
        columns: mapDock(L.columns, (d) => (d.id === fid ? { ...d, tabs: [...d.tabs, id], active: id } : d)),
        focused: fid,
      }
    })
    takeCanvas(id)
  }

  /** 트리의 실행 이력 한 건 → 실행 상세 팝업 (모니터와 같은 화면).
   *  탭은 캔버스라 이력을 담을 자리가 없고, 이미 있는 화면을 또 만들 이유도 없다. */
  const openPipelineRun = (_p: PipelineSummary, runId: string) => setDetailRunId(runId)

  /** 트리의 [파이프라인] 버튼 — 서버에 새로 만들고 그 폴더에 놓은 뒤 탭으로 연다. */
  const newPipelineInFolder = async (folderId: string, name: string) => {
    try {
      const created = await createPipeline.mutateAsync({ name })
      persistSaved(addPipeline(saved, folderId, created.id))
      openPipeline({
        id: created.id,
        name: created.name,
        description: created.description,
        status: created.status,
        schedule: created.schedule,
        schedule_enabled: created.schedule_enabled,
        flow: [],
        last_run_status: null,
        last_run_at: null,
        updated_at: created.updated_at,
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : '파이프라인을 만들지 못했습니다')
    }
  }

  /** 트리에서만 뺀다 — 서버의 파이프라인은 남는다 (「미분류」로 돌아간다). */
  const removePipelineRef = (itemId: string) => persistSaved(removePipeline(saved, itemId))
  const movePipelineRef = (itemId: string, targetFolderId: string) =>
    persistSaved(movePipeline(saved, itemId, targetFolderId))
  /** 「미분류」에 있던 것을 폴더에 담는다. */
  const placePipelineRef = (pipelineId: string, targetFolderId: string) =>
    persistSaved(addPipeline(saved, targetFolderId, pipelineId))

  // 컬럼 사이 구분선 드래그 → 좌우 폭
  const startColResize = (e: React.PointerEvent, leftId: number, rightId: number) => {
    e.preventDefault()
    const rect = splitViewRef.current?.getBoundingClientRect()
    if (!rect) return
    const startX = e.clientX
    const wl0 = colWeights[leftId] ?? 1
    const wr0 = colWeights[rightId] ?? 1
    const total = L.columns.reduce((s, c) => s + (colWeights[c.id] ?? 1), 0)
    const move = (ev: PointerEvent) => {
      const frac = ((ev.clientX - startX) / rect.width) * total
      setColWeights((w) => ({ ...w, [leftId]: Math.max(0.25, wl0 + frac), [rightId]: Math.max(0.25, wr0 - frac) }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // 컬럼 안 도크 사이 구분선 드래그 → 위아래 높이
  const startRowResize = (e: React.PointerEvent, topId: number, botId: number) => {
    e.preventDefault()
    const colEl = (e.currentTarget as HTMLElement).parentElement
    const rect = colEl?.getBoundingClientRect()
    if (!rect) return
    const startY = e.clientY
    const wt0 = rowWeights[topId] ?? 1
    const wb0 = rowWeights[botId] ?? 1
    const col = L.columns.find((c) => c.docks.some((d) => d.id === topId))
    const total = col ? col.docks.reduce((s, d) => s + (rowWeights[d.id] ?? 1), 0) : 2
    const move = (ev: PointerEvent) => {
      const frac = ((ev.clientY - startY) / rect.height) * total
      setRowWeights((w) => ({ ...w, [topId]: Math.max(0.2, wt0 + frac), [botId]: Math.max(0.2, wb0 - frac) }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // 포인터 좌표 아래 드롭 대상: 본문 방향 존 > 탭 바(이동)
  const dropTargetAt = (x: number, y: number): DropTarget | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const side = el.getAttribute('data-dock-side')
      if (side === 'left' || side === 'right' || side === 'top' || side === 'bottom')
        return { dock: Number(el.getAttribute('data-dock-id')), side }
      const strip = el.getAttribute('data-dock-strip')
      if (strip) return { dock: Number(strip), side: null }
    }
    return null
  }

  const startTabDrag = (e: React.PointerEvent, tabId: number, fromDock: number, label: string) => {
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return
        started = true
        document.body.style.userSelect = 'none'
      }
      const t = dropTargetAt(ev.clientX, ev.clientY)
      dropRef.current = t
      setDropTarget(t)
      setDrag({ tabId, fromDock, x: ev.clientX, y: ev.clientY, label })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      if (started) {
        const t = dropRef.current
        if (t) {
          if (t.side === 'left' || t.side === 'right') splitH(tabId, fromDock, t.dock, t.side)
          else if (t.side === 'top' || t.side === 'bottom') splitV(tabId, fromDock, t.dock, t.side)
          else moveTab(tabId, fromDock, t.dock)
        }
      } else {
        selectTab(fromDock, tabId)
      }
      setDrag(null)
      setDropTarget(null)
      dropRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!connLoading && dbConns.length === 0) {
    return (
      <div className="view sqlpage-empty">
        <div className="sqlpage-empty-box">
          <Icon.db />
          <h3>DB 연결이 없습니다</h3>
          <p>
            SQL 편집기는 DB 연결(MySQL · PostgreSQL · MSSQL · MongoDB)이 필요합니다. 먼저{' '}
            <b>연결</b> 메뉴에서 등록하세요.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="view sqlpage-split" ref={splitViewRef}>
      {duckHint && (
        <div className="sql-duck-toast" role="status">
          {duckHint}
        </div>
      )}
      {L.columns.map((col, ci) => (
        <Fragment key={col.id}>
          {ci > 0 && (
            <div
              className="sql-pane-vsplit"
              onPointerDown={(e) => startColResize(e, L.columns[ci - 1].id, col.id)}
              title="드래그해서 좌·우 크기 조절"
            >
              <span className="sql-pane-vsplit-grip" />
            </div>
          )}
          <div className="sql-col" style={{ flexGrow: colWeights[col.id] ?? 1, flexBasis: 0 }}>
            {col.docks.map((dock, di) => (
              <Fragment key={dock.id}>
                {di > 0 && (
                  <div
                    className="sql-hsplit"
                    onPointerDown={(e) => startRowResize(e, col.docks[di - 1].id, dock.id)}
                    title="드래그해서 위·아래 크기 조절"
                  >
                    <span className="sql-hsplit-grip" />
                  </div>
                )}
                <div className="sql-dock-h" style={{ flexGrow: rowWeights[dock.id] ?? 1, flexBasis: 0 }}>
                  <DockView
                    dock={dock}
                    sessions={L.sessions}
                    dbConns={dbConns}
                    connLoading={connLoading}
                    focused={dock.id === L.focused}
                    dragging={!!drag}
                    dropTarget={dropTarget}
                    navConnections={dbConns}
                    navActiveConnId={navActiveConnId}
                    duckTables={duckTables}
                    duckLoading={duckLoading}
                    onPickTable={pickTable}
                    onOpenObjectQuery={openObjectQuery}
                    onStartTabDrag={startTabDrag}
                    onCloseTab={closeTab}
                    onAddTab={() => addTab(dock.id)}
                    onSplit={() => splitButton(dock.id)}
                    onFocusDock={() => focusDock(dock.id)}
                    onUpdateSession={updateSession}
                    onChangeConn={changeConn}
                    bindInsert={(sid, fn) => insertReg.current.set(sid, fn)}
                    onFocusSession={(sid) => setLastFocused(sid)}
                    onAiEscalate={escalateToAi}
                    onSaveSession={saveSession}
                    saved={saved}
                    onOpenSaved={openSaved}
                    onDeleteSavedQuery={deleteSavedQuery}
                    onDeleteSavedFolder={deleteSavedFolder}
                    onNewSavedFolder={newSavedFolder}
                    onNewSavedQuery={newSavedQuery}
                    onRenameSavedQuery={renameSavedQuery}
                    onRenameSavedFolder={renameSavedFolder}
                    onMoveSavedQuery={moveSavedQuery}
                    onMoveSavedFolder={moveSavedFolder}
                    favorites={favorites}
                    onAddFavorite={addFav}
                    muted={muted}
                    onToggleMuted={toggleMutedStatement}
                    onUpdateFavorite={updateFav}
                    onDeleteFavorite={deleteFav}
                    pipelines={pipelines}
                    onOpenPipeline={openPipeline}
                    onOpenPipelineRun={openPipelineRun}
                    onNewPipeline={newPipelineInFolder}
                    onRemovePipeline={removePipelineRef}
                    onMovePipeline={movePipelineRef}
                    onPlacePipeline={placePipelineRef}
                    canvasOwner={canvasOwner}
                    canvasOwnerLabel={canvasOwnerLabel}
                    onTakeCanvas={takeCanvas}
                  />
                </div>
              </Fragment>
            ))}
          </div>
        </Fragment>
      ))}
      {drag && (
        <div className="sql-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 14 }}>
          {drag.label}
        </div>
      )}
      {detailRunId && <RunDetail runId={detailRunId} onClose={() => setDetailRunId(null)} />}
      {saveReq && (
        <SaveQueryDialog
          folders={saved}
          defaultName={saveReq.defaultName}
          onCancel={() => setSaveReq(null)}
          onSave={commitSave}
        />
      )}
    </div>
  )
}
