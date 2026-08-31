import { describe, expect, it } from 'vitest'
import {
  DUCK_MARKER_NAME,
  findMarkers,
  markedConnId,
  markerLine,
  mergeBody,
  placeMarker,
  resolveConn,
  stripMarkers,
  targetFor,
  upsertMarker,
} from './connMarker'
import { DUCK_CONN } from './duckRefs'
import { sqlStatementRanges } from './SqlEditor'

const CONNS_WMS = [
  { id: 'w1', name: '창고 WMS', type: 'mssql' },
  { id: 'w2', name: '고객센터', type: 'postgres' },
]

const CONNS = [
  { id: 'c1', name: '운영 MySQL', type: 'mysql' },
  { id: 'c2', name: 'MES PostgreSQL', type: 'postgres' },
  { id: 'c3', name: 'mongo_log', type: 'mongo' },
]

describe('findMarkers', () => {
  it('인용된 이름과 인용 없는 이름을 모두 읽는다', () => {
    expect(findMarkers('-- @conn "MES PostgreSQL"\nSELECT 1')[0].name).toBe('MES PostgreSQL')
    expect(findMarkers('-- @conn mes_pg\nSELECT 1')[0].name).toBe('mes_pg')
  })

  it('앞 공백·대소문자·공백 없는 `--@conn` 을 허용한다', () => {
    expect(findMarkers('   --@CONN "운영 MySQL"\nSELECT 1')[0].name).toBe('운영 MySQL')
  })

  it('이름 안의 `""` 이스케이프를 되돌린다', () => {
    expect(findMarkers('-- @conn "a""b"\nSELECT 1')[0].name).toBe('a"b')
  })

  it('줄 전체를 덮는다 — 떼어내면 빈 줄이 남지 않는다', () => {
    const text = '-- @conn "운영 MySQL"\nSELECT 1'
    expect(stripMarkers(text)).toBe('SELECT 1')
  })

  it('마커가 아닌 주석은 건드리지 않는다', () => {
    expect(findMarkers('-- 그냥 메모\nSELECT 1')).toHaveLength(0)
    expect(findMarkers('-- @connection "x"\nSELECT 1')).toHaveLength(0)
  })

  it('여러 개면 여러 개로 센다 (조용히 하나만 고르지 않는다)', () => {
    expect(findMarkers('-- @conn "a"\n-- @conn "b"\nSELECT 1')).toHaveLength(2)
  })

  it('개행 없이 끝나도 읽는다', () => {
    expect(findMarkers('-- @conn "운영 MySQL"')[0].name).toBe('운영 MySQL')
  })
})

describe('문장 분할과의 관계', () => {
  it('마커는 그 문장의 범위 안에 들어온다 — 결합 로직이 필요 없다', () => {
    const doc = 'SELECT 1;\n-- @conn "MES PostgreSQL"\nSELECT 2;'
    const ranges = sqlStatementRanges(doc)
    const second = doc.slice(ranges[1].from, ranges[1].to)
    expect(resolveConn(second, CONNS)).toMatchObject({ kind: 'conn', connId: 'c2' })
    // 첫 문장은 마커가 없다 — 앞 문장으로 새지 않는다.
    expect(resolveConn(doc.slice(ranges[0].from, ranges[0].to), CONNS).kind).toBe('inherit')
  })

  it('마커 안의 세미콜론은 문장을 쪼개지 않는다', () => {
    const doc = '-- @conn "a;b"\nSELECT 1;'
    expect(sqlStatementRanges(doc)).toHaveLength(1)
  })
})

