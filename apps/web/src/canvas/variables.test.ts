import { describe, expect, it } from 'vitest'
import {
  VariableError,
  extract,
  extractNodeRefs,
  malformedPlaceholders,
  missing,
  nodeRefKey,
  nodeRefText,
  render,
  substitute,
} from './variables'

/**
 * 백엔드 `apps/api/tests/test_variables.py` 와 **같은 사례**를 담는다.
 *
 * 문법이 양쪽에 복제되어 있으므로(프론트는 미리보기, 백엔드는 실제 실행) 한쪽만 고치면
 * 두 테스트가 함께 깨져야 한다. 사례를 옮길 때는 반대쪽도 같이 옮길 것.
 */

describe('extract', () => {
  it('평범한 참조를 뽑는다', () => {
    expect(extract("SELECT * FROM t WHERE id = $order_id")).toEqual(['order_id'])
  })

  it('중괄호 형태를 뽑는다', () => {
    expect(extract('orders_${suffix}_raw')).toEqual(['suffix'])
  })

  it('중괄호가 경계를 가른다', () => {
    expect(extract('$table_x')).toEqual(['table_x'])
    expect(extract('${table}_x')).toEqual(['table'])
  })

  it('등장 순서대로 중복 없이', () => {
    expect(extract('$b and $a and $b')).toEqual(['b', 'a'])
  })

  it('변수가 없으면 빈 목록', () => {
    expect(extract('SELECT 1')).toEqual([])
    expect(extract('')).toEqual([])
  })

  it('$$ 는 변수가 아니다', () => {
    expect(extract('price >= $$100')).toEqual([])
  })

  it('숫자로 시작하는 이름은 변수가 아니다', () => {
    expect(extract('$1st')).toEqual([])
  })

  it('홀로 있는 $ 는 무시한다', () => {
    expect(extract('cost in $ only')).toEqual([])
  })

  it('달러 인용($body$) 안의 이름은 변수로 세지 않는다', () => {
    expect(extract('$a $body$ $b $c $body$ $d')).toEqual(['a', 'd'])
  })
})

describe('substitute', () => {
  it('값으로 바꾼다', () => {
    expect(substitute('id = $order_id', { order_id: 42 })).toBe('id = 42')
  })

  it('사용자가 겪은 사례 — 따옴표 안의 변수도 바뀐다', () => {
    // 편집기 실행이 이걸 안 하면 `name = '$since'` 가 그대로 나가 0행이 된다
    const sql = "SELECT *\nFROM shop.customers \nwhere name = '$since'"
    expect(substitute(sql, { since: 'kim' })).toBe(
      "SELECT *\nFROM shop.customers \nwhere name = 'kim'",
    )
  })

  it('중괄호 형태', () => {
    expect(substitute('orders_${suffix}_raw', { suffix: 'kr' })).toBe('orders_kr_raw')
  })

  it('같은 변수가 여러 번', () => {
    expect(substitute('$a-$a', { a: 'x' })).toBe('x-x')
  })

  it('$$ 는 리터럴 $ 로 남는다', () => {
    expect(substitute('price >= $$100', {})).toBe('price >= $100')
  })

  it('값이 없으면 던진다', () => {
    // 빈 문자열로 때우면 `WHERE d > ''` 가 되어 전체 재적재가 조용히 일어난다
    expect(() => substitute('dt > $since', {})).toThrow(VariableError)
    expect(() => substitute('dt > $since', {})).toThrow('since')
  })

  it('자리표시자가 없으면 그대로', () => {
    expect(substitute('SELECT 1', { a: 1 })).toBe('SELECT 1')
  })

  it('달러 인용($procedure$) 본문은 변수로 치환하지 않는다', () => {
    const ddl = 'CREATE PROCEDURE p() AS $procedure$ DECLARE x int; BEGIN NULL; END; $procedure$'
    expect(substitute(ddl, {})).toBe(ddl)
  })

  it('달러 인용 밖의 변수는 여전히 치환된다', () => {
    const ddl = '$since $procedure$ SELECT $inside $procedure$'
    expect(substitute(ddl, { since: '2026' })).toBe('2026 $procedure$ SELECT $inside $procedure$')
  })
})

describe('render', () => {
  it.each([
    [42, '42'],
    [1.5, '1.5'],
    ['x', 'x'],
    [true, 'true'],
    [false, 'false'],
    [null, 'null'],
  ])('%s → %s', (value, expected) => {
    expect(render(value)).toBe(expected)
  })
})

