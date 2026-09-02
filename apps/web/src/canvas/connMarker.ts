/* ─────────────────────────────────────────────────────────────
   문장별 연결 마커 — `-- @conn "MES PostgreSQL"`

   한 탭에서 이기종 DB 를 함께 보기 위한 것이다. 상단 드롭다운이 **기본 연결**이고,
   문장 앞에 이 마커를 두면 그 문장만 다른 연결로 나간다. 마커가 없으면 기본을 따른다.

   ## 왜 주석인가

   편집기와 노트북은 같은 내용을 오가는 두 뷰다(`cellsToText`/`textToCells`).
   연결을 텍스트 밖에 두면 뷰를 한 번 토글하는 순간 조용히 사라진다. 마크다운 셀을
   `/*md … *​/` 주석으로 왕복시키는 것과 같은 이유이고, 같은 방법이다.

   덕분에 **`Cell` 타입에 연결 필드가 없다.** 셀 헤더의 드롭다운은 이 마커를 읽고 쓰는
   뷰일 뿐이라, 두 개의 진실이 생기지 않는다.

   ## 주석이라 안전한 것들 (확인함)

   - `sqlStatementRanges` 는 주석 안의 `;` 를 건너뛰므로 문장 분할이 어긋나지 않는다.
   - 마커는 **그 문장의 범위 안에** 자연스럽게 들어간다 — `;` 로만 자르기 때문이다.
     그래서 "이 마커가 어느 문장의 것인가"를 따로 계산하지 않는다.
   - `statementOf`(프론트)·`statement_verb`(백엔드)가 `--` 주석을 지우고 선두 명령을
     보므로, 마커가 붙은 채 나가도 허용 명령(§21) 판정이 어긋나지 않는다.
   - `federation_reference_hint` 는 `mask_noise` 로 주석을 덮은 뒤 연결 이름을 찾으므로
     마커 때문에 엉뚱한 연합 조회 안내가 뜨지 않는다.

   그래도 **보낼 때는 떼어낸다**(`stripMarkers`). 변수 치환(`substitute`)이 주석을
   가리지 않아, 이름에 `$` 가 든 연결이면 "변수 값이 없습니다"로 실행이 막힌다.

   ## `--` 를 쓰므로 반드시 자기 줄에 혼자 있어야 한다

   `--` 는 줄 끝까지 먹는다. 문장 중간에 끼우면 뒤가 통째로 주석이 되어 조용히 깨진다.
   그래서 넣는 쪽(`upsertMarker`)이 **언제나 문장 맨 앞의 제 줄에** 놓는다.
   ───────────────────────────────────────────────────────────── */
import { t } from '../i18n'

import { DUCK_CONN, quotePart } from './duckRefs'

/** 마커에서 「연합 조회」를 가리키는 이름. 드롭다운의 라벨과 같은 말을 쓴다 —
 *  사용자가 화면에서 본 것을 그대로 적을 수 있어야 한다. */
export const DUCK_MARKER_NAME = '연합 조회'

/** 마커 한 줄. 이름은 인용됐을 수도, 안 됐을 수도 있다 — 둘 다 사용자가 쓰는 형태다.
 *
 *  줄 전체를 잡는다(앞 공백 포함, 뒤 개행 포함). 떼어낼 때 빈 줄이 남지 않게 하려는 것.
 *  `@conn` 대소문자는 무시한다. */
const MARKER_RE = /^[ \t]*--[ \t]*@conn\b[ \t]*(?:"((?:[^"]|"")*)"|([^\s"][^\n]*?))?[ \t]*(?:\r?\n|$)/gim

/** 찾아낸 마커 하나. `from`/`to` 는 넘긴 텍스트 기준이고 **줄 전체**를 덮는다. */
export type ConnMarker = {
  /** 인용을 벗긴 연결 이름. 이름 없이 `-- @conn` 만 쓰면 빈 문자열. */
  name: string
  from: number
  to: number
}

/** 큰따옴표 안의 `""` 이스케이프를 되돌린다. */
const unquote = (raw: string): string => raw.replace(/""/g, '"')

/** 텍스트 안의 모든 마커를 앞에서부터 찾는다. */
export function findMarkers(text: string): ConnMarker[] {
  const out: ConnMarker[] = []
  // 빠른 탈출. `@conn` 으로 보면 대소문자를 무시하는 규칙과 어긋난다(`@CONN` 을 놓친다).
  if (!text || !text.includes('@')) return out
  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(text))) {
    const name = m[1] !== undefined ? unquote(m[1]) : (m[2] ?? '').trim()
    out.push({ name, from: m.index, to: m.index + m[0].length })
    // 빈 매치(이론상)로 무한 루프에 빠지지 않게.
    if (m[0].length === 0) MARKER_RE.lastIndex++
  }
  return out
}

