/** 쿼리 옆에 뜨는 AI 액션 패널 — 오류 수정(fix)·성능 튜닝(tune) 공용, 편집기·노트북 겸용.
 *
 *  fix: 실패한 쿼리와 오류 메시지를 sql.fix 로 보내 "진단 + 고친 SQL".
 *  tune: 쿼리와 실제 EXPLAIN 계획을 sql.tune 으로 보내 "병목 진단 + 튜닝된 SQL(+인덱스 제안)".
 *  결과 SQL 은 바로 실행하지 않고 **편집기에 적용**(되돌리기 가능)하거나, 부족하면
 *  **AI 탭에서 이어가기**로 대화로 승격한다. 응답은 공용 Markdown 렌더러로 그린다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { Markdown } from './Markdown'
import { MiniSelect } from '../canvas/AiChatPane'
import { useAiChat, useConnections, useExplain } from '../api/hooks'
import { specFor } from '../api/connectorFields'
import type { SelectOption } from './SearchSelect'

/** EXPLAIN [ANALYZE] 텍스트에서 총 실행 시간(ms)과 예상 비용을 뽑는다 (MySQL·PostgreSQL). */
function parsePerf(plan: string): { timeMs: number | null; cost: number | null } {
  const exec = /Execution Time:\s*([\d.]+)\s*ms/i.exec(plan) // PostgreSQL ANALYZE
  const rootActual = /actual time=[\d.]+\.\.([\d.]+)/.exec(plan) // MySQL ANALYZE 루트 노드
  const costM = /cost=[\d.]+\.\.([\d.]+)/.exec(plan) || /cost=([\d.]+)/.exec(plan)
  return {
    timeMs: exec ? Number(exec[1]) : rootActual ? Number(rootActual[1]) : null,
    cost: costM ? Number(costM[1]) : null,
  }
}

