import { z } from 'zod'

/** 토큰 보관.
 *
 * localStorage 를 쓴다 — XSS 가 나면 토큰이 새지만, 이 앱은 사내망 SPA 이고
 * 백엔드가 별도 오리진일 수 있어 httpOnly 쿠키를 쓰기 어렵다.
 * 대신 토큰 수명을 짧게(기본 8시간) 두고 만료 시 즉시 로그인으로 되돌린다.
 */
const TOKEN_KEY = 'eai.token'
const USER_KEY = 'eai.user'

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  roles: z.array(z.string()),
  is_active: z.boolean(),
  last_login_at: z.string().nullable().default(null),
  created_at: z.string(),
})
export type User = z.infer<typeof userSchema>

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().default('bearer'),
  expires_in: z.number(),
  user: userSchema,
})

export type Role = 'viewer' | 'operator' | 'editor' | 'admin'

/** 백엔드 rbac.py 의 역할 계층과 반드시 같아야 한다 */
const IMPLIES: Record<Role, Role[]> = {
  admin: ['admin', 'editor', 'operator', 'viewer'],
  editor: ['editor', 'operator', 'viewer'],
  operator: ['operator', 'viewer'],
  viewer: ['viewer'],
}

/** 빌드 시 VITE_AUTH_ENABLED=false 면 로그인을 건너뛴다 (백엔드 EAI_AUTH_ENABLED=false 와 짝).
 *  백엔드가 모든 요청을 로컬 관리자로 통과시키므로, 프론트도 가상 관리자로 바로 들어간다.
 *  로컬 개발 전용 — 배포 빌드에서는 이 값을 주지 않아 기본(로그인 필요)으로 돈다. */
const authDisabled = import.meta.env.VITE_AUTH_ENABLED === 'false'

const LOCAL_DEV_USER: User = {
  id: 'local-dev',
  email: 'local@dev',
  display_name: '로컬 개발자',
  roles: ['admin'],
  is_active: true,
  last_login_at: null,
  created_at: '1970-01-01T00:00:00Z',
}

let listeners: (() => void)[] = []

function notify() {
  listeners.forEach((fn) => fn())
}

/** localStorage 는 항상 있으리라 믿을 수 없다 — Safari 프라이빗 모드는 접근만으로 throw 하고,
 *  테스트·SSR 환경에는 아예 없다. 저장소가 없으면 메모리로 물러난다 (탭을 닫으면 사라질 뿐). */
const memory = new Map<string, string>()

function readItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null
  } catch {
    return memory.get(key) ?? null
  }
}

function writeItem(key: string, value: string): void {
  memory.set(key, value)
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 메모리에는 이미 담겼다 — 세션 동안은 정상 동작한다
  }
}

function removeItem(key: string): void {
  memory.delete(key)
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // 무시 — 메모리에서는 이미 지워졌다
  }
}

export const auth = {
  get token(): string | null {
    return readItem(TOKEN_KEY)
  },

  get user(): User | null {
    if (authDisabled) return LOCAL_DEV_USER
    const raw = readItem(USER_KEY)
    if (!raw) return null
    try {
      const parsed = userSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null // 저장된 값이 깨졌다 — 없는 것으로 취급한다
    }
  },

  get isAuthenticated(): boolean {
    if (authDisabled) return true
    return Boolean(readItem(TOKEN_KEY))
  },

  login(token: string, user: User) {
    writeItem(TOKEN_KEY, token)
    writeItem(USER_KEY, JSON.stringify(user))
    notify()
  },

  logout() {
    removeItem(TOKEN_KEY)
    removeItem(USER_KEY)
    notify()
  },

  /** 역할 계층을 반영한 권한 확인 — admin 은 editor 권한도 갖는다 */
  can(required: Role): boolean {
    const user = auth.user
    if (!user) return false
    return user.roles.some((r) => IMPLIES[r as Role]?.includes(required))
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn)
    return () => {
      listeners = listeners.filter((l) => l !== fn)
    }
  },
}
