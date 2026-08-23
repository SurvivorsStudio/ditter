import { useRuns } from '../api/hooks'
import { Tag, formatDateTime, formatDuration, formatNumber } from './common'
import type { PipelineSummary, RunListItem } from '../api/types'

/** 트리가 한 번에 보여줄 실행 이력 건수. 더 필요하면 [모니터]가 제 자리다 —
 *  여기서 무한 스크롤까지 하면 왼쪽 패널이 이력 화면이 되어 버린다. */
const HISTORY_LIMIT = 20

/** 파이프라인 한 건의 최근 실행 이력.
 *
 *  **펼쳤을 때만 마운트되므로 접혀 있으면 조회하지 않는다** — 트리에 파이프라인이 많은데
 *  전부 이력을 끌어오면 패널을 여는 것만으로 느려진다. */
export function RunHistory({
  pipeline,
  onOpenRun,
}: {
  pipeline: PipelineSummary
  onOpenRun: (p: PipelineSummary, runId: string) => void
}) {
  const { data, isLoading } = useRuns({ pipelineId: pipeline.id, limit: HISTORY_LIMIT })
  const items = data?.items ?? []

  if (isLoading && items.length === 0) return <div className="pl-hist-empty">불러오는 중…</div>
  if (items.length === 0) return <div className="pl-hist-empty">아직 실행한 적이 없습니다.</div>

  return (
    <div className="pl-hist">
      {items.map((r) => (
        <button key={r.id} className="pl-hist-row" onClick={() => onOpenRun(pipeline, r.id)}>
          <Tag status={r.status} />
          <span className="pl-hist-time" title={formatDateTime(r.started_at)}>
            {shortStamp(r.started_at)}
          </span>
          <span className="pl-hist-meta">{formatNumber(r.records)}건</span>
          <span className="pl-hist-meta">{formatDuration(r.duration_seconds)}</span>
          {isRunning(r) && <span className="pl-hist-pct">{r.progress}%</span>}
        </button>
      ))}
      {data && data.total > items.length && (
        <div className="pl-hist-empty">
          최근 {items.length}건 / 전체 {formatNumber(data.total)}건 — 더 보려면 [모니터]
        </div>
      )}
    </div>
  )
}

const isRunning = (r: RunListItem) => r.status === 'running' || r.status === 'pending'

/** 이력 줄은 좁다 — 오늘 것은 시:분:초, 그 전은 월/일 시:분. */
function shortStamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString('ko-KR', { hour12: false })
    : d.toLocaleString('ko-KR', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
}
