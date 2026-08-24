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
            label="전체 파이프라인"
            value={statsLoading ? <Spinner /> : formatNumber(stats?.pipelines_total ?? 0)}
            sub={`활성 ${stats?.pipelines_active ?? 0} · 비활성 ${stats?.pipelines_inactive ?? 0}`}
            color="var(--purple)"
          />
          <Stat
            label="오늘 성공"
            value={statsLoading ? <Spinner /> : formatNumber(stats?.runs_success_today ?? 0)}
            sub={`24시간 성공률 ${stats?.success_rate_24h ?? 0}%`}
            color="var(--green)"
            tone="up"
          />
          <Stat
            label="실패"
            value={statsLoading ? <Spinner /> : formatNumber(stats?.runs_failed_today ?? 0)}
            sub={(stats?.runs_failed_today ?? 0) > 0 ? '확인 필요' : '이상 없음'}
            color="var(--red)"
            tone={(stats?.runs_failed_today ?? 0) > 0 ? 'down' : undefined}
          />
          <Stat
            label="처리 레코드"
            value={statsLoading ? <Spinner /> : formatCompact(stats?.records_24h ?? 0)}
            sub="지난 24시간"
            color="var(--blue)"
          />
        </div>

        <div className="section-h">
          <h2>파이프라인</h2>
          <span className="more" onClick={() => navigate('/monitor')}>
            실행 이력 보기 →
          </span>
        </div>

        {notice && (
          <div style={{ marginBottom: 12 }}>
            <Banner kind="ok">
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1 }}>{notice}</span>
                <button className="x" onClick={() => setNotice(null)} aria-label="알림 닫기">
                  ×
                </button>
              </span>
            </Banner>
          </div>
        )}

        {error && <EmptyState title="목록을 불러오지 못했습니다">{String(error)}</EmptyState>}

        {isLoading && !pipelines && <EmptyState title="불러오는 중…" />}

        {pipelines && pipelines.length === 0 && (
          <EmptyState title="아직 파이프라인이 없습니다" image="/logo.png">
            상단의 [새 파이프라인] 버튼으로 첫 파이프라인을 만들어 보세요.
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
                  <div className="ds">{p.description || `버전 관리 · ${p.flow.join(' → ') || '노드 없음'}`}</div>
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
                  🕑 {p.schedule_enabled && p.schedule ? p.schedule : '수동'}
                </div>
                <Tag status={p.last_run_status ?? p.status} />
                {canEdit && (
                  <button
                    className="btn sm danger prow-del"
                    title="파이프라인 삭제"
                    aria-label={`${p.name} 삭제`}
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
              `'${impact.pipeline_name}' 을(를) 삭제했습니다.` +
                (impact.runs_total > 0
                  ? ` 실행 이력 ${formatNumber(impact.runs_total)}건도 함께 지워졌습니다.`
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
      setError(e instanceof Error ? e.message : '삭제에 실패했습니다')
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>파이프라인 삭제</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
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
              <Spinner /> 삭제 영향을 확인하는 중…
            </p>
          )}

          {data && cdcBlocked && (
            <Banner kind="error">
              CDC 스트림이 살아 있어 지울 수 없습니다 (<b>{data.cdc_stream_status}</b>). 모니터에서
              스트림을 먼저 중지하세요. 여기서 지우면 Debezium 커넥터가 주인 없이 남아 계속
              토픽에 씁니다.
            </Banner>
          )}

          {data && !cdcBlocked && runBlocked && (
            <Banner kind="warn">
              지금 실행이 진행 중입니다 (<b>{data.active_run_status}</b>). 그래도 지우면 그 실행은
              중간에 끊깁니다. 끝나기를 기다리는 편이 안전합니다.
            </Banner>
          )}

          {data && !cdcBlocked && !runBlocked && (
            <Banner kind="warn">
              삭제하면 되돌릴 수 없습니다. 아래 이력도 함께 사라집니다.
            </Banner>
          )}

          {data && (
            <div className="usage-list" style={{ marginTop: 12 }}>
              <div className="usage-row">
                <span className="usage-name" style={{ cursor: 'default' }}>
                  실행 이력
                </span>
                <span className="usage-nodes">
                  <code>{formatNumber(data.runs_total)}건</code>
                  {data.last_run_at && (
                    <code>마지막 {formatDateTime(data.last_run_at)}</code>
                  )}
                </span>
              </div>
              <div className="usage-row">
                <span className="usage-name" style={{ cursor: 'default' }}>
                  증분 체크포인트
                </span>
                <span className="usage-nodes">
                  <code>{formatNumber(data.checkpoints_total)}개</code>
                  {data.checkpoints_total > 0 && <code>워터마크 초기화됨</code>}
                </span>
              </div>
              <div className="usage-row">
                <span className="usage-name" style={{ cursor: 'default' }}>
                  버전 스냅샷
                </span>
                <span className="usage-nodes">
                  <code>{formatNumber(data.versions_total)}개</code>
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
              {runBlocked
                ? '진행 중인 실행이 끊긴다는 것을 이해했고, 그래도 삭제합니다.'
                : '실행 이력과 체크포인트가 함께 지워진다는 것을 이해했습니다.'}
            </label>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn danger-solid"
            disabled={
              isLoading || remove.isPending || cdcBlocked || (needsAck && !acknowledged)
            }
            onClick={submit}
          >
            {remove.isPending ? <Spinner /> : <Icon.trash />}
            {runBlocked ? '그래도 삭제' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
