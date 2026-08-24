/** 연결마다 허용하는 SQL 명령 (쿼리 편집기 실행 가드).
 *
 * 백엔드 `connection_service.SQL_STATEMENTS` 와 **반드시 같아야 한다** —
 * 한쪽만 늘리면 화면에는 체크박스가 보이는데 저장이 거부된다
 * (`DUCK_TYPES`·`SYNC_CHANNELS` 와 같은 주의).
 *
 * 표기는 항상 대문자(`SELECT`)로 보여주고, 저장되는 값은 소문자다.
 */

/** 표시 순서를 겸한다 — 체크박스도 태그도 이 순서로 나온다. */
export const SQL_STATEMENTS = [
  'select',
  'insert',
  'update',
  'delete',
  'merge',
  'create',
  'alter',
  'drop',
  'truncate',
] as const

export type SqlStatement = (typeof SQL_STATEMENTS)[number]

/** 허용 명령이 저장되지 않은 연결(이 기능 이전에 만든 것 포함)의 기본값 — 읽기 전용.
 *  백엔드 `DEFAULT_STATEMENTS` 와 같다. */
export const DEFAULT_STATEMENTS: SqlStatement[] = ['select']

/** 위험도 단계 — 태그·체크박스 색을 가른다. 무엇을 켜는지 눈으로 구분되게 한다. */
export type StatementRisk = 'read' | 'write' | 'ddl'

const RISK: Record<SqlStatement, StatementRisk> = {
  select: 'read',
  insert: 'write',
  update: 'write',
  delete: 'write',
  merge: 'write',
  create: 'ddl',
  alter: 'ddl',
  drop: 'ddl',
  truncate: 'ddl',
}

export const riskOf = (s: SqlStatement): StatementRisk => RISK[s]

/** 칩에 함께 보이는 짧은 말. 이름만으로는 무엇을 켜는지 한눈에 안 들어온다.
 *  길면 칩이 줄을 넘겨 아홉 개가 흩어지므로 여기서는 짧게만 — 자세한 건 툴팁이 맡는다. */
export const STATEMENT_HINT: Record<SqlStatement, string> = {
  select: '조회',
  insert: '행 추가',
  update: '행 수정',
  delete: '행 삭제',
  merge: '수정+추가',
  create: '생성',
  alter: '스키마 변경',
  drop: '테이블 삭제',
  truncate: '전체 삭제',
}

/** 칩에 마우스를 올렸을 때의 한 문장. 되돌릴 수 없는 것은 그렇다고 적는다 —
 *  체크 한 번으로 열리는 권한이라 무엇을 여는지 여기서 분명히 해야 한다. */
export const STATEMENT_DETAIL: Record<SqlStatement, string> = {
  select: '데이터를 읽습니다.',
  insert: '테이블에 행을 추가합니다.',
  update: '기존 행의 값을 바꿉니다.',
  delete: '조건에 맞는 행을 지웁니다 — 되돌릴 수 없습니다.',
  merge: '키가 있으면 수정하고 없으면 추가합니다 (upsert).',
  create: '테이블·인덱스 등을 만듭니다.',
  alter: '테이블 구조를 바꿉니다 — 기존 파이프라인이 깨질 수 있습니다.',
  drop: '테이블을 통째로 지웁니다 — 되돌릴 수 없습니다.',
  truncate: '테이블의 모든 행을 지웁니다 — 되돌릴 수 없습니다.',
}

const isStatement = (v: string): v is SqlStatement =>
  (SQL_STATEMENTS as readonly string[]).includes(v)

/** 값(배열 또는 CSV)을 목록으로 편다. **비어 있으면 비어 있는 대로** 돌려준다 —
 *  편집 중인 폼이 마지막 하나를 껐을 때 SELECT 가 도로 켜지면 안 된다.
 *  모르는 값은 버린다(화면 표시용이라 실행 가드와 달리 관대해도 된다). */
export function parseStatements(raw: unknown): SqlStatement[] {
  const items =
    typeof raw === 'string'
      ? raw.split(/[,\s]+/)
      : Array.isArray(raw)
        ? raw.map((v) => String(v))
        : []
  const picked = new Set(items.map((v) => v.trim().toLowerCase()).filter(isStatement))
  return SQL_STATEMENTS.filter((s) => picked.has(s)) // 표시 순서로 고정
}