/** 마커 줄을 통째로 지운 SQL. 실제로 서버에 보내는 것은 이 텍스트다. */
export function stripMarkers(text: string): string {
  const marks = findMarkers(text)
  if (marks.length === 0) return text
  let out = ''
  let last = 0
  for (const mk of marks) {
    out += text.slice(last, mk.from)
    last = mk.to
  }
  return out + text.slice(last)
}

/** 마커 한 줄을 만든다. **언제나 인용해서** 넣는다.
 *
 *  `quotePart` 는 필요할 때만 감싸는데, 여기서는 기계가 쓰는 자리라 늘 감싸는 편이
 *  낫다 — 이름 뒤에 사람이 뭘 덧붙여도 경계가 흔들리지 않는다. */
export function markerLine(name: string): string {
  return `-- @conn "${name.replace(/"/g, '""')}"`
}

/** 넘긴 이름이 인용 없이도 안전한가 — 안내 문구에 이름을 실을 때 쓴다(§18 과 같은 규칙). */
export const displayName = (name: string): string => quotePart(name)

/* ─────────────────────────────────────────────────────────────
   해석 — 이름을 실제 목적지로
   ───────────────────────────────────────────────────────────── */

/** 마커 해석에 필요한 최소한의 연결 정보. `Connection` 을 그대로 받지 않는 이유는
 *  이 모듈이 API 타입에 매이지 않게 하려는 것이다(테스트도 가벼워진다). */
export type ConnLike = { id: string; name: string; type: string }

export type ConnTarget =
  /** 기본 연결을 따른다 — 마커가 없다. */
  | { kind: 'inherit' }
  /** 실제 연결 하나. */
  | { kind: 'conn'; connId: string; name: string; type: string }
  /** 연합 조회(DuckDB). */
  | { kind: 'duck'; name: string }
  /** 해석할 수 없다 — 실행을 세워야 한다. */
  | { kind: 'error'; message: string }

/** 이름 비교는 앞뒤 공백·대소문자를 무시한다 — 노드 이름 비교(§17)와 같은 기준이다. */
const norm = (s: string): string => s.trim().toLowerCase()

/** 문장 하나의 목적지를 정한다.
 *
 *  **값이 없으면 시끄럽게 실패한다.** 이름이 틀렸을 때 조용히 기본 연결로 떨어뜨리면
 *  사용자가 보고 있는 칩과 다른 DB 로 쿼리가 나간다 — 가장 늦게 발견되는 종류다.
 *  (`$변수`·노드 결과 참조에서 지켜 온 규칙 그대로다.)
 */
export function resolveConn(text: string, connections: readonly ConnLike[]): ConnTarget {
  const marks = findMarkers(text)
  if (marks.length === 0) return { kind: 'inherit' }
  if (marks.length > 1) {
    // 마지막이 이기게 두면, 위에 있는 마커를 보고 있는 사용자가 다른 DB 로 쏜다.
    return {
      kind: 'error',
      message: t('cui.mk.tooMany', { n: marks.length }),
    }
  }
  const raw = marks[0].name
  if (!raw) {
    return { kind: 'error', message: t('cui.mk.noName') }
  }
  // 실제 연결을 먼저 본다 — 「연합 조회」라는 이름의 연결이 실제로 있다면 그쪽이 구체적이다.
  const hit = connections.find((c) => norm(c.name) === norm(raw))
  if (hit) return { kind: 'conn', connId: hit.id, name: hit.name, type: hit.type }
  if (norm(raw) === norm(DUCK_MARKER_NAME)) return { kind: 'duck', name: DUCK_MARKER_NAME }
  return {
    kind: 'error',
    message: t('cui.mk.notFound', { name: raw }),
  }
}

/** 목적지를 실행에 쓰는 모양으로 편다.
 *
 *  마커가 없으면 탭의 기본값을 그대로 쓴다. MongoDB 는 문법이 달라(`--` 가 주석이
 *  아니다) 마커로 고를 수 없으므로, 해석 결과의 mode 는 `sql`·`duck` 뿐이다. */
export function targetFor(
  target: ConnTarget,
  fallback: { mode: 'sql' | 'mongo' | 'duck'; connId?: string },
): { mode: 'sql' | 'mongo' | 'duck'; connId?: string; overridden: boolean; error?: string } {
  if (target.kind === 'inherit') return { ...fallback, overridden: false }
  if (target.kind === 'error') return { ...fallback, overridden: false, error: target.message }
  if (target.kind === 'duck') return { mode: 'duck', connId: undefined, overridden: true }
  if (target.type === 'mongo') {
    return {
      ...fallback,
      overridden: false,
      error: t('cui.mk.mongo', { name: target.name }),
    }
  }
  return { mode: 'sql', connId: target.connId, overridden: true }
}

