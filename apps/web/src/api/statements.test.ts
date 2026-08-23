import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STATEMENTS,
  SQL_STATEMENTS,
  canMute,
  mutedRunMessage,
  parseStatements,
  riskOf,
  statementOf,
  statementsOf,
  toCsv,
  toggleMuted,
} from './statements'

/** 백엔드 `connection_service.SQL_STATEMENTS` 와 같은 목록·순서여야 한다.
 *  한쪽만 늘리면 화면에는 보이는데 저장이 거부된다. */
describe('허용 명령 목록', () => {
  it('백엔드와 같은 순서로 아홉 개를 담는다', () => {
    expect([...SQL_STATEMENTS]).toEqual([
      'select',
      'insert',
      'update',
      'delete',
      'merge',
      'create',
      'alter',
      'drop',
      'truncate',
    ])
  })

  it('위험도는 셋으로만 갈린다', () => {
    expect(riskOf('select')).toBe('read')
    expect(riskOf('update')).toBe('write')
    expect(riskOf('drop')).toBe('ddl')
  })
})

describe('parseStatements', () => {
  it('배열·CSV 를 모두 받고 표시 순서로 고정한다', () => {
    expect(parseStatements(['update', 'select'])).toEqual(['select', 'update'])
    expect(parseStatements('update,select')).toEqual(['select', 'update'])
  })

  it('대소문자·중복·모르는 값을 정리한다', () => {
    expect(parseStatements(['SELECT', 'Select', 'selct'])).toEqual(['select'])
  })

  it('비어 있으면 비어 있는 대로 둔다 — 편집 중 마지막 하나를 껐을 때 되살아나면 안 된다', () => {
    expect(parseStatements('')).toEqual([])
    expect(parseStatements([])).toEqual([])
  })
})

describe('statementsOf (연결에서 실제로 실행되는 명령)', () => {
  const conn = (config: Record<string, unknown>) => ({ config })

  it('설정이 없으면 읽기 전용 — 백엔드 기본값과 같다', () => {
    expect(statementsOf(conn({ host: 'db' }))).toEqual(DEFAULT_STATEMENTS)
    expect(statementsOf(null)).toEqual(DEFAULT_STATEMENTS)
  })

  it('알아볼 수 없는 값도 읽기 전용으로 떨어진다 (넓히는 쪽으로 실패하지 않는다)', () => {
    expect(statementsOf(conn({ allowed_statements: ['선택'] }))).toEqual(['select'])
  })

  it('저장된 목록을 그대로 비춘다', () => {
    expect(statementsOf(conn({ allowed_statements: ['select', 'update'] }))).toEqual([
      'select',
      'update',
    ])
  })
})

describe('toCsv', () => {
  it('폼이 들고 다니는 CSV 로 되돌린다', () => {
    expect(toCsv(['select', 'update'])).toBe('select,update')
    expect(parseStatements(toCsv(['drop', 'select']))).toEqual(['select', 'drop'])
  })
})

describe('statementOf (실행 전 선두 명령 판정)', () => {
  it('선두 명령을 읽고 CTE 는 select 로 본다', () => {
    expect(statementOf('SELECT 1')).toBe('select')
    expect(statementOf('  update t set x=1')).toBe('update')
    expect(statementOf('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('select')
  })

  it('앞의 주석에 속지 않는다', () => {
    expect(statementOf('-- 메모\nINSERT INTO t VALUES (1)')).toBe('insert')
    expect(statementOf('/* 설명 */ DELETE FROM t')).toBe('delete')
  })

  it('모르는 것은 null — 판정하지 못하면 막지 않고 서버에 맡긴다', () => {
    expect(statementOf('')).toBeNull()
    expect(statementOf('EXEC sp_who')).toBeNull()
  })
})

describe('잠시 끄기 (툴바 태그)', () => {
  it('SELECT 는 끌 수 없다', () => {
    expect(canMute('select')).toBe(false)
    expect(canMute('insert')).toBe(true)
  })

  it('토글하면 켜지고 꺼진다', () => {
    const a = toggleMuted({}, 'c1', 'insert')
    expect(a).toEqual({ c1: ['insert'] })
    const b = toggleMuted(a, 'c1', 'update')
    expect(b.c1).toEqual(['insert', 'update']) // 표시 순서로 고정
    expect(toggleMuted(b, 'c1', 'insert').c1).toEqual(['update'])
  })

  it('마지막 하나를 켜면 연결 키까지 지운다 — 안 쓰는 항목이 쌓이지 않게', () => {
    expect(toggleMuted({ c1: ['insert'] }, 'c1', 'insert')).toEqual({})
  })

  it('다른 연결의 설정은 건드리지 않는다', () => {
    expect(toggleMuted({ c1: ['drop'] }, 'c2', 'insert')).toEqual({
      c1: ['drop'],
      c2: ['insert'],
    })
  })
})

describe('mutedRunMessage (실행 직전 차단)', () => {
  it('꺼 둔 명령이면 이유와 되돌리는 법을 함께 알린다', () => {
    const msg = mutedRunMessage('INSERT INTO t VALUES (1)', ['insert'])
    expect(msg).toContain('INSERT')
    expect(msg).toContain('태그')
  })

  it('켜 둔 명령·빈 목록은 통과한다', () => {
    expect(mutedRunMessage('SELECT 1', ['insert'])).toBeNull()
    expect(mutedRunMessage('INSERT INTO t VALUES (1)', [])).toBeNull()
  })

  it('문자열 안의 단어에 속지 않는다', () => {
    expect(mutedRunMessage("SELECT 'insert me' FROM t", ['insert'])).toBeNull()
  })
})
