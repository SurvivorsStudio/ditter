/** `/conn` 슬래시 명령 — 목록에 뜨는가, 고르면 마커가 문장 맨 앞에 놓이는가.
 *
 *  `placeMarker` 의 자리 계산은 connMarker.test 가 따로 본다. 여기서는 **편집기에
 *  실제로 붙는 경로**(자동완성 문맥 판정 → apply → 문서 변경)를 본다. */
import { describe, expect, it } from 'vitest'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { makeLoadQueryCompletion } from './SqlEditor'
import { findMarkers, DUCK_MARKER_NAME } from './connMarker'

const CONNS = [
  { id: 'c1', name: '운영 MySQL', type: 'mysql' },
  { id: 'c2', name: 'MES PostgreSQL', type: 'postgres' },
]

/** 커서를 `|` 로 표시한 문서에서 자동완성 결과를 얻는다. */
function complete(docWithCursor: string, conns = CONNS): CompletionResult | null {
  const pos = docWithCursor.indexOf('|')
  const doc = docWithCursor.replace('|', '')
  const src = makeLoadQueryCompletion(
    () => [],
    () => {},
    () => undefined,
    () => conns,
  )
  const state = EditorState.create({ doc, selection: { anchor: pos } })
  const r = src(new CompletionContext(state, pos, true))
  return r && !(r instanceof Promise) ? r : null
}

/** 결과에서 라벨의 apply 를 실제 편집기에 적용하고 새 문서를 돌려준다. */
function pick(docWithCursor: string, label: string): string {
  const pos = docWithCursor.indexOf('|')
  const doc = docWithCursor.replace('|', '')
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: pos } }),
  })
  const res = complete(docWithCursor)
  const opt = res?.options.find((o) => o.label === label)
  if (!opt || typeof opt.apply !== 'function') throw new Error(`항목 없음: ${label}`)
  opt.apply(view, opt, res!.from, pos)
  const out = view.state.doc.toString()
  view.destroy()
  return out
}

describe('`/` 명령 목록', () => {
  it('`/conn` 이 목록에 있다', () => {
    const labels = complete('/|')?.options.map((o) => o.label) ?? []
    expect(labels).toContain('/conn')
  })

  it('고를 연결이 없으면 숨는다 (mongo 탭)', () => {
    const labels = complete('/|', [])?.options.map((o) => o.label) ?? []
    expect(labels).not.toContain('/conn')
  })

  it('나눗셈 문맥에서는 뜨지 않는다', () => {
    expect(complete('SELECT a/|')).toBeNull()
  })
})

describe('`/conn.` 연결 목록', () => {
  it('연결·연합 조회·기본 연결 따르기를 함께 띄운다', () => {
    const labels = complete('SELECT 1 /conn.|')?.options.map((o) => o.label) ?? []
    expect(labels).toEqual(['기본 연결 따르기', DUCK_MARKER_NAME, '운영 MySQL', 'MES PostgreSQL'])
  })

  it('공백이 든 이름도 조각으로 거른다', () => {
    const labels = complete('SELECT 1 /conn.mes post|')?.options.map((o) => o.label) ?? []
    expect(labels).toEqual(['MES PostgreSQL'])
  })

  it('일치하는 것이 없으면 그렇게 말한다', () => {
    const labels = complete('SELECT 1 /conn.zzz|')?.options.map((o) => o.label) ?? []
    expect(labels).toEqual(['일치하는 연결 없음'])
  })
})

describe('고르면 마커가 놓인다', () => {
  it('커서가 문장 끝이어도 마커는 맨 앞 제 줄에 붙는다', () => {
    const out = pick('SELECT * FROM t /conn.mes|', 'MES PostgreSQL')
    expect(out).toBe('-- @conn "MES PostgreSQL"\nSELECT * FROM t ')
  })

  it('앞 문장은 건드리지 않는다', () => {
    const out = pick('SELECT 1;\nSELECT 2 /conn.운영|', '운영 MySQL')
    expect(out).toBe('SELECT 1;\n-- @conn "운영 MySQL"\nSELECT 2 ')
  })

  it('「기본 연결 따르기」는 마커를 지운다', () => {
    const out = pick('-- @conn "운영 MySQL"\nSELECT 1 /conn.|', '기본 연결 따르기')
    expect(findMarkers(out)).toHaveLength(0)
  })

  it('연합 조회도 고를 수 있다', () => {
    const out = pick('SELECT 1 /conn.연합|', DUCK_MARKER_NAME)
    expect(findMarkers(out)[0].name).toBe(DUCK_MARKER_NAME)
  })
})

describe('연결 먼저 → 쿼리 나중 (사용자 흐름)', () => {
  const WMS = [
    { id: 'w1', name: '창고 WMS', type: 'mssql' },
    { id: 'w2', name: '고객센터', type: 'postgres' },
  ]
  /** 실제 편집기에 자동완성을 적용한다. `|` 가 커서. */
  const run = (docWithCursor: string, label: string): string => {
    const doc = docWithCursor.replace('|', '/conn.')
    const pos = doc.indexOf('/conn.') + '/conn.'.length
    const withCursor = doc.slice(0, pos) + '|' + doc.slice(pos)
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: pos } }) })
    const res = complete(withCursor, WMS)
    const opt = res?.options.find((o) => o.label === label)
    if (!opt || typeof opt.apply !== 'function') throw new Error(`항목 없음: ${label}`)
    opt.apply(view, opt, res!.from, pos)
    const out = view.state.doc.toString()
    view.destroy()
    return out
  }

  it('세미콜론 없이 쓴 쿼리 아래에서 골라도 위 연결이 그대로다', () => {
    const out = run('-- @conn "창고 WMS"\nselect *\nfrom dbo.items\n|', '고객센터')
    expect(out).toBe('-- @conn "창고 WMS"\nselect *\nfrom dbo.items;\n\n-- @conn "고객센터"\n')
    expect(findMarkers(out).map((m) => m.name)).toEqual(['창고 WMS', '고객센터'])
  })

  it('쓰던 줄 안에서 부르면 그 문장의 연결을 정한다 (가르지 않는다)', () => {
    const out = run('select * from t where |', '고객센터')
    expect(out).toBe('-- @conn "고객센터"\nselect * from t where ')
  })
})
