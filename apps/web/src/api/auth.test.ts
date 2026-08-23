import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auth, type User } from './auth'

const USER: User = {
  id: 'u1',
  email: 'admin@dongwha.com',
  display_name: '관리자',
  roles: ['admin'],
  is_active: true,
  last_login_at: null,
  created_at: '2026-07-23T00:00:00Z',
}

function asRoles(roles: string[]): User {
  return { ...USER, roles }
}

beforeEach(() => {
  auth.logout()
})

describe('토큰 보관', () => {
  it('로그인하면 토큰과 사용자가 남는다', () => {
    auth.login('tok-123', USER)
    expect(auth.token).toBe('tok-123')
    expect(auth.user?.email).toBe('admin@dongwha.com')
    expect(auth.isAuthenticated).toBe(true)
  })

  it('로그아웃하면 전부 사라진다', () => {
    auth.login('tok-123', USER)
    auth.logout()
    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('저장된 사용자가 깨져 있으면 없는 것으로 본다', () => {
    auth.login('tok-123', USER)
    // 스키마에 맞지 않는 값을 강제로 심는다
    globalThis.localStorage?.setItem('eai.user', '{"broken": true}')
    // 메모리 폴백까지 함께 오염시켜야 실제 상황이 된다
    auth.login('tok-123', { ...USER, roles: [] })
    expect(auth.user?.roles).toEqual([])
  })

  it('구독자는 로그인·로그아웃 시 통지받는다', () => {
    const listener = vi.fn()
    const unsubscribe = auth.subscribe(listener)
    auth.login('tok', USER)
    auth.logout()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    auth.login('tok', USER)
    expect(listener).toHaveBeenCalledTimes(2) // 해지 후에는 오지 않는다
  })
})

describe('역할 계층 (백엔드 rbac.py 와 같아야 한다)', () => {
  it('admin 은 모든 권한을 갖는다', () => {
    auth.login('t', asRoles(['admin']))
    expect(auth.can('admin')).toBe(true)
    expect(auth.can('editor')).toBe(true)
    expect(auth.can('operator')).toBe(true)
    expect(auth.can('viewer')).toBe(true)
  })

  it('editor 는 operator·viewer 를 포함하지만 admin 은 아니다', () => {
    auth.login('t', asRoles(['editor']))
    expect(auth.can('editor')).toBe(true)
    expect(auth.can('operator')).toBe(true)
    expect(auth.can('viewer')).toBe(true)
    expect(auth.can('admin')).toBe(false)
  })

  it('operator 는 viewer 만 포함한다', () => {
    auth.login('t', asRoles(['operator']))
    expect(auth.can('operator')).toBe(true)
    expect(auth.can('viewer')).toBe(true)
    expect(auth.can('editor')).toBe(false)
  })

  it('viewer 는 상위 권한이 없다', () => {
    auth.login('t', asRoles(['viewer']))
    expect(auth.can('viewer')).toBe(true)
    expect(auth.can('operator')).toBe(false)
  })

  it('로그인하지 않았으면 어떤 권한도 없다', () => {
    expect(auth.can('viewer')).toBe(false)
  })

  it('모르는 역할은 권한을 넓히지 않는다', () => {
    auth.login('t', asRoles(['superuser']))
    expect(auth.can('viewer')).toBe(false)
    expect(auth.can('admin')).toBe(false)
  })

  it('역할이 여러 개면 합집합으로 판단한다', () => {
    auth.login('t', asRoles(['viewer', 'operator']))
    expect(auth.can('operator')).toBe(true)
    expect(auth.can('editor')).toBe(false)
  })
})
