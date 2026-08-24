/** 저장된 쿼리·파이프라인 — 브라우저 localStorage 에 폴더 트리로 보관한다 (폴더 안에 폴더 가능).
 *  (기기·브라우저 로컬. 여러 기기 공유가 필요하면 백엔드 저장으로 옮긴다.)
 *
 *  **쿼리와 파이프라인이 한 트리에 산다.** 두 트리를 나란히 두면 "어디에 넣었더라"를
 *  두 곳에서 찾게 되고, 같은 업무를 쿼리와 파이프라인으로 함께 다루는 일이 흔하다.
 *
 *  다만 담기는 것이 다르다 — 쿼리는 **본문이 여기 있고**, 파이프라인은 **서버에 있는 것을
 *  가리키기만 한다**(`SavedPipeline`). 그래서 삭제의 뜻도 갈린다: 쿼리 ×는 쿼리를 지우고,
 *  파이프라인 ×는 트리에서 빼기만 한다. */

export type SavedQuery = {
  id: string
  name: string
  /** 'duck' 은 여러 연결에 걸친 연합 조회 — 불러올 때 연결 대신 연합 탭으로 열어야 한다.
   *  (예전에 저장된 항목에는 'sql'|'mongo' 만 있다.) */
  mode: 'sql' | 'mongo' | 'duck'
  text: string
  note?: string // 저장 시 남기는 메모
  connId?: string
  namespace?: string | null
  createdAt: number
}

/** 폴더에 놓인 파이프라인 한 건. **서버의 파이프라인을 가리키기만 한다.**
 *
 *  이름·상태를 여기 복제하지 않는 이유는, 복제하면 서버에서 바꿨을 때 트리만 옛 이름을
 *  들고 있게 되기 때문이다. 화면은 `GET /pipelines` 목록과 맞춰 그린다. */
export type SavedPipeline = {
  /** 트리 안에서의 항목 id — 드래그·삭제 대상이다 (파이프라인 id 와 다르다). */
  id: string
  pipelineId: string
  createdAt: number
}

export type SavedFolder = {
  id: string
  name: string
  folders: SavedFolder[] // 하위 폴더 (재귀)
  queries: SavedQuery[]
  pipelines: SavedPipeline[]
}

const KEY = 'eai_saved_queries_v1'

/** 짧은 고유 id (로컬 전용이라 충돌만 피하면 충분). */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// 예전 데이터(하위 폴더·파이프라인 없음)도 안전하게 정규화한다.
function normalize(f: Partial<SavedFolder> & { id: string; name: string }): SavedFolder {
  return {
    id: f.id,
    name: f.name,
    folders: Array.isArray(f.folders) ? f.folders.map(normalize) : [],
    queries: Array.isArray(f.queries) ? f.queries : [],
    pipelines: Array.isArray(f.pipelines)
      ? f.pipelines.filter((p) => typeof p?.pipelineId === 'string')
      : [],
  }
}

/** 빈 폴더 하나 — 필드를 빠뜨려 예전 모양이 새로 생기지 않게 여기서만 만든다. */
export function emptyFolder(name: string): SavedFolder {
  return { id: uid(), name, folders: [], queries: [], pipelines: [] }
}

export function loadSaved(): SavedFolder[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(normalize)
  } catch {
    /* 손상된 값은 무시하고 빈 목록으로 */
  }
  return []
}

export function storeSaved(folders: SavedFolder[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(folders))
  } catch {
    /* 용량 초과 등은 조용히 무시 */
  }
}

// ---- 트리 조작 헬퍼 (모두 순수함수, 새 트리를 돌려준다) ----

/** id 가 일치하는 폴더를 fn 으로 교체 (재귀). */
export function updateFolder(
  folders: SavedFolder[],
  id: string,
  fn: (f: SavedFolder) => SavedFolder,
): SavedFolder[] {
  return folders.map((f) => (f.id === id ? fn(f) : { ...f, folders: updateFolder(f.folders, id, fn) }))
}

/** id 가 일치하는 폴더를 트리에서 제거 (재귀). */
export function removeFolder(folders: SavedFolder[], id: string): SavedFolder[] {
  return folders
    .filter((f) => f.id !== id)
    .map((f) => ({ ...f, folders: removeFolder(f.folders, id) }))
}

/** parentId 안(또는 최상위)에 폴더를 추가. */
export function addFolder(
  folders: SavedFolder[],
  parentId: string | null,
  folder: SavedFolder,
): SavedFolder[] {
  if (!parentId) return [...folders, folder]
  return updateFolder(folders, parentId, (f) => ({ ...f, folders: [...f.folders, folder] }))
}

/** queryId 를 가진 쿼리를 fn 으로 교체 (재귀). */
export function updateQuery(
  folders: SavedFolder[],
  queryId: string,
  fn: (q: SavedQuery) => SavedQuery,
): SavedFolder[] {
  return folders.map((f) => ({
    ...f,
    queries: f.queries.map((q) => (q.id === queryId ? fn(q) : q)),
    folders: updateQuery(f.folders, queryId, fn),
  }))
}

/** queryId 를 트리에서 제거 (재귀). */
export function removeQuery(folders: SavedFolder[], queryId: string): SavedFolder[] {
  return folders.map((f) => ({
    ...f,
    queries: f.queries.filter((q) => q.id !== queryId),
    folders: removeQuery(f.folders, queryId),
  }))
}

// ---- 파이프라인 항목 (쿼리와 같은 자리에 산다) ----

/** 폴더에 파이프라인 참조를 넣는다. 같은 파이프라인이 트리 여러 곳에 겹치지 않도록
 *  **먼저 어디에 있든 빼고 넣는다** — 두 폴더에 같은 것이 보이면 어느 쪽이 진짜인지 없다. */
