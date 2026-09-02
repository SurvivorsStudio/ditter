import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Icon } from '../components/icons'
import type { EaiNode as EaiNodeType } from '../store/canvasStore'
import { useNodeActions } from './nodeActions'
import { CATEGORY_KEY, SPEC_BY_KIND, isSource, isTarget, isTrigger, switchOutputs } from './nodeCatalog'
import { t, useT, type MsgKey } from '../i18n'

// 라벨은 MsgKey 로만 들고 렌더 시점에 t() 로 푼다 — 모듈 상수에 번역문을 담으면
// 언어 전환을 못 따라온다. success 가 status.success('성공') 가 아닌 이유는
// 노드 뱃지에서는 '완료' 라고 부르기 때문이다 — 뜻이 다른 말은 키도 가른다.
const STATUS_LABEL: Record<string, MsgKey> = {
  pending: 'status.pending',
  running: 'status.running',
  success: 'cui.node.statusDone',
  failed: 'status.failed',
  skipped: 'cui.node.statusSkipped',
}

/** 노드 부제 — 무엇을 대상으로 하는지 한 줄로 보여준다.
 *  렌더마다 불리므로 여기서 t() 를 불러도 언어 전환을 따라온다. */
function subtitle(kind: string, params: Record<string, unknown>): string {
  if (isTrigger(kind)) {
    return kind === 'trigger.schedule'
      ? String(params.cron ?? t('cui.node.cronUnset'))
      : t('cui.node.buttonRun')
  }
  if (isSource(kind)) {
    if (params.query) return t('cui.node.customQuery')
    const table = params.table ? String(params.table) : t('cui.node.noTable')
    return params.incremental_column ? t('cui.node.incremental', { table }) : table
  }
  if (kind === 'target.s3' || kind === 'target.file') {
    const fallback = kind === 'target.file' ? t('cui.node.connFolder') : t('cui.node.noPath')
    const prefix = params.path_prefix ? String(params.path_prefix) : fallback
    const defaultFmt = kind === 'target.file' ? 'jsonl' : 'parquet'
    return `${prefix} · ${String(params.file_format ?? defaultFmt)}`
  }
  if (isTarget(kind)) {
    return `${String(params.table ?? t('cui.node.noTable'))} · ${String(params.mode ?? 'upsert')}`
  }
  if (kind === 'transform.filter') {
    const n = Array.isArray(params.conditions) ? params.conditions.length : 0
    return n ? t('cui.node.condCount', { n }) : t('cui.node.noCond')
  }
  if (kind === 'transform.python') {
    const code = String(params.code ?? '').trim()
    return code ? t('cui.node.codeLines', { n: code.split('\n').length }) : t('cui.node.noCode')
  }
  if (kind === 'logic.switch') {
    const n = Array.isArray(params.cases) ? params.cases.length : 0
    return n ? t('cui.node.caseCount', { n }) : t('cui.node.noCase')
  }
  const n = Array.isArray(params.mappings) ? params.mappings.length : 0
  return n ? t('cui.node.mapCount', { n }) : t('cui.node.noMap')
}

export function EaiNode({ id, data, selected }: NodeProps<EaiNodeType>) {
  const tr = useT()
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
        <Handle type="target" position={Position.Left} title={tr('cui.node.inTitle')} />
      )}

      {canShowRun && (
        <button
          className="node-run-btn nodrag"
          title={
            isApiTrigger
              ? tr('cui.node.testRunTitle')
              : tr('cui.node.runOneTitle')
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
        <span>
          {STATUS_LABEL[status]
            ? tr(STATUS_LABEL[status])
            : spec
              ? tr(CATEGORY_KEY[spec.category])
              : tr('cui.node.ready')}
        </span>
        {/* 결과는 출구 쪽 엣지에 뜨지만, 하류가 없는 노드(타깃 등)는 그 엣지가 없다.
            그런 노드의 결과도 볼 수 있어야 하므로 건수 자체를 여는 버튼으로 둔다. */}
        {records > 0 &&
          (data.runState?.sample && actions ? (
            <button
              className="node-records nodrag"
              style={{ marginLeft: 'auto' }}
              title={tr('cui.node.recordsTitle')}
              onClick={(e) => {
                e.stopPropagation()
                actions.openResult(id)
              }}
            >
              {tr('common.count', { n: records })}
</button>
) : (
<span style={{ marginLeft: 'auto' }}>{tr('common.count', { n: records })}</span>
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
                title={tr('cui.node.outBranchTitle', { label: out.label })}
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
          <Handle type="source" position={Position.Right} title={tr('cui.node.outTitle')} />
        )
      )}
    </div>
  )
}

export const nodeTypes = { eai: EaiNode }
