import type { ReactNode } from 'react'

export const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  running: '실행중',
  success: '성공',
  failed: '실패',
  cancelled: '취소',
  active: '활성',
  inactive: '비활성',
  draft: '초안',
  ok: '정상',
  warn: '지연',
  error: '오류',
  unknown: '미확인',
  // CDC 스트림 상태 (Phase 4)
  provisioning: '준비중',
  paused: '일시정지',
  stopped: '중지됨',
}

export const TRIGGER_LABEL: Record<string, string> = {
  manual: '수동',
  schedule: '스케줄',
  cdc: 'CDC',
}

export function Tag({ status }: { status: string }) {
  return <span className={`tag ${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

export function Stat({
  label,
  value,
  sub,
  color,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  color: string
  tone?: 'up' | 'down'
}) {
  return (
    <div className="stat">
      <div className="lab">
        <span className="dot" style={{ background: color }} />
        {label}
      </div>
      <div className="num">{value}</div>
      {sub !== undefined && <div className={`sub ${tone ?? ''}`}>{sub}</div>}
    </div>
  )
}

export function Banner({ kind, children }: { kind: 'error' | 'warn' | 'ok'; children: ReactNode }) {
  return <div className={`banner ${kind}`}>{children}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function Spinner() {
  return <span className="spin" />
}

export function formatNumber(value: number): string {
  return value.toLocaleString('ko-KR')
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return '—'
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('ko-KR', { hour12: false })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ko-KR', { hour12: false })
}
