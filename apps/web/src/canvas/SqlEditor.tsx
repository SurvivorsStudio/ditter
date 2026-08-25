import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { sql, keywordCompletionSource, StandardSQL } from '@codemirror/lang-sql'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView, keymap } from '@codemirror/view'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  startCompletion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { Prec } from '@codemirror/state'
import { Icon } from '../components/icons'
import { SchemaTableTree, type TreeTable } from '../components/SchemaTableTree'
import { useRunQuery, useRunMongo, useRunDuck, useExplain } from '../api/hooks'
import { ExplainModal, type ExplainTarget } from './ExplainModal'
import { ApiError, api } from '../api/client'
import { VariableError, substitute as substituteVars } from './variables'
import type { DuckTable } from './duckRefs'
import type { Favorite } from '../api/favoritesStore'
import type { SqlStatement } from '../api/statements'
import { mutedRunMessage } from '../api/statements'
import { FavoritePickerModal } from '../components/Favorites'
import { AiInlinePrompt } from './AiInlinePrompt'

/** 자동완성에 쓰는 테이블 정보 — 트리용 TreeTable 에 컬럼을 얹은 것. */
export type CompletionTable = TreeTable & {
  columns?: { name: string; data_type?: string }[]
}

/** FROM/JOIN 절 뒤 별칭으로 오해하면 안 되는 SQL 키워드들. */
const _ALIAS_STOPWORDS = new Set([
  'where', 'join', 'inner', 'left', 'right', 'outer', 'full', 'cross', 'natural',
  'on', 'using', 'group', 'order', 'having', 'limit', 'offset', 'union', 'and',
  'or', 'as', 'select', 'set', 'values', 'into',
])

type FromRef = { table: string; alias?: string }

/** 에디터에 이미 쓰인 FROM/JOIN 절에서 참조 테이블(과 별칭)을 뽑아낸다. */
function parseFromRefs(doc: string): FromRef[] {
  const re = /\b(?:from|join)\s+(?:[a-z_]\w*\.)?([a-z_]\w*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi
  const refs: FromRef[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(doc))) {
    const table = m[1]
    const alias = m[2] && !_ALIAS_STOPWORDS.has(m[2].toLowerCase()) ? m[2] : undefined
    refs.push({ table, alias })
  }
  return refs
}

/** 테이블/컬럼 목록 기반 SQL 자동완성 소스.
 *  - `t_s10_` 처럼 이름을 치면 매칭 테이블을 추천하고, 고르면 `schema.table` 로 자동 완성한다.
 *  - `sfbizsc.` 처럼 스키마 뒤에서는 그 스키마의 테이블을 추천한다.
 *  - `t.` 처럼 테이블/별칭 뒤에서는 그 테이블의 컬럼을 추천한다.
 *  - FROM 에 테이블이 선언돼 있으면 SELECT/WHERE 등에서 그 테이블들의 컬럼을 바로 추천한다.
 */
/** 즐겨찾기 불러오기 자동완성 — 편집기에서 `/loadQuery` 를 치면 등록된 즐겨찾기를 띄운다.
 *
 *  - `/loadQuery()` (또는 `/loadQuery` 만) → 전체 목록을 팝업으로.
 *  - `/loadQuery.이름` → 이름으로 걸러서.
 *  선택하면 `/loadQuery...` 트리거 텍스트가 그 자리에서 즐겨찾기 SQL 로 바뀐다(커서 위치 삽입).
 *  favs 를 함수로 받는 이유는 최신 목록을 매번 읽기 위해서다(에디터 재구성 없이).
 */
/** 편집기 슬래시 명령. 괄호를 쓰지 않는다(자동완성 괄호와 충돌하던 문제 회피).
 *  - loadQuery: `/loadQuery.` 를 넣고 인라인 즐겨찾기 드롭다운을 띄운다(이름으로 바로).
 *  - loadQueryList: 큰 모달 피커를 연다(전체 목록 + SQL 미리보기). */
const SLASH_COMMANDS: { name: string; desc: string; kind: 'inline' | 'modal' | 'ai' }[] = [
  { name: 'loadQuery', desc: '즐겨찾기 바로 불러오기 (이름)', kind: 'inline' },
  { name: 'loadQueryList', desc: '즐겨찾기 목록 팝업', kind: 'modal' },
  { name: 'aiQuery', desc: 'AI 로 SQL 생성', kind: 'ai' },
]

/** 인라인 자동완성 — `/` 명령 목록과 `/loadQuery.이름` 직접 필터를 담당한다.
 *  `/loadQueryList` 는 여기서 모달을 연다. openModal 로 큰 피커를 띄운다. */
function makeLoadQueryCompletion(
  getFavs: () => Favorite[],
  openModal: (range: { from: number; to: number }) => void,
  /** AI 명령 실행기(range → 프롬프트). 없으면(mongo·연합조회) `/aiQuery` 를 목록에서 숨긴다. */
  getOpenAi: () => ((range: { from: number; to: number }) => void) | undefined,
): CompletionSource {
  return (ctx) => {
    // 즐겨찾기 직접 필터: '/loadQuery.<이름조각>' — 인라인 드롭다운으로 바로 고른다. (대소문자 무시)
    const favMatch = ctx.matchBefore(/\/loadquery\.[^\s()]*/i)
    if (!favMatch) {
      // 명령 단계: '/', '/l', … (아직 '.' 없음) → 슬래시 명령 목록.
      const cmd = ctx.matchBefore(/\/[a-zA-Z]*/)
      if (!cmd || !/^\/[a-zA-Z]*$/.test(cmd.text)) return null
      // 나눗셈(a/b)·경로 같은 문맥에선 뜨지 않게 — '/' 앞이 시작이거나 공백일 때만.
      const prev = cmd.from > 0 ? ctx.state.sliceDoc(cmd.from - 1, cmd.from) : ''
      if (prev && !/\s/.test(prev)) return null
      const frag = cmd.text.slice(1).toLowerCase()
      const options = SLASH_COMMANDS.filter(
        (c) => (c.kind !== 'ai' || getOpenAi()) && c.name.toLowerCase().startsWith(frag),
      ).map((c) => ({
        label: '/' + c.name,
        detail: '명령',
        type: 'keyword',
        info: c.desc,
        apply: (view: EditorView) => {
          if (c.kind === 'modal' || c.kind === 'ai') {
            // 명령 텍스트는 지우고 그 자리에 결과(즐겨찾기 SQL / AI 생성 SQL)를 넣을 지점을 넘긴다.
            view.dispatch({ changes: { from: cmd.from, to: ctx.pos, insert: '' }, selection: { anchor: cmd.from } })
            closeCompletion(view)
            // 열기를 다음 틱으로 미룬다 — 확정한 Enter 가 갓 열린 팝업의 선택까지
            // 이어져 첫 항목이 자동 선택되는 경쟁 상태를 막는다.
            const open = c.kind === 'ai' ? getOpenAi() : openModal
            if (open) setTimeout(() => open({ from: cmd.from, to: cmd.from }), 0)
          } else {
            // '/loadQuery.' 로 만들어 인라인 즐겨찾기 드롭다운을 잇는다.
            const insert = '/loadQuery.'
            view.dispatch({ changes: { from: cmd.from, to: ctx.pos, insert }, selection: { anchor: cmd.from + insert.length } })
            startCompletion(view)
          }
        },
      }))
      return options.length ? { from: cmd.from, options } : null
    }
    const triggerFrom = favMatch.from // '/loadQuery' 시작 — 선택 시 여기부터 통째로 교체한다.
    const anchor = favMatch.from + favMatch.text.indexOf('.') + 1 // '.' 뒤(이름 조각)부터
    const frag = favMatch.text.slice(favMatch.text.indexOf('.') + 1).toLowerCase()
    const favs = getFavs()
    if (favs.length === 0) {
      return { from: anchor, options: [{ label: '등록된 즐겨찾기가 없습니다', type: 'text', apply: () => {} }], filter: false }
    }
    // 이름 조각으로 직접 거른다(대소문자·부분일치). 없으면 안내 항목만 — 이 문맥에선 즐겨찾기만 보인다.
    const matched = favs.filter((f) => !frag || f.name.toLowerCase().includes(frag))
    if (matched.length === 0) {
      return { from: anchor, options: [{ label: '일치하는 즐겨찾기 없음', type: 'text', apply: () => {} }], filter: false }
    }
    const options = matched.map((f) => ({
      label: f.name,
      detail: '즐겨찾기',
      type: 'text',
      // '/loadQuery.이름' 트리거 전체를 SQL 로 바꾼다(커서 위치 삽입).
      apply: (view: EditorView, _c: unknown, _from: number, to: number) =>
        view.dispatch({
          changes: { from: triggerFrom, to, insert: f.sql },
          selection: { anchor: triggerFrom + f.sql.length },
        }),
      info: () => {
        const el = document.createElement('div')
        el.className = 'cm-loadquery-info'
        el.textContent = f.sql
        return el
      },
    }))
    return { from: anchor, options, filter: false }
  }
}

/** 두 자동완성 결과를 합친다 — 같은 시작점(단어 시작)이면 옵션을 이어 붙인다.
 *  SQL 은 키워드·테이블 소스를 함께 쓰므로 override 로 묶을 때 이 병합이 필요하다. */
function mergeCompletions(
  a: CompletionResult | null,
  b: CompletionResult | null,
): CompletionResult | null {
  if (!a) return b
  if (!b) return a
  if (a.from === b.from) {
    return { from: a.from, options: [...a.options, ...b.options], validFor: a.validFor ?? b.validFor }
  }
  // 시작점이 다르면 커서에 더 가까운(더 큰 from) 쪽을 쓴다.
  return a.from >= b.from ? a : b
}