/** 연결에서 **실제로 실행되는** 허용 명령 — 태그·안내는 이 함수로 읽는다.
 *
 * 설정이 없거나 알아볼 수 없으면 읽기 전용으로 본다. 백엔드
 * `connection_statements` 와 같은 기본값이라야 태그가 거짓말을 하지 않는다.
 */
export function statementsOf(
  conn: { config: Record<string, unknown> } | null | undefined,
): SqlStatement[] {
  const parsed = parseStatements(conn?.config?.allowed_statements)
  return parsed.length ? parsed : [...DEFAULT_STATEMENTS]
}

/** 폼은 CSV 문자열로 들고 있다 (값 맵이 `string | boolean` 이라 배열을 담을 수 없다). */
export const toCsv = (list: SqlStatement[]): string => list.join(',')

/** 문장의 선두 명령. 백엔드 `connection_service.statement_verb` 와 같은 규칙이다 —
 *  문자열·주석을 지우고 첫 낱말을 보며, CTE(`WITH`)는 `select` 로 본다.
 *
 *  여기서 하는 판정은 **실행 전에 막기 위한 것**이고, 실제 가드는 서버에 있다.
 *  둘이 어긋나면 화면이 통과시킨 것을 서버가 거절할 뿐, 반대 방향으로는 새지 않는다. */
export function statementOf(sql: string): SqlStatement | null {
  const scan = (sql || '')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
  const m = /^([a-z]+)\b/i.exec(scan)
  if (!m) return null
  const verb = m[1].toLowerCase()
  const head = verb === 'with' ? 'select' : verb
  return isStatement(head) ? head : null
}

/* ─────────────────────────────────────────────────────────────
   잠시 꺼 두기 (편집기 툴바 태그 클릭)

   연결의 허용 명령이 "이 연결에서 무엇이 가능한가"라면, 이건 **지금 내가 실수하지
   않겠다**는 표시다. 허용된 명령 안에서만 끌 수 있고, 끄면 그 연결로는 실행이 막힌다.

   기기·브라우저 로컬에 남긴다(즐겨찾기·저장된 쿼리와 같은 전제). 서버에 두면 남이
   켠 것을 내가 끄는 셈이 되는데, 이건 **내 실수를 막는 장치**라 그러면 뜻이 달라진다.
   그래서 보안 경계가 아니다 — 진짜 경계는 연결의 허용 명령(서버)이다.
   ───────────────────────────────────────────────────────────── */

const MUTED_KEY = 'eai_muted_statements_v1'

/** 연결 id → 꺼 둔 명령 목록. */
export type MutedMap = Record<string, SqlStatement[]>

export function loadMuted(): MutedMap {
  try {
    const raw = localStorage.getItem(MUTED_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: MutedMap = {}
    for (const [connId, list] of Object.entries(parsed as Record<string, unknown>)) {
      const picked = parseStatements(list)
      if (picked.length) out[connId] = picked
    }
    return out
  } catch {
    return {}
  }
}

export function storeMuted(map: MutedMap): void {
  try {
    localStorage.setItem(MUTED_KEY, JSON.stringify(map))
  } catch {
    /* 용량 초과 등은 조용히 무시 */
  }
}

/** 한 명령을 껐다 켠다. 빈 목록은 키째 지운다 — 안 쓰는 연결이 쌓이지 않게. */
export function toggleMuted(map: MutedMap, connId: string, stmt: SqlStatement): MutedMap {
  const cur = map[connId] ?? []
  const next = cur.includes(stmt) ? cur.filter((s) => s !== stmt) : [...cur, stmt]
  const rest = { ...map }
  if (next.length) rest[connId] = SQL_STATEMENTS.filter((s) => next.includes(s))
  else delete rest[connId]
  return rest
}

/** SELECT 는 끌 수 없다. 실수로 조회하는 일은 없고, 끄면 편집기가 아무 일도 못 한다. */
export const canMute = (s: SqlStatement): boolean => s !== 'select'

/** 실행 직전 검사 — 꺼 둔 명령이면 막는 이유를 돌려준다(통과면 null). */
export function mutedRunMessage(sql: string, muted: SqlStatement[]): string | null {
  if (!muted.length) return null
  const stmt = statementOf(sql)
  if (!stmt || !muted.includes(stmt)) return null
  return `${stmt.toUpperCase()} 를 꺼 두었습니다 — 실행하지 않았습니다. 상단의 ${stmt.toUpperCase()} 태그를 눌러 다시 켜세요.`
}