export function addPipeline(
  folders: SavedFolder[],
  folderId: string,
  pipelineId: string,
): SavedFolder[] {
  const without = removePipelineId(folders, pipelineId)
  const ref: SavedPipeline = { id: uid(), pipelineId, createdAt: Date.now() }
  return updateFolder(without, folderId, (f) => ({ ...f, pipelines: [...f.pipelines, ref] }))
}

/** 트리 항목 id 로 뺀다 (× 버튼). **서버의 파이프라인은 지우지 않는다.** */
export function removePipeline(folders: SavedFolder[], itemId: string): SavedFolder[] {
  return folders.map((f) => ({
    ...f,
    pipelines: f.pipelines.filter((p) => p.id !== itemId),
    folders: removePipeline(f.folders, itemId),
  }))
}

/** 파이프라인 id 로 뺀다 — 중복 방지용 내부 정리. */
function removePipelineId(folders: SavedFolder[], pipelineId: string): SavedFolder[] {
  return folders.map((f) => ({
    ...f,
    pipelines: f.pipelines.filter((p) => p.pipelineId !== pipelineId),
    folders: removePipelineId(f.folders, pipelineId),
  }))
}

/** 파이프라인 항목을 targetFolderId 폴더로 옮긴다. */
export function movePipeline(
  folders: SavedFolder[],
  itemId: string,
  targetFolderId: string,
): SavedFolder[] {
  const pulled: SavedPipeline[] = []
  const walk = (fs: SavedFolder[]): SavedFolder[] =>
    fs.map((f) => ({
      ...f,
      pipelines: f.pipelines.filter((p) => {
        if (p.id === itemId) {
          pulled.push(p)
          return false
        }
        return true
      }),
      folders: walk(f.folders),
    }))
  const without = walk(folders)
  const ref = pulled[0]
  if (!ref) return folders
  return updateFolder(without, targetFolderId, (f) => ({ ...f, pipelines: [...f.pipelines, ref] }))
}

/** 트리 어딘가에 놓인 파이프라인 id 전부 — 「미분류」를 계산할 때 쓴다. */
export function placedPipelineIds(folders: SavedFolder[]): Set<string> {
  const out = new Set<string>()
  const walk = (fs: SavedFolder[]) => {
    for (const f of fs) {
      for (const p of f.pipelines) out.add(p.pipelineId)
      walk(f.folders)
    }
  }
  walk(folders)
  return out
}

/** 폴더가 (자기 포함) id 를 담고 있는지. */
function folderContains(folder: SavedFolder, id: string): boolean {
  return folder.id === id || folder.folders.some((f) => folderContains(f, id))
}

/** 트리에서 쿼리를 뽑아낸다 → [뺀 트리, 쿼리]. */
function extractQuery(folders: SavedFolder[], queryId: string): [SavedFolder[], SavedQuery | null] {
  let found: SavedQuery | null = null
  const walk = (fs: SavedFolder[]): SavedFolder[] =>
    fs.map((f) => ({
      ...f,
      queries: f.queries.filter((q) => {
        if (q.id === queryId) {
          found = q
          return false
        }
        return true
      }),
      folders: walk(f.folders),
    }))
  return [walk(folders), found]
}

/** 쿼리를 targetFolderId 폴더로 옮긴다. */
export function moveQuery(folders: SavedFolder[], queryId: string, targetFolderId: string): SavedFolder[] {
  const [without, q] = extractQuery(folders, queryId)
  if (!q) return folders
  return updateFolder(without, targetFolderId, (f) => ({ ...f, queries: [...f.queries, q] }))
}

/** 트리에서 폴더를 뽑아낸다 → [뺀 트리, 폴더]. */
function extractFolder(folders: SavedFolder[], folderId: string): [SavedFolder[], SavedFolder | null] {
  let found: SavedFolder | null = null
  const walk = (fs: SavedFolder[]): SavedFolder[] =>
    fs
      .filter((f) => {
        if (f.id === folderId) {
          found = f
          return false
        }
        return true
      })
      .map((f) => ({ ...f, folders: walk(f.folders) }))
  return [walk(folders), found]
}

/** 폴더를 targetParentId(없으면 최상위)로 옮긴다. 자기/자손 안으로는 못 옮긴다(순환 방지). */
export function moveFolder(
  folders: SavedFolder[],
  folderId: string,
  targetParentId: string | null,
): SavedFolder[] {
  let target: SavedFolder | null = null
  const find = (fs: SavedFolder[]) => {
    for (const f of fs) {
      if (f.id === folderId) target = f
      else find(f.folders)
    }
  }
  find(folders)
  if (!target) return folders
  if (targetParentId && folderContains(target, targetParentId)) return folders // 순환 금지
  const [without, folder] = extractFolder(folders, folderId)
  if (!folder) return folders
  return addFolder(without, targetParentId, folder)
}

/** 폴더 트리를 "경로 라벨"과 함께 평탄화 (선택기에 쓴다). */
export function flattenFolders(
  folders: SavedFolder[],
  prefix = '',
  depth = 0,
): { id: string; label: string; depth: number; queryNames: string[] }[] {
  const out: { id: string; label: string; depth: number; queryNames: string[] }[] = []
  for (const f of folders) {
    const label = prefix ? `${prefix} / ${f.name}` : f.name
    out.push({ id: f.id, label, depth, queryNames: f.queries.map((q) => q.name) })
    out.push(...flattenFolders(f.folders, label, depth + 1))
  }
  return out
}
