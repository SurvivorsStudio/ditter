import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../api/auth'
import {
  useCancelRun,
  useDeleteStream,
  usePipelines,
  useRuns,
  useStats,
  useStream,
  useStreamAction,
  useStreams,
} from '../api/hooks'
import { RunDetail } from './RunDetail'
import {
  Banner,
  EmptyState,
  Spinner,
  Stat,
  Tag,
  formatDuration,
  formatNumber,
  formatTime,
  triggerLabel,
} from '../components/common'
import { Icon } from '../components/icons'

const FILTERS = [
  { key: undefined, label: '전체' },
  { key: 'success', label: '✔ 성공' },
  { key: 'running', label: '● 실행중' },
  { key: 'failed', label: '✕ 실패' },
] as const

const RANGES = [
  { hours: 24, label: '최근 24시간' },
  { hours: 24 * 7, label: '최근 7일' },
  { hours: undefined, label: '전체 기간' },
] as const

const BAR_COLOR: Record<string, string> = {
  success: 'var(--green)',
  running: 'var(--blue)',
  failed: 'var(--red)',
  pending: 'var(--amber)',
  cancelled: 'var(--muted)',
}

export function Monitor() {
  const [tab, setTab] = useState<'runs' | 'streams'>('runs')
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [hours, setHours] = useState<number | undefined>(24)
  const [pipelineId, setPipelineId] = useState<string | undefined>(undefined)
  const [openRunId, setOpenRunId] = useState<string | null>(null)

  const { data: stats } = useStats()
  const { data: pipelines } = usePipelines()
  const { data: page, isLoading, error } = useRuns({ status, hours, pipelineId, limit: 100 })
  const cancel = useCancelRun()

  const runs = page?.items ?? []
  const canOperate = auth.can('operator')

  return (
    <div className="view">
      <div className="pad">
        <div className="filter-row" style={{ marginBottom: 14 }}>
          <span className={`pill ${tab === 'runs' ? 'on' : ''}`} onClick={() => setTab('runs')}>
            실행 (배치)
          </span>
          <span
            className={`pill ${tab === 'streams' ? 'on' : ''}`}
            onClick={() => setTab('streams')}
          >
            <Icon.broadcast /> 스트림 (CDC)
          </span>
        </div>

        {tab === 'streams' ? (
          <StreamsPanel canOperate={canOperate} />
        ) : (
          <RunsPanel
            stats={stats}
            pipelines={pipelines}
            page={page}
            isLoading={isLoading}
            error={error}
            runs={runs}
            status={status}
            setStatus={setStatus}
            hours={hours}
            setHours={setHours}
            pipelineId={pipelineId}
            setPipelineId={setPipelineId}
            canOperate={canOperate}
            cancel={cancel}
            setOpenRunId={setOpenRunId}
          />
        )}
      </div>

      {openRunId && <RunDetail runId={openRunId} onClose={() => setOpenRunId(null)} />}
    </div>
  )
}

type RunsPanelProps = {
  stats: ReturnType<typeof useStats>['data']
  pipelines: ReturnType<typeof usePipelines>['data']
  page: ReturnType<typeof useRuns>['data']
  isLoading: boolean
  error: unknown
  runs: NonNullable<ReturnType<typeof useRuns>['data']>['items']
  status: string | undefined
  setStatus: (v: string | undefined) => void
  hours: number | undefined
  setHours: (v: number | undefined) => void
  pipelineId: string | undefined
  setPipelineId: (v: string | undefined) => void
  canOperate: boolean
  cancel: ReturnType<typeof useCancelRun>
  setOpenRunId: (v: string | null) => void
}

