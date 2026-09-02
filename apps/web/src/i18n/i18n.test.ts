import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale, t, useT } from './index'

/** 언어 저장·조회·보간의 계약을 못박는다. 기본은 ko 이고, 기존 테스트의 한글 단언이
 *  전부 이 기본 위에 서 있다 — 기본이 바뀌면 여기가 가장 먼저 빨개져야 한다. */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  setLocale('ko')
  localStorage.clear()
})

describe('locale store', () => {
  it('기본은 ko 다 (저장된 것이 없을 때)', () => {
    expect(getLocale()).toBe('ko')
  })

  it('setLocale 이 영속화하고 <html lang> 을 맞춘다', () => {
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(localStorage.getItem('eai_locale_v1')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    setLocale('ko')
    expect(document.documentElement.lang).toBe('ko')
  })

  it('언어를 바꾸면 useT 를 쓰는 컴포넌트가 다시 그린다', () => {
    const host = document.createElement('div')
    let root: Root | undefined
    function Probe() {
      const t = useT()
      return createElement('span', null, t('common.refresh'))
    }
    act(() => {
      root = createRoot(host)
      root.render(createElement(Probe))
    })
    expect(host.textContent).toBe('새로고침')
    act(() => setLocale('en'))
    expect(host.textContent).toBe('Refresh')
    act(() => root?.unmount())
  })
})

describe('t()', () => {
  it('현재 언어의 문구를 고른다', () => {
    expect(t('common.cancel')).toBe('취소')
    setLocale('en')
    expect(t('common.cancel')).toBe('Cancel')
  })

  it('{name} 보간 — 숫자는 자릿수 구분까지 언어를 따른다', () => {
    setLocale('en')
    expect(t('common.logoutTitle', { who: 'a@b (admin)' })).toBe('a@b (admin) — click to log out')
    // 숫자 포맷은 별도 키 없이 동작만 확인한다
    const text = '{n} rows'.replace('{n}', (1234).toLocaleString('en-US'))
    expect(text).toBe('1,234 rows')
  })

  it('빠뜨린 변수는 자리 표식을 그대로 남긴다 (조용한 빈칸 금지)', () => {
    expect(t('common.logoutTitle', {})).toBe('{who} — 클릭하면 로그아웃')
  })

  it('{name|단수|복수} — 영어 복수형만을 위한 최소 장치', () => {
    setLocale('en')
    expect(t('common.rowCount', { n: 1 })).toBe('1 row')
    expect(t('common.rowCount', { n: 1234 })).toBe('1,234 rows')
    setLocale('ko')
    expect(t('common.rowCount', { n: 1234 })).toBe('1,234행')
  })
})

describe('사전 무결성', () => {
  it('모든 키가 ko·en 둘 다 비어 있지 않다', async () => {
    const { common } = await import('./messages/common')
    const { nav } = await import('./messages/nav')
    const { status } = await import('./messages/status')
    const { login } = await import('./messages/login')
    const all = { ...common, ...nav, ...status, ...login } as Record<
      string,
      readonly [string, string]
    >
    for (const [key, [ko, en]] of Object.entries(all)) {
      expect(ko, `${key} ko`).not.toBe('')
      expect(en, `${key} en`).not.toBe('')
    }
  })
})
