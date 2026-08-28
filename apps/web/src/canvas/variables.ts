/** 파이프라인 변수 문법 — 백엔드 `schemas/variables.py` 의 **복제본**.
 *
 * 정규식과 규칙이 양쪽에 존재하는 것은 의도된 중복이다. 프론트는 실행 전 미리보기에서,
 * 백엔드는 실제 실행에서 같은 문자열을 같은 값으로 바꿔야 한다. 한쪽만 고치면 "편집기에서는
 * 되는데 실행하면 다르다"가 나므로, 양쪽 테스트에 **같은 사례**를 넣어 함께 깨지게 했다
 * (`variables.test.ts` ↔ `tests/test_variables.py`).
 */

/** 변수 이름 규칙 — 영문/숫자/밑줄, 숫자로 시작 불가 */
const NAME = '[A-Za-z_][A-Za-z0-9_]*'

/** `$name` 과 `${name}` 둘 다 받는다. 중괄호형은 경계가 모호할 때 쓴다. */
const PATTERN = new RegExp(`\\$(?:\\{(${NAME})\\}|(${NAME}))`, 'g')

/** 노드 결과 참조 — `${노드이름.컬럼}` 은 그 노드가 낸 **첫 행의 그 컬럼 값**이다.
 *
 * 트리거 변수와 달리 중괄호가 필수다. 노드 이름은 사람이 붙인 이름이라 한글·공백이
 * 들어가는데, 경계 없이 `$` 뒤에 두면 어디까지가 이름인지 알 수 없다.
 * 이름과 컬럼은 마지막 점으로 갈린다 (컬럼 쪽이 점을 못 쓰기 때문).
 *
 * 컬럼 뒤의 `[]` 는 **모든 행**의 그 컬럼을 쉼표로 이어 붙인다 — `IN (...)` 을 위한 것. */
const NODE_REF = /\$\{\s*([^{}$]+?)\s*\.\s*([^{}$.[\]]+?)\s*(\[\s*\])?\s*\}/g

/** 치환은 두 문법을 **한 번에** 훑는다 (노드 참조 1·2·3 / 트리거 변수 4·5).
 *  따로 훑으면 앞 단계가 꽂은 값 안의 `$` 를 뒤 단계가 다시 변수로 읽는다. */
const SUBSTITUTION = new RegExp(`${NODE_REF.source}|${PATTERN.source}`, 'g')

/** `${...}` 껍데기 전부 — 안이 무엇이든 일단 잡는다 */
const BRACED = /\$\{([^{}]*)\}/g

export type NodeRef = { node: string; column: string; many?: boolean }

/** 값 묶음에서 이 참조를 찾을 때 쓰는 키. 낱값과 목록은 만드는 방법이 달라 키가 갈린다. */
export function nodeRefKey(ref: NodeRef): string {
  return ref.many ? `${ref.node}.${ref.column}[]` : `${ref.node}.${ref.column}`
}

/** 화면에 그대로 보여주고 편집기에 꽂아 넣는 표기 */
export function nodeRefText(ref: NodeRef): string {
  return `\${${nodeRefKey(ref)}}`
}

/** `$$` 는 리터럴 `$` 로 탈출한다 */
const ESCAPE = '$$'
const SENTINEL = '\x00EAI_DOLLAR\x00'

/** PL/pgSQL 달러 인용 블록(`$tag$ … $tag$`, tag 는 이름). 프로시저·함수 본문이 여기 담긴다.
 *
 * 변수 치환에서 통째로 빼지 않으면 `$procedure$` 의 `$procedure` 를 변수로 오인해 실행이 깨진다.
 * 이름 없는 `$` 두 개(빈 태그)는 기존 이스케이프와 모호하므로 건드리지 않는다 — 이름 있는 태그만.
 */
const DOLLAR_OPEN = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g
const DQ_MARK = '\x00DQ'

function maskDollarQuotes(text: string): { masked: string; blocks: string[] } {
  if (!text.includes('$')) return { masked: text, blocks: [] }
  const blocks: string[] = []
  let out = ''
  let last = 0
  DOLLAR_OPEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DOLLAR_OPEN.exec(text))) {
    const delim = m[0]
    const close = text.indexOf(delim, m.index + delim.length)
    if (close < 0) continue // 짝이 없으면 인용 블록이 아니다 — 변수로 둔다
    const end = close + delim.length
    out += text.slice(last, m.index) + `${DQ_MARK}${blocks.length}\x00`
    blocks.push(text.slice(m.index, end))
    last = end
    DOLLAR_OPEN.lastIndex = end
  }
  if (blocks.length === 0) return { masked: text, blocks }
  return { masked: out + text.slice(last), blocks }
}

function restoreDollarQuotes(text: string, blocks: string[]): string {
  if (blocks.length === 0) return text
  // NUL 은 SQL 본문에 나올 수 없어서 센티넬로 골랐다(위 DQ_MARK). 제어문자인 것이 요점이다.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x00DQ(\d+)\x00/g, (_, i) => blocks[Number(i)])
}

