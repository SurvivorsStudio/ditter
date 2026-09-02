/** 표시 언어 — 이 브라우저가 화면을 어느 언어로 그릴지 한 곳에서 정한다.
 *
 *  `api/aiDefault.ts` 와 같은 모듈 싱글턴 + useSyncExternalStore 패턴이다.
 *  서버에 두지 않는 이유도 같다 — "내가 어느 언어로 보고 싶은가"는 브라우저의 사정이다.
 *
 *  기본은 **한국어 하드코딩**이다. navigator.language 를 보지 않는 이유:
 *  판정이 환경마다 갈려 테스트가 흔들리고, 한국어 우선 제품에서 전환은 클릭 한 번이다.
 */
import { useSyncExternalStore } from 'react'

export type Locale = 'ko' | 'en'

const KEY = 'eai_locale_v1'

/** localStorage 는 항상 있으리라 믿을 수 없다 (Safari 프라이빗은 접근만으로 throw).
 *  저장소가 없으면 메모리로 물러난다 — api/auth.ts 와 같은 관용구. */
const memory = new Map<string, string>()

function read(): Locale {
  let raw: string | null
  try {
    raw = globalThis.localStorage?.getItem(KEY) ?? memory.get(KEY) ?? null
  } catch {
    raw = memory.get(KEY) ?? null
  }
  return raw === 'en' ? 'en' : 'ko' // 깨진 값은 기본으로 — 넓히는 방향으로 실패하지 않는다
}

let current: Locale = read()
const subs = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

/** <html lang> 을 현재 언어에 맞춘다 — 스크린리더·브라우저 번역이 이 속성을 본다. */
function syncHtmlLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current
}
syncHtmlLang()

/** 컴포넌트 밖(에러 throw·기본 이름 생성 등)에서의 즉석 읽기. 화면은 useLocale/useT 를 쓴다. */
export function getLocale(): Locale {
  return current
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current)
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  memory.set(KEY, locale)
  try {
    globalThis.localStorage?.setItem(KEY, locale)
  } catch {
    // 메모리에는 이미 담겼다 — 이번 세션에는 적용되고 기억만 못 한다
  }
  syncHtmlLang()
  subs.forEach((fn) => fn())
}

/** Intl/toLocaleString 에 넘길 태그. 날짜·숫자 형식이 언어를 따라온다. */
export function localeTag(): 'ko-KR' | 'en-US' {
  return current === 'ko' ? 'ko-KR' : 'en-US'
}
