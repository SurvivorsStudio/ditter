import { describe, expect, it } from 'vitest'
import {
  addPipeline,
  emptyFolder,
  loadSaved,
  movePipeline,
  moveQuery,
  placedPipelineIds,
  removeFolder,
  removePipeline,
  type SavedFolder,
} from './savedStore'

/** 쿼리와 파이프라인이 한 트리에 산다. 담기는 것이 달라서(본문 ↔ 참조) 규칙도 갈리는데,
 *  그 차이가 조용히 무너지면 "지웠더니 파이프라인까지 없어졌다" 같은 사고가 된다. */

const folder = (id: string, name: string, pipelineIds: string[] = []): SavedFolder => ({
  id,
  name,
  folders: [],
  queries: [],
  pipelines: pipelineIds.map((pipelineId, i) => ({ id: `it${i}-${id}`, pipelineId, createdAt: 0 })),
})

describe('savedStore — 파이프라인 항목', () => {
  it('폴더에 파이프라인을 담는다', () => {
    const tree = addPipeline([folder('f', 'A')], 'f', 'p1')
    expect(tree[0].pipelines.map((p) => p.pipelineId)).toEqual(['p1'])
  })

  it('같은 파이프라인을 다른 폴더에 담으면 앞의 것은 빠진다', () => {
    // 두 폴더에 같은 것이 보이면 어느 쪽이 진짜인지 정할 수 없다.
    const tree = addPipeline([folder('a', 'A', ['p1']), folder('b', 'B')], 'b', 'p1')
    expect(tree[0].pipelines).toHaveLength(0)
    expect(tree[1].pipelines.map((p) => p.pipelineId)).toEqual(['p1'])
  })

  it('트리 항목 id 로 뺀다 (미분류로 되돌리기)', () => {
    const tree = folder('a', 'A', ['p1'])
    const out = removePipeline([tree], tree.pipelines[0].id)
    expect(placedPipelineIds(out).size).toBe(0)
  })

  it('옮기면 항목 id 가 유지된다', () => {
    const src = folder('a', 'A', ['p1'])
    const itemId = src.pipelines[0].id
    const out = movePipeline([src, folder('b', 'B')], itemId, 'b')
    expect(out[1].pipelines[0].id).toBe(itemId)
    expect(out[0].pipelines).toHaveLength(0)
  })

  it('없는 항목을 옮기면 트리를 그대로 돌려준다', () => {
    const tree = [folder('a', 'A', ['p1'])]
    expect(movePipeline(tree, 'nope', 'a')).toBe(tree)
  })

  it('placedPipelineIds 는 하위 폴더까지 훑는다', () => {
    const tree: SavedFolder[] = [{ ...folder('a', 'A', ['p1']), folders: [folder('b', 'B', ['p2'])] }]
    expect([...placedPipelineIds(tree)].sort()).toEqual(['p1', 'p2'])
  })

  it('폴더를 지우면 그 안의 파이프라인은 미분류로 돌아간다 (서버에서 지워지지 않는다)', () => {
    const out = removeFolder([folder('a', 'A', ['p1'])], 'a')
    expect(out).toHaveLength(0)
    expect(placedPipelineIds(out).size).toBe(0)
  })

  it('쿼리 이동은 파이프라인을 건드리지 않는다', () => {
    const a: SavedFolder = {
      ...folder('a', 'A', ['p1']),
      queries: [{ id: 'q1', name: 'q', mode: 'sql', text: '', createdAt: 0 }],
    }
    const out = moveQuery([a, folder('b', 'B')], 'q1', 'b')
    expect(out[0].pipelines.map((p) => p.pipelineId)).toEqual(['p1'])
    expect(out[1].queries.map((q) => q.id)).toEqual(['q1'])
  })

  it('emptyFolder 는 세 칸을 모두 채운다 — 예전 모양이 새로 생기면 안 된다', () => {
    const f = emptyFolder('새 폴더')
    expect(f).toMatchObject({ name: '새 폴더', folders: [], queries: [], pipelines: [] })
  })

  it('파이프라인 칸이 없던 예전 저장값도 읽힌다', () => {
    localStorage.setItem(
      'eai_saved_queries_v1',
      JSON.stringify([{ id: 'f', name: '옛폴더', queries: [] }]),
    )
    const out = loadSaved()
    expect(out[0].pipelines).toEqual([])
    expect(out[0].folders).toEqual([])
    localStorage.clear()
  })
})
