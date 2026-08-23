import { beforeEach, describe, expect, it } from 'vitest'
import { SYNC_CHANNELS, SYNC_PURPOSES, nodeKindSchema } from '../api/types'
import {
  CATEGORIES,
  NODE_SPECS,
  SPEC_BY_KIND,
  allowedConnectorTypes,
  isSource,
  isSyncKind,
  isSyncSource,
  isSyncTarget,
  isSyncTrigger,
  isTarget,
  isTrigger,
} from './nodeCatalog'
import { useCanvasStore } from '../store/canvasStore'

const SYNC_KINDS = ['trigger.sync', 'source.sync.mssql', 'target.sync.db'] as const

describe('실시간 동기화 노드 카탈로그', () => {
  it.each(SYNC_KINDS)('%s 는 zod 스키마와 카탈로그 양쪽에 있다', (kind) => {
    expect(nodeKindSchema.safeParse(kind).success).toBe(true)
    expect(SPEC_BY_KIND[kind]).toBeDefined()
  })

  it('소스·타깃·트리거 분류가 서로 어긋나지 않는다', () => {
    expect(isSyncTrigger('trigger.sync') && isTrigger('trigger.sync')).toBe(true)
    expect(isSyncSource('source.sync.mssql') && isSource('source.sync.mssql')).toBe(true)
    expect(isSyncTarget('target.sync.db') && isTarget('target.sync.db')).toBe(true)
  })

  it.each(SYNC_KINDS)('%s 는 동기화 파이프라인으로 인식된다', (kind) => {
    expect(isSyncKind(kind)).toBe(true)
  })

  it('CDC 노드는 동기화로 인식되지 않는다 — 실행 경로가 다르다', () => {
    for (const kind of ['trigger.cdc', 'source.cdc.mssql', 'target.db']) {
      expect(isSyncKind(kind)).toBe(false)
    }
  })

  it('소스는 MSSQL, 타깃은 PostgreSQL 연결만 받는다 (사이드카 JDBC 드라이버 범위)', () => {
    expect(allowedConnectorTypes('source.sync.mssql')).toEqual(['mssql'])
    expect(allowedConnectorTypes('target.sync.db')).toEqual(['postgres'])
  })

  it('부하 테스트·복제본 용도 기본값은 "아직 확인 안 됨" 쪽이다', () => {
    const params = SPEC_BY_KIND['source.sync.mssql'].defaultParams
    expect(params.load_test_ack).toBe(false)
    expect(params.purpose).toBe('readonly')
    expect(params.tables).toEqual([])
  })

  /** 팔레트는 "소분류가 처음 바뀌는 자리"에만 라벨을 끼운다. 그래서 소분류가 붙은 항목이
   *  분류 중간에 있으면 뒤따르는 소분류 없는 항목들까지 그 라벨 아래로 보인다 —
   *  실제로 「동기화 타깃 DB」를 타깃 분류 중간에 넣었다가 MongoDB·S3 가 '실시간 동기화'
   *  아래로 딸려 들어갔다. 소분류가 붙은 항목은 그 분류의 끝에 있어야 한다. */
  it('소분류가 붙은 노드는 그 분류의 마지막에 모여 있다', () => {
    for (const category of CATEGORIES) {
      const inCategory = NODE_SPECS.filter((s) => s.category === category)
      const firstGrouped = inCategory.findIndex((s) => s.group)
      if (firstGrouped === -1) continue
      const tail = inCategory.slice(firstGrouped)
      expect(tail.every((s) => s.group), `${category}: 소분류 뒤에 소분류 없는 노드가 있다`).toBe(
        true,
      )
    }
  })

  it('채널 목록은 백엔드 SYNC_CHANNELS 와 같다', () => {
    expect(SYNC_CHANNELS.map((c) => c.id)).toEqual(['realtime', 'standard', 'bulk'])
  })

  it('복제본 용도 목록은 백엔드 SYNC_PURPOSES 와 같다', () => {
    expect(SYNC_PURPOSES.map((p) => p.id)).toEqual(['readonly', 'operational'])
  })
})

/** 이 기능의 핵심 규칙 — 데이터가 워커를 지나지 않으므로 사이에 아무것도 끼울 수 없다.
 *  백엔드 `_sync_pipeline_issues` 가 같은 것을 저장 시점에 잡지만, 애초에 그려지지 않는 편이
 *  낫다: 이어 놓고 나서 "왜 변환이 안 먹지"를 겪을 이유가 없다. */
describe('캔버스 연결 규칙 — 동기화 소스↔타깃', () => {
  const definition = {
    nodes: [
      { id: 'trg', kind: 'trigger.sync' as const, label: '', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'src',
        kind: 'source.sync.mssql' as const,
        label: '',
        position: { x: 0, y: 0 },
        params: {},
      },
      {
        id: 'tgt',
        kind: 'target.sync.db' as const,
        label: '',
        position: { x: 0, y: 0 },
        params: {},
      },
      {
        id: 'flt',
        kind: 'transform.filter' as const,
        label: '',
        position: { x: 0, y: 0 },
        params: {},
      },
      {
        id: 'db',
        kind: 'target.db' as const,
        label: '',
        position: { x: 0, y: 0 },
        params: {},
      },
    ],
    edges: [],
    variables: {},
  }
  const connect = (source: string, target: string) =>
    useCanvasStore.getState().onConnect({ source, target, sourceHandle: null, targetHandle: null })

  beforeEach(() => useCanvasStore.getState().loadDefinition(definition))

  it('동기화 소스 → 동기화 타깃은 이어진다', () => {
    connect('src', 'tgt')
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })

  it('트리거 → 동기화 소스는 이어진다 (언제 켜는지를 정해 준다)', () => {
    connect('trg', 'src')
    expect(useCanvasStore.getState().edges).toHaveLength(1)
  })

  it('동기화 소스 → 변환 노드는 거절된다', () => {
    connect('src', 'flt')
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('동기화 소스 → 일반 타깃은 거절된다', () => {
    connect('src', 'db')
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })

  it('변환 노드 → 동기화 타깃은 거절된다', () => {
    connect('flt', 'tgt')
    expect(useCanvasStore.getState().edges).toHaveLength(0)
  })
})
