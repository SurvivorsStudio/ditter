import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale } from './index'
import { switchLocale } from './switchLocale'

/** 제외 목록이 조용히 갈리는 것을 막는다. 한쪽으로 틀리면 화면에 두 언어가 섞이고
 *  (제외를 너무 넓게 잡음) 다른 쪽으로 틀리면 언어 버튼 한 번이 원본 DB 조회를
 *  연결 수만큼 다시 낸다 (제외를 빠뜨림). 둘 다 화면에 원인이 안 보인다. */

afterEach(() => {
  setLocale('ko')
  localStorage.clear()
})

const VALIDATION = ['validation', 'p1'] as const
const SCHEMA = ['connection-schema', 'c1', 'nopk'] as const
const OBJECTS = ['connection-schema', 'c1', 'objects'] as const
const DETAIL = ['object-detail', 'c1', 'table', 'dbo', 'orders'] as const

describe('switchLocale', () => {
  it('언어를 바꾸고 서버 문구를 담은 캐시만 무효화한다', () => {
    const qc = new QueryClient()
    qc.setQueryData(VALIDATION, { issues: [] })
    qc.setQueryData(SCHEMA, { tables: [] })
    qc.setQueryData(OBJECTS, { objects: [] })
    qc.setQueryData(DETAIL, { definition: '' })

    switchLocale('en', qc)

    expect(getLocale()).toBe('en')
    expect(qc.getQueryState(VALIDATION)?.isInvalidated).toBe(true)
    // 원본 DB 에서 온 이름뿐이라 다시 받아도 같은 문자열이다 — 조회만 늘어난다
    expect(qc.getQueryState(SCHEMA)?.isInvalidated).toBe(false)
    expect(qc.getQueryState(OBJECTS)?.isInvalidated).toBe(false)
    expect(qc.getQueryState(DETAIL)?.isInvalidated).toBe(false)
  })
})