function RunsPanel({
  stats,
  pipelines,
  page,
  isLoading,
  error,
  runs,
  status,
  setStatus,
  hours,
  setHours,
  pipelineId,
  setPipelineId,
  canOperate,
  cancel,
  setOpenRunId,
}: RunsPanelProps) {
  return (
    <>
        <div className="stats">
          <Stat
            label="성공률 (24h)"
            value={`${stats?.success_rate_24h ?? 0}%`}
            sub={`실행 ${stats?.runs_total_24h ?? 0}건 기준`}
            color="var(--green)"
            tone="up"
          />
          <Stat
            label="평균 처리시간"
            value={formatDuration(stats?.avg_duration_seconds ?? null)}
            sub={`중앙값 ${formatDuration(stats?.median_duration_seconds ?? null)}`}
            color="var(--blue)"
          />
          <Stat
            label="실행 (24h)"
            value={formatNumber(stats?.runs_total_24h ?? 0)}
            sub={`스케줄 ${stats?.runs_scheduled_24h ?? 0} · 수동 ${stats?.runs_manual_24h ?? 0}`}
            color="var(--purple)"
          />
          <Stat
            label="실패 (오늘)"
            value={formatNumber(stats?.runs_failed_today ?? 0)}
            sub={(stats?.runs_failed_today ?? 0) > 0 ? '로그 확인 필요' : '이상 없음'}
            color="var(--red)"
            tone={(stats?.runs_failed_today ?? 0) > 0 ? 'down' : undefined}
          />
        </div>

        <div className="filter-row">
          {FILTERS.map((f) => (
            <span
              key={f.label}
              className={`pill ${status === f.key ? 'on' : ''}`}
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto' }} />
          <select
            className="pill select"
            value={pipelineId ?? ''}
            onChange={(e) => setPipelineId(e.target.value || undefined)}
            title="파이프라인별 필터"
          >
            <option value="">모든 파이프라인</option>
            {(pipelines ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {RANGES.map((r) => (
            <span
              key={r.label}
              className={`pill ${hours === r.hours ? 'on' : ''}`}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </span>
          ))}
        </div>

        {error && <Banner kind="error">실행 이력을 불러오지 못했습니다: {String(error)}</Banner>}

        {isLoading && !page && <EmptyState title="불러오는 중…" />}

        {page && runs.length === 0 && (
          <EmptyState title="해당 조건의 실행 이력이 없습니다">
            필터를 바꾸거나 파이프라인을 실행해 보세요.
          </EmptyState>
        )}

        {runs.length > 0 && (
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>실행</th>
                  <th>파이프라인</th>
                  <th style={{ width: 80 }}>상태</th>
                  <th style={{ width: 80 }}>트리거</th>
                  <th style={{ width: 100 }}>처리 건수</th>
                  <th style={{ width: 150 }}>진행률</th>
                  <th style={{ width: 80 }}>소요</th>
                  <th style={{ width: 100 }}>시작 시각</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="mono" style={{ color: 'var(--muted)' }}>
                      #{run.id.slice(0, 6)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{run.pipeline_name}</td>
                    <td>
                      <Tag status={run.status} />
                    </td>
                    <td style={{ color: '#5b6070' }}>{triggerLabel(run.trigger)}</td>
                    <td className="mono">{formatNumber(run.records)}</td>
                    <td>
                      <span className="bar">
                        <i
                          style={{
                            width: `${run.progress}%`,
                            background: BAR_COLOR[run.status] ?? 'var(--green)',
                          }}
                        />
                      </span>{' '}
                      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {run.progress}%
                      </span>
                    </td>
                    <td className="mono" style={{ color: '#5b6070' }}>
                      {formatDuration(run.duration_seconds)}
                    </td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>
                      {formatTime(run.started_at)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn sm" onClick={() => setOpenRunId(run.id)}>
                        상세
                      </button>{' '}
                      {canOperate && (run.status === 'running' || run.status === 'pending') && (
                        <button
                          className="btn sm danger"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(run.id)}
                          title="실행 취소"
                        >
                          <Icon.stop />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  )
}

/* --------------------------------------------------------------- CDC 스트림 탭 */

const STREAM_FILTERS = [
  { key: undefined, label: '전체' },
  { key: 'running', label: '● 흐르는 중' },
  { key: 'paused', label: '❚❚ 일시정지' },
  { key: 'failed', label: '✕ 실패' },
  { key: 'stopped', label: '■ 중지됨' },
] as const

/** 스트림 상태별로 가능한 제어 (백엔드 전이 가드와 짝) */
const STREAM_ACTIVE = new Set(['provisioning', 'running', 'paused'])
/** 중지·실패한 스트림만 이력 삭제 가능 (활성은 서버가 409) */
const STREAM_REMOVABLE = new Set(['stopped', 'failed'])
/** cdc-sink 자동 재구독 주기 — 백엔드 ROUTER_REFRESH_SECONDS 와 반드시 같아야 한다 */
const SINK_REFRESH_SECONDS = 10

function StreamsPanel({ canOperate }: { canOperate: boolean }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<string | undefined>(undefined)
  const { data: streams, isLoading, error } = useStreams(status)
  const act = useStreamAction()
  const del = useDeleteStream()

  const rows = streams ?? []

  // 카운트다운용 1초 틱
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // 스트림이 '구독 대기중'으로 처음 보인 시각 — 클라이언트 기준 카운트다운의 기준점.
  // sink 는 자동 재구독을 하지만 그 시점을 UI 가 정확히 알 수 없어, 알려진 주기(10초)로 추정한다.
  const waitingSince = useRef<Record<string, number>>({})
  useEffect(() => {
    const seen = waitingSince.current
    const current = streams ?? []
    const live = new Set(current.map((s) => s.id))
    for (const s of current) {
      const waiting = s.status === 'running' && !s.subscribed
      if (waiting && seen[s.id] === undefined) seen[s.id] = Date.now()
      if (!waiting) delete seen[s.id]
    }
    for (const id of Object.keys(seen)) if (!live.has(id)) delete seen[id]
  }, [streams])

  return (
    <>
      <div className="filter-row">
        {STREAM_FILTERS.map((f) => (
          <span
            key={f.label}
            className={`pill ${status === f.key ? 'on' : ''}`}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </span>
        ))}
      </div>

      {error && <Banner kind="error">스트림 목록을 불러오지 못했습니다: {String(error)}</Banner>}
      {act.error && (
        <Banner kind="error">
          스트림 제어 실패: {act.error instanceof Error ? act.error.message : '오류'}
        </Banner>
      )}
      {del.error && (
        <Banner kind="error">
          이력 삭제 실패: {del.error instanceof Error ? del.error.message : '오류'}
        </Banner>
      )}

      {isLoading && !streams && <EmptyState title="불러오는 중…" />}

      {streams && rows.length === 0 && (
        <EmptyState title="해당 조건의 스트림이 없습니다">
          캔버스에서 CDC 소스 파이프라인을 만들고 [스트림 시작]을, 실시간 동기화
          파이프라인이면 [동기화 시작]을 눌러 보세요.
        </EmptyState>
      )}

      {rows.length > 0 && (
        <div className="stream-grid">
          {rows.map((s) => {
            const active = STREAM_ACTIVE.has(s.status)
            const removable = STREAM_REMOVABLE.has(s.status)
            const sync = s.engine === 'symmetricds'
            const waiting = s.status === 'running' && !s.subscribed
            const elapsed = Math.floor((nowMs - (waitingSince.current[s.id] ?? nowMs)) / 1000)
            const remain = Math.max(0, SINK_REFRESH_SECONDS - elapsed)
            return (
              <div className="stream-card" key={s.id}>
                <div className="stream-top">
                  <button
                    className="stream-name"
                    onClick={() => navigate(`/canvas/${s.pipeline_id}`)}
                    title="파이프라인 열기"
                  >
                    {s.pipeline_name}
                  </button>
                  {sync && <span className="tag">동기화</span>}
                  {waiting && !sync ? (
                    <span className="tag provisioning">구독 대기중</span>
                  ) : (
                    <Tag status={s.status} />
                  )}
                </div>

                {waiting && !sync && (
                  <div className="stream-waiting">
                    <Spinner /> Sink 자동 구독 대기 —{' '}
                    {remain > 0 ? `약 ${remain}초 후 시작` : '곧 시작됩니다…'}
                  </div>
                )}

                {sync ? (
                  <SyncMetrics streamId={s.id} active={active} />
                ) : (
                  <div className="stream-metrics">
                    <div className="sm-item">
                      <span className="sm-num">{formatNumber(s.events_total)}</span>
                      <span className="sm-lab">누적 이벤트</span>
                    </div>
                    <div className="sm-item">
                      <span className="sm-num">{s.eps.toFixed(1)}</span>
                      <span className="sm-lab">eps</span>
                    </div>
                    <div className="sm-item">
                      <span className="sm-num">{s.lag_ms == null ? '—' : `${s.lag_ms}ms`}</span>
                      <span className="sm-lab">랙(lag)</span>
                    </div>
                  </div>
                )}

                <div className="stream-foot">
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                    최근 {formatTime(s.last_event_at)} · 시작 {formatTime(s.started_at)}
                  </span>
                  {canOperate && (active || removable) && (
                    <div className="actions">
                      {s.status === 'running' && (
                        <button
                          className="btn sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: s.id, action: 'pause' })}
                          title="일시정지"
                        >
                          <Icon.pause />
                        </button>
                      )}
                      {s.status === 'paused' && (
                        <button
                          className="btn sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: s.id, action: 'resume' })}
                          title="재개"
                        >
                          <Icon.play />
                        </button>
                      )}
                      {active && (
                        <button
                          className="btn sm danger"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: s.id, action: 'stop' })}
                          title={sync ? '중지 (원본 트리거 제거)' : '중지 (커넥터 삭제)'}
                        >
                          {act.isPending && act.variables?.id === s.id ? <Spinner /> : <Icon.stop />}
                        </button>
                      )}
                      {removable && (
                        <button
                          className="btn sm danger"
                          disabled={del.isPending}
                          onClick={() => del.mutate(s.id)}
                          title="이력 삭제"
                        >
                          {del.isPending && del.variables === s.id ? <Spinner /> : <Icon.trash />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {s.status === 'failed' && (
                  <div className="stream-error">
                    {sync
                      ? '동기화가 실패 상태입니다. 원본에 트리거가 남아 있을 수 있으니 SYM_TRIGGER 를 확인하세요.'
                      : '스트림이 실패 상태입니다. 파이프라인·소스 상태를 확인하세요.'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}


/** SymmetricDS 스트림의 지표.
 *
 * 목록 응답(events_total·eps)은 Kafka Sink 가 채우는 값이라 동기화 경로에서는 늘 0 이다.
 * 여기서 상세를 따로 읽는 이유가 그것이다 — 상세 조회가 곧 **원본 DB 의 SYM_* 를 읽어
 * 지표를 갱신하는** 동작이다. 계기판이 진실의 원천을 직접 보게 두는 편이,
 * 목록에 채워 넣고 채우는 쪽을 잊는 것보다 낫다 (CDC 때 실제로 겪은 실수다).
 *
 * 목록보다 느리게(10초) 도는 것은 폴링 한 번이 원본에 쿼리 넷을 날리기 때문이다.
 */
function SyncMetrics({ streamId, active }: { streamId: string; active: boolean }) {
  const { data } = useStream(active ? streamId : undefined, 10_000)
  const metrics = (data?.metrics ?? {}) as {
    pending_rows?: number
    error_batches?: number
    registered_nodes?: number
    lag_ms?: number
  }
  const pending = metrics.pending_rows ?? 0
  const errors = metrics.error_batches ?? 0
  const nodes = metrics.registered_nodes ?? 0

  return (
    <>
      <div className="stream-metrics">
        <div className="sm-item">
          <span className="sm-num">{formatNumber(pending)}</span>
          <span className="sm-lab">미전송</span>
        </div>
        <div className="sm-item">
          <span className="sm-num">{formatNumber(errors)}</span>
          <span className="sm-lab">오류 배치</span>
        </div>
        <div className="sm-item">
          <span className="sm-num">{metrics.lag_ms == null ? '—' : `${metrics.lag_ms}ms`}</span>
          <span className="sm-lab">랙(lag)</span>
        </div>
      </div>
      {active && nodes === 0 && (
        <div className="stream-waiting">
          <Spinner /> 타깃 노드 등록 대기 — 등록 전에는 데이터가 가지 않습니다.
        </div>
      )}
      {pending > 0 && (
        <div className="stream-waiting">
          미전송 {formatNumber(pending)}건이 원본 SYM_DATA 에 쌓여 있습니다. 계속 늘어나면
          원본 DB 용량과 트랜잭션 로그를 확인하세요.
        </div>
      )}
      {errors > 0 && (
        <div className="stream-error">
          전송 실패 배치 {formatNumber(errors)}건 — SYM_OUTGOING_BATCH 를 확인하세요.
        </div>
      )}
    </>
  )
}