/** SQL 로 조립되는 파라미터 — 여기 꽂히는 값은 주입 가드를 통과해야 한다 */
export const SQL_CONTEXT_KEYS = new Set(['query', 'where', 'filter', 'sql'])

/** **Python 코드**로 조립되는 파라미터 (transform.python 의 `code`).
 *
 * JSON 표기가 통하지 않는다 — `true`·`null` 을 그대로 꽂으면 NameError 다. 값을 Python
 * 리터럴로 만든다. 문자열 낱값만 예외로 원문 그대로 둔다: 사용자가 `x = "${집계.dt}"` 처럼
 * 직접 감싸는 것이 기존 규칙이라 여기서 또 감싸면 `"'2026-08-01'"` 이 된다.
 * **낱값은 직접, 목록은 자동** — SQL 과 같은 규칙이다. */
export const PY_CONTEXT_KEYS = new Set(['code'])

/** SQL 문맥에서 거절하는 조각. 문자열을 닫거나 문장을 잇거나 주석으로 뒤를 죽이는 것들. */
const INJECTION_TOKENS = ["'", '"', ';', '--', '/*', '*/', '\\']

export class VariableError extends Error {}

/** 값 묶음. 목록(`${이름.컬럼[]}`)만 배열이고 나머지는 스칼라다. */
export type VariableValues = Record<string, string | number | boolean | null | undefined | unknown[]>