export function makeTableCompletion(tables: CompletionTable[]): CompletionSource {
  const tableOptions = tables.map((t) => {
    const qualified = t.namespace ? `${t.namespace}.${t.name}` : t.name
    return { label: t.name, detail: t.namespace ?? '테이블', type: 'class', apply: qualified }
  })
  const colsByTable = new Map<string, NonNullable<CompletionTable['columns']>>()
  const tablesBySchema = new Map<string, CompletionTable[]>()
  for (const t of tables) {
    if (t.columns?.length) colsByTable.set(t.name.toLowerCase(), t.columns)
    const ns = (t.namespace ?? '').toLowerCase()
    if (ns) {
      if (!tablesBySchema.has(ns)) tablesBySchema.set(ns, [])
      tablesBySchema.get(ns)!.push(t)
    }
  }

  return (ctx) => {
    const doc = ctx.state.sliceDoc()

    // `이름.부분` — 테이블/별칭 뒤 컬럼, 또는 스키마 뒤 테이블
    const dotted = ctx.matchBefore(/(\w+)\.(\w*)$/)
    if (dotted) {
      const m = /(\w+)\.(\w*)$/.exec(dotted.text)!
      const head = m[1].toLowerCase()
      const from = dotted.from + m[1].length + 1 // 점 뒤부터 교체
      // 별칭 → 테이블 매핑 (FROM sfbizsc.t x → x.col)
      const aliasTable = parseFromRefs(doc).find((r) => r.alias?.toLowerCase() === head)?.table
      const cols = colsByTable.get(head) ?? (aliasTable ? colsByTable.get(aliasTable.toLowerCase()) : undefined)
      if (cols?.length) {
        return {
          from,
          options: cols.map((c) => ({ label: c.name, detail: c.data_type, type: 'property' })),
          validFor: /^\w*$/,
        }
      }
      const inSchema = tablesBySchema.get(head)
      if (inSchema?.length) {
        return {
          from,
          options: inSchema.map((t) => ({ label: t.name, type: 'class' })),
          validFor: /^\w*$/,
        }
      }
      return null
    }

    const word = ctx.matchBefore(/\w+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    const before = ctx.state.sliceDoc(0, word.from)

    // FROM/JOIN 바로 뒤(테이블 자리) — 테이블 추천
    const inTablePos = /\b(?:from|join|into|update)\s+(?:[\w."]+\s*,\s*)*$/i.test(before)
    if (inTablePos) {
      return { from: word.from, options: tableOptions, validFor: /^\w*$/ }
    }

    // 그 외(SELECT/WHERE/ON/GROUP BY…) — 선언된 테이블의 컬럼을 추천
    const refs = parseFromRefs(doc)
    if (refs.length) {
      const multi = refs.length > 1
      const seen = new Set<string>()
      const columns: { label: string; detail?: string; type: string; boost: number }[] = []
      for (const ref of refs) {
        const cols = colsByTable.get(ref.table.toLowerCase())
        if (!cols) continue
        const label = ref.alias ?? ref.table
        for (const c of cols) {
          const key = c.name.toLowerCase() + (multi ? '@' + label.toLowerCase() : '')
          if (seen.has(key)) continue
          seen.add(key)
          columns.push({
            label: c.name,
            detail: multi ? `${c.data_type ?? ''} · ${label}`.trim() : c.data_type,
            type: 'property',
            boost: 1,
          })
        }
      }
      if (columns.length) return { from: word.from, options: columns, validFor: /^\w*$/ }
    }
    return null
  }
}

/** 연합 조회(DuckDB) 자동완성 소스.
 *
 *  일반 SQL 자동완성과 갈라놓은 이유는 **이름이 세 토막 이상이라서**다. `aaa` 를 치면
 *  `mysql_wms.wms.aaa` 를 통째로 넣어야 하고, 같은 이름의 테이블이 연결마다 있을 수
 *  있어 어느 연결인지를 항목에 함께 보여 줘야 고를 수 있다.
 *
 *  - FROM/JOIN 자리: 정규화된 이름 전체를 넣는다 (항목에는 연결·DB 를 부제로).
 *  - `별칭.` 뒤: FROM 에 선언된 그 테이블의 컬럼.
 *  - 그 외: FROM 에 declared 된 테이블들의 컬럼.
 */
function makeDuckCompletion(tables: DuckTable[]): CompletionSource {
  const tableOptions = tables.map((t) => ({
    label: t.name,
    detail: t.namespace
      ? `${t.connectionName} · ${t.database}.${t.namespace}`
      : `${t.connectionName} · ${t.database}`,
    type: 'class',
    apply: t.ref,
  }))
  const byRef = new Map(tables.map((t) => [t.ref.toLowerCase(), t]))
  const byName = new Map<string, DuckTable>()
  for (const t of tables) if (!byName.has(t.name.toLowerCase())) byName.set(t.name.toLowerCase(), t)

  /** FROM/JOIN 에 쓰인 정규화 이름과 별칭. 인용 이름(`"운영 MySQL"`)까지 받는다. */
  const refsInDoc = (doc: string): { table: DuckTable; alias?: string }[] => {
    const part = '(?:"(?:[^"]|"")*"|[^\\W\\d][\\w$]*)'
    const re = new RegExp(
      `\\b(?:from|join)\\s+(${part}(?:\\s*\\.\\s*${part})+)(?:\\s+(?:as\\s+)?([A-Za-z_]\\w*))?`,
      'gi',
    )
    const out: { table: DuckTable; alias?: string }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(doc))) {
      const table = byRef.get(m[1].replace(/\s*\.\s*/g, '.').toLowerCase())
      if (!table) continue
      const alias = m[2] && !_ALIAS_STOPWORDS.has(m[2].toLowerCase()) ? m[2] : undefined
      out.push({ table, alias })
    }
    return out
  }

  return (ctx) => {
    const doc = ctx.state.sliceDoc()
    const dotted = ctx.matchBefore(/(\w+)\.(\w*)$/)
    if (dotted) {
      const m = /(\w+)\.(\w*)$/.exec(dotted.text)!
      const head = m[1].toLowerCase()
      const from = dotted.from + m[1].length + 1
      const hit =
        refsInDoc(doc).find((r) => r.alias?.toLowerCase() === head)?.table ?? byName.get(head)
      // 정규화 이름 중간의 점(`mysql_wms.` 다음)에서는 아무것도 제안하지 않는다 —
      // 데이터베이스 이름을 추측해 넣으면 실행할 때까지 틀린 줄 모른다.
      if (!hit?.columns?.length) return null
      return {
        from,
        options: hit.columns.map((c) => ({ label: c.name, detail: c.data_type, type: 'property' })),
        validFor: /^\w*$/,
      }
    }

    const word = ctx.matchBefore(/\w+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    const before = ctx.state.sliceDoc(0, word.from)
    if (/\b(?:from|join)\s+(?:[\w."]+\s*,\s*)*$/i.test(before)) {
      return { from: word.from, options: tableOptions, validFor: /^\w*$/ }
    }

    const refs = refsInDoc(doc)
    if (refs.length) {
      const multi = refs.length > 1
      const seen = new Set<string>()
      const columns: { label: string; detail?: string; type: string; boost: number }[] = []
      for (const ref of refs) {
        const label = ref.alias ?? ref.table.name
        for (const c of ref.table.columns ?? []) {
          const key = c.name.toLowerCase() + (multi ? '@' + label.toLowerCase() : '')
          if (seen.has(key)) continue
          seen.add(key)
          columns.push({
            label: c.name,
            detail: multi ? `${c.data_type ?? ''} · ${label}`.trim() : c.data_type,
            type: 'property',
            boost: 1,
          })
        }
      }
      if (columns.length) return { from: word.from, options: columns, validFor: /^\w*$/ }
    }
    return null
  }
}

/** MongoDB 셸 자동완성 소스.
 *  - 명령 시작에서 컬렉션 이름 추천.
 *  - `컬렉션.` 뒤에서 find/aggregate (find 뒤 체이닝이면 sort/limit/skip).
 *  - find({...})·aggregate([...]) 인자 안에서는 그 컬렉션의 (샘플링된) 필드 추천.
 */
function makeMongoCompletion(collections: CompletionTable[]): CompletionSource {
  const names = collections.map((c) => c.name)
  const fieldsByColl = new Map<string, NonNullable<CompletionTable['columns']>>()
  for (const c of collections) if (c.columns?.length) fieldsByColl.set(c.name, c.columns)

  return (ctx) => {
    const doc = ctx.state.sliceDoc(0, ctx.pos)

    // `이름.부분` — 컬렉션 뒤 메서드, 또는 find(...) 뒤 체이닝 modifier
    const dotted = ctx.matchBefore(/([A-Za-z_]\w*)\s*\.\s*(\w*)$/)
    if (dotted) {
      const m = /([A-Za-z_]\w*)\s*\.\s*(\w*)$/.exec(dotted.text)!
      const head = m[1]
      const from = ctx.pos - m[2].length
      if (names.includes(head)) {
        return {
          from,
          options: [
            { label: 'find', type: 'method', detail: '{ 필터 }', apply: 'find({  })' },
            { label: 'aggregate', type: 'method', detail: '[ 파이프라인 ]', apply: 'aggregate([  ])' },
          ],
          validFor: /^\w*$/,
        }
      }
      // find/aggregate 뒤 체이닝
      return {
        from,
        options: ['sort', 'limit', 'skip'].map((f) => ({ label: f, type: 'method', apply: `${f}()` })),
        validFor: /^\w*$/,
      }
    }

    const word = ctx.matchBefore(/[\w$]+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null

    // 인자 괄호 안(필드 자리)인지 — 여는 괄호가 닫는 괄호보다 많으면 안쪽
    const opens = (doc.match(/[{[(]/g) ?? []).length
    const closes = (doc.match(/[}\])]/g) ?? []).length
    const inside = opens > closes
    // 명령이 참조하는 컬렉션 (첫 `이름.find|aggregate`)
    const ref = /([A-Za-z_]\w*)\s*\.\s*(?:find|aggregate)\b/.exec(doc)?.[1]

    if (inside && ref && fieldsByColl.has(ref)) {
      const cols = fieldsByColl.get(ref)!
      return {
        from: word.from,
        options: cols.map((c) => ({ label: c.name, detail: c.data_type, type: 'property' })),
        validFor: /^[\w$]*$/,
      }
    }
    if (!inside) {
      return {
        from: word.from,
        options: names.map((n) => ({ label: n, type: 'class', detail: '컬렉션' })),
        validFor: /^\w*$/,
      }
    }
    return null
  }
}

/** SQL 을 `;` 기준으로 문장 범위로 나눈다 — 문자열('…','')·식별자("…")·주석(--, /​* *​/) 안의 `;` 는 건너뛴다.
 *  각 범위는 `;` 를 제외한 [from, to) 다. 커서 위치의 단일 문장을 실행할 때 쓴다. */
export function sqlStatementRanges(sql: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  const n = sql.length
  let start = 0
  let i = 0
  while (i < n) {
    const ch = sql[i]
    if (ch === "'") {
      i++
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue } // '' 이스케이프
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '"') {
      i++
      while (i < n && sql[i] !== '"') i++
      i++
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    // PL/pgSQL 달러 인용 ($tag$ … $tag$) — 함수·프로시저 본문은 그 안에 세미콜론이 많다.
    // 이 블록을 통째로 건너뛰지 않으면 CREATE FUNCTION/PROCEDURE 가 세미콜론마다 쪼개진다.
    if (ch === '$') {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++
      if (sql[j] === '$') {
        const delim = sql.slice(i, j + 1) // "$$" 또는 "$procedure$" 등
        const end = sql.indexOf(delim, j + 1)
        i = end < 0 ? n : end + delim.length
        continue
      }
    }
    if (ch === ';') {
      ranges.push({ from: start, to: i })
      start = i + 1
      i++
      continue
    }
    i++
  }
  if (start < n) ranges.push({ from: start, to: n })
  return ranges
}

/** CodeMirror 기반 SQL 에디터 — 라인 번호·SQL 문법 하이라이트·키워드/테이블 자동완성. */
export function SqlEditor({
  value,
  onChange,
  height,
  cmRef,
  completion,
  duckCompletion,
  favorites,
  onOpenLoadModal,
  onAiCommand,
  onRun,
  language = 'sql',
  placeholder = 'SELECT * FROM schema.table WHERE ...',
}: {
  value: string
  onChange: (value: string) => void
  height: string
  cmRef?: React.Ref<ReactCodeMirrorRef>
  /** ⌘/Ctrl+Enter — 에디터 안에서 눌렀을 때 실행. CodeMirror 키맵에서 처리해
   *  줄바꿈이 함께 들어가지 않도록 한다(래퍼 div 의 keydown 은 이미 늦다). */
  onRun?: () => void
  completion?: CompletionTable[]
  /** 연합 조회(DuckDB) 자동완성 — 주어지면 `completion` 대신 이쪽을 쓴다.
   *  한 편집기에 여러 연결의 테이블이 섞여 이름만으로는 구분이 안 되기 때문이다. */
  duckCompletion?: DuckTable[]
  /** 즐겨찾기 목록 — `/loadQuery` 자동완성 소스가 참조한다. */
  favorites?: Favorite[]
  /** `/loadQuery()` (빈 괄호)를 감지하면 큰 모달 피커를 연다. 넘긴 범위를 선택 SQL 로 교체한다. */
  onOpenLoadModal?: (range: { from: number; to: number }) => void
  /** `/aiQuery` 를 감지하면 AI 인라인 프롬프트를 연다. 넘긴 범위에 생성 SQL 이 들어간다. */
  onAiCommand?: (range: { from: number; to: number }) => void
  language?: 'sql' | 'json' | 'javascript'
  placeholder?: string
}) {
  // 즐겨찾기·모달 콜백은 ref 로 읽어 에디터를 재구성하지 않고도 최신 값을 쓴다.
  const favRef = useRef<Favorite[]>(favorites ?? [])
  favRef.current = favorites ?? []
  const openModalRef = useRef(onOpenLoadModal)
  openModalRef.current = onOpenLoadModal
  const onAiRef = useRef(onAiCommand)
  onAiRef.current = onAiCommand
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const extensions = useMemo(() => {
    if (language === 'json') return [json()]
    // 자동완성 팝업이 열려 있으면 Enter/Tab 으로 선택 확정(없으면 그냥 통과 → 줄바꿈/들여쓰기).
    const acceptKeys = Prec.highest(
      keymap.of([
        // ⌘/Ctrl+Enter — 실행. true 를 돌려 기본 줄바꿈 삽입을 막는다(래퍼 div 로
        // 이벤트가 올라가기 전에 CodeMirror 안에서 먼저 처리해야 줄바꿈이 안 남는다).
        {
          key: 'Mod-Enter',
          run: () => {
            onRunRef.current?.()
            return true
          },
        },
        { key: 'Enter', run: acceptCompletion },
        { key: 'Tab', run: acceptCompletion },
      ]),
    )
    // 인라인 자동완성(작은 드롭다운)을 확실히 여는 트리거 — `/` 명령과 `/loadQuery.이름`만.
    // `/loadQuery()` 는 여기 포함하지 않는다(큰 모달로 따로 연다).
    const slashTrigger = /(?:^|[\s([{,;])(\/[a-zA-Z]*|\/loadquery\.[^\s()]*)$/i
    const autoTrigger = EditorView.updateListener.of((u) => {
      if (!u.docChanged && !u.selectionSet) return
      if (completionStatus(u.state) === 'active') return
      const pos = u.state.selection.main.head
      const before = u.state.sliceDoc(Math.max(0, pos - 60), pos)
      if (slashTrigger.test(before)) setTimeout(() => startCompletion(u.view), 0)
    })
    // `/loadQueryList` 를 (단어 경계까지) 다 치면 큰 모달 피커를 연다. 괄호를 안 쓰므로 안정적.
    // 명령 텍스트는 지우고, 그 자리에 즐겨찾기 SQL 을 넣을 지점으로 모달을 연다.
    const LIST_CMD = '/loadQueryList'
    const openModal = (range: { from: number; to: number }) => openModalRef.current?.(range)
    const modalTrigger = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      const pos = u.state.selection.main.head
      const before = u.state.sliceDoc(Math.max(0, pos - LIST_CMD.length), pos)
      // 딱 '/loadQueryList' 로 끝나고(그 앞이 시작/공백), 커서 뒤가 글자가 아니어야 한다. (대소문자 무시)
      const after = u.state.sliceDoc(pos, Math.min(u.state.doc.length, pos + 1))
      if (before.toLowerCase().endsWith(LIST_CMD.toLowerCase()) && !/[a-zA-Z]/.test(after)) {
        const boundaryOk = before.length === LIST_CMD.length || /\s/.test(before[before.length - LIST_CMD.length - 1] ?? ' ')
        if (!boundaryOk) return
        const from = pos - LIST_CMD.length
        setTimeout(() => {
          const v = u.view
          v.dispatch({ changes: { from, to: pos, insert: '' }, selection: { anchor: from } })
          closeCompletion(v)
          openModal({ from, to: from })
        }, 0)
      }
    })
    // `/aiQuery` 를 다 치면 AI 인라인 프롬프트를 연다 (같은 방식). 명령을 지우고 그 자리를 넘긴다.
    const AI_CMD = '/aiQuery'
    const openAi = (range: { from: number; to: number }) => onAiRef.current?.(range)
    const aiTrigger = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      const pos = u.state.selection.main.head
      const before = u.state.sliceDoc(Math.max(0, pos - AI_CMD.length), pos)
      const after = u.state.sliceDoc(pos, Math.min(u.state.doc.length, pos + 1))
      if (before.toLowerCase().endsWith(AI_CMD.toLowerCase()) && !/[a-zA-Z]/.test(after)) {
        const boundaryOk =
          before.length === AI_CMD.length || /\s/.test(before[before.length - AI_CMD.length - 1] ?? ' ')
        if (!boundaryOk) return
        const from = pos - AI_CMD.length
        setTimeout(() => {
          const v = u.view
          v.dispatch({ changes: { from, to: pos, insert: '' }, selection: { anchor: from } })
          closeCompletion(v)
          openAi({ from, to: from })
        }, 0)
      }
    })
    // 슬래시(`/`) 문맥이면 즐겨찾기/명령만 배타적으로 보이고, 아니면 언어 자동완성으로 넘긴다.
    // override 로 언어의 기본 소스(SQL 키워드 등)를 대체해, 슬래시 문맥에 키워드가 섞이지 않게 한다.
    const loadQuery = makeLoadQueryCompletion(() => favRef.current, openModal, () => onAiRef.current)
    const asResult = (r: ReturnType<CompletionSource>): CompletionResult | null =>
      r && !(r instanceof Promise) ? r : null
    if (language === 'javascript') {
      const base = javascript()
      const mongoSrc = completion && completion.length > 0 ? makeMongoCompletion(completion) : null
      const src: CompletionSource = (ctx) => loadQuery(ctx) ?? (mongoSrc ? mongoSrc(ctx) : null)
      return [acceptKeys, autoTrigger, modalTrigger, aiTrigger, base, autocompletion({ override: [src] })]
    }
    const base = sql()
    const kwSrc = keywordCompletionSource(StandardSQL, true) // SQL 키워드(대소문자 무시)
    // 연합 조회(DuckDB) 자동완성이 있으면 그걸, 아니면 일반 테이블 자동완성을 테이블 소스로 쓴다.
    const tableSrc = duckCompletion?.length
      ? makeDuckCompletion(duckCompletion)
      : completion && completion.length > 0
        ? makeTableCompletion(completion)
        : null
    const src: CompletionSource = (ctx) => {
      const slash = loadQuery(ctx)
      if (slash) return slash // 슬래시 문맥 → 즐겨찾기/명령만
      return mergeCompletions(asResult(kwSrc(ctx)), tableSrc ? asResult(tableSrc(ctx)) : null)
    }
    return [acceptKeys, autoTrigger, modalTrigger, aiTrigger, base, autocompletion({ override: [src] })]
  }, [completion, duckCompletion, language])

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      height={height}
      theme="light"
      extensions={extensions}
      onChange={onChange}
      placeholder={placeholder}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: false,
        autocompletion: true,
        highlightActiveLineGutter: true,
        bracketMatching: true,
      }}
    />
  )
}

/** 편집기 왼쪽에 띄우는 자리표시자 하나 (트리거 변수 또는 노드 결과 참조). */
export type EditorVariable = {
  /** 치환에 쓰는 **키**. 트리거 변수는 `since`, 노드 참조는 `집계.max_dt` 다. */
  name: string
  type: string
  /** 마지막 실행에서 실제로 들어온 값. 아직 돌린 적이 없으면 null */
  value: string | number | boolean | null
  /** value 가 실측값이 아니라 선언된 예시일 때 true */
  isExample: boolean
  /** 화면에 보이고 커서에 꽂히는 표기. 없으면 `$이름`. */
  insert?: string
  /** 어디서 온 값인가 — 패널을 두 묶음으로 나눠 보여준다 */
  source?: 'trigger' | 'node'
}

/** 이 변수를 쓰려면 편집기에 무엇을 적어야 하는가 */
function insertText(v: EditorVariable): string {
  return v.insert ?? `$${v.name}`
}

/** API 트리거가 넘겨주는 값 목록.
 *
 * 쿼리를 쓰는 자리에서 "지금 무슨 값이 들어오는가"를 볼 수 없으면 `$since` 를 넣어도 그게
 * 무엇이 될지 상상해야 한다. 클릭하면 커서 위치에 삽입된다 — 이름을 손으로 옮겨 적다
 * 오타를 내면 저장 시점에야 걸린다.
 */
function VariablePanel({
  variables,
  onInsert,
}: {
  variables: EditorVariable[]
  onInsert: (text: string) => void
}) {
  const trigger = variables.filter((v) => v.source !== 'node')
  const fromNodes = variables.filter((v) => v.source === 'node')

  const row = (v: EditorVariable) => {
    const text = insertText(v)
    return (
      <button
        className="sql-var-row"
        key={text}
        onClick={() => onInsert(text)}
        title={`${text} (${v.type})${v.isExample ? ' · 아직 실행 전이라 예시 값입니다' : ''}`}
      >
        <span className="svr-name">{text}</span>
        <span className={`svr-val ${v.value === null ? 'empty' : ''} ${v.isExample ? 'example' : ''}`}>
          {v.value === null ? '값 없음' : String(v.value)}
        </span>
      </button>
    )
  }

  return (
    <div className="sql-var-panel">
      {trigger.length > 0 && (
        <>
          <div className="sql-modal-tree-hd">API 트리거 변수 — 클릭하면 삽입됩니다</div>
          {trigger.map(row)}
        </>
      )}
      {fromNodes.length > 0 && (
        <>
          <div className="sql-modal-tree-hd">노드 결과 — 그 노드 첫 행의 값</div>
          {fromNodes.map(row)}
        </>
      )}
      <div className="sql-var-note">
        따옴표는 직접 넣으세요 — <code>WHERE dt &gt;= &apos;$since&apos;</code>. 값에 따옴표·
        세미콜론이 있으면 실행이 거부됩니다.
      </div>
    </div>
  )
}

/** 셀 값을 표에 표시할 문자열로. null 은 NULL, 객체(Mongo 중첩 문서 등)는 JSON 으로.
 *  아주 긴 값은 잘라 DOM 이 무거워지지 않게 한다. */
function cell(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', isNull: true }
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (s.length > 400) s = `${s.slice(0, 400)}…`
  return { text: s, isNull: false }
}

/** 텍스트에서 검색어와 일치하는 부분을 <mark> 로 강조한 React 노드를 돌려준다. */
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text
  const lower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  let idx = lower.indexOf(q)
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(
      <mark className="sql-hit" key={idx}>
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
    idx = lower.indexOf(q, i)
  }
  parts.push(text.slice(i))
  return parts
}