describe('SQL 주입 가드', () => {
  it.each(["o'brien", 'a"b', '1; DROP TABLE t', 'x -- c', 'a /* c */ b'])(
    '%s 는 SQL 문맥에서 거절된다',
    (bad) => {
      expect(() => substitute('dt > $v', { v: bad }, { contextKey: 'where' })).toThrow(VariableError)
    },
  )

  it('제어문자는 거절된다', () => {
    expect(() => substitute('dt > $v', { v: 'a\nb' }, { contextKey: 'query' })).toThrow(
      VariableError,
    )
  })

  it('SQL 문맥이 아니면 통과한다', () => {
    expect(substitute('$v', { v: "o'brien" }, { contextKey: 'prefix' })).toBe("o'brien")
  })

  it('평범한 값은 통과한다', () => {
    expect(substitute('dt > $v', { v: '2026-08-13' }, { contextKey: 'where' })).toBe(
      'dt > 2026-08-13',
    )
  })
})

describe('missing', () => {
  it('값이 없는 이름만 돌려준다', () => {
    expect(missing('$a $b $c', { a: 1, c: 3 })).toEqual(['b'])
  })

  it('모두 있으면 빈 목록', () => {
    expect(missing('$a', { a: null })).toEqual([])
  })
})

describe('extractNodeRefs', () => {
  it('평범한 참조를 뽑는다', () => {
    expect(extractNodeRefs("dt > '${주문조회.max_dt}'")).toEqual([
      { node: '주문조회', column: 'max_dt', many: false },
    ])
  })

  it('이름에 공백이 있어도 된다', () => {
    expect(extractNodeRefs('${daily agg.v}')).toEqual([
      { node: 'daily agg', column: 'v', many: false },
    ])
  })

  it('앞뒤 공백을 턴다', () => {
    expect(extractNodeRefs('${ 집계 . v }')).toEqual([{ node: '집계', column: 'v', many: false }])
  })

  it('마지막 점이 이름과 컬럼을 가른다', () => {
    expect(extractNodeRefs('${주문.집계.dt}')).toEqual([
      { node: '주문.집계', column: 'dt', many: false },
    ])
  })

  it('중괄호가 없으면 참조가 아니다', () => {
    expect(extractNodeRefs('$집계.v')).toEqual([])
  })

  it('등장 순서대로 중복 없이', () => {
    expect(extractNodeRefs('${a.x} ${b.y} ${a.x}')).toEqual([
      { node: 'a', column: 'x', many: false },
      { node: 'b', column: 'y', many: false },
    ])
  })

  it('$$ 로 탈출한 것은 참조가 아니다', () => {
    expect(extractNodeRefs('$${a.x}')).toEqual([])
  })

  it('트리거 변수와 서로 침범하지 않는다', () => {
    expect(extractNodeRefs('${since}')).toEqual([])
    expect(extract('${집계.v}')).toEqual([])
  })

  it('키와 표기', () => {
    expect(nodeRefKey({ node: '집계', column: 'v' })).toBe('집계.v')
    expect(nodeRefText({ node: '집계', column: 'v' })).toBe('${집계.v}')
  })
})

describe('노드 결과 치환', () => {
  it('값으로 바꾼다', () => {
    expect(substitute("dt > '${집계.max_dt}'", { '집계.max_dt': '2026-08-01' })).toBe(
      "dt > '2026-08-01'",
    )
  })

  it('값이 없으면 던진다', () => {
    expect(() => substitute('${집계.v}', {})).toThrow(VariableError)
  })

  it('트리거 변수와 섞여도 된다', () => {
    expect(substitute('$env/${집계.v}', { env: 'prd', '집계.v': 7 })).toBe('prd/7')
  })

  it('꽂아 넣은 값 안의 $ 를 다시 읽지 않는다', () => {
    expect(substitute('${집계.v}', { '집계.v': '$env' })).toBe('$env')
  })

  it('SQL 자리에서는 주입 가드가 걸린다', () => {
    expect(() =>
      substitute('name = ${집계.name}', { '집계.name': "o'brien" }, { contextKey: 'where' }),
    ).toThrow(VariableError)
  })

  it('SQL 이 아닌 자리에서는 따옴표를 허용한다', () => {
    expect(substitute('${집계.name}', { '집계.name': "o'brien" }, { contextKey: 'table' })).toBe(
      "o'brien",
    )
  })
})

