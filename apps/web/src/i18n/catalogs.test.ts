import { afterEach, describe, expect, it } from 'vitest'
import { specFor } from '../api/connectorFields'
import { NODE_SPECS, defaultParamsFor, defaultPycode, isDefaultPycode } from '../canvas/nodeCatalog'
import { setLocale, t } from './index'

/** 카탈로그(노드 팔레트·커넥터 필드)가 언어를 따라오는지 — en 스모크. */

afterEach(() => setLocale('ko'))

describe('커넥터 스펙', () => {
  it('specFor 는 현재 언어로 풀어 준다', () => {
    expect(specFor('local_file').label).toBe('로컬 파일')
    expect(specFor('mysql').fields.find((f) => f.key === 'host')?.label).toBe('호스트')
    setLocale('en')
    expect(specFor('local_file').label).toBe('Local file')
    expect(specFor('mysql').fields.find((f) => f.key === 'host')?.label).toBe('Host')
  })

  it('기술 예시 placeholder 는 언어와 무관하게 그대로다', () => {
    setLocale('en')
    expect(specFor('mysql').fields.find((f) => f.key === 'host')?.placeholder).toBe('db.internal')
  })
})

describe('노드 카탈로그', () => {
  it('모든 스펙의 titleKey·hintKey 가 사전에 있다 (t 가 키를 그대로 돌려주지 않는다)', () => {
    for (const spec of NODE_SPECS) {
      expect(t(spec.titleKey), spec.kind).not.toBe(spec.titleKey)
      expect(t(spec.hintKey), spec.kind).not.toBe(spec.hintKey)
    }
  })

  it('스위치·Python 시드는 생성 시점 언어를 따른다', () => {
    const switchSpec = NODE_SPECS.find((s) => s.kind === 'logic.switch')!
    const pySpec = NODE_SPECS.find((s) => s.kind === 'transform.python')!
    const koCases = defaultParamsFor(switchSpec).cases as { label: string }[]
    expect(koCases[0].label).toBe('분기 1')
    expect(String(defaultParamsFor(pySpec).code)).toContain('각 레코드')
    setLocale('en')
    const enCases = defaultParamsFor(switchSpec).cases as { label: string }[]
    expect(enCases[0].label).toBe('Branch 1')
    expect(String(defaultParamsFor(pySpec).code)).toContain('Receives each record')
  })

  it('기본 골격 판정은 언어를 가리지 않는다', () => {
    const koCode = defaultPycode('row')
    setLocale('en')
    expect(isDefaultPycode(koCode)).toBe(true) // ko 로 만든 노드를 en 화면에서 봐도 기본 골격
    expect(isDefaultPycode(defaultPycode('batch'))).toBe(true)
    expect(isDefaultPycode('def transform(row):\n    return row["x"]')).toBe(false)
  })
})