/** 결과 JSON 뷰 — 읽기 전용 CodeMirror(JSON) 로 색상·라인번호·접기·검색(⌘/Ctrl+F)을 준다.
 *  큰 문서도 뷰포트 가상 렌더라 버틴다. 바닥 근처로 스크롤하면 onNearBottom 으로 다음 페이지. */
function JsonView({
  text,
  onNearBottom,
  cmRef,
}: {
  text: string
  onNearBottom?: () => void
  cmRef?: React.Ref<ReactCodeMirrorRef>
}) {
  const cb = useRef(onNearBottom)
  cb.current = onNearBottom
  const extensions = useMemo(
    () => [
      json(),
      EditorView.lineWrapping,
      search({ top: true }),
      keymap.of(searchKeymap),
      EditorView.domEventHandlers({
        scroll: (_e, view) => {
          const el = view.scrollDOM
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) cb.current?.()
          return false
        },
      }),
    ],
    [],
  )
  return (
    <CodeMirror
      ref={cmRef}
      value={text}
      theme="light"
      height="100%"
      editable={false}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        bracketMatching: true,
      }}
    />
  )
}

/** SQL 워크벤치 — 왼쪽 스키마→테이블 트리 + 오른쪽 에디터/실행/결과 그리드(무한 스크롤).
 *  커스텀 SQL 팝업(SqlModal)과 독립 SQL 편집기 페이지가 함께 쓴다.
 *  트리에서 테이블을 클릭하면 커서 위치에 ``schema.table`` 을 끼워 넣고,
 *  실행(⌘/Ctrl+↵)하면 소스에서 SELECT 를 돌려 결과를 아래 표에 보여준다. */
