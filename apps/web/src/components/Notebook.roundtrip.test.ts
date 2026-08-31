/** 노트북 ↔ 편집기 왕복에서 **셀별 연결이 살아남는가.**
 *
 *  이 기능이 `Cell` 에 연결 필드를 두지 않고 본문 주석(`-- @conn`)을 쓰는 이유가
 *  여기다 — 뷰를 토글할 때 정보가 새면 화면과 실행이 갈린다. 그 약속을 못 박는다. */
import { describe, expect, it } from 'vitest'
import { cellUid, cellsToText, dropCellCache, readCellCache, textToCells, writeCellCache, type Cell } from './Notebook'
import { findMarkers, resolveConn } from '../canvas/connMarker'
import { sqlStatementRanges } from '../canvas/SqlEditor'

const CONNS = [
  { id: 'c1', name: '운영 MySQL', type: 'mysql' },
  { id: 'c2', name: 'MES PostgreSQL', type: 'postgres' },
]
const sql = (src: string): Cell => ({ id: cellUid(), type: 'sql', src })
const md = (src: string): Cell => ({ id: cellUid(), type: 'md', src })

describe('셀별 연결 왕복 (노트북 → 편집기 → 노트북)', () => {
  it('셀마다 다른 연결이 그대로 돌아온다', () => {
    const cells = [
      sql('-- @conn "운영 MySQL"\nSELECT * FROM orders'),
      sql('-- @conn "MES PostgreSQL"\nSELECT * FROM work_order'),
      sql('SELECT 1'), // 기본 연결
    ]
    const back = textToCells(cellsToText(cells))
    expect(back.map((c) => c.src)).toEqual(cells.map((c) => c.src))
    expect(back.map((c) => resolveConn(c.src, CONNS).kind)).toEqual(['conn', 'conn', 'inherit'])
  })

  it('메모 셀이 섞여 있어도 연결이 엉키지 않는다', () => {
    const cells = [
      md('# 재고 비교'),
      sql('-- @conn "운영 MySQL"\nSELECT count(*) FROM inventory'),
      md('여기서부터 MES'),
      sql('-- @conn "MES PostgreSQL"\nSELECT count(*) FROM inventory'),
    ]
    const back = textToCells(cellsToText(cells))
    expect(back.map((c) => c.type)).toEqual(['md', 'sql', 'md', 'sql'])
    expect(resolveConn(back[1].src, CONNS)).toMatchObject({ connId: 'c1' })
    expect(resolveConn(back[3].src, CONNS)).toMatchObject({ connId: 'c2' })
  })

  it('마커만 있고 SQL 이 아직 없는 셀이 다음 문장을 삼키지 않는다', () => {
    // `;` 를 마커 줄 끝에 붙이면 주석에 먹혀 두 셀이 하나로 합쳐졌다.
    const cells = [sql('-- @conn "운영 MySQL"'), sql('SELECT 1')]
    const text = cellsToText(cells)
    expect(sqlStatementRanges(text)).toHaveLength(2)
    expect(textToCells(text)).toHaveLength(2)
  })

  it('본문이 `--` 주석으로 끝나는 셀도 마찬가지다', () => {
    const cells = [sql('SELECT 1 -- 확인 필요'), sql('SELECT 2')]
    expect(textToCells(cellsToText(cells))).toHaveLength(2)
  })

  it('문자열 안의 `--` 는 주석이 아니므로 줄을 바꾸지 않는다', () => {
    expect(cellsToText([sql("SELECT '--'")])).toBe("SELECT '--';")
  })

  it('편집기에서 손으로 쓴 마커도 노트북 셀로 들어온다', () => {
    const typed = 'SELECT 1;\n\n-- @conn "MES PostgreSQL"\nSELECT 2;'
    const cells = textToCells(typed)
    expect(cells).toHaveLength(2)
    expect(findMarkers(cells[0].src)).toHaveLength(0)
    expect(findMarkers(cells[1].src)[0].name).toBe('MES PostgreSQL')
  })
})

/** 셀 결과 캐시가 **그 결과가 나간 곳**까지 들고 가는가.
 *
 *  마커는 실행한 뒤에도 바뀔 수 있어서, 되살린 결과의 「더 보기」·정렬이 지금 값을 다시
 *  계산하면 한 표에 두 DB 의 행이 섞인다 — 오류 없이 값만 섞이는 종류라 화면에 안 보인다. */
describe('셀 결과 캐시가 목적지를 기억한다', () => {
  const base = {
    columns: ['id'],
    rows: [{ id: 1 }],
    row_count: 1,
    truncated: true,
    total: null,
    elapsed_ms: 3,
    execCount: 1,
    sort: null,
    colFilters: {},
    error: null,
    query: 'SELECT * FROM orders',
    ts: Date.now(),
  }

  it('마커가 정한 연결이 새로고침(캐시 왕복) 뒤에도 남는다', () => {
    const id = cellUid()
    writeCellCache(id, { ...base, mode: 'sql', connId: 'c2' })
    expect(readCellCache(id)).toMatchObject({ mode: 'sql', connId: 'c2' })
    dropCellCache(id)
  })

  it('연합 조회는 connId 가 비어도 mode 로 남는다', () => {
    // `connId` 로 "없다"와 "모른다"를 가를 수 없는 이유 — 연합 조회는 정상적으로 비어 있다.
    const id = cellUid()
    writeCellCache(id, { ...base, mode: 'duck', connId: undefined })
    const back = readCellCache(id)
    expect(back?.mode).toBe('duck')
    expect(back?.connId).toBeUndefined()
    dropCellCache(id)
  })

  it('이 필드가 생기기 전에 쓰인 캐시도 그대로 읽힌다 (mode 만 비어 있다)', () => {
    // 키 버전을 올리지 않았으므로 옛 항목이 그대로 살아 있다. 깨지지 않고 목적지만
    // 비어 있어야 한다 — 그때만 `ranTarget()` 이 지금 값으로 떨어진다.
    const id = cellUid()
    writeCellCache(id, { ...base })
    const back = readCellCache(id)
    expect(back?.query).toBe(base.query)
    expect(back?.mode).toBeUndefined()
    expect(back?.connId).toBeUndefined()
    dropCellCache(id)
  })
})