const fmtMs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(0)} ms`)

const MODE_CFG = {
  fix: {
    intent: 'sql.fix' as const,
    title: 'AI 수정',
    loading: '오류를 분석하는 중…',
    userMsg: '이 쿼리의 오류를 고쳐줘.',
    apply: '편집기에 적용',
  },
  tune: {
    intent: 'sql.tune' as const,
    title: 'AI 튜닝',
    loading: '실행 계획을 분석하는 중…',
    userMsg: '실행 계획을 근거로 이 쿼리를 튜닝해줘.',
    apply: '튜닝된 쿼리 적용',
  },
}

export function AiFixPanel({
  mode = 'fix',
  sql,
  error,
  explain,
  explainAnalyzed,
  dbConnId,
  onApply,
  onEscalate,
  onClose,
}: {
  /** 'fix' = 오류 수정(기본), 'tune' = 계획 기반 성능 튜닝. */
  mode?: 'fix' | 'tune'
  sql: string
  /** fix 모드의 오류 메시지. */
  error?: string
  /** tune 모드의 실제 실행 계획(EXPLAIN) 텍스트. */
  explain?: string
  /** AS-IS 계획이 EXPLAIN ANALYZE(실제 시간 포함)로 뽑혔는지 — 성능 비교의 전제. */
  explainAnalyzed?: boolean
  /** 스키마 문맥용 대상 DB (SQL 모드에서만). */
  dbConnId?: string
  onApply: (sql: string) => void
  onEscalate: (payload: { sql: string; error?: string; explain?: string; assistant: string }) => void
  onClose: () => void
}) {
  const cfg = MODE_CFG[mode]
  const { data: conns = [] } = useConnections()
  const aiConns = useMemo(() => conns.filter((c) => specFor(c.type).category === 'ai'), [conns])
  const [aiConnId, setAiConnId] = useState('')
  useEffect(() => {
    if (!aiConnId && aiConns.length > 0) setAiConnId(aiConns[0].id)
  }, [aiConns, aiConnId])
  const aiOptions: SelectOption[] = aiConns.map((c) => ({
    value: c.id,
    label: c.name,
    hint: specFor(c.type).label,
  }))

  const chat = useAiChat()
  const [result, setResult] = useState<{ text: string; sql: string | null } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // 성능 비교(AS-IS/TO-BE) — 튜닝 결과 쿼리를 EXPLAIN ANALYZE 로 재보고 원본 계획과 견준다.
  const explainMut = useExplain()
  const [perf, setPerf] = useState<{
    asis: ReturnType<typeof parsePerf>
    tobe: ReturnType<typeof parsePerf>
  } | null>(null)
  const [perfErr, setPerfErr] = useState<string | null>(null)
  const compare = (tunedSql: string) => {
    if (!dbConnId) return
    setPerf(null)
    setPerfErr(null)
    explainMut.mutate(
      { id: dbConnId, query: tunedSql, analyze: true },
      {
        onSuccess: (r) =>
          setPerf({ asis: parsePerf(explain ?? ''), tobe: parsePerf(r.plan) }),
        onError: (e) =>
          setPerfErr(e instanceof Error ? e.message : '튜닝 쿼리 성능 분석에 실패했습니다.'),
      },
    )
  }

  const run = (connId: string) => {
    if (!connId) return
    setResult(null)
    setFailed(null)
    setPerf(null)
    setPerfErr(null)
    chat.mutate(
      {
        ai_connection_id: connId,
        messages: [{ role: 'user', content: cfg.userMsg }],
        intent: cfg.intent,
        db_connection_id: dbConnId ?? null,
        sql,
        error: error ?? null,
        explain: explain ?? null,
      },
      {
        onSuccess: (out) => setResult({ text: out.message.content, sql: out.sql }),
        onError: (e) => setFailed(e instanceof Error ? e.message : 'AI 호출에 실패했습니다.'),
      },
    )
  }

  // 모델이 정해지면 한 번 자동 실행한다(오류·계획 자리에서 바로 결과를 보여주려는 것).
  const started = useRef(false)
  useEffect(() => {
    if (aiConnId && !started.current) {
      started.current = true
      run(aiConnId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConnId])

  if (aiConns.length === 0) {
    return (
      <div className="ai-fix">
        <div className="ai-fix-head">
          <Icon.bolt />
          <span>{cfg.title}</span>
          <button className="ai-fix-x" onClick={onClose} title="닫기">×</button>
        </div>
        <div className="ai-fix-body ai-fix-empty">
          「연결 관리」에서 AI 모델(Gemini·Bedrock)을 먼저 등록하세요.
        </div>
      </div>
    )
  }

  return (
    <div className="ai-fix">
      <div className="ai-fix-head">
        <Icon.bolt />
        <span>{cfg.title}</span>
        <div className="ai-fix-head-right">
          <MiniSelect
            value={aiConnId}
            options={aiOptions}
            onChange={(v) => {
              setAiConnId(v)
              run(v)
            }}
            placeholder="AI 모델"
            align="right"
            up={false}
          />
          <button className="ai-fix-x" onClick={onClose} title="닫기">×</button>
        </div>
      </div>

      <div className="ai-fix-body">
        {chat.isPending ? (
          <div className="ai-fix-loading">
            <span className="ai-progress-spin" />
            {cfg.loading}
          </div>
        ) : failed ? (
          <div className="ai-fix-error">{failed}</div>
        ) : result ? (
          <>
            <Markdown text={result.text} />
            <div className="ai-fix-actions">
              {result.sql && (
                <button className="btn sm primary" onClick={() => onApply(result.sql!)} title="결과 쿼리를 편집기에 넣습니다(되돌리기 가능)">
                  <Icon.check /> {cfg.apply}
                </button>
              )}
              <button
                className="btn sm"
                onClick={() => onEscalate({ sql, error, explain, assistant: result.text })}
                title="AI 어시스턴트 탭에서 대화로 이어갑니다"
              >
                <Icon.bolt /> AI 탭에서 이어가기
              </button>
              {mode === 'tune' && dbConnId && result.sql && (
                <button
                  className="btn sm"
                  onClick={() => compare(result.sql!)}
                  disabled={explainMut.isPending}
                  title="튜닝된 쿼리를 EXPLAIN ANALYZE 로 재보고 원본과 비교합니다"
                >
                  <Icon.chart /> {explainMut.isPending ? '분석 중…' : '성능 비교'}
                </button>
              )}
              <button className="btn sm" onClick={() => run(aiConnId)} title="다시 분석">
                <Icon.refresh /> 다시
              </button>
            </div>
            {perfErr && <div className="ai-fix-error" style={{ marginTop: 8 }}>{perfErr}</div>}
            {perf && <PerfCompare asis={perf.asis} tobe={perf.tobe} analyzed={explainAnalyzed} />}
          </>
        ) : null}
      </div>
    </div>
  )
}

/** AS-IS(원본) / TO-BE(튜닝) 성능 비교 카드. */
function PerfCompare({
  asis,
  tobe,
  analyzed,
}: {
  asis: { timeMs: number | null; cost: number | null }
  tobe: { timeMs: number | null; cost: number | null }
  analyzed?: boolean
}) {
  // 개선률을 부호로 갈라 셀 내용·색을 정한다.
  // 양수(빨라짐/비용↓) → 초록 '↓ N%', 음수(느려짐/비용↑) → 앰버 '↑ N% 느려짐', 0/판정불가 → '—'.
  const delta = (
    a: number | null,
    b: number | null,
    worseLabel: string,
  ): { text: string; cls: string } => {
    if (a == null || b == null || a <= 0) return { text: '—', cls: '' }
    const pct = Math.round(((a - b) / a) * 100)
    if (pct > 0) return { text: `↓ ${pct}%`, cls: 'ai-perf-good' }
    if (pct < 0) return { text: `↑ ${-pct}% ${worseLabel}`, cls: 'ai-perf-bad' }
    return { text: '변화 없음', cls: '' }
  }
  const timeImp = delta(asis.timeMs, tobe.timeMs, '느려짐')
  const costImp = delta(asis.cost, tobe.cost, '늘어남')
  return (
    <div className="ai-perf">
      <div className="ai-perf-title">성능 비교</div>
      <table className="ai-perf-table">
        <thead>
          <tr>
            <th />
            <th>AS-IS (원본)</th>
            <th>TO-BE (튜닝)</th>
            <th>개선</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="ai-perf-metric">실행 시간</td>
            <td>{asis.timeMs != null ? fmtMs(asis.timeMs) : '—'}</td>
            <td>{tobe.timeMs != null ? fmtMs(tobe.timeMs) : '—'}</td>
            <td className={timeImp.cls}>{timeImp.text}</td>
          </tr>
          <tr>
            <td className="ai-perf-metric">예상 비용</td>
            <td>{asis.cost != null ? asis.cost.toLocaleString() : '—'}</td>
            <td>{tobe.cost != null ? tobe.cost.toLocaleString() : '—'}</td>
            <td className={costImp.cls}>{costImp.text}</td>
          </tr>
        </tbody>
      </table>
      {asis.timeMs == null && (
        <div className="ai-perf-note">
          원본을 <b>성능 분석(EXPLAIN ANALYZE)</b> 으로 실행하면 실제 실행 시간까지 비교됩니다
          {analyzed === false ? ' (지금은 추정 계획이라 비용만 비교).' : '.'}
        </div>
      )}
    </div>
  )
}