/** 문자열에서 참조된 변수 이름을 등장 순서대로, 중복 없이 뽑는다 */
export function extract(text: string): string[] {
  if (!text || !text.includes('$')) return []
  const names: string[] = []
  const masked = maskDollarQuotes(text).masked.split(ESCAPE).join(SENTINEL)
  for (const m of masked.matchAll(PATTERN)) {
    const name = m[1] ?? m[2]
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/** 문자열에서 참조된 노드 결과를 등장 순서대로, 중복 없이 뽑는다 */
export function extractNodeRefs(text: string): NodeRef[] {
  if (!text || !text.includes('$')) return []
  const refs: NodeRef[] = []
  const masked = maskDollarQuotes(text).masked.split(ESCAPE).join(SENTINEL)
  for (const m of masked.matchAll(NODE_REF)) {
    const ref: NodeRef = { node: m[1], column: m[2], many: m[3] !== undefined }
    if (!refs.some((r) => nodeRefKey(r) === nodeRefKey(ref))) refs.push(ref)
  }
  return refs
}

/** 변수 이름도 노드 참조도 아닌 `${...}`.
 *
 * 치환되지 않고 **글자 그대로 남는다** — `${집계.}` 같은 오타가 SQL 에 실려 나가면
 * 원인을 찾기 어려우니 저작 화면에서 알려주기 위한 목록이다. */
export function malformedPlaceholders(text: string): string[] {
  if (!text || !text.includes('$')) return []
  const found: string[] = []
  const masked = maskDollarQuotes(text).masked.split(ESCAPE).join(SENTINEL)
  const nameOnly = new RegExp(`^${NAME}$`)
  const refOnly = new RegExp(`^(?:${NODE_REF.source})$`)
  for (const m of masked.matchAll(BRACED)) {
    if (nameOnly.test(m[1]) || refOnly.test(m[0])) continue
    if (!found.includes(m[0])) found.push(m[0])
  }
  return found
}

/** 치환에 쓸 문자열 표현. JSON 표기(true/false/null)로 맞춘다 — `True` 는 SQL 이 모른다. */
export function render(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

/**
 * `$이름` 을 값으로 바꾼다.
 *
 * 값이 없으면 던진다. 빈 문자열로 때우면 `WHERE dt > ''` 가 되어 전체 재적재를 조용히
 * 일으킨다 — 미리보기에서도 같은 규칙이어야 실행 결과를 예측할 수 있다.
 */
export function substitute(
  text: string,
  values: VariableValues,
  options: { contextKey?: string } = {},
): string {
  if (!text || !text.includes('$')) return text

  const ctxKey = options.contextKey?.toLowerCase()
  const guard = ctxKey != null && SQL_CONTEXT_KEYS.has(ctxKey)
  const python = ctxKey != null && PY_CONTEXT_KEYS.has(ctxKey)
  // 프로시저·함수 본문($procedure$ … $procedure$)은 치환 대상에서 빼 둔다.
  const { masked: dq, blocks } = maskDollarQuotes(text)
  const masked = dq.split(ESCAPE).join(SENTINEL)

  const out = masked.replace(
    SUBSTITUTION,
    (
      _full,
      refNode?: string,
      refColumn?: string,
      listMark?: string,
      braced?: string,
      bare?: string,
    ) => {
      const isRef = refNode !== undefined
      const key = isRef
        ? nodeRefKey({ node: refNode, column: refColumn ?? '', many: listMark !== undefined })
        : (braced ?? bare ?? '')
      if (!(key in values) || values[key] === undefined) {
        throw new VariableError(
          isRef ? `노드 결과 값이 없습니다: \${${key}}` : `변수 값이 없습니다: $${key}`,
        )
      }
      const raw = values[key]
      if (isRef && listMark !== undefined) return renderList(key, raw, { guard, python })
      // 문자열은 사용자가 따옴표를 붙이는 자리라 원문 그대로 둔다 (PY_CONTEXT_KEYS 참고)
      const rendered = python && typeof raw !== 'string' ? pyLiteral(raw) : render(raw)
      if (guard) assertSqlSafe(key, rendered)
      return rendered
    },
  )

  return restoreDollarQuotes(out.split(SENTINEL).join('$'), blocks)
}

/** `${이름.컬럼[]}` 을 `IN (...)` 안쪽에 넣을 문자열로 만든다.
 *
 * **SQL 자리에서는 따옴표를 우리가 붙인다.** 낱값(`'$since'`)은 사용자가 직접 감싸지만
 * 목록은 원소마다 감싸야 해서 손으로 쓸 방법이 없다. 가드를 먼저 통과시킨 뒤에 붙이므로
 * 값이 따옴표를 닫고 나오는 일은 없다 — 순서가 뒤집히면 그 자체가 주입 통로가 된다.
 */
export function renderList(
  name: string,
  raw: unknown,
  options: { guard?: boolean; python?: boolean } = {},
): string {
  if (!Array.isArray(raw)) throw new VariableError(`\${${name}} 는 목록이어야 합니다`)
  if (raw.length === 0) {
    throw new VariableError(`\${${name}} 가 빈 목록입니다 — 참조한 노드가 행을 내지 않았습니다`)
  }
  return raw
    .map((item) => {
      if (options.python) return pyLiteral(item)
      const rendered = render(item)
      if (!options.guard) return rendered
      assertSqlSafe(name, rendered)
      // 숫자를 감싸면 비교가 문자열 비교가 된다 — 문자만 감싼다
      const bare = item === null || typeof item === 'boolean' || typeof item === 'number'
      return bare ? rendered : `'${rendered}'`
    })
    .join(', ')
}

/** `repr` 이 이름 있는 이스케이프를 주는 셋. 나머지 제어문자는 `\xNN` 이 된다. */
const PY_NAMED_ESCAPES: Record<string, string> = { '\t': '\\t', '\n': '\\n', '\r': '\\r' }

/**
 * 따옴표 안에 들어갈 몸통을 이스케이프한다 (감싸는 따옴표는 호출자가 붙인다).
 *
 * **줄바꿈을 빠뜨리면 안 된다.** Python 의 따옴표 하나짜리 문자열 리터럴은 실제 줄바꿈을
 * 담을 수 없어 `SyntaxError` 가 되고, NUL 은 아예 소스에 들어갈 수 없다
 * ("source code string cannot contain null bytes").
 */
function pyEscapeBody(text: string): string {
  // eslint-disable-next-line no-control-regex -- 제어문자를 이스케이프하는 것이 이 함수의 일이다
  return text.replace(/[\\\u0000-\u001f\u007f]/g, (ch) =>
    ch === '\\'
      ? '\\\\'
      : (PY_NAMED_ESCAPES[ch] ?? `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`),
  )
}

/**
 * Python 리터럴 표기. 백엔드 `_py_literal`(= `repr`) 과 짝이다.
 *
 * ASCII 입력에서는 `repr` 과 **글자까지 같은** 결과를 낸다. 비ASCII 비출력 문자
 * (U+200B 같은 것)는 `repr` 이 `\u200b` 로 쓰지만 여기서는 원문 그대로 둔다 — 그 글자는
 * 리터럴 안에 그냥 있어도 유효한 Python 이라 **값은 같고 표기만 다르다.** 완전한 일치는
 * 유니코드 printable 표가 있어야 하는데, 그 표를 프런트에 복제하면 이 파일이 경계하는
 * 「양쪽이 어긋난다」를 하나 더 만드는 셈이다.
 */
function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  // repr 과 같은 규칙: 작은따옴표가 들어 있고 큰따옴표가 없을 때만 큰따옴표로 감싼다
  const text = String(value)
  if (text.includes("'") && !text.includes('"')) return `"${pyEscapeBody(text)}"`
  return `'${pyEscapeBody(text).replace(/'/g, "\\'")}'`
}

/** 참조됐지만 값이 없는 변수 */
export function missing(text: string, values: VariableValues): string[] {
  return extract(text).filter((n) => !(n in values) || values[n] === undefined)
}

function assertSqlSafe(name: string, rendered: string): void {
  for (const token of INJECTION_TOKENS) {
    if (rendered.includes(token)) {
      throw new VariableError(
        `$${name} 의 값에 SQL 로 해석될 수 있는 문자가 있습니다: ${JSON.stringify(token)}. ` +
          '쿼리·조건절에 꽂는 값에는 따옴표·세미콜론·주석을 넣을 수 없습니다.',
      )
    }
  }
  // 제어문자 검사. 정규식 대신 코드포인트로 본다 — 소스에 제어문자를 직접 적으면
  // 에디터·도구마다 다르게 보여 유지보수가 어렵다.
  for (const ch of rendered) {
    if ((ch.codePointAt(0) ?? 0) < 0x20) {
      throw new VariableError(`$${name} 의 값에 제어문자가 있습니다.`)
    }
  }
}
