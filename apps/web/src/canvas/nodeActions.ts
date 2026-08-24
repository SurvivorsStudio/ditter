import { createContext, useContext } from 'react'

/** 노드 카드 안의 "이 노드만 실행" 버튼이 쓰는 액션.
 *
 * Canvas 가 값을 채워 Provider 로 내려주고, EaiNode 가 소비한다 — React Flow 가
 * 노드를 렌더하므로 props 로 직접 넘기기 어렵기 때문에 context 로 전달한다.
 */
export type NodeActions = {
  /** 그 노드만 독립 실행한다 (그 노드까지 필요한 상류만) */
  runNode: (nodeId: string) => void
  /** API 트리거의 테스트 실행 — 값을 채우는 모달을 열고 파이프라인 전체를 돌린다.
   *  단일 노드 실행과 달리 '이 노드만'이 아니라 전체다: 트리거는 흐름의 시작점이라
   *  혼자 실행하는 것에 의미가 없다. */
  testRun: (nodeId: string) => void
  /** 지금 단일 실행 중인 노드 id (스피너 표시용). 없으면 null */
  runningNodeId: string | null
  /** 실행을 시작할 수 있는 상태인가 (다른 실행이 도는 중이면 false) */
  canRun: boolean
  /** 그 노드의 결과 샘플을 모달로 연다 (엣지 위 결과 칩에서 호출) */
  openResult: (nodeId: string) => void
  /** 이 엣지로 넘어간 값을 모달로 연다.
   *
   *  결과 샘플(행 데이터)과 다른 것이다. 이쪽은 상류가 하류에 **건네준 값** — 예를 들어
   *  API 트리거가 넘긴 `$since` 가 하류 노드의 WHERE 절을 무엇으로 바꿨는가다.
   *  로그로도 남지만, 어느 선에서 무엇이 넘어갔는지는 그 선을 눌러 보는 편이 직관적이다. */
  openEdgeValues: (sourceId: string, targetId: string) => void
}

export const NodeActionsContext = createContext<NodeActions | null>(null)

export function useNodeActions(): NodeActions | null {
  return useContext(NodeActionsContext)
}
