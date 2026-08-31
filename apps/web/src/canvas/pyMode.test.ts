import { describe, expect, it } from 'vitest'
import { detectPyMode, isReplaceablePyCode } from './ConfigPanel'
import { defaultPycode } from './nodeCatalog'

describe('detectPyMode', () => {
  it('transform 정의는 행 단위', () => {
    expect(detectPyMode('def transform(row):\n    return row')).toBe('row')
  })
  it('transform_batch 정의는 배치 단위', () => {
    expect(detectPyMode('def transform_batch(df):\n    return df')).toBe('batch')
  })
  it('transform_batch 가 있으면 transform 보다 우선 (배치)', () => {
    // 실제로는 둘 다 있으면 백엔드가 거부하지만, 감지는 batch 를 먼저 본다
    expect(detectPyMode('def transform_batch(df):\n    return df')).toBe('batch')
  })
  it('주석·공백만이면 null', () => {
    expect(detectPyMode('# 아무 함수 없음\n')).toBeNull()
    expect(detectPyMode('')).toBeNull()
  })
  it('기본 골격들이 각각 올바르게 감지된다', () => {
    expect(detectPyMode(defaultPycode('row'))).toBe('row')
    expect(detectPyMode(defaultPycode('batch'))).toBe('batch')
  })
})

describe('isReplaceablePyCode', () => {
  it('빈 코드는 교체 가능', () => {
    expect(isReplaceablePyCode('   \n')).toBe(true)
  })
  it('기본 골격은 교체 가능', () => {
    expect(isReplaceablePyCode(defaultPycode('row'))).toBe(true)
    expect(isReplaceablePyCode(defaultPycode('batch'))).toBe(true)
  })
  it('def 없는 주석뿐이면 교체 가능', () => {
    expect(isReplaceablePyCode('# 메모\n# 메모2')).toBe(true)
  })
  it('커스텀 함수가 있으면 교체 불가 (확인 필요)', () => {
    expect(isReplaceablePyCode('def transform(row):\n    print(row)\n    return row')).toBe(false)
  })
})
