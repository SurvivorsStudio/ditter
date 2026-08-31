import { useState } from 'react'
import { auth } from '../api/auth'
import { useCancelRun, useRetryRun, useRun, useRunLogs } from '../api/hooks'
import { nodeStateSchema, type NodeState } from '../api/types'
import {
  Banner,
  Spinner,
  Tag,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTime,
  triggerLabel,
} from '../components/common'
import { Icon } from '../components/icons'
import { useT } from '../i18n'

const LEVELS = [
  { key: undefined, labelKey: 'monitor.filter.all' },
  { key: 'info', labelKey: 'monitor.level.info' },
  { key: 'warning', labelKey: 'monitor.level.warning' },
  { key: 'error', labelKey: 'monitor.level.error' },
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
  const t = useT()
  const [level, setLevel] = useState<string | undefined>(undefined)
  const [nodeFilter, setNodeFilter] = useState<string | undefined>(undefined)
  // 성공/실패를 문구가 아니라 값으로 든다 — 문구('시작')로 판정하면 번역되는 순간 색이 어긋난다
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

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
      setMessage({ kind: 'ok', text: t('monitor.detail.retryStarted', { id: created.id.slice(0, 8) }) })
    } catch (e) {
      setMessage({
        kind: 'error',
        text: e instanceof Error ? e.message : t('monitor.detail.retryFailed'),
      })
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{t('monitor.detail.title', { id: runId.slice(0, 8) })}</h3>
          {run && <Tag status={run.status} />}
          <button className="x" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '14px 22px' }}>
          {isLoading && <Spinner />}
          {message && <Banner kind={message.kind}>{message.text}</Banner>}

          {run && (
            <>
              {run.error && <Banner kind="error">{run.error}</Banner>}

              <div className="detail-grid">
                <Field label={t('monitor.th.trigger')} value={triggerLabel(run.trigger)} />
                <Field label={t('monitor.detail.version')} value={`v${run.pipeline_version}`} />
                <Field label={t('monitor.th.records')} value={formatNumber(run.records)} />
                <Field label={t('monitor.th.progress')} value={`${run.progress}%`} />
                <Field label={t('monitor.detail.started')} value={formatDateTime(run.started_at)} />
                <Field
                  label={t('monitor.th.duration')}
                  value={formatDuration(
                    run.started_at && run.finished_at
                      ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000
                      : null,
                  )}
                />
              </div>

              <h4 className="detail-h">{t('monitor.detail.nodeResults')}</h4>
              {Object.keys(nodeStates).length === 0 ? (
                <div className="hint" style={{ padding: '0 0 10px' }}>
                  {t('monitor.detail.noNodeStates')}
                </div>
              ) : (
                <div className="table" style={{ marginBottom: 18 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('monitor.detail.th.node')}</th>
                        <th style={{ width: 90 }}>{t('monitor.th.status')}</th>
                        <th style={{ width: 110 }}>{t('monitor.detail.th.records')}</th>
                        <th>{t('monitor.detail.th.result')}</th>
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
                              {nodeFilter === id
                                ? t('monitor.detail.clearFilter')
                                : t('monitor.detail.logs')}
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
                  {t('monitor.detail.logs')}
                  {nodeFilter && (
                    <span className="detail-chip">
                      {t('monitor.detail.nodeChip', { node: nodeFilter })}
                    </span>
                  )}
                </h4>
                <div className="filter-row" style={{ margin: 0 }}>
                  {LEVELS.map((l) => (
                    <span
                      key={l.labelKey}
                      className={`pill sm ${level === l.key ? 'on' : ''}`}
                      onClick={() => setLevel(l.key)}
                    >
                      {t(l.labelKey)}
                    </span>
                  ))}
                </div>
              </div>

              {logsLoading && <Spinner />}
              {logs && logs.length === 0 && (
                <div className="hint">{t('monitor.detail.noLogs')}</div>
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
              {t('monitor.cancelRun')}
            </button>
          )}
          {canOperate && !isActive && (
            <>
              <button className="btn" disabled={retry.isPending} onClick={() => handleRetry(true)}>
                <Icon.refresh />
                {t('monitor.detail.retryFull')}
              </button>
              <button
                className="btn primary"
                disabled={retry.isPending}
                onClick={() => handleRetry(false)}
              >
                {retry.isPending ? <Spinner /> : <Icon.play />}
                {t('monitor.detail.retry')}
              </button>
            </>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.close')}
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