describe('resolveConn', () => {
  it('마커가 없으면 기본 연결을 따른다', () => {
    expect(resolveConn('SELECT 1', CONNS).kind).toBe('inherit')
  })

  it('이름을 앞뒤 공백·대소문자 무시로 맞춘다', () => {
    expect(resolveConn('-- @conn "  mes postgresql  "\nSELECT 1', CONNS)).toMatchObject({
      kind: 'conn',
      connId: 'c2',
    })
  })

  it('「연합 조회」를 연합 조회로 읽는다', () => {
    expect(resolveConn(`-- @conn "${DUCK_MARKER_NAME}"\nSELECT 1`, CONNS).kind).toBe('duck')
    expect(markedConnId(`-- @conn "${DUCK_MARKER_NAME}"\nSELECT 1`, CONNS)).toBe(DUCK_CONN)
  })

  it('같은 이름의 실제 연결이 있으면 그쪽이 이긴다 (가려지지 않는다)', () => {
    const withDup = [...CONNS, { id: 'c9', name: DUCK_MARKER_NAME, type: 'mysql' }]
    expect(resolveConn(`-- @conn "${DUCK_MARKER_NAME}"\nSELECT 1`, withDup)).toMatchObject({
      kind: 'conn',
      connId: 'c9',
    })
  })

  it('없는 이름은 조용히 넘어가지 않고 에러다', () => {
    const t = resolveConn('-- @conn "지워진DB"\nSELECT 1', CONNS)
    expect(t.kind).toBe('error')
    expect(t.kind === 'error' && t.message).toContain('지워진DB')
  })

  it('마커가 둘 이상이면 에러다 — 마지막이 이기게 두지 않는다', () => {
    const t = resolveConn('-- @conn "운영 MySQL"\n-- @conn "MES PostgreSQL"\nSELECT 1', CONNS)
    expect(t.kind).toBe('error')
    expect(t.kind === 'error' && t.message).toContain('2개')
  })

  it('이름 없는 마커는 에러다', () => {
    expect(resolveConn('-- @conn\nSELECT 1', CONNS).kind).toBe('error')
  })
})

describe('targetFor', () => {
  const fallback = { mode: 'sql' as const, connId: 'c1' }

  it('마커가 없으면 기본값 그대로다', () => {
    expect(targetFor(resolveConn('SELECT 1', CONNS), fallback)).toEqual({
      mode: 'sql',
      connId: 'c1',
      overridden: false,
    })
  })

  it('지정하면 그 연결로 바꾼다', () => {
    expect(targetFor(resolveConn('-- @conn "MES PostgreSQL"\nS', CONNS), fallback)).toEqual({
      mode: 'sql',
      connId: 'c2',
      overridden: true,
    })
  })

  it('연합 조회는 mode 까지 바뀌고 연결을 고르지 않는다', () => {
    const r = targetFor(resolveConn(`-- @conn "${DUCK_MARKER_NAME}"\nS`, CONNS), fallback)
    expect(r).toMatchObject({ mode: 'duck', connId: undefined, overridden: true })
  })

  it('MongoDB 는 문장별로 고를 수 없다 — 기본값을 지키고 이유를 말한다', () => {
    const r = targetFor(resolveConn('-- @conn "mongo_log"\nS', CONNS), fallback)
    expect(r.overridden).toBe(false)
    expect(r.connId).toBe('c1')
    expect(r.error).toContain('MongoDB')
  })

  it('해석 실패는 기본값으로 떨어지지 않고 에러를 들고 온다', () => {
    const r = targetFor(resolveConn('-- @conn "없음"\nS', CONNS), fallback)
    expect(r.error).toBeTruthy()
  })
})

describe('upsertMarker', () => {
  it('마커가 없으면 문장 첫 줄 앞에 넣는다', () => {
    const { text } = upsertMarker('SELECT 1', 'MES PostgreSQL')
    expect(text).toBe('-- @conn "MES PostgreSQL"\nSELECT 1')
  })

  it('앞의 빈 줄은 그대로 두고 내용 줄 앞에 놓는다', () => {
    const { text } = upsertMarker('\n\nSELECT 1', '운영 MySQL')
    expect(text).toBe('\n\n-- @conn "운영 MySQL"\nSELECT 1')
  })

  it('이미 있으면 갈아 끼운다 (중복으로 쌓이지 않는다)', () => {
    const { text } = upsertMarker('-- @conn "운영 MySQL"\nSELECT 1', 'MES PostgreSQL')
    expect(text).toBe('-- @conn "MES PostgreSQL"\nSELECT 1')
    expect(findMarkers(text)).toHaveLength(1)
  })

  it('손으로 여러 개 써 둔 경우 하나로 정리한다', () => {
    const { text } = upsertMarker('-- @conn "a"\n-- @conn "b"\nSELECT 1', '운영 MySQL')
    expect(findMarkers(text)).toHaveLength(1)
    expect(text).toBe('-- @conn "운영 MySQL"\nSELECT 1')
  })

  it('null 이면 지운다 — 기본 연결로 되돌리는 길', () => {
    expect(upsertMarker('-- @conn "운영 MySQL"\nSELECT 1', null).text).toBe('SELECT 1')
  })

  it('마커가 없는데 null 이면 아무것도 바꾸지 않는다', () => {
    expect(upsertMarker('SELECT 1', null)).toEqual({ text: 'SELECT 1', delta: 0, at: 0 })
  })

  it('delta 로 커서를 보정할 수 있다', () => {
    const stmt = 'SELECT 1'
    const { text, delta, at } = upsertMarker(stmt, '운영 MySQL')
    expect(at).toBe(0)
    expect(text.length - stmt.length).toBe(delta)
  })

  it('따옴표가 든 이름을 넣고 다시 읽어도 같다 (왕복)', () => {
    const name = 'weird "quoted" name'
    const { text } = upsertMarker('SELECT 1', name)
    expect(findMarkers(text)[0].name).toBe(name)
  })
})

