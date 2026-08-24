import type { z } from 'zod'
import { auth } from './auth'

/** 개발 중에는 vite 프록시(/api)를, 배포 시에는 빌드 타임 주입값을 쓴다 */
const RAW_BASE = import.meta.env.VITE_API_BASE ?? '/api'
export const API_BASE = RAW_BASE.replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { method = 'GET', body, signal } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = auth.token
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (e) {
    // 사용자가 취소(AbortController)한 경우는 그대로 전파해 호출부가 조용히 처리하게 한다
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    // 네트워크 자체가 끊긴 경우 — status 0 으로 서버 응답과 구분해서 알린다
    throw new ApiError(0, `서버에 연결할 수 없습니다 (${API_BASE})`, undefined)
  }

  const requestId = response.headers.get('X-Request-ID') ?? undefined

  // 토큰이 만료·무효라면 붙잡고 있어봐야 소용없다 — 즉시 비우고 로그인으로 돌린다
  if (response.status === 401 && token) {
    auth.logout()
  }

  if (response.status === 204) return null

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : `요청 실패 (${response.status})`
    throw new ApiError(response.status, detail, requestId)
  }

  return payload
}

/**
 * 응답을 스키마로 검증해서 돌려준다. 검증 실패는 곧 백엔드 계약 위반이므로 즉시 드러낸다.
 *
 * 제네릭을 스키마 자체로 받는 것이 중요하다 — `z.ZodType<T>` 로 받으면 TS 가 T 를
 * 출력이 아닌 **입력** 타입으로 추론해 `.default()` 필드가 전부 optional 로 새어 나온다.
 */
async function parsed<S extends z.ZodTypeAny>(
  schema: S,
  path: string,
  options?: RequestOptions,
): Promise<z.infer<S>> {
  const raw = await request(path, options)
  const result = schema.safeParse(raw)
  if (!result.success) {
    console.error('API 응답 스키마 불일치', path, result.error.issues, raw)
    throw new ApiError(500, `응답 형식이 올바르지 않습니다: ${path}`)
  }
  return result.data
}

/**
 * 파일 다운로드 — JSON 이 아니라 스트림(blob)을 받아 브라우저 저장을 띄운다.
 * (내보내기처럼 응답이 파일인 엔드포인트용. `request` 는 JSON 을 가정하므로 못 쓴다.)
 */
async function download(path: string, body: unknown, filename: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = auth.token
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(0, `서버에 연결할 수 없습니다 (${API_BASE})`)
  }
  if (res.status === 401 && token) auth.logout()
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = `내보내기 실패 (${res.status})`
    try {
      const p = JSON.parse(text)
      if (p && typeof p === 'object' && 'detail' in p) detail = String((p as { detail: unknown }).detail)
    } catch {
      /* 본문이 JSON 이 아니면 기본 메시지 */
    }
    throw new ApiError(res.status, detail)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const api = { request, parsed, download }

/** 실행 스트림 WebSocket URL */
export function runStreamUrl(runId: string): string {
  const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`
  const url = new URL(`${base}/runs/${runId}/stream`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  // 브라우저 WebSocket 은 커스텀 헤더를 붙일 수 없어 토큰을 쿼리로 넘긴다.
  // 토큰이 접속 로그에 남을 수 있으므로 수명을 짧게 유지하는 것이 전제다.
  const token = auth.token
  if (token) url.searchParams.set('token', token)
  return url.toString()
}
