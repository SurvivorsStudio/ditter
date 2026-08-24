/** 즐겨찾기(자주 쓰는 단일 쿼리) 저장소.
 *
 * "저장됨"(폴더 트리)과는 **별개**다. 여기 담긴 항목은 편집기에서 `/loadQuery()` 팝업이나
 * `/loadQuery.이름` 단축으로 커서 위치에 SQL 을 불러오기 위한 것이다. 연결(DB)은 저장하지 않고
 * SQL 텍스트만 둔다 — 불러오면 현재 탭의 연결을 그대로 쓴다.
 */
export type Favorite = {
  id: string
  name: string
  sql: string
  /** 이 즐겨찾기가 속한 연결(DB). 쿼리 탭에서 같은 연결일 때만 `/loadQuery` 목록에 보인다. */
  connId?: string
  createdAt: number
}

const KEY = 'eai_favorites_v1'

export function favUid(): string {
  return 'fav-' + Math.random().toString(36).slice(2, 10)
}

export function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((f): f is Favorite => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({
        id: f.id,
        name: f.name,
        sql: String(f.sql ?? ''),
        connId: typeof f.connId === 'string' ? f.connId : undefined,
        createdAt: f.createdAt ?? 0,
      }))
  } catch {
    return []
  }
}

export function storeFavorites(list: Favorite[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 용량 초과 등은 조용히 무시 */
  }
}

export function addFavorite(
  list: Favorite[],
  name: string,
  sql: string,
  connId?: string,
): Favorite[] {
  return [...list, { id: favUid(), name, sql, connId, createdAt: Date.now() }]
}

export function updateFavorite(list: Favorite[], id: string, patch: Partial<Favorite>): Favorite[] {
  return list.map((f) => (f.id === id ? { ...f, ...patch } : f))
}

export function removeFavorite(list: Favorite[], id: string): Favorite[] {
  return list.filter((f) => f.id !== id)
}
