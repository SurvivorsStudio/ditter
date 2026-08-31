/** 다국어 문구 조회 `t(key, vars)`.
 *
 *  사전은 **[ko, en] 쌍 튜플**이다 — 별도 en 사전을 두면 키가 한쪽에만 있는 상태가
 *  생길 수 있는데, 쌍으로 묶으면 그 상태가 타입으로 불가능하고 리뷰에서 두 언어가
 *  나란히 보인다. 키는 `keyof typeof MESSAGES` 라 오타가 컴파일에서 잡힌다.
 *
 *  보간은 두 형태다:
 *  - `{name}` — vars.name 치환. 숫자는 localeTag() 로 자릿수 구분(1,234)까지 맞춘다.
 *  - `{name|단수|복수}` — vars.name === 1 이면 단수, 아니면 복수. 한국어에는 복수형이
 *    없어 ko 문구에는 쓸 일이 없고, en 의 `{n} row{n|,s}` 같은 자리를 위한 최소 장치다.
 *
 *  컴포넌트에서는 `useT()` 를 쓴다 — 언어가 바뀌면 구독으로 다시 그린다.
 *  컴포넌트 밖(throw·기본 이름 생성 등 **호출 시점 평가**)에서는 `t` 를 직접 불러도 된다.
 *  번역된 문자열을 모듈 상수에 담아 두면 언어 전환을 따라오지 못한다 — 라벨 맵은
 *  `Record<X, MsgKey>` 로 두고 조회 함수에서 t() 를 부른다.
 */
import { canvas } from './messages/canvas'
import { common } from './messages/common'
import { connectors } from './messages/connectors'
import { login } from './messages/login'
import { nav } from './messages/nav'
import { nodes } from './messages/nodes'
import { runs } from './messages/runs'
import { statements } from './messages/statements'
import { status } from './messages/status'
import { getLocale, localeTag, useLocale, type Locale } from './locale'

const MESSAGES = {
  ...common,
  ...nav,
  ...status,
  ...login,
  ...runs,
  ...nodes,
  ...connectors,
  ...statements,
  ...canvas,
} as const

export type MsgKey = keyof typeof MESSAGES
export type TVars = Record<string, string | number>
export type TFunc = (key: MsgKey, vars?: TVars) => string

/** `{name}` 과 `{name|단수|복수}` 를 함께 잡는다. */
const SLOT = /\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g

function interpolate(text: string, vars: TVars | undefined, tag: string): string {
  if (!vars) return text
  return text.replace(SLOT, (whole, name: string, one?: string, many?: string) => {
    const value = vars[name]
    if (value === undefined) return whole // 빠뜨린 변수는 자리 그대로 — 조용히 빈칸이 되면 원인을 못 찾는다
    if (one !== undefined && many !== undefined) return value === 1 ? one : many
    return typeof value === 'number' ? value.toLocaleString(tag) : String(value)
  })
}

export function t(key: MsgKey, vars?: TVars): string {
  const pair = MESSAGES[key]
  const text = getLocale() === 'ko' ? pair[0] : pair[1]
  return interpolate(text, vars, localeTag())
}

/** 언어별 바운드 함수를 하나씩만 만들어 둔다 — 언어가 바뀔 때만 항등성이 바뀌므로
 *  useMemo/useCallback 의존성 배열에 그대로 넣어도 안전하다. */
const bound: Partial<Record<Locale, TFunc>> = {}

export function useT(): TFunc {
  const locale = useLocale()
  return (bound[locale] ??= (key, vars) => t(key, vars))
}

export { getLocale, localeTag, setLocale, useLocale, type Locale } from './locale'
