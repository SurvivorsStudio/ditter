import { describe, expect, it } from 'vitest'
import { CONNECTOR_SPECS } from './connectorFields'
import { NODE_SPECS, SPEC_BY_KIND, isCdcSource } from '../canvas/nodeCatalog'

/** CDC 를 지원하는 커넥터 타입 — 백엔드 cdc_service.CDC_SUPPORTED_TYPES 와 반드시 같아야 한다.
 *  한쪽만 바뀌면 UI 와 실제 지원이 어긋나므로 이 목록을 기준으로 양쪽을 검증한다. */
const CDC_SUPPORTED_TYPES = ['mysql', 'postgres', 'mssql'] as const

/** 커넥터 스펙의 필드 중 cdc_enabled 체크박스를 가진 타입들 */
function typesWithCdcCheckbox(): string[] {
  return Object.entries(CONNECTOR_SPECS)
    .filter(([, spec]) => spec.fields.some((f) => f.key === 'cdc_enabled'))
    .map(([type]) => type)
    .sort()
}

describe('연결 폼 — CDC 체크박스(cdc_enabled)', () => {
  it('CDC 지원 타입에만 cdc_enabled 필드가 있다', () => {
    expect(typesWithCdcCheckbox()).toEqual([...CDC_SUPPORTED_TYPES].sort())
  })

  it.each(CDC_SUPPORTED_TYPES)('%s 연결 폼에 cdc_enabled 체크박스가 있다', (type) => {
    const field = CONNECTOR_SPECS[type].fields.find((f) => f.key === 'cdc_enabled')
    expect(field).toBeDefined()
    expect(field?.kind).toBe('checkbox')
  })

  it('MSSQL 폼은 cdc_enabled 를 서버 인증서 신뢰보다 뒤에 둔다', () => {
    const keys = CONNECTOR_SPECS.mssql.fields.map((f) => f.key)
    expect(keys).toContain('trust_server_certificate')
    expect(keys).toContain('cdc_enabled')
    expect(keys.indexOf('cdc_enabled')).toBeGreaterThan(keys.indexOf('trust_server_certificate'))
  })

  it('문서형/스토리지/ERP 커넥터에는 cdc_enabled 가 없다', () => {
    for (const type of ['mongo', 's3', 'local_file', 'sap_rfc']) {
      expect(CONNECTOR_SPECS[type].fields.some((f) => f.key === 'cdc_enabled')).toBe(false)
    }
  })
})

describe('팔레트 — CDC 소스 노드', () => {
  it('CDC 지원 타입마다 source.cdc.<type> 노드가 있다', () => {
    for (const type of CDC_SUPPORTED_TYPES) {
      const spec = SPEC_BY_KIND[`source.cdc.${type}`]
      expect(spec, `source.cdc.${type} 노드 스펙이 없음`).toBeDefined()
      expect(spec.connectorType).toBe(type)
      expect(spec.groupKey).toBe('nodeGroup.cdc')
    }
  })

  it('MSSQL (CDC) 노드가 존재하고 mssql 연결을 요구한다', () => {
    const spec = SPEC_BY_KIND['source.cdc.mssql']
    expect(spec.titleKey).toBe('node.source.cdc.mssql.title')
    expect(spec.connectorType).toBe('mssql')
    expect(spec.defaultParams).toMatchObject({ snapshot: 'initial', delete_mode: 'soft' })
  })

  it('isCdcSource 는 세 CDC 소스에만 true, 배치 소스엔 false', () => {
    for (const type of CDC_SUPPORTED_TYPES) {
      expect(isCdcSource(`source.cdc.${type}`)).toBe(true)
    }
    for (const kind of ['source.mysql', 'source.mssql', 'source.mongo', 'target.db']) {
      expect(isCdcSource(kind)).toBe(false)
    }
  })

  it('CDC 소스 노드의 connectorType 집합 = CDC 체크박스를 가진 연결 타입 집합', () => {
    // 프론트 안에서의 정합성: "CDC 소스로 쓸 수 있는 노드"와 "CDC 를 켤 수 있는 연결"이 어긋나면
    // 노드는 있는데 켤 연결이 없거나(반대) 하는 구멍이 생긴다.
    const cdcNodeTypes = NODE_SPECS.filter((s) => isCdcSource(s.kind))
      .map((s) => s.connectorType)
      .sort()
    expect(cdcNodeTypes).toEqual(typesWithCdcCheckbox())
  })
})