/** 해석된 목적지의 사람이 읽는 이름. 해석 못 했으면 `null`. */
export function connName(target: ConnTarget): string | null {
  return target.kind === 'conn' || target.kind === 'duck' ? target.name : null
}

/** 마커가 가리키는 연결 id — 화면(칩·헤더)에서 "지금 이 문장은 어디로 가는가"를
 *  그릴 때 쓴다. 해석되지 않으면 `null`. */
export function markedConnId(text: string, connections: readonly ConnLike[]): string | null {
  const t = resolveConn(text, connections)
  if (t.kind === 'conn') return t.connId
  if (t.kind === 'duck') return DUCK_CONN
  return null
}

/* ─────────────────────────────────────────────────────────────
   쓰기 — 문장 맨 앞에 놓는다
   ───────────────────────────────────────────────────────────── */

/** 텍스트 하나에 대한 마커 갱신 결과. `text` 는 새 전체 텍스트,
 *  `delta` 는 `at` 이후 위치가 밀린 양(커서 보정용)이다. */
export type MarkerEdit = { text: string; delta: number; at: number }

/** 노트북 셀 편집기가 마커 줄을 감추고 편집할 때, 편집 결과를 원본에 되붙인다.
 *
 *  셀 편집기는 `stripMarkers(src)` 를 보여준다 — 칩이 이미 연결을 말하는데 본문 1행에
 *  같은 말이 또 있으면 셀마다 한 줄씩 낭비다. **진실은 여전히 `src`** 이고 여기서는
 *  앞머리를 접어 둘 뿐이라, 편집기 뷰로 넘어가면 주석이 그대로 보인다.
 *
 *  본문에 손으로 마커를 써 넣으면 **그쪽이 이긴다** — 방금 친 것을 무시하고 예전 값으로
 *  되돌리면, 썼는데 사라지는 것으로 보인다. */
export function mergeBody(prevSrc: string, body: string): string {
  const typed = findMarkers(body)[0]?.name
  const keep = typed ?? findMarkers(prevSrc)[0]?.name
  return keep === undefined ? body : upsertMarker(body, keep).text
}

/** `/conn.…` 트리거를 지우고 그 문장 맨 앞에 마커를 놓는, **편집기에 보낼 한 번의 변경**.
 *
 *  커서 자리에 그대로 끼우면 안 된다 — `--` 는 줄 끝까지 주석이라 뒤에 오는 SQL 을
 *  통째로 먹는다. 그래서 트리거를 지운 문서에서 문장을 찾고, 그 문장을 통째로 갈아 끼운다.
 *
 *  `ranges` 는 **트리거를 지운 문서** 기준의 문장 범위다(호출부가 `sqlStatementRanges`
 *  로 만든다). 고르는 규칙은 실행(`pickRunText`)과 같아야 한다 — 다르면 칩이 붙은
 *  문장과 실제로 나가는 문장이 달라진다.
 *
 *  돌려주는 좌표는 **원문 기준**이다.
 */
