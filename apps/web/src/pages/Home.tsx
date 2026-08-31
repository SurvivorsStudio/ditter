import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useDeletePipeline,
  usePipelineDeletionImpact,
  usePipelines,
  useStats,
} from '../api/hooks'
import { auth } from '../api/auth'
import type { DeletionImpact, PipelineSummary } from '../api/types'
import { Icon } from '../components/icons'
import {
  Banner,
  EmptyState,
  Spinner,
  Stat,
  Tag,
  formatCompact,
  formatDateTime,
  formatNumber,
} from '../components/common'
import { useT } from '../i18n'

/** 칩 색은 노드 종류를 따른다 — 소스=파랑(a) · 변환=보라(b) · 타깃=초록(c) (설계 문서 §8) */
const CHIP_CLASS: Record<string, string> = {
  MySQL: 'a',
  PostgreSQL: 'a',
  필터: 'b',
  매핑: 'b',
  'Target DB': 'c',
  S3: 'c',
}

export function Home() {
  const t = useT()
  const navigate = useNavigate()
  const { data: stats, isLoading: statsLoading } = useStats()
  const { data: pipelines, isLoading, error } = usePipelines()
  const [deleting, setDeleting] = useState<PipelineSummary | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canEdit = auth.can('editor')

  return (
    <div className="view">
      <div className="pad">
        <div className="stats">
          <Stat
            label={t('home.statPipelines')}
            value={statsLoading ? <Spinner /> : formatNumber(stats?.pipelines_total ?? 0)}
            sub={t('home.statPipelinesSub', {
              active: stats?.pipelines_active ?? 0,
              inactive: stats?.pipelines_inactive ?? 0,
            })}
            color="var(--purple)"
          />
          <Stat
            label={t('home.statSuccessToday')}
            value={statsLoading ? <Spinner /> : formatNumber(stats?.runs_success_today ?? 0)}
            sub={t('home.statSuccessSub', { rate: stats?.success_rate_24h ?? 0 })}
            color="var(--green)"
            tone="up"
          />
          <Stat
            label={t('status.failed')}
            value={statsLoading ? <Spinner /> : formatNumber(stats?.runs_failed_today ?? 0)}
            sub={(stats?.runs_failed_today ?? 0) > 0 ? t('home.statNeedsCheck') : t('home.statAllClear')}
            color="var(--red)"
            tone={(stats?.runs_failed_today ?? 0) > 0 ? 'down' : undefined}
          />
          <Stat
            label={t('home.statRecords')}
            value={statsLoading ? <Spinner /> : formatCompact(stats?.records_24h ?? 0)}
            sub={t('home.statLast24h')}
            color="var(--blue)"
          />
        </div>

        <div className="section-h">
          <h2>{t('nav.pipelines')}</h2>
          <span className="more" onClick={() => navigate('/monitor')}>
            {t('home.viewRunHistory')}
          </span>
        </div>

        {notice && (
          <div style={{ marginBottom: 12 }}>
            <Banner kind="ok">
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1 }}>{notice}</span>
                <button className="x" onClick={() => setNotice(null)} aria-label={t('home.dismissNotice')}>
                  ×
                </button>
              </span>
            </Banner>
          </div>
        )}

        {error && <EmptyState title={t('home.loadFailed')}>{String(error)}</EmptyState>}

        {isLoading && !pipelines && <EmptyState title={t('runs.loading')} />}

        {pipelines && pipelines.length === 0 && (
          <EmptyState title={t('home.emptyTitle')} image="/logo.png">
            {t('home.emptyBody')}
          </EmptyState>
        )}

        {pipelines && pipelines.length > 0 && (
          <div className="plist">
            {pipelines.map((p) => (
              <div className="prow" key={p.id} onClick={() => navigate(`/canvas/${p.id}`)}>
                <div
                  className="picon"
                  style={{ background: p.last_run_status === 'failed' ? 'var(--red)' : 'var(--src)' }}
                >
                  <Icon.db />
                </div>
                <div className="pmeta">
                  <div className="nm">{p.name}</div>
                  <div className="ds">
                    {p.description ||
                      t('home.flowFallback', { flow: p.flow.join(' → ') || t('home.noNodes') })}
                  </div>
                </div>
                <div className="miniflow">
                  {p.flow.map((label, index) => (
                    <span key={`${label}-${index}`}>
                      <span className={`chip ${CHIP_CLASS[label] ?? 'b'}`}>{label}</span>
                      {index < p.flow.length - 1 && <span className="arw"> ▶ </span>}
                    </span>
                  ))}
                </div>
                <div className="schedule">
                  🕑 {p.schedule_enabled && p.schedule ? p.schedule : t('trigger.manual')}
                </div>
                <Tag status={p.last_run_status ?? p.status} />
                {canEdit && (
                  <button
                    className="btn sm danger prow-del"
                    title={t('home.deletePipeline')}
                    aria-label={t('home.deleteAria', { name: p.name })}
                    onClick={(e) => {
                      // 행 전체가 캔버스로 가는 링크다 — 삭제는 그 이동을 타면 안 된다
                      e.stopPropagation()
                      setNotice(null)
                      setDeleting(p)
                    }}
                  >
                    <Icon.trash />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {deleting && (
        <DeletePipelineDialog
          pipeline={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(impact) =>
            setNotice(
              t('home.deletedNotice', { name: impact.pipeline_name }) +
                (impact.runs_total > 0
                  ? t('home.deletedRunsNotice', { n: impact.runs_total })
                  : ''),
            )
          }
        />
      )}
    </div>
  )
}

/** 삭제 확인 — 무엇이 함께 사라지는지 먼저 보여주고, 막혀 있으면 왜인지 알린다.
 *
 * 파이프라인 삭제는 실행 이력·체크포인트까지 cascade 로 함께 지운다. 체크포인트가 사라지면
 * 같은 이름으로 다시 만들어도 증분 위치를 잃어 처음부터 다시 읽는다 — 지우기 전에 알아야 할
 * 일이라 건수를 펼쳐 보인다.
 */
function DeletePipelineDialog({
  pipeline,
  onClose,
  onDeleted,
}: {
  pipeline: PipelineSummary
  onClose: () => void
  onDeleted: (impact: DeletionImpact) => void
}) {
  const t = useT()
  const { data, isLoading } = usePipelineDeletionImpact(pipeline.id)
  const remove = useDeletePipeline()
  const [error, setError] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  // CDC 는 force 로도 못 넘긴다 — 서버가 거부하므로 버튼 자체를 잠근다
  const cdcBlocked = Boolean(data?.cdc_stream_id)
  const runBlocked = Boolean(data?.active_run_id)
  const needsAck = runBlocked || (data?.runs_total ?? 0) > 0

  const submit = async () => {
    setError(null)
    try {
      const impact = await remove.mutateAsync({ id: pipeline.id, force: runBlocked })
      onDeleted(impact)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('home.deleteFailed'))
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{t('home.deletePipeline')}</h3>
          <button className="x" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '18px 22px 8px' }}>
          <div className="chosen-type" style={{ margin: '0 0 16px' }}>
            <span>
              <b>{pipeline.name}</b>
              {pipeline.description && (
                <span className="type-desc"> · {pipeline.description}</span>
              )}
            </span>
          </div>

          {error && <Banner kind="error">{error}</Banner>}

          {isLoading && !data && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              <Spinner /> {t('home.impactLoading')}
            </p>
          )}

          {data && cdcBlocked && (
            <Banner kind="error">
              {t('home.cdcBlockedLead')} (<b>{data.cdc_stream_status}</b>).{' '}
              {t('home.cdcBlockedRest')}
            </Banner>
          )}

          {data && !cdcBlocked && runBlocked && (
            <Banner kind="warn">
              {t('home.runBlockedLead')} (<b>{data.active_run_status}</b>).{' '}
              {t('home.runBlockedRest')}
            </Banner>
          )}

          {data && !cdcBlocked && !runBlocked && (
            <Banner kind="warn">{t('home.deleteWarn')}</Banner>
          )}

          {data && (
            <div className="usage-list" style={{ marginTop: 12 }}>
              <div className="usage-row">
                <span className="usage-name" style={{ cursor: 'default' }}>
                  {t('nav.crumb.monitor')}
                </span>
                <span className="usage-nodes">
                  <code>{t('common.count', { n: data.runs_total })}</code>
                  {data.last_run_at && (
                    <code>{t('home.lastAt', { at: formatDateTime(data.last_run_at) })}</code>
                  )}
                </span>
              </div>
              <div className="usage-row">
                <span className="usage-name" style={{ cursor: 'default' }}>
                  {t('home.checkpoints')}
                </span>
                <span className="usage-nodes">
                  <code>{t('home.itemCount', { n: data.checkpoints_total })}</code>
                  {data.checkpoints_total > 0 && <code>{t('home.watermarkReset')}</code>}
                </span>
              </div>
              <div className="usage-row">
                <span className="usage-name" style={{ cursor: 'default' }}>
                  {t('home.versionSnapshots')}
                </span>
                <span className="usage-nodes">
                  <code>{t('home.itemCount', { n: data.versions_total })}</code>
                </span>
              </div>
            </div>
          )}

          {data && !cdcBlocked && needsAck && (
            <label className="check ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              {runBlocked ? t('home.ackRun') : t('home.ackHistory')}
            </label>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn danger-solid"
            disabled={
              isLoading || remove.isPending || cdcBlocked || (needsAck && !acknowledged)
            }
            onClick={submit}
          >
            {remove.isPending ? <Spinner /> : <Icon.trash />}
            {runBlocked ? t('home.deleteAnyway') : t('home.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
