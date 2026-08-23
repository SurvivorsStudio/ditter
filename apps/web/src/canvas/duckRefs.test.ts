/** 연합 조회 표기 — 백엔드 `duck_service.rewrite` 가 되읽을 수 있는 문자열만 만들어야 한다.
 *
 *  여기서 어긋나면 증상이 고약하다: 편집기가 넣어 준 이름을 서버가 "연결을 찾을 수 없다"고
 *  거절한다. 사용자가 직접 친 것도 아닌데. 그래서 파이썬 쪽 `test_duck_refs.py` 와 같은
 *  사례를 양쪽에 둔다.
 */
import { describe, expect, it } from 'vitest'
import { duckDatabase, duckRef, duckStarter, isDuckType, quotePart } from './duckRefs'

describe('duckRef — 단계 수는 엔진이 정한다', () => {
  it('MySQL 은 연결.데이터베이스.테이블 3단계', () => {
    expect(
      duckRef({
        connectionName: 'mysql_wms',
        connectionType: 'mysql',
        database: 'wms',
        namespace: null,
        table: 'aaa',
      }),
    ).toBe('mysql_wms.wms.aaa')
  })

  it('PostgreSQL 은 스키마가 끼어 4단계', () => {
    expect(
      duckRef({
        connectionName: 'postgre_mes',
        connectionType: 'postgres',
        database: 'mes',
        namespace: 'k123',
        table: 'bbb',
      }),
    ).toBe('postgre_mes.mes.k123.bbb')
  })

  it('MSSQL 은 PostgreSQL 과 같은 4단계 (커넥션이 DB 하나에 묶인다)', () => {
    expect(
      duckRef({
        connectionName: 'sqlsrv',
        connectionType: 'mssql',
        database: 'shop',
        namespace: 'dbo',
        table: 'customers',
      }),
    ).toBe('sqlsrv.shop.dbo.customers')
  })

  it('MySQL 은 스키마를 받아도 무시한다 — 그 단계가 없다', () => {
    expect(
      duckRef({
        connectionName: 'm',
        connectionType: 'mysql',
        database: 'wms',
        namespace: 'ignored',
        table: 'aaa',
      }),
    ).toBe('m.wms.aaa')
  })
})

describe('duckRef — 만들 수 없으면 만들지 않는다', () => {
  it('데이터베이스를 모르면 null', () => {
    expect(
      duckRef({
        connectionName: 'm',
        connectionType: 'mysql',
        database: null,
        namespace: null,
        table: 'aaa',
      }),
    ).toBeNull()
  })

  it('PostgreSQL 인데 스키마를 모르면 null — 아무 스키마나 넣으면 실행할 때야 틀린 줄 안다', () => {
    expect(
      duckRef({
        connectionName: 'p',
        connectionType: 'postgres',
        database: 'mes',
        namespace: null,
        table: 'bbb',
      }),
    ).toBeNull()
  })
})

describe('quotePart — 경계가 모호할 때만 감싼다', () => {
  it('평범한 식별자는 그대로', () => {
    expect(quotePart('mysql_wms')).toBe('mysql_wms')
    expect(quotePart('t1$x')).toBe('t1$x')
  })

  it('공백·한글은 감싼다 — 감싸지 않으면 어디까지가 이름인지 알 수 없다', () => {
    expect(quotePart('운영 MySQL')).toBe('"운영 MySQL"')
    expect(quotePart('주문')).toBe('"주문"')
  })

  it('숫자로 시작하면 감싼다', () => {
    expect(quotePart('1st')).toBe('"1st"')
  })

  it('이름 안의 큰따옴표는 겹쳐 이스케이프한다', () => {
    expect(quotePart('od"d')).toBe('"od""d"')
  })

  it('감싼 이름도 정규화 이름에 그대로 들어간다', () => {
    expect(
      duckRef({
        connectionName: '운영 MySQL',
        connectionType: 'mysql',
        database: 'wms',
        namespace: null,
        table: '주문',
      }),
    ).toBe('"운영 MySQL".wms."주문"')
  })
})

describe('지원 타입', () => {
  it('DuckDB 확장이 있는 것만 — 백엔드 DUCK_TYPES 와 같아야 한다', () => {
    expect(isDuckType('mysql')).toBe(true)
    expect(isDuckType('postgres')).toBe(true)
    expect(isDuckType('mssql')).toBe(true) // 커뮤니티 확장으로 ATTACH 된다
    expect(isDuckType('mongo')).toBe(false) // ATTACH 할 수 있는 확장이 없다
    expect(isDuckType('s3')).toBe(false)
  })

  it('duckDatabase 는 빈 값을 데이터베이스로 치지 않는다', () => {
    expect(duckDatabase({ database: 'wms' })).toBe('wms')
    expect(duckDatabase({ database: '  ' })).toBeNull()
    expect(duckDatabase({})).toBeNull()
    expect(duckDatabase(undefined)).toBeNull()
  })
})

describe('duckStarter — 새 탭이 처음 보여 주는 문장', () => {
  it('쓸 수 있는 연결이 있으면 그 이름으로 채운다', () => {
    const sql = duckStarter([{ name: 'mysql_wms', type: 'mysql', config: { database: 'wms' } }])
    expect(sql).toContain('FROM mysql_wms.wms.테이블')
  })

  it('PostgreSQL 이면 스키마 자리까지 보여 준다', () => {
    const sql = duckStarter([{ name: 'pg', type: 'postgres', config: { database: 'mes' } }])
    expect(sql).toContain('FROM pg.mes.스키마.테이블')
  })

  it('MSSQL 도 스키마 자리까지 보여 준다 (PostgreSQL 과 같은 4단계)', () => {
    const sql = duckStarter([{ name: 'sqlsrv', type: 'mssql', config: { database: 'shop' } }])
    expect(sql).toContain('FROM sqlsrv.shop.스키마.테이블')
  })

  it('쓸 수 있는 연결이 없으면 문법 안내만', () => {
    const sql = duckStarter([{ name: 'docs', type: 'mongo', config: { database: 'd' } }])
    expect(sql).toContain('연결이름.데이터베이스.테이블')
    expect(sql).not.toContain('docs')
  })
})
