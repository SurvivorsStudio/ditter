import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/icons'
import { AiFixPanel } from '../components/AiFixPanel'
import { useT, type MsgKey } from '../i18n'

export type ExplainTarget = { plan: string; analyzed: boolean; sql: string }

/** 계획 텍스트에서 요약값을 뽑는다 (PostgreSQL EXPLAIN [ANALYZE] 기준). */
// 라벨은 MsgKey 로만 들고 렌더 시점에 t() 로 푼다 — 이 함수는 useMemo([target]) 안에서
// 불리므로 여기서 번역문을 굳히면 언어를 바꿔도 옛 말이 남는다.
function summarize(plan: string, analyzed: boolean): { label: MsgKey; value: string }[] {
  const out: { label: MsgKey; value: string }[] = []
  const plan_time = /Planning Time:\s*([\d.]+)\s*ms/.exec(plan)
  const exec_time = /Execution Time:\s*([\d.]+)\s*ms/.exec(plan)
  const cost = /cost=[\d.]+\.\.([\d.]+)/.exec(plan)
  const rows = /rows=(\d+)/.exec(plan)
  if (analyzed) {
    if (plan_time) out.push({ label: 'cui.explain.planTime', value: `${plan_time[1]} ms` })
    if (exec_time) out.push({ label: 'cui.explain.execTime', value: `${exec_time[1]} ms` })
  }
  if (cost) out.push({ label: 'cui.explain.cost', value: cost[1] })
  if (rows) out.push({ label: 'cui.explain.rows', value: Number(rows[1]).toLocaleString() })
  return out
}

/** 쿼리 실행 계획 모달 — 텍스트 계획 + 요약 + (선택) 계획 기반 AI 튜닝. */
export function ExplainModal({
  target,
  onClose,
  dbConnId,
  onApply,
  onAiEscalate,
}: {
  target: ExplainTarget
  onClose: () => void
  /** 스키마 문맥용 대상 DB — 있으면 「AI 튜닝」을 띄운다. */
  dbConnId?: string
  /** 튜닝된 쿼리를 편집기에 적용. */
  onApply?: (sql: string) => void
  onAiEscalate?: (payload: {
    sql: string
    error?: string
    explain?: string
    assistant: string
    dbConnId?: string
  }) => void
}) {
  const tr = useT()
  const [copied, setCopied] = useState(false)
  const [tuning, setTuning] = useState(false)
  const summary = useMemo(() => summarize(target.plan, target.analyzed), [target])

  const copyPlan = async () => {
    try {
      await navigator.clipboard.writeText(target.plan)
    } catch {
      /* 무시 */
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return createPortal(
    <div className="obj-modal-backdrop" onClick={onClose}>
      <div className="obj-modal explain-modal" onClick={(e) => e.stopPropagation()}>
        <div className="obj-modal-hd">
          <span className="obj-modal-kind">{target.analyzed ? 'EXPLAIN ANALYZE' : 'EXPLAIN'}</span>
          <span className="obj-modal-name" title={target.sql}>
            {target.sql.replace(/\s+/g, ' ').trim()}
          </span>
          <button className="obj-modal-x" onClick={onClose} aria-label={tr('common.close')}>
            ×
          </button>
        </div>
        <div className="obj-modal-body">
          {summary.length > 0 && (
            <div className="explain-summary">
              {summary.map((s) => (
                <div key={s.label} className="explain-stat">
                  <span className="explain-stat-label">{tr(s.label)}</span>
                  <span className="explain-stat-value">{s.value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="obj-sec-hd">
            <h4>{tr('cui.explain.plan')}</h4>
            <div className="obj-sec-actions">
              {onApply && (
                <button
                  className={`btn sm ${tuning ? '' : 'primary'}`}
                  onClick={() => setTuning((v) => !v)}
                  title={tr('cui.explain.tuneTitle')}
                >
                  <Icon.bolt /> {tuning ? tr('cui.explain.tuneClose') : tr('cui.explain.tune')}
                </button>
              )}
              <button className="btn sm" onClick={copyPlan}>
                <Icon.copy />
                {copied ? tr('cui.copied') : tr('cui.copy')}
              </button>
            </div>
          </div>
          {tuning && onApply && (
            <AiFixPanel
              mode="tune"
              sql={target.sql}
              explain={target.plan}
              explainAnalyzed={target.analyzed}
              dbConnId={dbConnId}
              onApply={(sql) => {
                onApply(sql)
                onClose()
              }}
              onEscalate={(p) => {
                onAiEscalate?.({ ...p, dbConnId })
                onClose()
              }}
              onClose={() => setTuning(false)}
            />
          )}
          <pre className="explain-plan">{target.plan}</pre>
          {!target.analyzed && (
            <div className="explain-note">
              {tr('cui.explain.note1')}
              <b>{tr('cui.explain.noteAnalyze')}</b>
              {tr('cui.explain.note2')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