export function placeMarker(
  doc: string,
  triggerFrom: number,
  triggerTo: number,
  name: string | null,
  ranges: readonly { from: number; to: number }[],
  /** 문장을 갈라도 되는가. 편집기는 `true`(여러 문장이 한 문서에 산다),
   *  노트북 셀은 `false`(셀 하나가 곧 문장 하나라 가를 자리가 없다). */
  allowSplit = true,
): { from: number; to: number; insert: string; anchor: number } {
  const trimmed = doc.slice(0, triggerFrom) + doc.slice(triggerTo)
  const hit =
    ranges.find((r) => triggerFrom <= r.to) ??
    ranges[ranges.length - 1] ?? { from: 0, to: trimmed.length }
  const stmt = trimmed.slice(hit.from, hit.to)
  const at = triggerFrom - hit.from // 문장 안에서의 커서 위치

  /* ── 지금 문장의 연결인가, 새 문장인가 ─────────────────────────
     사용자는 **연결을 먼저 고르고 그 아래에 쿼리를 쓴다.** 그런데 세미콜론 없이
     쓴 쿼리 아래에서 `/conn` 을 부르면 문서 전체가 한 문장이라, 문장 맨 앞 마커를
     갈아 끼우는 것이 곧 **위에 있는 남의 쿼리의 목적지를 조용히 바꾸는 일**이 된다.
     화면에서 멀리 떨어진 줄이라 알아채기도 어렵다.

     셋이 모두 맞을 때만 가른다:
       1. 트리거가 **제 줄 맨 앞**에 있다 — 엔터를 치고 새로 시작한 자리다.
          (`SELECT * FROM t WHERE /conn…` 처럼 쓰던 줄이면 지금 문장의 연결이다.)
       2. 커서 위에 이 문장의 SQL 이 있다 — 없으면 갈 것이 없다.
       3. 커서 뒤에 남은 것이 없다 — `select *|\nfrom t` 를 가르면 쿼리가 깨진다. */
  const head = stmt.slice(0, at)
  const onOwnLine = /(^|\n)[ \t]*$/.test(head)
  const above = stripMarkers(head).trim()
  const below = stmt.slice(at).trim()
  if (allowSplit && name !== null && onOwnLine && above && !below) {
    // 새 문장을 연다. 앞 쿼리를 `;` 로 끊어야 마커가 제 문장을 갖는다 —
    // 안 끊으면 한 문장에 마커가 둘이 되어 실행이 막힌다.
    // `--` 주석으로 끝나면 `;` 가 주석에 먹히므로 줄을 바꿔 붙인다.
    const sep = above.endsWith(';') ? '' : endsInLineComment(above) ? '\n;' : ';'
    const insert = stmt.slice(0, at).replace(/\s+$/, '') + sep + '\n\n' + markerLine(name) + '\n'
    return {
      from: hit.from,
      to: hit.to >= triggerFrom ? hit.to + (triggerTo - triggerFrom) : hit.to,
      insert: insert + stmt.slice(at).replace(/^[ \t]*/, ''),
      anchor: hit.from + insert.length,
    }
  }

  const edit = upsertMarker(stmt, name)
  // `triggerFrom` 앞은 두 문서가 같고, 뒤는 트리거 길이만큼 밀려 있다.
  const shift = triggerTo - triggerFrom
  return {
    from: hit.from,
    to: hit.to >= triggerFrom ? hit.to + shift : hit.to,
    insert: edit.text,
    // 원래 편집하던 자리로 되돌린다 — 마커는 위에 한 줄 생겼을 뿐이다.
    anchor: Math.max(hit.from, triggerFrom + edit.delta),
  }
}

/** 마지막 줄이 `--` 줄주석으로 끝나는가 — 그러면 `;` 를 같은 줄에 붙일 수 없다.
 *
 *  붙이면 세미콜론이 주석에 먹혀 **다음 문장이 이 문장에 합쳐진다.**
 *  `cellsToText`(노트북 → 편집기)와 위 문장 가르기가 같은 이유로 이것을 본다.
 *  문자열 안의 `--` 는 주석이 아니므로 지우고 본다. */
export function endsInLineComment(text: string): boolean {
  const last = text.slice(text.lastIndexOf('\n') + 1).replace(/'(?:[^']|'')*'/g, "''")
  return last.includes('--')
}

/** 문장 텍스트에 마커를 넣거나(있으면) 바꾸거나, `null` 이면 지운다.
 *
 *  넣는 자리는 **언제나 그 문장의 첫 줄 앞**이다. 커서 자리에 끼우면 `--` 가 뒤를
 *  통째로 주석으로 만든다. 앞에 오는 빈 줄·공백은 그대로 두어, 문장 사이 간격이
 *  마커를 넣었다고 달라지지 않게 한다.
 */
export function upsertMarker(stmt: string, name: string | null): MarkerEdit {
  const marks = findMarkers(stmt)
  const line = name === null ? '' : markerLine(name) + '\n'
  if (marks.length > 0) {
    // 이미 있으면 첫 마커를 갈아 끼우고 나머지(손으로 여러 개 쓴 경우)는 지운다 —
    // 고르는 행위가 곧 "이 문장은 여기로"라는 뜻이라 중복을 남길 이유가 없다.
    let out = stmt.slice(0, marks[0].from) + line
    let last = marks[0].to
    for (const mk of marks.slice(1)) {
      out += stmt.slice(last, mk.from)
      last = mk.to
    }
    out += stmt.slice(last)
    return { text: out, delta: out.length - stmt.length, at: marks[0].from }
  }
  if (name === null) return { text: stmt, delta: 0, at: 0 }
  // 문장 앞의 빈 줄·들여쓰기는 건너뛰고 **첫 내용 줄의 시작**에 놓는다.
  const lead = /^[\s]*/.exec(stmt)?.[0] ?? ''
  const nl = lead.lastIndexOf('\n')
  const at = nl >= 0 ? nl + 1 : 0
  const text = stmt.slice(0, at) + line + stmt.slice(at)
  return { text, delta: line.length, at }
}
