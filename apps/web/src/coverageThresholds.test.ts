// @vitest-environment node
//
// jsdom 이 아니라 node 로 돈다. 이 파일은 `vite.config.ts` 를 그대로 임포트하는데, 그러면
// vite·esbuild 가 딸려 들어오고 esbuild 는 jsdom 의 TextEncoder 에서 기동을 거부한다
// ("your JavaScript environment is broken"). DOM 이 필요 없는 검사라 환경만 바꾼다.

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import config from '../vite.config'

/**
 * 층별 커버리지 하한(`vite.config.ts` 의 `coverage.thresholds` 글롭 키)이 실제로 파일을
 * 잡는지 지킨다.
 *
 * vitest 는 **아무 파일에도 맞지 않는 글롭을 경고 없이 건너뛴다** — 종료코드 0 이다.
 * 실측: 키를 `src/stores/**`(없는 폴더)로 바꾸고 하한을 99 로 올려도 그냥 통과한다.
 * 그래서 폴더 이름이 바뀌거나 파일이 옮겨지면 그 층의 하한이 소리 없이 사라지는데,
 * 문서(README·CHANGELOG·CLAUDE.md·CONTRIBUTING)는 여전히 걸려 있다고 말하고 CI 도
 * 계속 초록이다. 설정은 들어가 있고 오류도 없는데 동작만 다른 상태다.
 *
 * 대상 글롭을 여기 적어 두지 않고 **설정에서 읽는** 이유는, 층이 하나 늘었을 때 이 테스트가
 * 따라오지 못하면 같은 구멍이 그 층에 그대로 다시 생기기 때문이다.
 */

/** 글롭이 아니라 하한 수치·옵션인 키. 나머지는 전부 경로 글롭으로 본다. */
const NON_GLOB_KEYS = new Set([
  'lines',
  'functions',
  'branches',
  'statements',
  'perFile',
  'autoUpdate',
  '100',
])

/**
 * 글롭을 정규식으로 바꾼다. 새 의존성을 들이지 않으려고 직접 처리한다 —
 * 여기서 쓰는 문법은 `**` · `*` · `{a,b}` 셋뿐이다.
 */
function globToRegExp(glob: string): RegExp {
  const segments = glob.split('/')
  const body = segments
    .map((segment, i) => {
      const last = i === segments.length - 1
      if (segment === '**') return last ? '(?:.+)?' : '(?:[^/]+/)*'
      const escaped = segment
        .replace(/[.+^$()|[\]\\]/g, '\\$&')
        .replace(/\{([^{}]*)\}/g, (_all, inner: string) => `(?:${inner.split(',').join('|')})`)
        .replace(/\*/g, '[^/]*')
      return last ? escaped : `${escaped}/`
    })
    .join('')
  return new RegExp(`^${body}$`)
}

/** `src` 아래 모든 파일을 프로젝트 루트 기준 경로(`src/...`)로 돌려준다. */
function listSourceFiles(): string[] {
  const walk = (dir: string, prefix: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
  return walk(fileURLToPath(new URL('.', import.meta.url)), 'src/')
}

const coverage = config.test?.coverage as
  | { thresholds?: Record<string, unknown>; exclude?: string[] }
  | undefined

describe('coverage.thresholds 의 층별 글롭', () => {
  const globs = Object.keys(coverage?.thresholds ?? {}).filter((key) => !NON_GLOB_KEYS.has(key))
  const excluded = (coverage?.exclude ?? []).map(globToRegExp)
  const measured = listSourceFiles().filter((file) => !excluded.some((rx) => rx.test(file)))

  it('층별 하한이 하나 이상 걸려 있다', () => {
    // 글롭이 통째로 사라지면 아래 each 가 0번 돌아 이 파일이 조용히 무의미해진다.
    expect(globs.length).toBeGreaterThan(0)
  })

  it.each(globs)('%s 가 실제 소스 파일을 잡는다', (glob) => {
    const rx = globToRegExp(glob)
    const hits = measured.filter((file) => rx.test(file))
    expect(
      hits.length,
      `커버리지 하한 글롭 '${glob}' 이 아무 파일에도 맞지 않는다. vitest 는 이런 글롭을 ` +
        `경고 없이 건너뛰므로 이 층의 하한은 지금 아무것도 막지 못한다(CI 는 그대로 초록이다). ` +
        `폴더를 옮겼다면 vite.config.ts 의 키도 함께 고칠 것.`,
    ).toBeGreaterThan(0)
  })
})
