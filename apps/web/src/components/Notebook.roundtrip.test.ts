/** 노트북 ↔ 편집기 왕복에서 **셀별 연결이 살아남는가.**
 *
 *  이 기능이 `Cell` 에 연결 필드를 두지 않고 본문 주석(`-- @conn`)을 쓰는 이유가
 *  여기다 — 뷰를 토글할 때 정보가 새면 화면과 실행이 갈린다. 그 약속을 못 박는다. */
import { describe, expect, it } from 'vitest'
import { cellUid, cellsToText, textToCells, type Cell } from './Notebook'
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
