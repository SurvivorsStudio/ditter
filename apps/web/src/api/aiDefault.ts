/** AI 기본 연결 — 이 브라우저에서 AI 가 무엇으로 답할지 한 곳에서 정한다.
 *
 *  전에는 AI 를 쓰는 자리마다(어시스턴트 탭 · AI 수정 · AI 튜닝 · 노트북 셀 · 인라인 프롬프트)
 *  **각자 "등록된 첫 AI 연결"로 떨어졌다.** 연결이 여럿이면 자리마다 다른 모델사가 답하는데
 *  화면 어디에도 그 사실이 보이지 않았다 — 답이 다른 이유를 프롬프트에서 찾게 된다.
 *
 *  이제 쿼리 편집기 툴바(「실행 계획」 옆)의 드롭다운 하나가 그 기본값이고, 모든 자리가
 *  여기서 시작한다. 자리마다 있는 선택(칩·드롭다운)은 **그 자리에서만 쓰는 덮어쓰기**이고
 *  기본값을 바꾸지 않는다 — 비교하려고 한 번 눌렀다가 기본이 따라 바뀌면 그건 기본값이 아니다.
 *  (§21 「허용 명령 ↔ 잠시 끄기」와 같은 두 층.)
 *
 *  서버에 두지 않는 이유도 같다. "이 연결은 원래 무엇인가"가 아니라 "내가 무엇으로 보고
 *  싶은가"라서, 서버에 쓰면 남의 기본값을 내가 바꾸는 셈이 된다.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'eai_ai_default_conn_v1'

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return '' // 못 읽으면 "정한 적 없음" — 첫 AI 연결로 떨어지면 그만이다
  }
}

let current = read()
const subs = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

/** 저장된 기본 연결 id ('' = 정한 적 없음). 화면에 그릴 때는 아래 `useAiConn` 을 쓴다. */
export function useAiDefaultId(): string {
  return useSyncExternalStore(subscribe, () => current)
}

/** 툴바 드롭다운이 부른다. 열려 있는 패널·탭이 함께 따라오도록 구독자에게 알린다. */
export function setAiDefault(id: string): void {
  if (id === current) return
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* 저장 실패(사파리 프라이빗 등)는 삼킨다 — 이번 세션에는 적용되고 기억만 못 한다 */
  }
  subs.forEach((fn) => fn())
}

/** 지금 실제로 쓸 AI 연결 id.
 *
 *  정해 둔 연결이 **지워졌거나 아직 안 정했으면** 첫 AI 연결로 떨어진다 — 없는 연결로
 *  부르면 404 이고, 그 실패는 "AI 가 안 된다"로만 보인다. 저장된 값은 지우지 않는다:
 *  연결 목록을 아직 못 받은 순간에 지우면 멀쩡한 설정이 날아간다.
 */
export function useAiConn(aiConns: { id: string }[]): string {
  const saved = useAiDefaultId()
  if (saved && aiConns.some((c) => c.id === saved)) return saved
  return aiConns[0]?.id ?? ''
}