describe('markerLine', () => {
  it('언제나 인용한다 — 뒤에 무엇이 붙어도 경계가 흔들리지 않게', () => {
    expect(markerLine('plain')).toBe('-- @conn "plain"')
    expect(markerLine('has space')).toBe('-- @conn "has space"')
  })
})

describe('placeMarker — `/conn` 이 마커를 놓는 자리', () => {
  /** 편집기가 하는 일을 그대로 흉내낸다: 트리거를 지운 문서로 문장을 나눈 뒤 적용. */
  const apply = (doc: string, name: string | null) => {
    const from = doc.indexOf('/conn.')
    const to = doc.length // 트리거는 커서(문서 끝)까지라고 본다
    const trimmed = doc.slice(0, from) + doc.slice(to)
    const r = placeMarker(doc, from, to, name, sqlStatementRanges(trimmed))
    return { text: doc.slice(0, r.from) + r.insert + doc.slice(r.to), anchor: r.anchor }
  }

  it('커서가 문장 중간이어도 마커는 문장 맨 앞 제 줄에 놓인다', () => {
    // 커서 자리에 그대로 끼우면 `--` 가 뒤를 통째로 주석으로 만든다.
    const { text } = apply('SELECT * FROM t WHERE /conn.MES', 'MES PostgreSQL')
    expect(text).toBe('-- @conn "MES PostgreSQL"\nSELECT * FROM t WHERE ')
    expect(stripMarkers(text).trim()).toBe('SELECT * FROM t WHERE')
  })

  it('여러 문장 중 커서가 놓인 문장에만 붙는다', () => {
    const { text } = apply('SELECT 1;\nSELECT 2 /conn.MES', 'MES PostgreSQL')
    const ranges = sqlStatementRanges(text)
    expect(resolveConn(text.slice(ranges[0].from, ranges[0].to), CONNS).kind).toBe('inherit')
    expect(resolveConn(text.slice(ranges[1].from, ranges[1].to), CONNS)).toMatchObject({
      kind: 'conn',
      connId: 'c2',
    })
  })

  it('이미 마커가 있으면 갈아 끼운다 — 두 개로 쌓이지 않는다', () => {
    const { text } = apply('-- @conn "운영 MySQL"\nSELECT 1 /conn.MES', 'MES PostgreSQL')
    expect(findMarkers(text)).toHaveLength(1)
    expect(findMarkers(text)[0].name).toBe('MES PostgreSQL')
  })

  it('「기본 연결 따르기」(null)는 마커를 지운다', () => {
    const { text } = apply('-- @conn "운영 MySQL"\nSELECT 1 /conn.', null)
    expect(findMarkers(text)).toHaveLength(0)
    expect(text.trim()).toBe('SELECT 1')
  })

  it('커서는 원래 편집하던 자리로 돌아온다 (마커 길이만큼만 밀린다)', () => {
    const doc = 'SELECT * FROM t /conn.MES'
    const { anchor, text } = apply(doc, 'MES PostgreSQL')
    // 트리거가 시작하던 자리 = 마커 한 줄 뒤의 같은 지점
    expect(text.slice(0, anchor)).toBe('-- @conn "MES PostgreSQL"\nSELECT * FROM t ')
  })

  it('빈 문서에서도 깨지지 않는다', () => {
    const { text } = apply('/conn.MES', 'MES PostgreSQL')
    expect(findMarkers(text)[0].name).toBe('MES PostgreSQL')
  })
})