export function SqlWorkbench({
  value,
  onChange,
  connectionId,
  tables = [],
  loading = false,
  hint,
  autoFocus = false,
  className = '',
  sidebar,
  mode = 'sql',
  duckTables = [],
  namespace,
  toolbarLeft,
  variables = [],
  bindInsert,
  onFocusEditor,
  floatingRun = false,
  onSave,
  favorites,
  onAddFavorite,
  viewToggle,
  muted = [],
}: {
  value: string
  onChange: (value: string) => void
  connectionId?: string
  tables?: CompletionTable[]
  /** 즐겨찾기 목록 — 에디터의 `/loadQuery` 자동완성으로 넘긴다. */
  favorites?: Favorite[]
  /** 우클릭 메뉴의 "즐겨찾기 저장" — 선택/현재 문장을 이 연결의 즐겨찾기로 저장한다. */
  onAddFavorite?: (name: string, sql: string, connId: string) => void
  loading?: boolean
  hint?: React.ReactNode
  autoFocus?: boolean
  className?: string
  /** 왼쪽 패널을 커스텀으로 대체. 커서 삽입 함수를 넘겨 준다 (기본 트리 대신 커넥션 내비게이터 등).
   *  ``false`` 면 왼쪽 패널을 아예 두지 않는다 (내비게이터가 바깥에 공용으로 있는 경우). */
  sidebar?: ((insertAtCursor: (text: string) => void) => React.ReactNode) | false
  /** 'sql' 이면 한 연결에서 SELECT, 'mongo' 면 ``컬렉션.find({...})``,
   *  'duck' 이면 여러 연결에 걸친 DuckDB 연합 조회 (연결을 고르지 않는다). */
  mode?: 'sql' | 'mongo' | 'duck'
  /** mode='duck' 의 자동완성 목록 — 모든 연합 가능 연결의 테이블을 정규화된 이름으로. */
  duckTables?: DuckTable[]
  namespace?: string | null
  /** 툴바 왼쪽 슬롯 (연결 선택 드롭다운 등). */
  toolbarLeft?: React.ReactNode
  /** API 트리거가 넘겨주는 `$변수` — 왼쪽 패널에 현재 값과 함께 띄운다. */
  variables?: EditorVariable[]
  /** 커서 삽입 함수를 바깥(페이지)에 등록 — 공용 내비게이터가 포커스된 에디터에 삽입할 때 쓴다. */
  bindInsert?: (fn: (text: string) => void) => void
  /** 이 에디터가 포커스(클릭)될 때 호출 — 여러 pane 중 어디가 활성인지 추적. */
  onFocusEditor?: () => void
  /** true 면 실행 버튼을 툴바 대신 에디터 하단에 아이콘(재생)만으로 띄운다. */
  floatingRun?: boolean
  /** 주어지면 툴바에 "저장" 버튼을 띄운다 — 현재 쿼리를 저장 대화상자로 넘긴다. */
  onSave?: () => void
  /** 툴바 오른쪽 슬롯 — 편집기↔노트북 전환 토글 등. */
  viewToggle?: React.ReactNode
  /** 사용자가 툴바 태그로 잠시 꺼 둔 명령 — 실행 전에 여기서 막는다.
   *  실수 방지용 장치이고, 진짜 가드는 연결의 허용 명령(서버)이다. */
  muted?: SqlStatement[]
}) {
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  // 아직 값이 없는 변수(`value === null`)는 넣지 않는다 — 그래야 치환이 조용히 'null' 을
  // 꽂는 대신 "값이 없습니다"로 끊긴다.
  /** 변수가 치환되어 실제로 나간 쿼리. 원문과 같으면 null (보여줄 게 없다). */
  const [ranWith, setRanWith] = useState<string | null>(null)
  const variableValues = useMemo(
    () =>
      Object.fromEntries(
        variables.filter((v) => v.value !== null).map((v) => [v.name, v.value] as const),
      ),
    [variables],
  )
  // 페이지네이션(loadMore)이 참조할 "실행된 요청" (정렬·필터 포함)
  const executed = useRef<{
    mode: 'sql' | 'mongo' | 'duck'
    query: string
    namespace?: string | null
    sortCol: string | null
    sortDir: 'asc' | 'desc'
    filters: { col: string; value: string }[]
  }>({ mode: 'sql', query: '', sortCol: null, sortDir: 'asc', filters: [] })
  const runQuery = useRunQuery()
  const runMongo = useRunMongo()
  const runDuck = useRunDuck()
  const explainMut = useExplain()
  const [explaining, setExplaining] = useState<false | 'plain' | 'analyze'>(false)
  const [explainResult, setExplainResult] = useState<ExplainTarget | null>(null)
  const isDuck = mode === 'duck'
  const pending =
    mode === 'mongo' ? runMongo.isPending : isDuck ? runDuck.isPending : runQuery.isPending
  // 연합 조회는 연결을 고르지 않는다 — 어느 연결을 쓸지는 SQL 안의 참조가 정한다.
  const ready = isDuck || Boolean(connectionId)
  // 실행 취소용 — 실행/추가로딩 요청마다 새 컨트롤러를 만들고, 취소 시 abort 한다.
  const abortRef = useRef<AbortController | null>(null)
  const [data, setData] = useState<{
    columns: string[]
    rows: Record<string, unknown>[]
    elapsedMs: number
    hasMore: boolean
    total: number | null
    /** 실행된 명령 (select·update…). 쓰기는 결과 표시가 다르다 — 행이 아니라 건수를 말한다. */
    statement: string
    /** 쓰기가 바꾼 행 수. SELECT 이거나 방언이 알려주지 않으면 null. */
    affected: number | null
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'json'>('table')
  // 전체 화면 — 편집 영역을 뷰포트 전체로 키운다 (Esc 로 해제)
  const [fullscreen, setFullscreen] = useState(false)
  // `/loadQuery()` 로 연 즐겨찾기 피커 모달. 교체할 트리거 범위를 담는다.
  const [loadModal, setLoadModal] = useState<{ from: number; to: number } | null>(null)
  // `/aiQuery` 로 열리는 AI 인라인 프롬프트 — 생성 SQL 을 이 범위에 꽂는다.
  const [aiPrompt, setAiPrompt] = useState<{ from: number; to: number } | null>(null)
  // 편집기 우클릭 컨텍스트 메뉴 (실행 / 즐겨찾기 저장) — 대상 SQL 과 화면 위치.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sql: string } | null>(null)
  // 즐겨찾기 저장 대화상자 (우클릭 → 즐겨찾기 저장). 대상 SQL 을 담는다.
  const [favSave, setFavSave] = useState<{ sql: string; name: string } | null>(null)
  // 실행 경과 시간(초) — 실행 중 라이브로 올라간다. 얼마나 걸리는지 보고 취소 판단.
  const [runSecs, setRunSecs] = useState(0)
  // 취소 알림 토스트 (잠깐 떴다 사라진다)
  const [cancelled, setCancelled] = useState(false)
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showCancelled = () => {
    setCancelled(true)
    if (cancelTimer.current) clearTimeout(cancelTimer.current)
    cancelTimer.current = setTimeout(() => setCancelled(false), 2500)
  }
  // 컬럼 정렬(전체 데이터셋 기준)·컬럼 필터 — 바뀌면 offset 0 부터 재조회한다.
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null)
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const [showFilters, setShowFilters] = useState(false)
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 컬럼 폭 — 사용자가 헤더 경계를 드래그해 넓히면 그 컬럼만 잘리지 않고 다 보인다.
  // (기본은 지정 없음 → CSS max-width 로 잘림. 지정하면 그 폭으로 고정.)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizing = useRef<{ col: string; startX: number; startW: number } | null>(null)
  const startColResize = (e: React.PointerEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).closest('th')
    const startW = th ? Math.round(th.getBoundingClientRect().width) : (colWidths[col] ?? 160)
    resizing.current = { col, startX: e.clientX, startW }
    const onMove = (ev: PointerEvent) => {
      const r = resizing.current
      if (!r) return
      const w = Math.max(56, Math.round(r.startW + (ev.clientX - r.startX)))
      setColWidths((prev) => ({ ...prev, [r.col]: w }))
    }
    const onUp = () => {
      resizing.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('col-resizing')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.classList.add('col-resizing')
  }
  // 더블클릭하면 그 컬럼 폭 지정을 지워 기본(잘림)으로 되돌린다.
  const resetColWidth = (col: string) =>
    setColWidths((prev) => {
      if (!(col in prev)) return prev
      const next = { ...prev }
      delete next[col]
      return next
    })
  const colStyle = (c: string): React.CSSProperties | undefined =>
    colWidths[c] ? { width: colWidths[c], maxWidth: colWidths[c], minWidth: colWidths[c] } : undefined
  // 새 결과가 오면 각 컬럼을 내용에 맞춰 자동으로 넓힌다 (상한 안에서). 처음부터
  // 잘리지 않고 보이게 하려는 것. colWidths 가 비어 있을 때만 실행 — 사용자가 드래그로
  // 조절했거나(비어있지 않음) 이어붙기(loadMore)에는 다시 잡지 않는다.
  //
  // 폭은 브라우저가 그린 실제 셀의 scrollWidth 로 잰다. 폭 지정이 없는 이 시점의 셀은
  // CSS max-width(340) + overflow:hidden 상태라, scrollWidth 가 잘린 뒤가 아니라
  // 내용 전체 폭을 그대로 알려 준다 (캔버스 측정은 tabular-nums 등에서 어긋난다).
  useEffect(() => {
    if (!data || data.rows.length === 0) return
    if (Object.keys(colWidths).length > 0) return
    const table = gridRef.current?.querySelector('.sql-grid') ?? null
    if (!table) return
    const headThs = [...table.querySelectorAll('thead tr:first-child th.sql-th')] as HTMLElement[]
    const bodyRows = [...table.querySelectorAll('tbody tr')] as HTMLElement[]
    const MIN = 72
    // 한 컬럼이 화면을 다 먹지 않도록 상한. 셀 텍스트는 이미 400자에서 잘리므로(cell)
    // 이 상한이 병리적으로 넓은 컬럼만 막는다. EXPLAIN 계획 줄은 대개 이 안에 들어온다.
    const MAX = 820
    const SLACK = 8 // 오른쪽 패딩·반올림 여유 (한 글자도 잘리지 않게)
    const widths: Record<string, number> = {}
    data.columns.forEach((c, ci) => {
      let w = headThs[ci]?.scrollWidth ?? 0
      for (const tr of bodyRows) {
        const td = tr.children[ci + 1] as HTMLElement | undefined // +1: 행번호 칸 건너뜀
        if (td) w = Math.max(w, td.scrollWidth)
      }
      widths[c] = Math.min(MAX, Math.max(MIN, w + SLACK))
    })
    setColWidths(widths)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  // 결과 저장(내보내기) — 형식 선택 메뉴 + 진행 상태
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  // 에디터/결과 세로 분할 비율 (에디터 몫). 가운데 구분선을 드래그해 조절한다.
  const [splitPct, setSplitPct] = useState(0.5)
  const splitRef = useRef<HTMLDivElement>(null)
  // 결과 검색 (⌘/Ctrl+F) — 테이블은 찾기 바로 행 필터+강조, JSON 은 CodeMirror 내장 검색
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const resultRef = useRef<HTMLDivElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const jsonCmRef = useRef<ReactCodeMirrorRef>(null)

  // 연결이 바뀌면 이전 결과·오류를 비운다 (편집기 텍스트는 부모가 관리하므로 유지)
  useEffect(() => {
    setData(null)
    setError(null)
  }, [connectionId])

  // 실행 중이면 경과 시간을 100ms 마다 갱신 (얼마나 걸리는지 보이게)
  useEffect(() => {
    if (!pending) {
      setRunSecs(0)
      return
    }
    const start = Date.now()
    setRunSecs(0)
    const iv = setInterval(() => setRunSecs((Date.now() - start) / 1000), 100)
    return () => clearInterval(iv)
  }, [pending])

  // 열릴 때 커서를 문서 끝에 두고 포커스 — 트리에서 클릭한 테이블이 작성 중인 위치로 들어가게.
  useEffect(() => {
    if (!autoFocus) return
    const t = setTimeout(() => {
      const view = cmRef.current?.view
      if (view) {
        view.dispatch({ selection: { anchor: view.state.doc.length } })
        view.focus()
      }
    }, 30)
    return () => clearTimeout(t)
  }, [autoFocus])

  const viewRef = useRef(view)
  viewRef.current = view

  // JSON 뷰: CodeMirror 내장 검색 패널을 열고, Find 입력 옆에 일치 건수를 주입한다.
  const openJsonFind = () => {
    const v = jsonCmRef.current?.view
    if (!v) return
    openSearchPanel(v)
    setTimeout(() => {
      const panel = v.dom.querySelector('.cm-search') as HTMLElement | null
      const field = panel?.querySelector('input[name="search"]') as HTMLInputElement | null
      if (!panel || !field) return
      let countEl = panel.querySelector('.cm-count') as HTMLElement | null
      if (!countEl) {
        countEl = document.createElement('span')
        countEl.className = 'cm-count'
        field.after(countEl)
      }
      const update = () => {
        const q = field.value
        let c = 0
        if (q) {
          const hay = v.state.doc.toString().toLowerCase()
          const needle = q.toLowerCase()
          let i = 0
          while ((i = hay.indexOf(needle, i)) !== -1) {
            c++
            i += needle.length
          }
        }
        countEl!.textContent = q ? `${c.toLocaleString()}개 일치` : ''
      }
      field.removeEventListener('input', update)
      field.addEventListener('input', update)
      update()
      field.focus()
      field.select()
    }, 30)
  }

  // ⌘/Ctrl+F → 결과 검색. 이 워크벤치가 보이는(활성 탭) 상태일 때만 가로챈다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) || e.shiftKey) return
      const el = resultRef.current
      if (!el || el.offsetParent === null) return // 숨겨진 탭이면 무시
      if (viewRef.current === 'json') {
        if (!el.querySelector('.sql-json-wrap')) return
        e.preventDefault()
        openJsonFind()
      } else {
        if (!el.querySelector('.sql-grid')) return // 표시할 결과가 없으면 넘어감
        e.preventDefault()
        setFindOpen(true)
        setTimeout(() => findInputRef.current?.select(), 20)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 전체 화면일 때 Esc 로 해제
  useEffect(() => {
    if (!fullscreen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [fullscreen])

  const applyFirstPage = (r: {
    columns: string[]
    rows: Record<string, unknown>[]
    elapsed_ms: number
    truncated: boolean
    total?: number | null
    statement?: string
    affected_rows?: number | null
  }) => {
    setData({
      columns: r.columns,
      rows: r.rows,
      elapsedMs: r.elapsed_ms,
      hasMore: r.truncated,
      total: r.total ?? null,
      statement: r.statement ?? 'select',
      affected: r.affected_rows ?? null,
    })
    setError(null)
    // 새 결과마다 폭 지정을 비운다 → 아래 자동 맞춤 effect 가 내용에 맞춰 다시 잡는다.
    // (이어붙기 loadMore 는 applyFirstPage 를 타지 않아 사용자가 조절한 폭이 보존된다.)
    setColWidths({})
    if (gridRef.current) gridRef.current.scrollTop = 0
  }
  const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
  const firstPageError = (e: unknown, fallback: string) => {
    if (isAbort(e)) {
      setError(null) // 사용자가 취소 — 오류로 취급하지 않고 취소 알림만
      showCancelled()
      return
    }
    setData(null)
    setError(e instanceof ApiError ? e.message : fallback)
  }
  // 실행 중인 요청 취소
  const cancel = () => abortRef.current?.abort()

  const buildFilters = (cf: Record<string, string>) =>
    Object.entries(cf)
      .map(([col, value]) => ({ col, value: value.trim() }))
      .filter((f) => f.value !== '')

  // 첫 페이지 실행 (신규 실행·정렬·필터 변경 공용). 정렬·필터를 executed 에 저장해 loadMore 가 잇는다.
  const execFirst = (
    m: 'sql' | 'mongo' | 'duck',
    q: string,
    ns: string | null | undefined,
    s: { col: string; dir: 'asc' | 'desc' } | null,
    cf: Record<string, string>,
  ) => {
    if (!ready) return
    const filters = buildFilters(cf)
    const sortCol = s?.col ?? null
    const sortDir = s?.dir ?? 'asc'
    executed.current = { mode: m, query: q, namespace: ns, sortCol, sortDir, filters }
    setError(null)
    setCancelled(false)
    if (cancelTimer.current) clearTimeout(cancelTimer.current)
    const signal = (abortRef.current = new AbortController()).signal
    const handlers = {
      onSuccess: applyFirstPage,
      onError: (e: unknown) =>
        firstPageError(e, m === 'mongo' ? '조회에 실패했습니다.' : '쿼리 실행에 실패했습니다.'),
    }
    if (m === 'duck') {
      runDuck.mutate({ query: q, offset: 0, sortCol, sortDir, filters, signal }, handlers)
    } else if (!connectionId) {
      return // 연합 조회가 아니면 연결이 있어야 한다 (ready 가 이미 걸렀지만 타입을 좁힌다)
    } else if (m === 'mongo') {
      runMongo.mutate(
        { id: connectionId, command: q, namespace: ns, offset: 0, sortCol, sortDir, filters, signal },
        handlers,
      )
    } else {
      runQuery.mutate(
        { id: connectionId, query: q, offset: 0, sortCol, sortDir, filters, signal },
        handlers,
      )
    }
  }

  // 실행할 텍스트를 고른다 — 드래그 선택이 있으면 그 부분만, 없으면 커서가 놓인 `;` 문장만.
  // (일반 SQL 에디터의 "선택 실행 / 현재 문장 실행" 동작. 몽고는 문장 분할 없이 선택-또는-전체.)
  const pickRunText = (): string => {
    const view = cmRef.current?.view
    if (!view) return value
    const sel = view.state.selection.main
    const doc = view.state.doc.toString()
    if (sel.from !== sel.to) return doc.slice(sel.from, sel.to) // 선택 실행
    if (mode === 'mongo') return doc
    const ranges = sqlStatementRanges(doc)
    if (ranges.length === 0) return doc
    const pos = sel.head
    // 커서를 감싸거나(또는 그 뒤 끝나는) 첫 문장. 마지막 `;` 뒤 여백이면 마지막 문장으로.
    const hit = ranges.find((r) => pos <= r.to) ?? ranges[ranges.length - 1]
    return doc.slice(hit.from, hit.to)
  }

  // 편집기 우클릭 — 선택(또는 현재 문장)이 있으면 컨텍스트 메뉴(실행·즐겨찾기 저장)를 띄운다.
  const onEditorContextMenu = (e: React.MouseEvent) => {
    const sql = pickRunText().trim()
    if (!sql) return // 대상이 없으면 브라우저 기본 메뉴
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, sql })
  }
  // 컨텍스트 메뉴는 바깥 클릭·Esc·스크롤로 닫는다.
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [ctxMenu])

  // 우클릭 → 즐겨찾기 저장 확정. 이 탭의 연결(connectionId)에 귀속시킨다.
  const commitFavSave = () => {
    if (!favSave || !onAddFavorite || !connectionId) return
    const name = favSave.name.trim()
    if (!name) return
    onAddFavorite(name, favSave.sql, connectionId)
    setFavSave(null)
  }

  // 편집기에서 새로 실행 — 정렬·필터는 초기화 (컬럼 구성이 달라질 수 있으므로).
  const run = () => {
    if (!ready || pending) return
    const raw = pickRunText().trim()
    if (!raw) return

    // `$변수` 를 지금 값으로 바꿔서 보낸다.
    //
    // 이 실행은 파이프라인 엔진이 아니라 커넥션으로 쿼리를 **직접** 보내는 경로라,
    // 치환하지 않으면 `name = '$since'` 가 문자 그대로 나가 아무 행도 안 맞는다.
    // 실행 시점의 엔진과 같은 규칙(variables.ts ↔ variables.py)을 써야 미리보기가
    // 실제 실행을 예측한다.
    let q: string
    try {
      q = substituteVars(raw, variableValues, { contextKey: 'query' })
    } catch (e) {
      setError(e instanceof VariableError ? e.message : '변수 치환에 실패했습니다.')
      setRanWith(null)
      return
    }
    // 꺼 둔 명령이면 보내지 않는다. 치환까지 끝난 뒤에 보는 이유는 변수 치환이 문장을
    // 바꿀 수 있어서다 — 실제로 나갈 SQL 을 봐야 판정이 어긋나지 않는다.
    const blocked = mutedRunMessage(q, muted)
    if (blocked) {
      setError(blocked)
      setRanWith(null)
      return
    }
    // 무엇이 실제로 나갔는지 보여준다 — 치환된 줄을 못 보면 결과가 0행일 때 원인을 못 찾는다
    setRanWith(q === raw ? null : q)
    // 새 실행이므로 정렬·필터는 초기화 (컬럼 구성이 달라질 수 있으므로).
    setSort(null)
    setColFilters({})
    execFirst(mode, q, namespace, null, {})
  }

  // 실행 계획 — EXPLAIN(analyze=false) / EXPLAIN ANALYZE(analyze=true). PostgreSQL·MySQL 만.
  // 선택(또는 커서 문장)을 대상으로, $변수 치환까지 마친 SQL 을 보낸다.
  const canExplain = mode === 'sql' && Boolean(connectionId)
  const runExplain = (raw: string, analyze: boolean) => {
    if (!canExplain || !connectionId || explaining) return
    const trimmed = raw.trim()
    if (!trimmed) return
    let q: string
    try {
      q = substituteVars(trimmed, variableValues, { contextKey: 'query' })
    } catch (e) {
      setError(e instanceof VariableError ? e.message : '변수 치환에 실패했습니다.')
      return
    }
    setError(null)
    setExplaining(analyze ? 'analyze' : 'plain')
    explainMut.mutate(
      { id: connectionId, query: q, analyze },
      {
        onSuccess: (r) => {
          setExplainResult({ plan: r.plan, analyzed: r.analyzed, sql: q })
          setExplaining(false)
        },
        onError: (e) => {
          setError(e instanceof ApiError ? e.message : '실행 계획 조회에 실패했습니다.')
          setExplaining(false)
        },
      },
    )
  }

  // 마지막 실행한 쿼리를 기준으로 정렬·필터만 바꿔 재조회 (offset 0).
  const applySortFilter = (
    s: { col: string; dir: 'asc' | 'desc' } | null,
    cf: Record<string, string>,
  ) => {
    const ex = executed.current
    if (!ex.query || !ready) return
    execFirst(ex.mode, ex.query, ex.namespace, s, cf)
  }

  // 헤더 클릭 → 정렬 순환 (없음 → 오름 → 내림 → 없음)
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

  // 컬럼 필터 입력 (디바운스 후 재조회)
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

  // 조회 결과를 파일로 저장 (전체 데이터셋, 현재 정렬·필터 반영)
  const doExport = async (fmt: 'csv' | 'json' | 'txt') => {
    const ex = executed.current
    if (!ready || !ex.query || exporting) return
    setExportOpen(false)
    setExporting(fmt)
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    try {
      // 연합 조회는 연결에 매이지 않아 내보내기 경로도 다르다 (routers/duck.py).
      const [path, body] =
        ex.mode === 'duck'
          ? ['/duckdb/export', { query: ex.query }]
          : [
              `/connections/${connectionId}/export`,
              {
                mode: ex.mode,
                query: ex.mode === 'sql' ? ex.query : undefined,
                command: ex.mode === 'mongo' ? ex.query : undefined,
                namespace: ex.namespace ?? undefined,
              },
            ]
      await api.download(
        path as string,
        {
          ...(body as Record<string, unknown>),
          format: fmt,
          sort_col: ex.sortCol,
          sort_dir: ex.sortDir,
          filters: ex.filters,
        },
        `query_result_${stamp}.${fmt}`,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '내보내기에 실패했습니다.')
    } finally {
      setExporting(null)
    }
  }

  // 스크롤이 바닥에 가까워지면 다음 페이지를 이어 받는다 (무한 스크롤)
  const loadMore = () => {
    if (!ready || !data || !data.hasMore || pending || loadingMore) return
    const ex = executed.current
    setLoadingMore(true)
    const onSuccess = (r: {
      columns: string[]
      rows: Record<string, unknown>[]
      elapsed_ms: number
      truncated: boolean
    }) =>
      setData((prev) =>
        prev
          ? {
              columns: prev.columns.length ? prev.columns : r.columns,
              rows: [...prev.rows, ...r.rows],
              elapsedMs: r.elapsed_ms,
              hasMore: r.truncated,
              total: prev.total, // 전체 건수는 첫 페이지 값 유지
              statement: prev.statement,
              affected: prev.affected,
            }
          : prev,
      )
    const onError = (e: unknown) => {
      if (isAbort(e)) {
        showCancelled()
        return
      }
      setError(e instanceof ApiError ? e.message : '추가 로딩에 실패했습니다.')
    }
    const onSettled = () => setLoadingMore(false)
    const signal = (abortRef.current = new AbortController()).signal

    if (ex.mode === 'duck') {
      runDuck.mutate(
        {
          query: ex.query,
          offset: data.rows.length,
          sortCol: ex.sortCol,
          sortDir: ex.sortDir,
          filters: ex.filters,
          signal,
        },
        { onSuccess, onError, onSettled },
      )
    } else if (!connectionId) {
      setLoadingMore(false)
    } else if (ex.mode === 'mongo') {
      runMongo.mutate(
        {
          id: connectionId,
          command: ex.query,
          namespace: ex.namespace,
          offset: data.rows.length,
          sortCol: ex.sortCol,
          sortDir: ex.sortDir,
          filters: ex.filters,
          signal,
        },
        { onSuccess, onError, onSettled },
      )
    } else {
      runQuery.mutate(
        {
          id: connectionId,
          query: ex.query,
          offset: data.rows.length,
          sortCol: ex.sortCol,
          sortDir: ex.sortDir,
          filters: ex.filters,
          signal,
        },
        { onSuccess, onError, onSettled },
      )
    }
  }

  const onGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) loadMore()
  }

  const insertAtCursor = useCallback((text: string) => {
    const view = cmRef.current?.view
    if (!view) return
    const { from, to } = view.state.selection.main
    // 앞 글자가 공백/개행/없음이 아니면 공백을 하나 붙여 붙는 걸 막는다
    const before = from > 0 ? view.state.sliceDoc(from - 1, from) : ' '
    const ins = (/\s/.test(before) ? '' : ' ') + text
    view.dispatch({
      changes: { from, to, insert: ins },
      selection: { anchor: from + ins.length },
    })
    view.focus()
  }, [])

  // 공용 내비게이터가 이 에디터의 커서에 삽입할 수 있도록 삽입 함수를 바깥에 등록한다.
  useEffect(() => {
    bindInsert?.(insertAtCursor)
  }, [bindInsert, insertAtCursor])
  // 기본 트리용 — "namespace|name" 인코딩을 schema.table 로 풀어 삽입
  const insert = (encoded: string) => {
    const [ns, name] = encoded.split('|')
    insertAtCursor(ns ? `${ns}.${name}` : name)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      // 에디터 안에서 눌렀으면 CodeMirror 키맵이 이미 실행한다(+줄바꿈 방지). 여기서 또
      // 실행하면 두 번 돈다 — 에디터 밖(결과 영역 등)에 포커스가 있을 때만 실행한다.
      if ((e.target as HTMLElement).closest?.('.cm-editor')) return
      e.preventDefault()
      run()
      return
    }
    // ⌘/Ctrl+S — 저장. 드래그 선택이 있으면 그 부분을 "즐겨찾기"로,
    // 선택이 없으면 현재 쿼리 탭을 "저장"(저장됨 대화상자)한다. (브라우저 기본 저장은 막는다)
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'KeyS') {
      const view = cmRef.current?.view
      const sel = view?.state.selection.main
      const hasSel = !!(view && sel && sel.from !== sel.to)
      if (hasSel && onAddFavorite) {
        const sql = view!.state.sliceDoc(sel!.from, sel!.to).trim()
        if (sql) {
          e.preventDefault()
          setFavSave({ sql, name: '' })
          return
        }
      }
      // 선택 없음 → 현재 쿼리 탭 저장
      if (!hasSel && onSave && value.trim()) {
        e.preventDefault()
        onSave()
      }
    }
  }

  // 가운데 구분선 드래그 → 에디터/결과 높이 비율 조절
  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect()
      if (!rect || rect.height === 0) return
      const pct = (ev.clientY - rect.top) / rect.height
      setSplitPct(Math.max(0.12, Math.min(0.88, pct)))
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

  // 테이블 뷰 검색 — 로드된 행 중 어떤 셀이든 검색어를 포함하는 행만 (원래 행번호 유지)
  const findQ = findText.trim().toLowerCase()
  const cols = data?.columns ?? []
  const shownTableRows: [Record<string, unknown>, number][] = data
    ? data.rows
        .map((r, i) => [r, i] as [Record<string, unknown>, number])
        .filter(([r]) => !findQ || cols.some((c) => cell(r[c]).text.toLowerCase().includes(findQ)))
    : []

  const closeFind = () => {
    setFindOpen(false)
    setFindText('')
  }

  // 결과 영역은 한 번이라도 실행하기 전엔 숨긴다 — 편집기가 세로 공간을 다 쓰게.
  const showResult = pending || data !== null || error !== null || cancelled

  return (
    <div
      className={`sql-wb ${className} ${fullscreen ? 'fullscreen' : ''}`}
      onKeyDown={onKeyDown}
      onMouseDownCapture={onFocusEditor}
    >
      {sidebar === false ? null : sidebar ? (
        sidebar(insertAtCursor)
      ) : (
        <div className="sql-modal-tree">
          {variables.length > 0 && (
            <VariablePanel variables={variables} onInsert={insertAtCursor} />
          )}
          <div className="sql-modal-tree-hd">테이블을 클릭하면 SQL 에 삽입됩니다</div>
          <SchemaTableTree tables={tables} value="" loading={loading} onChange={insert} />
        </div>
      )}
      <div className="sql-modal-editor">
        {(toolbarLeft || hint || !floatingRun) && (
          <div className={`sql-editor-toolbar ${floatingRun ? 'slim' : ''}`}>
            {toolbarLeft}
            {onSave && (
              <button
                className="sql-save-btn"
                onClick={onSave}
                disabled={!value.trim()}
                title="이 쿼리를 폴더에 저장 (⌘/Ctrl+S)"
              >
                <Icon.save />
                저장
              </button>
            )}
            {hint && <span className="sql-editor-hint">{hint}</span>}
            <div className="sql-toolbar-spacer" />
            {!floatingRun &&
              (pending ? (
                <button className="btn sm sql-run cancel" onClick={cancel} title="실행 취소">
                  <Icon.stop />
                  취소
                </button>
              ) : (
                <button
                  className="btn primary sm sql-run"
                  onClick={run}
                  disabled={!ready || !value.trim()}
                  title={ready ? '소스에서 실행 (⌘/Ctrl + Enter)' : '먼저 연결을 고르세요'}
                >
                  <Icon.play />
                  {mode === 'mongo' ? '조회' : '실행'}
                  <kbd className="sql-kbd">⌘↵</kbd>
                </button>
              ))}
            {canExplain && (
              <div className="sql-explain-btns">
                <button
                  className="btn sm sql-explain"
                  onClick={() => runExplain(pickRunText(), false)}
                  disabled={!ready || !value.trim() || explaining !== false}
                  title="실행 계획 (EXPLAIN) — 추정 계획만, 실행하지 않음"
                >
                  <Icon.map />
                  {explaining === 'plain' ? '분석 중…' : '실행 계획'}
                </button>
                <button
                  className="btn sm sql-explain"
                  onClick={() => runExplain(pickRunText(), true)}
                  disabled={!ready || !value.trim() || explaining !== false}
                  title="성능 분석 (EXPLAIN ANALYZE) — 실제 실행 후 계획+시간 (롤백됨)"
                >
                  <Icon.bolt />
                  {explaining === 'analyze' ? '분석 중…' : '성능 분석'}
                </button>
              </div>
            )}
            {viewToggle}
            <button
              className="sql-fs-btn"
              onClick={() => setFullscreen((v) => !v)}
              title={fullscreen ? '전체 화면 해제 (Esc)' : '전체 화면으로 작성'}
              aria-label={fullscreen ? '전체 화면 해제' : '전체 화면'}
            >
              {fullscreen ? <Icon.compress /> : <Icon.expand />}
            </button>
          </div>
        )}
        <div className="sql-split" ref={splitRef}>
          <div
            className="sql-editor-cm"
            style={{ flexGrow: showResult ? splitPct : 1 }}
            onContextMenu={onEditorContextMenu}
          >
          <SqlEditor
            cmRef={cmRef}
            value={value}
            onChange={onChange}
            height="100%"
            language={mode === 'mongo' ? 'javascript' : 'sql'}
            completion={isDuck ? undefined : tables}
            duckCompletion={isDuck ? duckTables : undefined}
            favorites={favorites}
            onRun={run}
            onOpenLoadModal={(r) => setLoadModal(r)}
            onAiCommand={mode === 'sql' ? (r) => setAiPrompt(r) : undefined}
            placeholder={
              mode === 'mongo'
                ? 'collection.find({ })   또는   collection.aggregate([ ... ])'
                : isDuck
                  ? 'SELECT * FROM 연결이름.데이터베이스.테이블 …'
                  : 'SELECT * FROM schema.table WHERE ...'
            }
          />
          {floatingRun && (
            <button
              className={`sql-run-fab ${pending ? 'cancel' : ''}`}
              onClick={pending ? cancel : run}
              disabled={!pending && (!ready || !value.trim())}
              title={
                pending
                  ? `실행 취소 (${runSecs.toFixed(1)}초 경과)`
                  : ready
                    ? '실행 (⌘/Ctrl + Enter)'
                    : '먼저 연결을 고르세요'
              }
              aria-label={pending ? '실행 취소' : '실행'}
            >
              {pending ? <Icon.stop /> : <Icon.play />}
            </button>
          )}
          </div>
          {showResult && (
          <>
          <div
            className="sql-vsplit"
            onPointerDown={startSplitDrag}
            title="드래그해서 위·아래 크기 조절"
          >
            <span className="sql-vsplit-grip" />
          </div>
          <div className="sql-result" ref={resultRef} style={{ flexGrow: 1 - splitPct }}>
          {cancelled && (
            <div className="sql-cancel-toast">
              <Icon.stop />
              실행을 취소했습니다
            </div>
          )}
          {findOpen && view === 'table' && data && (
            <div className="sql-find">
              <Icon.search />
              <input
                ref={findInputRef}
                value={findText}
                placeholder="결과에서 검색…"
                onChange={(e) => setFindText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeFind()
                }}
              />
              <span className="sql-find-count">
                {findQ ? `${shownTableRows.length.toLocaleString()}개 일치` : ''}
              </span>
              <button className="sql-find-x" onClick={closeFind} aria-label="닫기">
                ×
              </button>
            </div>
          )}
          {ranWith && !error && (
            <div className="sql-ran-with" title={ranWith}>
              <span className="srw-tag">변수 치환됨</span>
              <code>{ranWith.replace(/\s+/g, ' ').trim()}</code>
            </div>
          )}
          {error ? (
            <div className="sql-result-error">
              <Icon.alert />
              <span>{error}</span>
            </div>
          ) : data && data.statement !== 'select' && data.columns.length === 0 ? (
            /* 쓰기 문장은 돌려줄 행이 없다 — 빈 그리드 대신 무엇이 얼마나 바뀌었는지 말한다.
               `RETURNING`/`OUTPUT` 이 있어 컬럼이 오면 아래 일반 결과 그리드로 간다. */
            <div className="sql-result-write">
              <span className={`stmt-tag risk-${data.statement === 'select' ? 'read' : 'write'}`}>
                {data.statement.toUpperCase()}
              </span>
              <b>
                {data.affected == null
                  ? '실행했습니다'
                  : `${data.affected.toLocaleString()}행이 적용되었습니다`}
              </b>
              <span className="dot">·</span>
              <span>{data.elapsedMs} ms</span>
            </div>
          ) : data ? (
            <>
              <div className="sql-result-toolbar">
                {(sort || Object.values(colFilters).some((v) => v.trim())) && (
                  <span className="sql-grid-hint">전체 데이터 기준 정렬·필터</span>
                )}
                <div className="mode-seg" role="group" aria-label="결과 보기 방식">
                  <button
                    className={`mode-seg-btn ${view === 'table' ? 'active' : ''}`}
                    onClick={() => setView('table')}
                  >
                    테이블
                  </button>
                  <button
                    className={`mode-seg-btn ${view === 'json' ? 'active' : ''}`}
                    onClick={() => setView('json')}
                  >
                    JSON
                  </button>
                </div>
                {view === 'table' && (
                  <button
                    className={`sql-filter-toggle ${showFilters ? 'on' : ''}`}
                    onClick={toggleFilters}
                    title="컬럼별 필터 (전체 데이터 기준)"
                  >
                    <Icon.filter />
                    필터
                  </button>
                )}
                <div className="sql-export">
                  <button
                    className="sql-filter-toggle"
                    onClick={() => setExportOpen((o) => !o)}
                    disabled={!!exporting}
                    title="결과를 파일로 저장 (전체 데이터)"
                  >
                    <Icon.save />
                    {exporting ? '저장 중…' : '저장'}
                    <Icon.chevron />
                  </button>
                  {exportOpen && (
                    <>
                      <div className="sql-export-overlay" onClick={() => setExportOpen(false)} />
                      <div className="sql-export-menu">
                        <div className="sql-export-hd">파일 형식</div>
                        {(['csv', 'json', 'txt'] as const).map((f) => (
                          <button key={f} onClick={() => doExport(f)}>
                            <span className="sql-export-fmt">{f.toUpperCase()}</span>
                            <span className="sql-export-desc">
                              {f === 'csv' ? '엑셀·범용' : f === 'json' ? '구조 보존' : '탭 구분(TSV)'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {view === 'table' ? (
                <div className="sql-grid-wrap" ref={gridRef} onScroll={onGridScroll}>
                  {data.columns.length === 0 ? (
                    <div className="sql-result-empty">결과 행이 없습니다.</div>
                  ) : (
                    <table className="sql-grid">
                      <thead>
                        <tr>
                          <th className="rownum">#</th>
                          {data.columns.map((c) => (
                            <th
                              key={c}
                              className={`sql-th ${sort?.col === c ? 'sorted' : ''}`}
                              onClick={() => cycleSort(c)}
                              style={colStyle(c)}
                              title="클릭하면 정렬 (오름 → 내림 → 해제)"
                            >
                              <span className="sql-th-label">{c}</span>
                              <span className="sql-th-arrow">
                                {sort?.col === c ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                              </span>
                              <span
                                className="sql-col-resize"
                                onPointerDown={(e) => startColResize(e, c)}
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => {
                                  e.stopPropagation()
                                  resetColWidth(c)
                                }}
                                title="드래그해서 폭 조절 · 더블클릭하면 초기화"
                              />
                            </th>
                          ))}
                          {/* 남는 폭을 흡수하는 빈 칸 — 컬럼이 적어도 안 늘어나게 */}
                          <th className="sql-grid-spacer" aria-hidden="true" />
                        </tr>
                        {showFilters && (
                          <tr className="sql-filter-row">
                            <th className="rownum" />
                            {data.columns.map((c) => (
                              <th key={c} style={colStyle(c)}>
                                <input
                                  className="sql-col-filter"
                                  value={colFilters[c] ?? ''}
                                  placeholder="필터…"
                                  onChange={(e) => onColFilter(c, e.target.value)}
                                />
                              </th>
                            ))}
                            <th className="sql-grid-spacer" aria-hidden="true" />
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {shownTableRows.map(([row, i]) => (
                          <tr key={i}>
                            <td className="rownum">{i + 1}</td>
                            {data.columns.map((c) => {
                              const { text, isNull } = cell(row[c])
                              return (
                                <td
                                  key={c}
                                  className={isNull ? 'null' : ''}
                                  title={text}
                                  style={colStyle(c)}
                                >
                                  {findQ ? highlight(text, findQ) : text}
                                </td>
                              )
                            })}
                            <td className="sql-grid-spacer" aria-hidden="true" />
                          </tr>
                        ))}
                        {findQ && shownTableRows.length === 0 && (
                          <tr>
                            <td className="rownum" />
                            <td className="sql-find-none" colSpan={data.columns.length + 1}>
                              일치하는 행이 없습니다 (로드된 {data.rows.length.toLocaleString()}행 기준)
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                  {loadingMore && <div className="sql-grid-more">더 불러오는 중… {runSecs.toFixed(1)}초</div>}
                </div>
              ) : (
                <div className="sql-json-wrap">
                  <JsonView
                    text={JSON.stringify(data.rows, null, 2)}
                    onNearBottom={loadMore}
                    cmRef={jsonCmRef}
                  />
                  {loadingMore && <div className="sql-json-more">더 불러오는 중… {runSecs.toFixed(1)}초</div>}
                </div>
              )}
              <div className="sql-result-status">
                {data.total != null ? (
                  <span>
                    전체 <b>{data.total.toLocaleString()}</b> 행
                    {data.rows.length < data.total && (
                      <span className="sql-result-loaded">
                        {' '}
                        · {data.rows.length.toLocaleString()} 로드됨
                      </span>
                    )}
                  </span>
                ) : (
                  <span>{data.rows.length.toLocaleString()} 행</span>
                )}
                <span className="dot">·</span>
                <span>{data.elapsedMs} ms</span>
                {data.statement !== 'select' && data.affected != null && (
                  <>
                    <span className="dot">·</span>
                    <span>
                      {data.statement.toUpperCase()} {data.affected.toLocaleString()}행 적용
                    </span>
                  </>
                )}
                {data.hasMore && <span className="sql-result-more">스크롤하면 더 불러옵니다</span>}
              </div>
            </>
          ) : (
            <div className="sql-result-empty">
              {pending ? (
                <span className="sql-running">
                  <span className="sql-running-dot" />
                  실행 중… <b>{runSecs.toFixed(1)}초</b>
                </span>
              ) : mode === 'mongo' ? (
                '컬렉션.find({…}) 또는 컬렉션.aggregate([…]) 를 실행하면 여기에 표시됩니다 (⌘/Ctrl + Enter)'
              ) : (
                '실행하면 결과가 여기에 표시됩니다 (⌘/Ctrl + Enter)'
              )}
            </div>
          )}
          </div>
          </>
          )}
        </div>
      </div>
      {loadModal && (
        <FavoritePickerModal
          favorites={favorites ?? []}
          onPick={(sql) => {
            const v = cmRef.current?.view
            if (v) {
              const to = Math.min(loadModal.to, v.state.doc.length)
              const from = Math.min(loadModal.from, to)
              v.dispatch({
                changes: { from, to, insert: sql },
                selection: { anchor: from + sql.length },
              })
              v.focus()
            }
            setLoadModal(null)
          }}
          onClose={() => {
            // 취소하면 `/loadQuery()` 자리표시자는 지운다(지저분하게 남기지 않는다).
            const v = cmRef.current?.view
            if (v) {
              const to = Math.min(loadModal.to, v.state.doc.length)
              const from = Math.min(loadModal.from, to)
              if (v.state.sliceDoc(from, to) === '/loadQuery()') {
                v.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } })
              }
              v.focus()
            }
            setLoadModal(null)
          }}
        />
      )}
      {aiPrompt && (
        <AiInlinePrompt
          dbConnId={connectionId}
          onInsert={(genSql) => {
            const v = cmRef.current?.view
            if (v) {
              const to = Math.min(aiPrompt.to, v.state.doc.length)
              const from = Math.min(aiPrompt.from, to)
              v.dispatch({
                changes: { from, to, insert: genSql },
                selection: { anchor: from + genSql.length },
              })
              v.focus()
            }
            setAiPrompt(null)
          }}
          onClose={() => {
            setAiPrompt(null)
            cmRef.current?.view?.focus()
          }}
        />
      )}
      {ctxMenu &&
        createPortal(
          <div
            className="sql-ctxmenu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="sql-ctxmenu-item"
              disabled={!connectionId || pending}
              onClick={() => {
                setCtxMenu(null)
                run()
              }}
            >
              <Icon.play />
              실행
              <span className="sql-ctxmenu-kbd">⌘↵</span>
            </button>
            {canExplain && (
              <>
                <button
                  className="sql-ctxmenu-item"
                  disabled={explaining !== false}
                  onClick={() => {
                    const sql = ctxMenu.sql
                    setCtxMenu(null)
                    runExplain(sql, false)
                  }}
                >
                  <Icon.map />
                  실행 계획 (EXPLAIN)
                </button>
                <button
                  className="sql-ctxmenu-item"
                  disabled={explaining !== false}
                  onClick={() => {
                    const sql = ctxMenu.sql
                    setCtxMenu(null)
                    runExplain(sql, true)
                  }}
                >
                  <Icon.bolt />
                  성능 분석 (EXPLAIN ANALYZE)
                </button>
              </>
            )}
            {onAddFavorite && (
              <button
                className="sql-ctxmenu-item"
                disabled={!connectionId}
                onClick={() => {
                  setFavSave({ sql: ctxMenu.sql, name: '' })
                  setCtxMenu(null)
                }}
              >
                <Icon.star />
                즐겨찾기 저장
                <span className="sql-ctxmenu-kbd">⌘S</span>
              </button>
            )}
          </div>,
          document.body,
        )}
      {explainResult && (
        <ExplainModal target={explainResult} onClose={() => setExplainResult(null)} />
      )}
      {favSave &&
        createPortal(
          <div className="sql-favsave-overlay" onMouseDown={() => setFavSave(null)}>
            <div className="sql-favsave" onMouseDown={(e) => e.stopPropagation()}>
              <div className="sql-favsave-hd">
                <Icon.star />
                즐겨찾기 저장
              </div>
              <input
                className="sql-favsave-name"
                autoFocus
                placeholder="이름 (예: 일일 집계)"
                value={favSave.name}
                onChange={(e) => setFavSave((s) => (s ? { ...s, name: e.target.value } : s))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitFavSave()
                  if (e.key === 'Escape') setFavSave(null)
                }}
              />
              <pre className="sql-favsave-sql">{favSave.sql}</pre>
              <div className="sql-favsave-actions">
                <button
                  className="btn sm primary"
                  onClick={commitFavSave}
                  disabled={!favSave.name.trim() || !connectionId}
                >
                  <Icon.save />
                  저장
                </button>
                <button className="btn sm" onClick={() => setFavSave(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/** SQL 을 크게 편집하는 팝업 — 워크벤치를 모달 크롬으로 감싼 것. */
export function SqlModal({
  value,
  onChange,
  onClose,
  connectionId,
  tables = [],
  loading = false,
  variables = [],
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
  connectionId?: string
  tables?: CompletionTable[]
  loading?: boolean
  variables?: EditorVariable[]
}) {
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal code-modal sql-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>커스텀 SQL</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <SqlWorkbench
          className="mb sql-modal-body"
          value={value}
          onChange={onChange}
          connectionId={connectionId}
          tables={tables}
          loading={loading}
          variables={variables}
          autoFocus
          hint="커스텀 SQL 모드에서는 증분 워터마크가 적용되지 않습니다 — 전량을 읽습니다."
        />
        <div className="mf">
          <button className="btn primary" onClick={onClose}>
            <Icon.save />
            완료
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
