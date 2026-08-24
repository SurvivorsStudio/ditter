import { useState } from 'react'
import { auth } from '../api/auth'
import { useCancelRun, useRetryRun, useRun, useRunLogs } from '../api/hooks'
import { nodeStateSchema, type NodeState } from '../api/types'
import {
  Banner,
  Spinner,
  TRIGGER_LABEL,
  Tag,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTime,
} from '../components/common'
import { Icon } from '../components/icons'

const LEVELS = [
  { key: undefined, label: '전체' },
  { key: 'info', label: 'info+' },
  { key: 'warning', label: 'warning+' },
  { key: 'error', label: 'error' },
] as const

const NODE_STATUS_COLOR: Record<string, string> = {
  success: 'var(--green)',
  running: 'var(--blue)',
  failed: 'var(--red)',
  pending: 'var(--muted)',
  skipped: 'var(--muted)',
}

/** 실행 상세 — 노드별 분해, 로그, 재실행 (Phase 2 Monitor 고도화) */
export function RunDetail({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [level, setLevel] = useState<string | undefined>(undefined)
  const [nodeFilter, setNodeFilter] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<string | null>(null)

  const { data: run, isLoading } = useRun(runId)
  const { data: logs, isLoading: logsLoading } = useRunLogs(runId, { level, nodeId: nodeFilter })
  const retry = useRetryRun()
  const cancel = useCancelRun()

  const canOperate = auth.can('operator')
  const nodeStates = parseNodeStates(run?.node_states)
  const isActive = run?.status === 'running' || run?.status === 'pending'

  const handleRetry = async (fullRefresh: boolean) => {
    setMessage(null)
    try {
      const created = await retry.mutateAsync({ id: runId, fullRefresh })
      setMessage(`재실행을 시작했습니다 (#${created.id.slice(0, 8)})`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '재실행에 실패했습니다')
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>실행 상세 · #{runId.slice(0, 8)}</h3>
          {run && <Tag status={run.status} />}
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '14px 22px' }}>
          {isLoading && <Spinner />}
          {message && <Banner kind={message.includes('시작') ? 'ok' : 'error'}>{message}</Banner>}

          {run && (
            <>
              {run.error && <Banner kind="error">{run.error}</Banner>}

              <div className="detail-grid">
                <Field label="트리거" value={TRIGGER_LABEL[run.trigger] ?? run.trigger} />
                <Field label="파이프라인 버전" value={`v${run.pipeline_version}`} />
                <Field label="처리 건수" value={formatNumber(run.records)} />
                <Field label="진행률" value={`${run.progress}%`} />
                <Field label="시작" value={formatDateTime(run.started_at)} />
                <Field
                  label="소요"
                  value={formatDuration(
                    run.started_at && run.finished_at
                      ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000
                      : null,
                  )}
                />
              </div>

              <h4 className="detail-h">노드별 결과</h4>
              {Object.keys(nodeStates).length === 0 ? (
                <div className="hint" style={{ padding: '0 0 10px' }}>
                  아직 노드 상태가 기록되지 않았습니다.
                </div>
              ) : (
                <div className="table" style={{ marginBottom: 18 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>노드</th>
                        <th style={{ width: 90 }}>상태</th>
                        <th style={{ width: 110 }}>건수</th>
                        <th>결과 / 위치</th>
                        <th style={{ width: 70 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(nodeStates).map(([id, state]) => (
                        <tr key={id}>
                          <td style={{ fontWeight: 600 }}>{id}</td>
                          <td>
                            <span
                              className="node-dot"
                              style={{ background: NODE_STATUS_COLOR[state.status] ?? 'var(--muted)' }}
                            />
                            {state.status}
                          </td>
                          <td className="mono">{formatNumber(state.records)}</td>
                          <td
                            style={{ color: 'var(--muted)', wordBreak: 'break-all' }}
                            title={state.location ?? state.message}
                          >
                            {state.location ?? state.message ?? '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn sm"
                              onClick={() => setNodeFilter(nodeFilter === id ? undefined : id)}
                            >
                              {nodeFilter === id ? '해제' : '로그'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="detail-h-row">
                <h4 className="detail-h">
                  로그
                  {nodeFilter && <span className="detail-chip">노드: {nodeFilter}</span>}
                </h4>
                <div className="filter-row" style={{ margin: 0 }}>
                  {LEVELS.map((l) => (
                    <span
                      key={l.label}
                      className={`pill sm ${level === l.key ? 'on' : ''}`}
                      onClick={() => setLevel(l.key)}
                    >
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>

              {logsLoading && <Spinner />}
              {logs && logs.length === 0 && (
                <div className="hint">해당 조건의 로그가 없습니다.</div>
              )}
              {logs && logs.length > 0 && (
                <div className="logbox">
                  {logs.map((log) => (
                    <div key={log.id} className={`lvl-${log.level}`}>
                      <span className="ts">{formatTime(log.ts)}</span>
                      {log.node_id && <span style={{ color: '#8f96b8' }}>[{log.node_id}] </span>}
                      {log.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mf">
          {canOperate && isActive && (
            <button className="btn danger" disabled={cancel.isPending} onClick={() => cancel.mutate(runId)}>
              <Icon.stop />
              실행 취소
            </button>
          )}
          {canOperate && !isActive && (
            <>
              <button className="btn" disabled={retry.isPending} onClick={() => handleRetry(true)}>
                <Icon.refresh />
                전체 재적재로 재실행
              </button>
              <button
                className="btn primary"
                disabled={retry.isPending}
                onClick={() => handleRetry(false)}
              >
                {retry.isPending ? <Spinner /> : <Icon.play />}
                재실행
              </button>
            </>
          )}
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  )
}

function parseNodeStates(raw: unknown): Record<string, NodeState> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, NodeState> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = nodeStateSchema.safeParse(value)
    if (parsed.success) out[key] = parsed.data
  }
  return out
}