describe('커서 아래로 새 문장을 연다 (사용자 보고)', () => {
  /** 편집기 경로. `|` 가 커서(= `/conn.…` 트리거가 놓인 자리)다. */
  const apply = (docWithCursor: string, name: string | null, allowSplit = true) => {
    const doc = docWithCursor.replace('|', '/conn.x')
    const from = doc.indexOf('/conn.x')
    const to = from + '/conn.x'.length
    const trimmed = doc.slice(0, from) + doc.slice(to)
    const r = placeMarker(doc, from, to, name, sqlStatementRanges(trimmed), allowSplit)
    return doc.slice(0, r.from) + r.insert + doc.slice(r.to)
  }

  it('세미콜론 없이 쓴 쿼리 아래에서 부르면 위 마커를 건드리지 않는다', () => {
    // 이게 보고된 버그다 — 위의 「창고 WMS」 가 조용히 바뀌고 있었다.
    const out = apply('-- @conn "창고 WMS"\nselect *\nfrom dbo.items\n|', '고객센터')
    expect(out).toBe(
      '-- @conn "창고 WMS"\nselect *\nfrom dbo.items;\n\n-- @conn "고객센터"\n',
    )
    const ranges = sqlStatementRanges(out)
    expect(resolveConn(out.slice(ranges[0].from, ranges[0].to), CONNS_WMS)).toMatchObject({
      name: '창고 WMS',
    })
    expect(resolveConn(out.slice(ranges[1].from, ranges[1].to), CONNS_WMS)).toMatchObject({
      name: '고객센터',
    })
  })

  it('마커가 없던 쿼리 아래에서도 마찬가지다', () => {
    const out = apply('select * from a\n|', '고객센터')
    expect(out).toBe('select * from a;\n\n-- @conn "고객센터"\n')
  })

  it('커서가 문장 머리면 그 문장의 연결을 바꾼다 (가르지 않는다)', () => {
    const out = apply('-- @conn "창고 WMS"\n|select * from dbo.items', '고객센터')
    expect(out).toBe('-- @conn "고객센터"\nselect * from dbo.items')
  })

  it('커서 뒤에 SQL 이 남아 있으면 가르지 않는다 — 가르면 쿼리가 깨진다', () => {
    const out = apply('select *|\nfrom dbo.items', '고객센터')
    expect(out).toBe('-- @conn "고객센터"\nselect *\nfrom dbo.items')
  })

  it('이미 `;` 로 끝났으면 가를 것이 없다 — 마커만 커서 줄에 놓인다', () => {
    // `;` 뒤는 이미 다른 문장이라 갈 필요가 없다. 세미콜론도 더 붙지 않는다.
    const out = apply('select * from a;\n|', '고객센터')
    expect(out).toBe('select * from a;\n-- @conn "고객센터"\n')
    expect(sqlStatementRanges(out)).toHaveLength(2)
  })

  it('앞 쿼리가 `--` 주석으로 끝나면 `;` 를 다음 줄에 놓는다', () => {
    const out = apply('select * from a -- 확인\n|', '고객센터')
    // 같은 줄에 붙이면 주석에 먹혀 두 문장이 하나로 합쳐진다.
    expect(sqlStatementRanges(out)).toHaveLength(2)
  })

  it('「기본 연결 따르기」는 가르지 않는다 — 지우는 동작이다', () => {
    const out = apply('-- @conn "창고 WMS"\nselect * from a\n|', null)
    expect(findMarkers(out)).toHaveLength(0)
  })

  it('노트북 셀(allowSplit=false)은 언제나 그 셀의 연결만 정한다', () => {
    const out = apply('-- @conn "창고 WMS"\nselect * from a\n|', '고객센터', false)
    expect(findMarkers(out)).toHaveLength(1)
    expect(findMarkers(out)[0].name).toBe('고객센터')
    expect(sqlStatementRanges(out)).toHaveLength(1)
  })
})

describe('mergeBody — 셀 편집기는 마커 줄을 감춘다', () => {
  it('본문을 고쳐도 마커가 살아남는다', () => {
    const src = '-- @conn "창고 WMS"\nselect * from a'
    expect(stripMarkers(src)).toBe('select * from a') // 편집기에 보이는 것
    expect(mergeBody(src, 'select * from b')).toBe('-- @conn "창고 WMS"\nselect * from b')
  })

  it('본문을 다 지워도 연결은 남는다', () => {
    expect(mergeBody('-- @conn "창고 WMS"\nselect 1', '')).toBe('-- @conn "창고 WMS"\n')
  })

  it('마커가 없으면 그대로 지나간다', () => {
    expect(mergeBody('select 1', 'select 2')).toBe('select 2')
  })

  it('본문에 손으로 쓴 마커가 이긴다 — 방금 친 것이 사라지면 안 된다', () => {
    const src = '-- @conn "창고 WMS"\nselect 1'
    expect(mergeBody(src, '-- @conn "고객센터"\nselect 1')).toBe('-- @conn "고객센터"\nselect 1')
  })

  it('편집을 반복해도 마커가 쌓이지 않는다 (제어 컴포넌트 왕복)', () => {
    let src = '-- @conn "창고 WMS"\nselect 1'
    for (let i = 0; i < 5; i++) src = mergeBody(src, stripMarkers(src) + ' ')
    expect(findMarkers(src)).toHaveLength(1)
  })
})
