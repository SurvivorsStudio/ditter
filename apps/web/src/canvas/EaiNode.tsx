import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Icon } from '../components/icons'
import type { EaiNode as EaiNodeType } from '../store/canvasStore'
import { useNodeActions } from './nodeActions'
import { SPEC_BY_KIND, isSource, isTarget, isTrigger, switchOutputs } from './nodeCatalog'

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  running: '실행중',
  success: '완료',
  failed: '실패',
  skipped: '건너뜀',
}

/** 노드 부제 — 무엇을 대상으로 하는지 한 줄로 보여준다 */
function subtitle(kind: string, params: Record<string, unknown>): string {
  if (isTrigger(kind)) {
    return kind === 'trigger.schedule' ? String(params.cron ?? 'cron 미설정') : '버튼 실행'
  }
  if (isSource(kind)) {
    if (params.query) return '커스텀 쿼리'
    const table = params.table ? String(params.table) : '테이블 미지정'
    return params.incremental_column ? `${table} · 증분` : table
  }
  if (kind === 'target.s3' || kind === 'target.file') {
    const fallback = kind === 'target.file' ? '연결 폴더' : '경로 미지정'
    const prefix = params.path_prefix ? String(params.path_prefix) : fallback
    const defaultFmt = kind === 'target.file' ? 'jsonl' : 'parquet'
    return `${prefix} · ${String(params.file_format ?? defaultFmt)}`
  }
  if (isTarget(kind)) {
    return `${String(params.table ?? '테이블 미지정')} · ${String(params.mode ?? 'upsert')}`
  }
  if (kind === 'transform.filter') {
    const n = Array.isArray(params.conditions) ? params.conditions.length : 0
    return n ? `조건 ${n}개` : '조건 없음'
  }
  if (kind === 'transform.python') {
    const code = String(params.code ?? '').trim()
    return code ? `코드 ${code.split('\n').length}줄` : '코드 없음'
  }
  if (kind === 'logic.switch') {
    const n = Array.isArray(params.cases) ? params.cases.length : 0
    return n ? `분기 ${n}개 + 그 외` : '분기 없음'
  }
  const n = Array.isArray(params.mappings) ? params.mappings.length : 0
  return n ? `매핑 ${n}개` : '매핑 없음'
}

export function EaiNode({ id, data, selected }: NodeProps<EaiNodeType>) {
  const spec = SPEC_BY_KIND[data.kind]
  const IconComp = spec?.icon
  const status = data.runState?.status ?? 'idle'
  const records = data.runState?.records ?? 0

  const actions = useNodeActions()
  // 트리거는 실행 대상이 아니다 — 소스·변환·타깃에만 단일 실행 버튼을 둔다.
  // 다만 API 트리거는 예외다: 값을 받아 파이프라인 전체를 돌리는 창구라, 저작 중에
  // 가짜 값으로 한 번 돌려보는 것이 이 노드의 사용법 그 자체다.
  const isApiTrigger = data.kind === 'trigger.api'
  const canShowRun = actions && (!isTrigger(data.kind) || isApiTrigger)
  const isRunningThis = actions?.runningNodeId === id

  return (
    <div className={`rf-node ${selected ? 'selected' : ''} status-${status}`}>
      {/* 입구는 왼쪽 — 여기로 값이 들어온다.
          트리거에는 두지 않는다. 트리거는 흐름의 **시작**이라 받을 것이 없다.
          타깃에 출구가 없는 것과 같은 이유다 — 못 하는 일은 그릴 수 없게 한다. */}
      {!isTrigger(data.kind) && (
        <Handle type="target" position={Position.Left} title="입구 — 여기로 값이 들어옵니다" />
      )}

      {canShowRun && (
        <button
          className="node-run-btn nodrag"
          title={
            isApiTrigger
              ? '테스트 실행 — 값을 채워 파이프라인 전체를 돌립니다'
              : '이 노드만 실행 (그 노드까지 필요한 상류만)'
          }
          disabled={!actions.canRun && !isRunningThis}
          onClick={(e) => {
            e.stopPropagation()
            if (!actions.canRun) return
            if (isApiTrigger) actions.testRun(id)
            else actions.runNode(id)
          }}
        >
          {isRunningThis ? <span className="node-run-spin" /> : <Icon.play />}
        </button>
      )}

      <div className="nhd">
        <div className="nic" style={{ background: spec?.color ?? 'var(--muted)' }}>
          {IconComp ? <IconComp /> : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="ntt" title={data.label}>
            {data.label}
          </div>
          <div className="nsub" title={subtitle(data.kind, data.params)}>
            {subtitle(data.kind, data.params)}
          </div>
        </div>
      </div>

      <div className="nfoot">
        <span className={`st ${status}`} />
        <span>{STATUS_LABEL[status] ?? spec?.category ?? '준비'}</span>
        {/* 결과는 출구 쪽 엣지에 뜨지만, 하류가 없는 노드(타깃 등)는 그 엣지가 없다.
            그런 노드의 결과도 볼 수 있어야 하므로 건수 자체를 여는 버튼으로 둔다. */}
        {records > 0 &&
          (data.runState?.sample && actions ? (
            <button
              className="node-records nodrag"
              style={{ marginLeft: 'auto' }}
              title="이 노드가 내놓은 값 보기"
              onClick={(e) => {
                e.stopPropagation()
                actions.openResult(id)
              }}
            >
              {records.toLocaleString()}건
            </button>
          ) : (
            <span style={{ marginLeft: 'auto' }}>{records.toLocaleString()}건</span>
          ))}
      </div>

      {data.kind === 'logic.switch' ? (
        <div className="switch-outs">
          {switchOutputs(data.params).map((out) => (
            <div className={`switch-out ${out.id === '__default__' ? 'default' : ''}`} key={out.id}>
              <span className="switch-out-label" title={out.label}>
                {out.label}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={out.id}
                title={`출구 (${out.label}) — 이 분기의 값이 나갑니다`}
              />
            </div>
          ))}
        </div>
      ) : (
        // 출구는 오른쪽 — 이 노드의 **결과값**이 나가는 곳이다.
        //
        // 타깃에는 두지 않는다. 타깃은 흐름의 **끝**이다 — DB·S3·파일에 적재하거나
        // API 응답으로 돌려주고 거기서 끝난다. 출구를 그리면 뒤에 노드를 이을 수 있는
        // 것처럼 보이는데, 엔진은 타깃을 종점으로 보고 있어 실행 시점에 깨진다.
        // 못 하는 일은 애초에 그릴 수 없게 하는 편이 낫다.
        !isTarget(data.kind) && (
          <Handle type="source" position={Position.Right} title="출구 — 이 노드의 결과값이 나갑니다" />
        )
      )}
    </div>
  )
}

export const nodeTypes = { eai: EaiNode }
