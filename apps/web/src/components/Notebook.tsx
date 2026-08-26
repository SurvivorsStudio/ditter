import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import { SqlEditor, sqlStatementRanges, type CompletionTable } from '../canvas/SqlEditor'
import { useRunQuery, useRunMongo, useRunDuck, useConnections } from '../api/hooks'
import { ApiError } from '../api/client'
import { Icon } from './icons'
import { FavoritePickerModal } from './Favorites'
import { ChartView, defaultChartConfig, type ChartConfig } from './ChartView'
import { CellAiChat } from './NotebookAi'
import { AiFixPanel } from './AiFixPanel'
import { specFor } from '../api/connectorFields'
import type { SelectOption } from './SearchSelect'
import type { Favorite } from '../api/favoritesStore'
import type { DuckTable } from '../canvas/duckRefs'
import type { QueryResult } from '../api/types'
import type { SqlStatement } from '../api/statements'
import { mutedRunMessage } from '../api/statements'

/** 노트북 셀 하나. `md` 는 설명용 마크다운, `sql` 은 실행 셀. */
export type Cell = { id: string; type: 'sql' | 'md'; src: string }

/** 셀이 노트북에 등록하는 API — 커맨드 모드에서 노트북이 셀을 실행/포커스한다. */
type CellApi = { run: () => void; focus: () => void; reset: () => void }

export function cellUid(): string {
  return 'c-' + Math.random().toString(36).slice(2, 9)
}

// ── 셀 실행 결과 캐시 ─────────────────────────────────────────────
// 새로고침·재진입 후에도 마지막 실행 결과(그리드·실행번호·정렬·필터)를 그대로 보여준다.
// 워크스페이스(자주 저장됨)를 부풀리지 않도록 별도 localStorage 키에 둔다.
type CachedResult = {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  truncated: boolean
  total: number | null
  elapsed_ms: number
  execCount: number | null
  sort: { col: string; dir: 'asc' | 'desc' } | null
  colFilters: Record<string, string>
  error: string | null
  query: string
  viewMode?: 'table' | 'chart' | 'json'
  chart?: ChartConfig | null
  ts: number
}
const NB_CACHE_KEY = 'eai_nb_cache_v1'
const NB_CACHE_MAX_CELLS = 60 // 캐시할 셀 수 상한(오래된 것부터 버림)
const NB_CACHE_MAX_ROWS = 500 // 셀당 저장 행 수 상한(localStorage 용량 보호)

function readAllCache(): Record<string, CachedResult> {
  try {
    return (JSON.parse(localStorage.getItem(NB_CACHE_KEY) || '{}') as Record<string, CachedResult>) || {}
  } catch {
    return {}
  }
}
export function readCellCache(id: string): CachedResult | undefined {
  return readAllCache()[id]
}
export function writeCellCache(id: string, entry: CachedResult) {
  const all = readAllCache()
  all[id] = entry
  // 셀 수 상한 — 오래된 것부터 제거
  let ids = Object.keys(all)
  if (ids.length > NB_CACHE_MAX_CELLS) {
    ids.sort((a, b) => all[a].ts - all[b].ts)
    for (const old of ids.slice(0, ids.length - NB_CACHE_MAX_CELLS)) delete all[old]
  }
  // 용량(quota) 초과 시 오래된 절반씩 덜어내며 재시도
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      localStorage.setItem(NB_CACHE_KEY, JSON.stringify(all))
      return
    } catch {
      ids = Object.keys(all).sort((a, b) => all[a].ts - all[b].ts)
      if (ids.length <= 1) {
        try {
          localStorage.removeItem(NB_CACHE_KEY)
        } catch {
          /* 무시 */
        }
        return
      }
      for (const old of ids.slice(0, Math.ceil(ids.length / 2))) delete all[old]
    }
  }
}
export function dropCellCache(id: string) {
  const all = readAllCache()
  if (id in all) {
    delete all[id]
    try {
      localStorage.setItem(NB_CACHE_KEY, JSON.stringify(all))
    } catch {
      /* 무시 */
    }
  }
}

/** 노트북 셀들을 하나의 SQL 텍스트로 합친다 (노트북 → 편집기).
 *  SQL 셀은 `;` 로 구분, 메모 셀은 `/*md … *​/` 주석으로 보존해 왕복(편집기 → 노트북)에서 복원된다. */
export function cellsToText(cells: Cell[]): string {
  return cells
    .map((c) =>
      c.type === 'md'
        ? c.src.trim()
          ? `/*md\n${c.src.trim()}\n*/`
          : ''
        : c.src.trim()
          ? c.src.trim().replace(/;+\s*$/, '') + ';'
          : '',
    )
    .filter(Boolean)
    .join('\n\n')
}

/** SQL 텍스트를 노트북 셀로 되돌린다 (편집기 → 노트북).
 *  `/*md … *​/` 마커는 메모 셀로, 나머지는 `;` 기준으로 SQL 셀로 나눈다 (문자열·주석 안 `;` 무시). */
export function textToCells(text: string): Cell[] {
  const cells: Cell[] = []
  const pushSql = (chunk: string) => {
    for (const r of sqlStatementRanges(chunk)) {
      const s = chunk.slice(r.from, r.to).trim()
      if (s) cells.push({ id: cellUid(), type: 'sql', src: s })
    }
  }
  const mdRe = /\/\*md\b([\s\S]*?)\*\//g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(text))) {
    pushSql(text.slice(last, m.index))
    cells.push({ id: cellUid(), type: 'md', src: m[1].trim() })
    last = mdRe.lastIndex
  }
  pushSql(text.slice(last))
  return cells
}

/** 접힌 셀에 보여줄 첫 (비어 있지 않은) 줄. 너무 길면 자른다. */
function firstLine(src: string): string {
  const line = src.split('\n').find((l) => l.trim()) ?? ''
  return line.length > 90 ? line.slice(0, 90) + '…' : line
}

function fmt(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', isNull: true }
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (s.length > 300) s = s.slice(0, 300) + '…'
  return { text: s, isNull: false }
}

/** 결과를 JSON(읽기 전용, 색상·라인번호·접기)으로 — 일반 편집기의 JSON 뷰와 같은 느낌. */
function NbJsonView({ rows }: { rows: Record<string, unknown>[] }) {
  const text = useMemo(() => JSON.stringify(rows, null, 2), [rows])
  const extensions = useMemo(() => [json(), EditorView.lineWrapping], [])
  return (
    <CodeMirror
      className="nb-json-cm"
      value={text}
      theme="light"
      editable={false}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  )
}

