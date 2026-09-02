import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { setLocale } from '../i18n'
import { ApiError, api, runStreamUrl } from './client'

const originalFetch = globalThis.fetch

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  )
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('api.request', () => {
  it('POST 본문을 JSON 으로 직렬화해 보낸다', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    await api.request('/pipelines/p1/run', {
      method: 'POST',
      body: { trigger: 'manual', full_refresh: true },
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ trigger: 'manual', full_refresh: true })
  })

  it('본문이 없으면 Content-Type 을 붙이지 않는다', async () => {
    const fetchMock = mockFetch(200, [])
    await api.request('/connections')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBeUndefined()
    // Accept-Language 는 본문과 무관하게 **항상** 간다 (아래 참조).
    expect(init.headers).toEqual({ 'Accept-Language': 'ko' })
  })

  it('서버 문구의 언어를 화면 언어로 지정한다', async () => {
    // 브라우저가 이 헤더를 자동으로도 붙인다. 명시적으로 덮어쓰지 않으면 영어 OS 를 쓰는
    // 한국인이 UI 는 한국어인데 서버 오류만 영어로 받는다.
    const fetchMock = mockFetch(200, [])
    setLocale('en')
    try {
      await api.request('/connections')
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Accept-Language']).toBe('en')
    } finally {
      setLocale('ko')
    }
  })

  it('204 는 본문 파싱 없이 null 을 돌려준다', async () => {
    mockFetch(204, null)
    await expect(api.request('/connections/c1', { method: 'DELETE' })).resolves.toBeNull()
  })

  it('오류 응답의 detail 을 그대로 메시지로 올린다', async () => {
    mockFetch(422, { detail: '실행할 수 없는 파이프라인입니다' })
    await expect(api.request('/pipelines/p1/run', { method: 'POST' })).rejects.toThrow(
      '실행할 수 없는 파이프라인입니다',
    )
  })

  it('네트워크 단절은 status 0 의 ApiError 로 구분된다', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('failed to fetch')
    }) as unknown as typeof fetch

    const error = await api.request('/health').catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(0)
  })
})

describe('api.parsed', () => {
  const schema = z.object({
    id: z.string(),
    records: z.number().default(0),
    error: z.string().nullable().default(null),
  })

  it('기본값이 채워진 출력 타입을 돌려준다', async () => {
    mockFetch(200, { id: 'run-1' })
    const result = await api.parsed(schema, '/runs/run-1')
    // .default() 필드는 응답에 없어도 값이 채워져야 한다
    expect(result).toEqual({ id: 'run-1', records: 0, error: null })
  })

  it('스키마에 맞지 않는 응답은 즉시 실패시킨다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(200, { id: 123 })
    await expect(api.parsed(schema, '/runs/run-1')).rejects.toThrow('응답 형식이 올바르지 않습니다')
  })

  it('타입 수준에서도 .default() 필드는 optional 로 새지 않는다 (client.ts 의 z.ZodType 함정 회귀 방지)', async () => {
    mockFetch(200, { id: 'run-1' })
    const result = await api.parsed(schema, '/runs/run-1')
    // 컴파일 시점 검증 — records·error 가 optional(`?`)이면 여기서 tsc 가 실패한다.
    expectTypeOf(result).toEqualTypeOf<{ id: string; records: number; error: string | null }>()
  })
})

describe('runStreamUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('http 오리진을 ws 로 바꾼다', () => {
    expect(runStreamUrl('run-1')).toMatch(/^ws:\/\//)
    expect(runStreamUrl('run-1')).toContain('/runs/run-1/stream')
  })
})