describe('malformedPlaceholders', () => {
  it('컬럼이 빠진 것', () => {
    expect(malformedPlaceholders('${집계.}')).toEqual(['${집계.}'])
  })

  it('이름이 빠진 것', () => {
    expect(malformedPlaceholders('${.v}')).toEqual(['${.v}'])
  })

  it('정상 표기는 보고하지 않는다', () => {
    expect(malformedPlaceholders('${since} ${집계.v}')).toEqual([])
  })

  it('$$ 로 탈출한 것은 보고하지 않는다', () => {
    expect(malformedPlaceholders('$${x}')).toEqual([])
  })

  it('한 번만 보고한다', () => {
    expect(malformedPlaceholders('${.v} ${.v}')).toEqual(['${.v}'])
  })
})

describe('목록 참조 ${이름.컬럼[]}', () => {
  it('대괄호가 목록임을 표시한다', () => {
    expect(extractNodeRefs('${주문.id[]}')).toEqual([{ node: '주문', column: 'id', many: true }])
  })

  it('대괄호 안팎의 공백을 턴다', () => {
    expect(extractNodeRefs('${ 주문 . id [ ] }')).toEqual([
      { node: '주문', column: 'id', many: true },
    ])
  })

  it('낱값과 목록은 다른 키다 — 한 파이프라인에서 같이 쓸 수 있다', () => {
    expect(nodeRefKey({ node: '주문', column: 'id' })).toBe('주문.id')
    expect(nodeRefKey({ node: '주문', column: 'id', many: true })).toBe('주문.id[]')
    expect(extractNodeRefs('${주문.id} ${주문.id[]}')).toHaveLength(2)
  })

  it('숫자는 그대로 이어 붙인다', () => {
    expect(substitute('id IN (${주문.id[]})', { '주문.id[]': [1, 2, 3] }, { contextKey: 'where' })).toBe(
      'id IN (1, 2, 3)',
    )
  })

  it('문자는 따옴표를 우리가 붙인다 — 원소마다 손으로 감쌀 방법이 없다', () => {
    expect(
      substitute('name IN (${주문.name[]})', { '주문.name[]': ['Kim', 'Lee'] }, { contextKey: 'where' }),
    ).toBe("name IN ('Kim', 'Lee')")
  })

  it('따옴표를 붙이기 전에 주입 가드를 먼저 통과시킨다', () => {
    expect(() =>
      substitute('name IN (${주문.name[]})', { '주문.name[]': ["o'brien"] }, { contextKey: 'where' }),
    ).toThrow(VariableError)
  })

  it('SQL 자리가 아니면 따옴표 없이 잇는다', () => {
    expect(substitute('${주문.id[]}', { '주문.id[]': [1, 2] }, { contextKey: 'table' })).toBe('1, 2')
  })

  it('빈 목록은 만들지 않는다 — IN () 은 문법 오류다', () => {
    expect(() => substitute('${주문.id[]}', { '주문.id[]': [] })).toThrow(VariableError)
  })

  it('목록 자리에 스칼라가 오면 던진다', () => {
    expect(() => substitute('${주문.id[]}', { '주문.id[]': 1 })).toThrow(VariableError)
  })
})

describe('Python 코드 문맥 (transform.python 의 code)', () => {
  const code = (source: string, values: Record<string, unknown>) =>
    substitute(source, values as never, { contextKey: 'code' })

  it('숫자 목록은 그대로 이어 붙인다', () => {
    expect(code('ALLOWED = [${주문.id[]}]', { '주문.id[]': [1, 2, 3] })).toBe('ALLOWED = [1, 2, 3]')
  })

  it('문자 목록은 따옴표를 붙인다 — 없으면 이름으로 읽혀 터진다', () => {
    expect(code('NAMES = [${주문.name[]}]', { '주문.name[]': ['Kim', 'Lee'] })).toBe(
      "NAMES = ['Kim', 'Lee']",
    )
  })

  it('값 안의 따옴표를 이스케이프한다', () => {
    expect(code('N = [${주문.name[]}]', { '주문.name[]': ["O'Brien"] })).toBe('N = ["O\'Brien"]')
  })

  it('참/거짓·없음은 Python 표기로', () => {
    expect(code('f = ${주문.f}', { '주문.f': true })).toBe('f = True')
    expect(code('x = ${주문.v}', { '주문.v': null })).toBe('x = None')
  })

  it('문자 낱값은 원문 그대로 — 따옴표는 사용자가 붙인다', () => {
    expect(code('dt = "${주문.dt}"', { '주문.dt': '2026-08-01' })).toBe('dt = "2026-08-01"')
  })

  it('SQL 문맥은 그대로다', () => {
    expect(substitute('id IN (${주문.id[]})', { '주문.id[]': [1, 2] }, { contextKey: 'where' })).toBe(
      'id IN (1, 2)',
    )
  })
})
