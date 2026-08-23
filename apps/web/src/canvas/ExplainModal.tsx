import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/icons'

export type ExplainTarget = { plan: string; analyzed: boolean; sql: string }

/** 계획 텍스트에서 요약값을 뽑는다 (PostgreSQL EXPLAIN [ANALYZE] 기준). */
function summarize(plan: string, analyzed: boolean): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const plan_time = /Planning Time:\s*([\d.]+)\s*ms/.exec(plan)
  const exec_time = /Execution Time:\s*([\d.]+)\s*ms/.exec(plan)
  const cost = /cost=[\d.]+\.\.([\d.]+)/.exec(plan)
  const rows = /rows=(\d+)/.exec(plan)
  if (analyzed) {
    if (plan_time) out.push({ label: '계획 시간', value: `${plan_time[1]} ms` })
    if (exec_time) out.push({ label: '실행 시간', value: `${exec_time[1]} ms` })
  }
  if (cost) out.push({ label: '예상 비용', value: cost[1] })
  if (rows) out.push({ label: '예상 행수', value: Number(rows[1]).toLocaleString() })
  return out
}

/** 쿼리 실행 계획 모달 — 텍스트 계획 + 요약. */
export function ExplainModal({ target, onClose }: { target: ExplainTarget; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
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
          <button className="obj-modal-x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="obj-modal-body">
          {summary.length > 0 && (
            <div className="explain-summary">
              {summary.map((s) => (
                <div key={s.label} className="explain-stat">
                  <span className="explain-stat-label">{s.label}</span>
                  <span className="explain-stat-value">{s.value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="obj-sec-hd">
            <h4>실행 계획</h4>
            <button className="btn sm" onClick={copyPlan}>
              <Icon.copy />
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
          <pre className="explain-plan">{target.plan}</pre>
          {!target.analyzed && (
            <div className="explain-note">
              추정 계획입니다. 실제 실행 시간·행수를 보려면 <b>성능 분석(EXPLAIN ANALYZE)</b> 을 쓰세요.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