/** 아주 작은 마크다운 렌더러 — 제목/굵게/기울임/코드/링크/목록. 입력은 먼저 이스케이프한다. */
function renderMd(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  const out: string[] = []
  let list = false
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (h) {
      if (list) { out.push('</ul>'); list = false }
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
    } else if (li) {
      if (!list) { out.push('<ul>'); list = true }
      out.push(`<li>${inline(li[1])}</li>`)
    } else if (line === '') {
      if (list) { out.push('</ul>'); list = false }
    } else {
      if (list) { out.push('</ul>'); list = false }
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  if (list) out.push('</ul>')
  return out.join('') || '<p class="nb-md-placeholder">빈 메모 — 더블클릭하면 편집</p>'
}

/** 셀 공통 액션(에디트 모드의 Jupyter 키). CodeMirror/textarea 가 먹기 전에 capture 로 가로챈다. */
function useCellKeys(actions: {
  run: () => void
  runNext: () => void
  runInsert: () => void
  toCommand: () => void
}) {
  return (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault(); e.stopPropagation(); actions.run(); actions.runNext()
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault(); e.stopPropagation(); actions.run(); actions.runInsert()
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault(); e.stopPropagation(); actions.run()
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); actions.toCommand()
    }
  }
}

/** SQL 실행 셀 — 미니 에디터 + 실행 + 개별 결과. 각 셀이 자체 실행 훅을 갖는다(독립 실행). */
function SqlCell({
  cell,
  mode,
  connectionId,
  namespace,
  tables,
  duckTables,
  favorites,
  muted,
  nextExecCount,
  onChangeSrc,
  aiAvailable,
  aiConnId,
  aiOptions,
  onAiModelChange,
  aiDbConnId,
  onInsertAiSqlBelow,
  onAiEscalate,
  selected,
  editing,
  register,
  onSelectCommand,
  onFocusEdit,
  onRunNext,
  onRunInsert,
  onToCommand,
  onDelete,
  onMove,
  onDuplicate,
  onAddBelow,
}: {
  cell: Cell
  mode: 'sql' | 'mongo' | 'duck'
  connectionId?: string
  namespace?: string | null
  tables: CompletionTable[]
  duckTables: DuckTable[]
  favorites: Favorite[]
  /** 툴바 태그로 잠시 꺼 둔 명령 — 셀 실행도 같은 연결로 나가므로 여기서도 막는다. */
  muted: SqlStatement[]
  nextExecCount: () => number
  onChangeSrc: (src: string) => void
  /** 셀별 AI 챗 — `/` 명령으로 이 블럭만 켠다. 모델은 노트북 공용. */
  aiAvailable: boolean
  aiConnId: string
  aiOptions: SelectOption[]
  onAiModelChange: (v: string) => void
  aiDbConnId?: string
  onInsertAiSqlBelow: (src: string) => void
  onAiEscalate?: (payload: { sql: string; error: string; assistant: string; dbConnId?: string }) => void
  selected: boolean
  editing: boolean
  register: (id: string, api: CellApi | null) => void
  onSelectCommand: () => void
  onFocusEdit: () => void
  onRunNext: () => void
  onRunInsert: () => void
  onToCommand: () => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onAddBelow: () => void
}) {
  const runQuery = useRunQuery()
  const runMongo = useRunMongo()
  const runDuck = useRunDuck()
  // 마운트 시 캐시에서 마지막 실행 결과를 되살린다(새로고침·재진입 후에도 유지).
  const hydrated = useMemo(() => readCellCache(cell.id), [cell.id])
  const [data, setData] = useState<QueryResult | null>(() =>
    hydrated && !hydrated.error
      ? {
          columns: hydrated.columns,
          rows: hydrated.rows,
          row_count: hydrated.row_count,
          truncated: hydrated.truncated,
          total: hydrated.total,
          elapsed_ms: hydrated.elapsed_ms,
          // 캐시에는 담지 않는다 — 되살린 결과에 "3행 적용" 이 다시 뜨면
          // 방금 또 실행한 것처럼 읽힌다. 쓰기 건수는 실행한 그 자리에서만 말한다.
          statement: 'select',
          affected_rows: null,
        }
      : null,
  )
  const [error, setError] = useState<string | null>(hydrated?.error ?? null)
  const [pending, setPending] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resultOpen, setResultOpen] = useState(true)
  // 주피터식 입력 접기 — 왼쪽 막대 클릭. 접으면 첫 줄 + ••• 만 보인다.
  const [collapsed, setCollapsed] = useState(false)
  // 이 블럭의 AI 챗 활성 여부 — `/` 명령으로 켠다(전역 토글 아님).
  const [aiActive, setAiActive] = useState(false)
  // 오류 자리의 AI 수정 패널 열림 여부.
  const [showFix, setShowFix] = useState(false)
  // 이 셀이 마지막으로 실행된 순번(주피터 `In [n]`). 아직 안 돌렸으면 null.
  const [execCount, setExecCount] = useState<number | null>(hydrated?.execCount ?? null)
  const abortRef = useRef<AbortController | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  // `/loadQueryList` 로 연 즐겨찾기 피커 모달. 교체할 트리거 범위를 담는다.
  const [loadModal, setLoadModal] = useState<{ from: number; to: number } | null>(null)
  // 결과 그리드 정렬·컬럼 필터(서버 측). 일반 편집기와 동일하게 offset 0 부터 재조회한다.
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(hydrated?.sort ?? null)
  const [colFilters, setColFilters] = useState<Record<string, string>>(hydrated?.colFilters ?? {})
  const [showFilters, setShowFilters] = useState(
    () => !!hydrated && Object.values(hydrated.colFilters).some((v) => v.trim()),
  )
  // 결과 보기 모드(표/차트)와 차트 설정. 재진입 후에도 유지되도록 캐시에 함께 저장한다.
  const [resultView, setResultView] = useState<'table' | 'chart' | 'json'>(
    (hydrated?.viewMode as 'table' | 'chart' | 'json') ?? 'table',
  )
  const [chartCfg, setChartCfg] = useState<ChartConfig | null>(hydrated?.chart ?? null)
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // loadMore·정렬·필터 재조회가 참조할 "실제 실행된" 쿼리와 정렬·필터.
  const executedRef = useRef<{
    query: string
    sort: { col: string; dir: 'asc' | 'desc' } | null
    filters: { col: string; value: string }[]
  }>({
    query: hydrated?.query ?? '',
    sort: hydrated?.sort ?? null,
    filters: hydrated
      ? Object.entries(hydrated.colFilters)
          .map(([col, value]) => ({ col, value: value.trim() }))
          .filter((f) => f.value !== '')
      : [],
  })

  const canRun = (mode === 'duck' || Boolean(connectionId)) && cell.src.trim().length > 0

  // 내용을 고치면 이전 오류는 즉시 지운다(옛 오류가 계속 남지 않게). 성공 결과는 재실행 전까지 유지.
  // 완전히 비우면 결과·오류를 모두 지운다. 마운트 시(하이드레이션 직후)에는 건드리지 않는다.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (cell.src.trim() === '') {
      setData(null)
      setError(null)
      dropCellCache(cell.id)
    } else {
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.src])

  const buildFilters = (cf: Record<string, string>) =>
    Object.entries(cf)
      .map(([col, value]) => ({ col, value: value.trim() }))
      .filter((f) => f.value !== '')

  // 현재 실행 결과를 localStorage 캐시에 저장한다(정렬·필터·실행번호 포함). 행은 상한까지만.
  const persist = (d: QueryResult | null, err: string | null, ec: number | null) => {
    const ex = executedRef.current
    const cf = Object.fromEntries(ex.filters.map((f) => [f.col, f.value]))
    writeCellCache(cell.id, {
      columns: d?.columns ?? [],
      rows: (d?.rows ?? []).slice(0, NB_CACHE_MAX_ROWS),
      row_count: d?.row_count ?? 0,
      truncated: d ? d.truncated || d.rows.length > NB_CACHE_MAX_ROWS : false,
      total: d?.total ?? null,
      elapsed_ms: d?.elapsed_ms ?? 0,
      execCount: ec,
      sort: ex.sort,
      colFilters: cf,
      error: err,
      query: ex.query,
      viewMode: resultView,
      chart: chartCfg,
      ts: Date.now(),
    })
  }

  // 보기 모드·차트 설정이 바뀌면(재실행 없이) 캐시에 반영해 재진입 후에도 유지한다.
  useEffect(() => {
    if (data || error) persist(data, error, execCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultView, chartCfg])

  // 첫 페이지 실행(신규 실행·정렬·필터 변경 공용). 정렬·필터를 executedRef 에 저장해 loadMore 가 잇는다.
  const execFirst = (
    q: string,
    s: { col: string; dir: 'asc' | 'desc' } | null,
    cf: Record<string, string>,
  ) => {
    if (!q) return
    if (mode !== 'duck' && !connectionId) return
    const filters = buildFilters(cf)
    const sortCol = s?.col ?? null
    const sortDir = s?.dir ?? 'asc'
    executedRef.current = { query: q, sort: s, filters }
    setError(null)
    setShowFix(false) // 새 실행이면 이전 오류의 AI 수정 패널을 접는다
    setPending(true)
    setResultOpen(true)
    const signal = (abortRef.current = new AbortController()).signal
    const onSuccess = (r: QueryResult) => {
      setData(r)
      setPending(false)
      const ec = nextExecCount()
      setExecCount(ec)
      persist(r, null, ec)
    }
    const onError = (e: unknown) => {
      setPending(false)
      if (e instanceof DOMException && e.name === 'AbortError') return
      setData(null)
      const msg = e instanceof ApiError ? e.message : '실행에 실패했습니다.'
      setError(msg)
      const ec = nextExecCount()
      setExecCount(ec)
      persist(null, msg, ec)
    }
    if (mode === 'duck') runDuck.mutate({ query: q, offset: 0, sortCol, sortDir, filters, signal }, { onSuccess, onError })
    else if (mode === 'mongo') runMongo.mutate({ id: connectionId!, command: q, namespace, offset: 0, sortCol, sortDir, filters, signal }, { onSuccess, onError })
    else runQuery.mutate({ id: connectionId!, query: q, offset: 0, sortCol, sortDir, filters, signal }, { onSuccess, onError })
  }

  const run = () => {
    if (pending) return
    const q = cell.src.trim()
    // 꺼 둔 명령이면 보내지 않는다 (편집기 툴바의 태그). 노트북도 같은 연결로 나가므로
    // 여기서 막지 않으면 셀로 실행하는 길이 그대로 열려 있다.
    const blocked = mutedRunMessage(q, muted)
    if (blocked) {
      setData(null)
      setError(blocked)
      return
    }
    // 내용이 비었으면 실행하지 않되, 이전 결과·오류는 지운다(옛 오류가 남지 않게).
    if (!q) {
      setData(null)
      setError(null)
      return
    }
    // 새 실행이므로 정렬·필터는 초기화 (컬럼 구성이 달라질 수 있으므로).
    setSort(null)
    setColFilters({})
    execFirst(q, null, {})
  }

  // 결과 그리드를 아래로 끌면 다음 페이지를 이어 붙인다(무한 스크롤). 정렬·필터는 실행된 값 유지.
  const loadMore = () => {
    if (!data || !data.truncated || pending || loadingMore) return
    const ex = executedRef.current
    if (!ex.query) return
    if (mode !== 'duck' && !connectionId) return
    setLoadingMore(true)
    const signal = (abortRef.current = new AbortController()).signal
    const onSuccess = (r: QueryResult) => {
      setData((prev) => {
        const merged = prev
          ? { ...prev, rows: [...prev.rows, ...r.rows], truncated: r.truncated }
          : r
        persist(merged, null, execCount)
        return merged
      })
      setLoadingMore(false)
    }
    const onError = (e: unknown) => {
      setLoadingMore(false)
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
    const offset = data.rows.length
    const sortCol = ex.sort?.col ?? null
    const sortDir = ex.sort?.dir ?? 'asc'
    const filters = ex.filters
    if (mode === 'duck') runDuck.mutate({ query: ex.query, offset, sortCol, sortDir, filters, signal }, { onSuccess, onError })
    else if (mode === 'mongo') runMongo.mutate({ id: connectionId!, command: ex.query, namespace, offset, sortCol, sortDir, filters, signal }, { onSuccess, onError })
    else runQuery.mutate({ id: connectionId!, query: ex.query, offset, sortCol, sortDir, filters, signal }, { onSuccess, onError })
  }

  // 한 페이지를 promise 로 받는다(loadAll 루프용). loadMore 와 같은 파라미터.
  const fetchPage = (offset: number, signal: AbortSignal): Promise<QueryResult> => {
    const ex = executedRef.current
    const sortCol = ex.sort?.col ?? null
    const sortDir = ex.sort?.dir ?? 'asc'
    const filters = ex.filters
    if (mode === 'duck') return runDuck.mutateAsync({ query: ex.query, offset, sortCol, sortDir, filters, signal })
    if (mode === 'mongo')
      return runMongo.mutateAsync({ id: connectionId!, command: ex.query, namespace, offset, sortCol, sortDir, filters, signal })
    return runQuery.mutateAsync({ id: connectionId!, query: ex.query, offset, sortCol, sortDir, filters, signal })
  }

  // "전체 로드" — truncated 가 false 가 될 때까지 페이지를 이어 받아 다 채운다.
  // 표·JSON·차트 공통(같은 data 를 쓴다). 진행 중엔 다시 누르면 중단한다.
  const loadAll = async () => {
    if (loadingAll) {
      abortRef.current?.abort()
      return
    }
    if (!data || !data.truncated || pending || loadingMore) return
    if (!executedRef.current.query) return
    if (mode !== 'duck' && !connectionId) return
    setLoadingAll(true)
    const signal = (abortRef.current = new AbortController()).signal
    try {
      let rows = data.rows
      let truncated: boolean = data.truncated
      while (truncated && !signal.aborted) {
        const r = await fetchPage(rows.length, signal)
        rows = rows.concat(r.rows)
        truncated = r.truncated
        // 점진적으로 화면·캐시에 반영 (긴 조회 중에도 진행이 보이게)
        const merged = { ...data, rows: rows.slice(), truncated }
        setData(merged)
        persist(merged, null, execCount)
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof ApiError ? e.message : '전체 로드에 실패했습니다.')
      }
    } finally {
      setLoadingAll(false)
    }
  }

  // 결과를 클립보드로 복사 — JSON 뷰면 JSON, 그 외(표·차트)는 TSV(엑셀·시트 붙여넣기용).
  const copyResult = async () => {
    if (!data) return
    let text: string
    if (resultView === 'json') {
      text = JSON.stringify(data.rows, null, 2)
    } else {
      const cell = (v: unknown) => {
        if (v === null || v === undefined) return ''
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
        return s.replace(/[\t\r\n]/g, ' ') // 탭·개행은 셀 경계를 깨므로 공백으로
      }
      const header = data.columns.join('\t')
      const body = data.rows.map((r) => data.columns.map((c) => cell(r[c])).join('\t')).join('\n')
      text = `${header}\n${body}`
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
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
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  // 마지막 실행 쿼리 기준으로 정렬·필터만 바꿔 재조회(offset 0).
  const applySortFilter = (
    s: { col: string; dir: 'asc' | 'desc' } | null,
    cf: Record<string, string>,
  ) => {
    if (!executedRef.current.query || pending) return
    execFirst(executedRef.current.query, s, cf)
  }

  // 헤더 클릭 → 정렬 순환(없음 → 오름 → 내림 → 없음)
  const cycleSort = (col: string) => {
    const next =
      !sort || sort.col !== col
        ? { col, dir: 'asc' as const }
        : sort.dir === 'asc'
          ? { col, dir: 'desc' as const }
          : null
    setSort(next)
    applySortFilter(next, colFilters)
  }

  // 컬럼 필터 입력(디바운스 후 재조회)
  const onColFilter = (col: string, v: string) => {
    const next = { ...colFilters, [col]: v }
    setColFilters(next)
    if (filterTimer.current) clearTimeout(filterTimer.current)
    filterTimer.current = setTimeout(() => applySortFilter(sort, next), 350)
  }

  // 필터 행 열고/닫기 — 닫을 때 활성 필터가 있으면 지우고 재조회
  const toggleFilters = () => {
    if (showFilters) {
      setShowFilters(false)
      if (Object.values(colFilters).some((v) => v.trim())) {
        setColFilters({})
        applySortFilter(sort, {})
      }
    } else {
      setShowFilters(true)
    }
  }

  // 차트 보기로 전환 — 설정이 없으면 데이터 기준 스마트 기본값을 만든다.
  const showChart = () => {
    if (!chartCfg && data && data.columns.length > 0) {
      setChartCfg(defaultChartConfig(data.columns, data.rows))
    }
    setResultView('chart')
  }

  // 노트북에 실행/포커스 API 를 등록(커맨드 모드에서 호출). ref 로 최신 값을 읽는다.
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    register(cell.id, {
      run: () => runRef.current(),
      focus: () => wrapRef.current?.querySelector<HTMLElement>('.cm-content')?.focus(),
      // 세션 초기화: 실행 중이면 취소하고 출력·실행번호를 지운다([ ] 로 되돌림). 캐시도 비운다.
      reset: () => {
        abortRef.current?.abort()
        setPending(false)
        setData(null)
        setError(null)
        setExecCount(null)
        dropCellCache(cell.id)
      },
    })
    return () => register(cell.id, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.id])

  const onKeyCapture = useCellKeys({ run, runNext: onRunNext, runInsert: onRunInsert, toCommand: onToCommand })

  return (
    <div
      ref={wrapRef}
      data-cell-id={cell.id}
      className={`nb-cell ${selected ? 'sel' : ''} ${selected && editing ? 'editing' : ''} ${pending ? 'running' : ''}`}
      onKeyDownCapture={onKeyCapture}
      onFocus={onFocusEdit}
    >
      {/* 주피터식 막대 — 가장 왼쪽. 선택·편집 상태 색을 겸하고, 클릭하면 입력을 접고/편다 */}
      <button
        type="button"
        className={`nb-collapse-bar ${collapsed ? 'collapsed' : ''}`}
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? '펼치기' : '접기'}
        aria-label={collapsed ? '셀 펼치기' : '셀 접기'}
      />
      <div className="nb-cell-gutter" onClick={onSelectCommand}>
        <span className="nb-cell-no">[{pending ? '*' : (execCount ?? ' ')}]</span>
      </div>
      <div className="nb-cell-main">
        <div className={`nb-cell-editor ${collapsed ? 'collapsed' : ''}`}>
          {collapsed ? (
            <button type="button" className="nb-collapsed" onClick={() => setCollapsed(false)} title="펼치기">
              <span className="nb-collapsed-code">{firstLine(cell.src)}</span>
              <span className="nb-collapsed-dots">•••</span>
            </button>
          ) : (
          <>
          {/* 스크롤·높이조절은 이 안쪽 래퍼가 담당 — 도구(실행 등)는 바깥에 고정 */}
          <div className="nb-cell-scroll">
            <SqlEditor
              cmRef={cmRef}
              value={cell.src}
              onChange={onChangeSrc}
              height="auto"
              language={mode === 'mongo' ? 'javascript' : 'sql'}
              completion={mode === 'duck' ? undefined : tables}
              duckCompletion={mode === 'duck' ? duckTables : undefined}
              favorites={favorites}
              onOpenLoadModal={(r) => setLoadModal(r)}
              // `/aiQuery` 는 기존 슬래시 명령 목록에서 함께 뜬다 — 고르면 이 블럭 AI 챗을 켠다.
              // AI 모델이 있을 때만 넘긴다(없으면 목록에서 자동으로 숨겨진다). SQL 을 만드는 기능이라
              // mongo 모드에는 붙이지 않는다.
              onAiCommand={aiAvailable && mode !== 'mongo' ? () => setAiActive(true) : undefined}
              placeholder={mode === 'mongo' ? 'collection.find({ })' : 'SELECT * FROM ...'}
            />
          </div>
          <div className="nb-cell-tools">
            <button
              className={`nb-tool-run ${pending ? 'busy' : ''}`}
              onClick={() => (pending ? abortRef.current?.abort() : run())}
              disabled={!pending && !canRun}
              title={pending ? '실행 취소' : '실행 (⌘/Ctrl+Enter)'}
            >
              {pending ? <Icon.stop /> : <Icon.play />}
            </button>
            <button title="아래에 셀 추가" onClick={onAddBelow}><Icon.plus /></button>
            <button title="위로" onClick={() => onMove(-1)}>↑</button>
            <button title="아래로" onClick={() => onMove(1)}>↓</button>
            <button title="복제" onClick={onDuplicate}><Icon.copy /></button>
            <button title="삭제" onClick={onDelete}><Icon.trash /></button>
          </div>
          </>
          )}
        </div>

        {(pending || data || error) && (
          <div className="nb-result">
            <div className="nb-result-hd" onClick={() => setResultOpen((o) => !o)}>
              <span className={`nb-caret ${resultOpen ? 'open' : ''}`}><Icon.chevron /></span>
              {pending ? (
                <span className="nb-running">실행 중…</span>
              ) : error ? (
                <span className="nb-err-label">오류</span>
              ) : data ? (
                <span>
                  {/* 쓰기 문장은 돌려줄 행이 없다 — 행 수 대신 바꾼 건수를 말한다 */}
                  {data.statement !== 'select' && data.columns.length === 0
                    ? `${data.statement.toUpperCase()} · ${
                        data.affected_rows == null
                          ? '실행됨'
                          : `${data.affected_rows.toLocaleString()}행 적용`
                      }`
                    : data.total != null
                      ? `${data.total.toLocaleString()} 행`
                      : `${data.row_count.toLocaleString()} 행`}
                  {(data.truncated || (data.total != null && data.rows.length < data.total)) &&
                    ` · ${data.rows.length.toLocaleString()} 로드됨`}
                  {' · '}{data.elapsed_ms} ms
                </span>
              ) : null}
              {!pending && !error && data && data.columns.length > 0 && (
                <div className="nb-result-tools" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`nb-loadall ${copied ? 'busy' : ''}`}
                    onClick={copyResult}
                    title={resultView === 'json' ? 'JSON 복사' : '표(TSV) 복사 — 엑셀·시트에 붙여넣기'}
                  >
                    {copied ? <Icon.check /> : <Icon.copy />}
                    {copied ? '복사됨' : '복사'}
                  </button>
                  {(data.truncated || loadingAll) && (
                    <button
                      className={`nb-loadall ${loadingAll ? 'busy' : ''}`}
                      onClick={loadAll}
                      title={loadingAll ? '중단' : '전체 데이터를 모두 불러옵니다'}
                    >
                      {loadingAll ? (
                        <>
                          <span className="nb-loadall-spin" />
                          {data.rows.length.toLocaleString()}
                          {data.total != null ? ` / ${data.total.toLocaleString()}` : ''}
                        </>
                      ) : (
                        <>
                          <Icon.stack />
                          전체 로드
                        </>
                      )}
                    </button>
                  )}
                  <div className="nb-view-switch">
                    <button
                      className={resultView === 'table' ? 'on' : ''}
                      onClick={() => setResultView('table')}
                      title="표로 보기"
                    >
                      <Icon.table />
                    </button>
                    <button
                      className={resultView === 'json' ? 'on' : ''}
                      onClick={() => setResultView('json')}
                      title="JSON 으로 보기"
                    >
                      <Icon.code />
                    </button>
                    <button
                      className={resultView === 'chart' ? 'on' : ''}
                      onClick={showChart}
                      title="차트로 보기"
                    >
                      <Icon.chart />
                    </button>
                  </div>
                  {resultView === 'table' && (
                    <button
                      className={`nb-filter-toggle ${showFilters || Object.values(colFilters).some((v) => v.trim()) ? 'on' : ''}`}
                      onClick={() => toggleFilters()}
                      title="컬럼 필터"
                    >
                      <Icon.filter />
                    </button>
                  )}
                </div>
              )}
            </div>
            {resultOpen && !pending && resultView === 'chart' && data && data.columns.length > 0 && !error ? (
              <div className="nb-chart-body">
                <ChartView
                  columns={data.columns}
                  rows={data.rows}
                  config={chartCfg ?? defaultChartConfig(data.columns, data.rows)}
                  onConfigChange={setChartCfg}
                />
              </div>
            ) : resultOpen && !pending && resultView === 'json' && data && data.columns.length > 0 && !error ? (
              <div
                className="nb-result-body nb-json-body"
                onScroll={(e) => {
                  const el = e.currentTarget
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) loadMore()
                }}
              >
                <NbJsonView rows={data.rows} />
              </div>
            ) : resultOpen && !pending ? (
              <div
                className="nb-result-body"
                onScroll={(e) => {
                  const el = e.currentTarget
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) loadMore()
                }}
              >
                {error ? (
                  <div className="nb-err-wrap">
                    <div className="nb-err">
                      <span>{error}</span>
                      {aiAvailable && mode === 'sql' && executedRef.current.query && (
                        <button
                          className="btn sm ai-fix-btn"
                          onClick={() => setShowFix((v) => !v)}
                          title="수행된 쿼리와 오류를 AI 가 보고 고칩니다"
                        >
                          <Icon.bolt /> AI로 고치기
                        </button>
                      )}
                    </div>
                    {showFix && executedRef.current.query && (
                      <AiFixPanel
                        sql={executedRef.current.query}
                        error={error}
                        dbConnId={aiDbConnId}
                        onApply={(fixed) => {
                          onChangeSrc(fixed)
                          setShowFix(false)
                        }}
                        onEscalate={(p) => {
                          onAiEscalate?.({ ...p, dbConnId: aiDbConnId })
                          setShowFix(false)
                        }}
                        onClose={() => setShowFix(false)}
                      />
                    )}
                  </div>
                ) : data && data.columns.length > 0 ? (
                  <div className="nb-grid-wrap">
                    <table className="nb-grid">
                      <thead>
                        <tr>
                          <th className="nb-rownum" />
                          {data.columns.map((c) => (
                            <th
                              key={c}
                              className={`nb-th ${sort?.col === c ? 'sorted' : ''}`}
                              onClick={() => cycleSort(c)}
                              title="클릭하면 정렬 (오름 → 내림 → 해제)"
                            >
                              <span className="nb-th-label">{c}</span>
                              <span className="nb-th-arrow">
                                {sort?.col === c ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                              </span>
                            </th>
                          ))}
                        </tr>
                        {showFilters && (
                          <tr className="nb-filter-row">
                            <th className="nb-rownum" />
                            {data.columns.map((c) => (
                              <th key={c}>
                                <input
                                  className="nb-col-filter"
                                  value={colFilters[c] ?? ''}
                                  placeholder="필터…"
                                  onChange={(e) => onColFilter(c, e.target.value)}
                                />
                              </th>
                            ))}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {data.rows.map((row, ri) => (
                          <tr key={ri}>
                            <td className="nb-rownum">{ri + 1}</td>
                            {data.columns.map((c) => {
                              const { text, isNull } = fmt(row[c])
                              return <td key={c} className={isNull ? 'nb-null' : ''}>{text}</td>
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(data.truncated || loadingMore) && (
                      <div className="nb-more" onClick={loadMore}>
                        {loadingMore ? '더 불러오는 중…' : '스크롤하거나 눌러 더 불러오기'}
                      </div>
                    )}
                  </div>
                ) : data ? (
                  <div className="nb-empty">결과 행이 없습니다.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        {aiActive && aiConnId && (
          <CellAiChat
            cellSrc={cell.src}
            dbConnId={aiDbConnId}
            aiConnId={aiConnId}
            modelOptions={aiOptions}
            onModelChange={onAiModelChange}
            onClose={() => setAiActive(false)}
            onInsert={(sql) => onChangeSrc(sql)}
            onInsertBelow={onInsertAiSqlBelow}
          />
        )}
      </div>
      {loadModal && (
        <FavoritePickerModal
          favorites={favorites}
          onPick={(sql) => {
            const v = cmRef.current?.view
            if (v) {
              const to = Math.min(loadModal.to, v.state.doc.length)
              const from = Math.min(loadModal.from, to)
              v.dispatch({ changes: { from, to, insert: sql }, selection: { anchor: from + sql.length } })
              v.focus()
            }
            setLoadModal(null)
          }}
          onClose={() => {
            cmRef.current?.view?.focus()
            setLoadModal(null)
          }}
        />
      )}
    </div>
  )
}

/** 마크다운(메모) 셀 — 편집 ↔ 미리보기. */
function MdCell({
  cell,
  selected,
  editing,
  register,
  onChange,
  onSelectCommand,
  onFocusEdit,
  onRunNext,
  onRunInsert,
  onToCommand,
  onDelete,
  onMove,
  onDuplicate,
  onAddBelow,
}: {
  cell: Cell
  selected: boolean
  editing: boolean
  register: (id: string, api: CellApi | null) => void
  onChange: (src: string) => void
  onSelectCommand: () => void
  onFocusEdit: () => void
  onRunNext: () => void
  onRunInsert: () => void
  onToCommand: () => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onAddBelow: () => void
}) {
  const [showEdit, setShowEdit] = useState(cell.src.trim() === '')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    register(cell.id, {
      run: () => setShowEdit(false), // 마크다운 실행 = 렌더
      focus: () => {
        setShowEdit(true)
        requestAnimationFrame(() => taRef.current?.focus())
      },
      reset: () => {}, // 메모 셀은 출력이 없어 초기화할 게 없다
    })
    return () => register(cell.id, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.id])

  const onKeyCapture = useCellKeys({
    run: () => setShowEdit(false),
    runNext: onRunNext,
    runInsert: onRunInsert,
    toCommand: onToCommand,
  })

  return (
    <div
      data-cell-id={cell.id}
      className={`nb-cell nb-cell-md ${selected ? 'sel' : ''} ${selected && editing ? 'editing' : ''}`}
      onKeyDownCapture={onKeyCapture}
      onFocus={onFocusEdit}
    >
      <div className="nb-cell-gutter" onClick={onSelectCommand} />
      <div className="nb-cell-main">
        {showEdit ? (
          <textarea
            ref={taRef}
            className="nb-md-input"
            autoFocus
            value={cell.src}
            placeholder="# 메모 (마크다운) — **굵게**, `코드`, - 목록"
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => cell.src.trim() && setShowEdit(false)}
          />
        ) : (
          <div
            className="nb-md-view"
            onDoubleClick={() => setShowEdit(true)}
            title="더블클릭(또는 Enter)하면 편집"
            dangerouslySetInnerHTML={{ __html: renderMd(cell.src) }}
          />
        )}
        <div className="nb-cell-tools">
          <button title={showEdit ? '미리보기' : '편집'} onClick={() => setShowEdit((e) => !e)}><Icon.edit /></button>
          <button title="아래에 셀 추가" onClick={onAddBelow}><Icon.plus /></button>
          <button title="위로" onClick={() => onMove(-1)}>↑</button>
          <button title="아래로" onClick={() => onMove(1)}>↓</button>
          <button title="복제" onClick={onDuplicate}><Icon.copy /></button>
          <button title="삭제" onClick={onDelete}><Icon.trash /></button>
        </div>
      </div>
    </div>
  )
}

/** 노트북 뷰 — Jupyter 식 셀 블록. 에디트/커맨드 모드 + 단축키. */
export function Notebook({
  cells,
  onChangeCells,
  mode,
  connectionId,
  namespace,
  tables,
  duckTables,
  favorites,
  muted = [],
  toolbarLeft,
  viewToggle,
  onSave,
  onAiEscalate,
}: {
  cells: Cell[]
  onChangeCells: (cells: Cell[]) => void
  mode: 'sql' | 'mongo' | 'duck'
  connectionId?: string
  namespace?: string | null
  tables: CompletionTable[]
  duckTables: DuckTable[]
  favorites: Favorite[]
  /** 편집기 툴바에서 꺼 둔 명령 (연결별). 실행 전에 셀에서도 막는다. */
  muted?: SqlStatement[]
  toolbarLeft?: React.ReactNode
  viewToggle?: React.ReactNode
  /** ⌘/Ctrl+S·저장 버튼 — 셀을 하나의 SQL 로 합쳐 저장한다(저장됨 탭). */
  onSave?: () => void
  /** 셀 오류 수정 패널의 「AI 탭에서 이어가기」 — 페이지가 처리한다. */
  onAiEscalate?: (payload: { sql: string; error: string; assistant: string; dbConnId?: string }) => void
}) {
  const [selId, setSelId] = useState<string | null>(cells[0]?.id ?? null)
  const [editing, setEditing] = useState(false)

  // ── 셀별 AI 어시스턴트 ── 각 셀에서 `/` 명령으로 그 블럭만 켠다(전역 토글 아님).
  // 모델은 노트북 공용 — 활성화된 블럭의 헤더에서 고르며 어느 블럭에서 바꿔도 함께 바뀐다.
  const { data: allConns = [] } = useConnections()
  const aiConns = useMemo(
    () => allConns.filter((c) => specFor(c.type).category === 'ai'),
    [allConns],
  )
  const [aiConnId, setAiConnId] = useState<string>('')
  // AI 모델 기본값 — 아직 안 골랐고 연결이 하나라도 있으면 첫 번째로.
  useEffect(() => {
    if (!aiConnId && aiConns.length > 0) setAiConnId(aiConns[0].id)
  }, [aiConns, aiConnId])
  const aiOptions: SelectOption[] = aiConns.map((c) => ({
    value: c.id,
    label: c.name,
    hint: specFor(c.type).label,
  }))
  // 스키마 문맥은 SQL 모드에서만(대상 DB 가 sql 계열일 때). mongo·duck 은 붙이지 않는다.
  const aiDbConnId = mode === 'sql' ? connectionId : undefined

  const apiRef = useRef(new Map<string, CellApi>())
  const bodyRef = useRef<HTMLDivElement>(null)
  const deletedRef = useRef<{ cell: Cell; at: number } | null>(null)
  const lastD = useRef(0)
  // 주피터의 `In [n]` 처럼 실행할 때마다 1씩 오르는 공용 실행 카운터(세션 단위).
  // 새로고침 후에도 이어서 증가하도록, 캐시에 남은 실행번호 중 최댓값에서 시작한다.
  const execCounterRef = useRef(0)
  const counterInit = useRef(false)
  if (!counterInit.current) {
    counterInit.current = true
    let mx = 0
    for (const c of cells) {
      const e = readCellCache(c.id)?.execCount
      if (typeof e === 'number' && e > mx) mx = e
    }
    execCounterRef.current = mx
  }
  const nextExecCount = () => (execCounterRef.current += 1)

  // 세션 초기화(커널 재시작) — 실행 카운터를 0 으로 되돌리고 모든 셀의 출력·실행번호를 지운다.
  const resetSession = () => {
    execCounterRef.current = 0
    apiRef.current.forEach((api) => api.reset())
  }

  const register = (id: string, api: CellApi | null) => {
    if (api) apiRef.current.set(id, api)
    else apiRef.current.delete(id)
  }

  // ---- 셀 변형 ----
  const setCell = (id: string, src: string) => onChangeCells(cells.map((c) => (c.id === id ? { ...c, src } : c)))
  const insertAt = (type: 'sql' | 'md', at: number): string => {
    const id = cellUid()
    const next = [...cells]
    next.splice(at, 0, { id, type, src: '' })
    onChangeCells(next)
    return id
  }
  // AI 가 만든 SQL 을 특정 셀 바로 아래에 새 SQL 셀로 꽂는다.
  const insertSqlBelow = (afterId: string, src: string) => {
    const i = cells.findIndex((c) => c.id === afterId)
    const at = i < 0 ? cells.length : i + 1
    const id = cellUid()
    const next = [...cells]
    next.splice(at, 0, { id, type: 'sql', src })
    onChangeCells(next)
    setSelId(id)
  }
  const removeCell = (id: string) => {
    const i = cells.findIndex((c) => c.id === id)
    if (i < 0) return
    deletedRef.current = { cell: cells[i], at: i }
    const next = cells.filter((c) => c.id !== id)
    onChangeCells(next)
    const neighbor = next[Math.min(i, next.length - 1)]
    setSelId(neighbor?.id ?? null)
    setEditing(false)
    requestAnimationFrame(() => bodyRef.current?.focus())
  }
  const moveCell = (id: string, dir: -1 | 1) => {
    const i = cells.findIndex((c) => c.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= cells.length) return
    const next = [...cells]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChangeCells(next)
  }
  const duplicateCell = (id: string) => {
    const i = cells.findIndex((c) => c.id === id)
    if (i < 0) return
    const next = [...cells]
    next.splice(i + 1, 0, { id: cellUid(), type: cells[i].type, src: cells[i].src })
    onChangeCells(next)
  }
  const setType = (id: string, type: 'sql' | 'md') =>
    onChangeCells(cells.map((c) => (c.id === id ? { ...c, type } : c)))
  const undoDelete = () => {
    const d = deletedRef.current
    if (!d) return
    const next = [...cells]
    next.splice(Math.min(d.at, cells.length), 0, d.cell)
    deletedRef.current = null
    onChangeCells(next)
    setSelId(d.cell.id)
  }

  // ---- 선택/모드 ----
  const selectCommand = (id: string) => {
    setSelId(id)
    setEditing(false)
    requestAnimationFrame(() => bodyRef.current?.focus())
  }
  const enterEdit = (id?: string) => {
    const target = id ?? selId
    if (!target) return
    setSelId(target)
    setEditing(true)
    requestAnimationFrame(() => apiRef.current.get(target)?.focus())
  }
  const selectRel = (delta: -1 | 1) => {
    const i = cells.findIndex((c) => c.id === selId)
    const j = i < 0 ? 0 : Math.min(Math.max(i + delta, 0), cells.length - 1)
    if (cells[j]) selectCommand(cells[j].id)
  }
  const runSel = () => selId && apiRef.current.get(selId)?.run()
  const runSelNext = () => {
    if (!selId) return
    apiRef.current.get(selId)?.run()
    goNext()
  }
  // Shift+Enter — 실행 후 다음 셀 선택(없으면 생성), 커맨드 모드.
  const goNext = () => {
    const i = cells.findIndex((c) => c.id === selId)
    if (i < 0) return
    if (i + 1 < cells.length) {
      selectCommand(cells[i + 1].id)
    } else {
      const id = insertAt('sql', cells.length)
      selectCommand(id)
    }
  }
  // Alt+Enter — 실행 후 아래에 셀 삽입하고 편집 모드로.
  const runInsertBelow = (id: string) => {
    const i = cells.findIndex((c) => c.id === id)
    const at = i < 0 ? cells.length : i + 1
    const newId = insertAt('sql', at)
    setSelId(newId)
    setEditing(true)
    requestAnimationFrame(() => apiRef.current.get(newId)?.focus())
  }

  // ---- 커맨드 모드 키 (본문 컨테이너) ----
  // 문자 키는 한글 IME 에서 e.key 가 자모(ㅁ, ㅂ…)로 나오므로, 레이아웃·IME 무관한 e.code 로 본다.
  const onCommandKeys = (e: React.KeyboardEvent) => {
    if (editing) return // 편집 중엔 커맨드 키를 쓰지 않는다
    const k = e.key
    const code = e.code
    const mod = e.metaKey || e.ctrlKey
    if (k === 'Enter' && e.shiftKey) {
      e.preventDefault(); runSelNext()
    } else if (k === 'Enter' && e.altKey) {
      e.preventDefault(); if (selId) { runSel(); runInsertBelow(selId) }
    } else if (k === 'Enter' && mod) {
      e.preventDefault(); runSel()
    } else if (k === 'Enter') {
      e.preventDefault(); enterEdit()
    } else if (mod) {
      return // 다른 ⌘/Ctrl 조합은 브라우저에 넘긴다(복사 등)
    } else if (k === 'ArrowUp' || code === 'KeyK') {
      e.preventDefault(); selectRel(-1)
    } else if (k === 'ArrowDown' || code === 'KeyJ') {
      e.preventDefault(); selectRel(1)
    } else if (code === 'KeyA') {
      e.preventDefault()
      const i = cells.findIndex((c) => c.id === selId)
      selectCommand(insertAt('sql', Math.max(i, 0)))
    } else if (code === 'KeyB') {
      e.preventDefault()
      const i = cells.findIndex((c) => c.id === selId)
      selectCommand(insertAt('sql', i < 0 ? cells.length : i + 1))
    } else if (code === 'KeyD') {
      e.preventDefault()
      const now = Date.now()
      if (now - lastD.current < 600 && selId) {
        lastD.current = 0
        removeCell(selId)
      } else lastD.current = now
    } else if (code === 'KeyM') {
      e.preventDefault(); if (selId) setType(selId, 'md')
    } else if (code === 'KeyY') {
      e.preventDefault(); if (selId) setType(selId, 'sql')
    } else if (code === 'KeyZ') {
      e.preventDefault(); undoDelete()
    }
  }

  const cellCommonProps = (cell: Cell, i: number) => ({
    selected: cell.id === selId,
    editing,
    register,
    onSelectCommand: () => selectCommand(cell.id),
    onFocusEdit: () => {
      setSelId(cell.id)
      setEditing(true)
    },
    onRunNext: goNext,
    onRunInsert: () => runInsertBelow(cell.id),
    onToCommand: () => selectCommand(cell.id),
    onDelete: () => removeCell(cell.id),
    onMove: (d: -1 | 1) => moveCell(cell.id, d),
    onDuplicate: () => duplicateCell(cell.id),
    onAddBelow: () => selectCommand(insertAt('sql', i + 1)),
  })

  return (
    <div
      className="nb"
      // ⌘/Ctrl+S — 셀 안(CodeMirror)에서 눌러도 캡처 단계에서 먼저 가로채 저장한다.
      // 한글 IME 에서도 동작하도록 e.code(KeyS) 로 판별한다.
      onKeyDownCapture={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
          e.preventDefault()
          e.stopPropagation()
          onSave?.()
        }
      }}
    >
      <div className="nb-toolbar">
        {toolbarLeft}
        <div className="nb-toolbar-spacer" />
        <button className="btn sm" onClick={() => selectCommand(insertAt('sql', cells.length))} title="SQL 셀 추가">
          <Icon.plus />
          SQL 셀
        </button>
        <button className="btn sm" onClick={() => selectCommand(insertAt('md', cells.length))} title="메모 셀 추가">
          <Icon.note />
          메모 셀
        </button>
        <span className="nb-toolbar-div" />
        <button className="btn sm" onClick={() => cells.filter((c) => c.type === 'sql').forEach((c) => apiRef.current.get(c.id)?.run())} title="모든 SQL 셀 실행">
          <Icon.play />
          전체 실행
        </button>
        <button className="btn sm" onClick={resetSession} title="세션 초기화 — 실행 번호와 모든 셀 출력을 지웁니다">
          <Icon.refresh />
          세션 초기화
        </button>
        {onSave && (
          <button className="btn sm" onClick={onSave} title="저장 (⌘/Ctrl+S) — 셀을 하나의 쿼리로 저장">
            <Icon.save />
            저장
          </button>
        )}
        <span className="nb-help" title="Shift+Enter 실행·다음 · ⌘/Ctrl+Enter 실행 · Alt+Enter 실행·삽입 · Esc 커맨드 · Enter 편집 · A/B 위·아래 추가 · DD 삭제 · M/Y 메모·코드 · Z 되돌리기">
          단축키 ⓘ
        </span>
        {viewToggle}
      </div>
      <div className="nb-body" ref={bodyRef} tabIndex={0} onKeyDown={onCommandKeys}>
        {cells.length === 0 && (
          <div className="nb-empty-hint">셀이 없습니다. 아래에서 SQL 또는 메모 셀을 추가하세요.</div>
        )}
        {cells.map((cell, i) =>
          cell.type === 'md' ? (
            <MdCell key={cell.id} cell={cell} onChange={(src) => setCell(cell.id, src)} {...cellCommonProps(cell, i)} />
          ) : (
            <SqlCell
              key={cell.id}
              cell={cell}
              mode={mode}
              connectionId={connectionId}
              namespace={namespace}
              tables={tables}
              duckTables={duckTables}
              favorites={favorites}
              muted={muted}
              nextExecCount={nextExecCount}
              onChangeSrc={(src) => setCell(cell.id, src)}
              aiAvailable={aiConns.length > 0}
              aiConnId={aiConnId}
              aiOptions={aiOptions}
              onAiModelChange={setAiConnId}
              aiDbConnId={aiDbConnId}
              onInsertAiSqlBelow={(src) => insertSqlBelow(cell.id, src)}
              onAiEscalate={onAiEscalate}
              {...cellCommonProps(cell, i)}
            />
          ),
        )}
      </div>
    </div>
  )
}

