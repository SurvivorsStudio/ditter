import type { ReactNode } from 'react'
import { localeTag, t, useLocale, type MsgKey } from '../i18n'

/** 번역 문자열을 모듈 상수에 담지 않는다 — 언어 전환을 따라오지 못한다.
 *  키 맵을 두고 조회 시점에 t() 를 부른다 (src/i18n/index.ts 머리말). */
const STATUS_KEY: Record<string, MsgKey> = {
  pending: 'status.pending',
  running: 'status.running',
  success: 'status.success',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
  active: 'status.active',
  inactive: 'status.inactive',
  draft: 'status.draft',
  ok: 'status.ok',
  warn: 'status.warn',
  error: 'status.error',
  unknown: 'status.unknown',
  // CDC 스트림 상태 (Phase 4)
  provisioning: 'status.provisioning',
  paused: 'status.paused',
  stopped: 'status.stopped',
}

const TRIGGER_KEY: Record<string, MsgKey> = {
  manual: 'trigger.manual',
  schedule: 'trigger.schedule',
  cdc: 'trigger.cdc',
}

/** 모르는 상태값은 원문 그대로 — 서버가 상태를 늘렸을 때 빈칸보다 낫다. */
export function statusLabel(status: string): string {
  const key = STATUS_KEY[status]
  return key ? t(key) : status
}

export function triggerLabel(trigger: string): string {
  const key = TRIGGER_KEY[trigger]
  return key ? t(key) : trigger
}

export function Tag({ status }: { status: string }) {
  useLocale() // 언어 전환을 구독한다 — 부모가 다시 그리지 않아도 라벨이 따라온다
  return <span className={`tag ${status}`}>{statusLabel(status)}</span>
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

export function EmptyState({
  title,
  children,
  image,
}: {
  title: string
  children?: ReactNode
  image?: string
}) {
  return (
    <div className="empty-state">
      {image && <img className="empty-logo" src={image} alt="" />}
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function Spinner() {
  return <span className="spin" />
}

export function formatNumber(value: number): string {
  return value.toLocaleString(localeTag())
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
  return d.toLocaleTimeString(localeTag(), { hour12: false })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(localeTag(), { hour12: false })
}

/** 좁은 줄용 — 오늘 것은 시:분:초, 그 전은 월/일 시:분. (RunHistory 등) */
export function formatShortStamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString(localeTag(), { hour12: false })
    : d.toLocaleString(localeTag(), {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
}
