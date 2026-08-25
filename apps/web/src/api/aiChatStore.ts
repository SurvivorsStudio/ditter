/** AI 챗 탭 — 대화 트랜스크립트 로컬 저장 (설계 문서 §7.6).
 *
 *  워크스페이스(`eai_sql_workspace_v1`)는 통째로 디바운스 직렬화되므로, 길어지는
 *  대화 이력을 세션에 넣으면 저장이 요동친다. 그래서 **전용 저장소**에 두고 세션은
 *  탭이 챗인지만 표시한다.
 *
 *  탭이 챗인지는 `connId === AI_CONN` 센티널로 가른다 — 연합 조회(DUCK_CONN)를 연결
 *  선택의 한 항목으로 둔 것과 같은 방식이라, 별도 탭 '종류'를 만들지 않는다.
 *  대화는 세션 id 로 키를 잡는다(워크스페이스와 함께 안정적으로 유지된다).
 */

export const AI_CONN = '__ai__'
export const isChatConn = (id: string | undefined): boolean => id === AI_CONN

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  /** assistant 응답에서 추출한 SQL (있으면 실행 버튼을 붙인다) */
  sql?: string | null
  /** 스키마를 못 읽었거나 일부만 넣었을 때의 안내 */
  note?: string | null
  /** 오류 말풍선 표시용 */
  error?: boolean
}

export type ChatIntent = 'sql.generate' | 'sql.tune'

export type ChatState = {
  aiConnId?: string
  dbConnId?: string
  intent: ChatIntent
  /** 언급된 테이블의 예시 행을 프롬프트에 넣어 값→컬럼 매핑 정확도를 높인다.
   *  실제 데이터가 AI 프로바이더로 전송된다 — 기본은 꺼짐, 사용자가 토글로 켤 때만 보낸다
   *  (undefined/미설정=꺼짐. 백엔드 include_samples 기본 False 와 일치). */
  samples?: boolean
  messages: ChatMessage[]
}

const KEY = 'eai_ai_chats_v1'

const empty = (): ChatState => ({ intent: 'sql.generate', messages: [] })

function readAll(): Record<string, ChatState> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, ChatState>) : {}
  } catch {
    return {}
  }
}

export function loadChat(sessionId: number): ChatState {
  const all = readAll()
  return all[String(sessionId)] ?? empty()
}

export function saveChat(sessionId: number, state: ChatState): void {
  const all = readAll()
  all[String(sessionId)] = state
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* 용량 초과 등은 무시 — 이력은 편의 기능이다 */
  }
}

/** 탭을 닫을 때 이력을 정리한다 (설계 D6: 닫으면 폐기, 프롬프트만 영속). */
export function clearChat(sessionId: number): void {
  const all = readAll()
  if (String(sessionId) in all) {
    delete all[String(sessionId)]
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      /* 무시 */
    }
  }
}

let _seq = 0
export function chatUid(): string {
  _seq += 1
  return `m${Date.now().toString(36)}${_seq}`
}
