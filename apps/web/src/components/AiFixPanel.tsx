/** 쿼리 옆에 뜨는 AI 액션 패널 — 오류 수정(fix)·성능 튜닝(tune) 공용, 편집기·노트북 겸용.
 *
 *  fix: 실패한 쿼리와 오류 메시지를 sql.fix 로 보내 "진단 + 고친 SQL".
 *  tune: 쿼리와 실제 EXPLAIN 계획을 sql.tune 으로 보내 "병목 진단 + 튜닝된 SQL(+인덱스 제안)".
 *  결과 SQL 은 바로 실행하지 않고 **편집기에 적용**(되돌리기 가능)하거나, 부족하면
 *  **AI 탭에서 이어가기**로 대화로 승격한다. 응답은 공용 Markdown 렌더러로 그린다.
 *
 *  머리의 **모델사 칩**은 「연결 관리」에 등록된 AI 연결이다. 누르면 그 모델사로 다시 돌고,
 *  눌려 있는 칩이 지금 화면의 답을 낸 모델사다 — 드롭다운과 달리 "무엇으로 돌았나"가
 *  펼치지 않아도 보이고, 다른 모델사로 바꿔 보는 것이 한 번의 클릭이다.
 *
 *  처음 눌리는 칩은 툴바의 **AI 기본 연결**(`api/aiDefault`)이다. 칩을 눌러 바꾼 것은
 *  이 패널에서만 쓰고 기본값을 건드리지 않는다 — 비교하려고 한 번 누른 것이 기본이 되면
 *  다음에 여는 패널이 조용히 다른 모델사로 답한다.
 *
 *  **AI 를 자동으로 부르는 것은 패널을 열 때 한 번뿐이다.** 그 뒤로는 칩·[다시]·안내의
 *  [다시 분석] 처럼 사람이 누른 것만 호출로 이어진다. 이 패널은 한 화면에 여러 개가 살아서
 *  (노트북은 셀마다 하나) 기본 연결 변경까지 자동 실행에 태우면 드롭다운 한 번이 유료 호출
 *  여러 건으로 퍼진다 — 몇 건이 나갔는지 화면 어디에도 보이지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { Markdown } from './Markdown'
import { useAiChat, useConnections, useExplain } from '../api/hooks'
import { useAiConn } from '../api/aiDefault'
import { specFor } from '../api/connectorFields'
import { useT } from '../i18n'

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

// 라벨은 MsgKey 로만 들고 렌더 시점에 t() 로 푼다 — 모듈 상수에 번역문을 담으면 언어 전환을 못 따라온다.
// userMsg 는 화면이 아니라 **AI 에게 보내는 프롬프트 시드**라 번역하지 않는다.
const MODE_CFG = {
  fix: {
    intent: 'sql.fix' as const,
    title: 'ai.fixTitle' as const,
    loading: 'ai.fixLoading' as const,
    userMsg: '이 쿼리의 오류를 고쳐줘.',
    apply: 'ai.fixApply' as const,
  },
  tune: {
    intent: 'sql.tune' as const,
    title: 'ai.tuneTitle' as const,
    loading: 'ai.tuneLoading' as const,
    userMsg: '실행 계획을 근거로 이 쿼리를 튜닝해줘.',
    apply: 'ai.tuneApply' as const,
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
  const t = useT()
  const { data: conns = [] } = useConnections()
  const aiConns = useMemo(() => conns.filter((c) => specFor(c.type).category === 'ai'), [conns])
  // 시작 모델사는 툴바의 AI 기본 연결. 칩으로 바꾸면 이 패널에서만 그 선택을 쓴다.
  const defaultAiConn = useAiConn(aiConns)
  /** 지금 화면의 답을 낸(또는 내고 있는) 모델사. 칩의 눌림도 이 값이 정한다 —
   *  "고르라고 정해진 것"이 아니라 **실제로 돈 것**을 보여야 칩이 답과 어긋나지 않는다. */
  const [active, setActive] = useState('')
  const activeRef = useRef('')
  /** 열려 있는 동안 기본 연결이 바뀌었을 때, **아직 부르지 않은** 그 모델사 id ('' = 안내 없음). */
  const [pendingDefault, setPendingDefault] = useState('')

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
          setPerfErr(e instanceof Error ? e.message : t('ai.perfAnalyzeFailed')),
      },
    )
  }

  // 모델사를 바꾸면 앞의 호출이 아직 돌고 있을 수 있다. 늦게 온 옛 응답을 그대로 그리면
  // **칩은 B 인데 화면은 A 의 답**이 된다 — 순번을 매겨 마지막 요청의 결과만 받는다.
  const seq = useRef(0)

  const run = (connId: string) => {
    if (!connId) return
    const mine = ++seq.current
    // "돈 모델사"는 요청을 **보내는 자리**에서 확정한다. 칩·안내가 모두 이 값을 본다.
    activeRef.current = connId
    setActive(connId)
    setPendingDefault('')
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
        onSuccess: (out) => {
          if (mine === seq.current) setResult({ text: out.message.content, sql: out.sql })
        },
        onError: (e) => {
          if (mine === seq.current)
            setFailed(e instanceof Error ? e.message : t('ai.callFailed'))
        },
      },
    )
  }

  /** 모델사 칩 클릭 — 이미 그 모델사로 돌았으면 아무 일도 하지 않는다.
   *  다시 부르는 것은 아래 [다시] 가 할 일이다(누를 때마다 비용이 나간다). */
  const pick = (connId: string) => {
    if (connId !== activeRef.current) run(connId)
  }

  // 자동 실행은 **패널을 열 때 한 번뿐**이다.
  //
  // 예전에는 툴바의 AI 기본 연결이 바뀌는 것까지 같은 경로로 태워 자동으로 다시 불렀다.
  // 그런데 이 패널은 한 화면에 여러 개가 산다 — 노트북은 셀마다 「AI로 고치기」가 따로 열린다.
  // 그러면 드롭다운을 **한 번** 바꾼 것이 유료 호출 N 건으로 퍼지고, 몇 건이 나갔는지
  // 화면 어디에도 보이지 않는다. 열려 있던 답까지 함께 지워진다.
  //
  // 그래서 기본 연결이 바뀌면 **부르지 않고 알리기만** 한다(아래 `pendingDefault` 안내).
  // 칩은 계속 "실제로 돈 모델사"를 가리키므로 화면과 어긋나지도 않는다.
  const seenDefault = useRef('')
  useEffect(() => {
    if (!defaultAiConn) return // 연결 목록을 아직 못 받았다
    const first = !seenDefault.current
    seenDefault.current = defaultAiConn
    if (first) {
      // 마운트 1회 — 오류·계획 자리에서 바로 결과를 보여주려는 것.
      // ref 로 가드하므로 StrictMode 의 이중 실행에도 요금이 두 번 나가지 않는다.
      if (!activeRef.current) run(defaultAiConn)
      return
    }
    setPendingDefault(defaultAiConn === activeRef.current ? '' : defaultAiConn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAiConn])

  if (aiConns.length === 0) {
    return (
      <div className="ai-fix">
        <div className="ai-fix-head">
          <Icon.bolt />
          <span>{t(cfg.title)}</span>
          <button className="ai-fix-x" onClick={onClose} title={t('common.close')}>×</button>
        </div>
        <div className="ai-fix-body ai-fix-empty">
          {t('ai.registerFirst')}
        </div>
      </div>
    )
  }

  return (
    <div className="ai-fix">
      <div className="ai-fix-head">
        <Icon.bolt />
        <span>{t(cfg.title)}</span>
        <div className="ai-fix-head-right">
          <div className="ai-vendors" role="group" aria-label={t('ai.vendorsAria')}>
            {aiConns.map((c) => {
              const on = c.id === active
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`ai-vendor ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => pick(c.id)}
                  title={
                    on
                      ? t('ai.vendorActiveTitle', { name: specFor(c.type).label })
                      : t('ai.vendorRerunTitle', { name: specFor(c.type).label })
                  }
                >
                  {c.name}
                </button>
              )
            })}
          </div>
          <button className="ai-fix-x" onClick={onClose} title={t('common.close')}>×</button>
        </div>
      </div>

      <div className="ai-fix-body">
        {/* 기본 모델사가 바뀌었다는 알림. **여기서 자동으로 부르지 않는다** — 누르면 그때 부른다. */}
        {pendingDefault && (
          <div className="ai-fix-notice">
            <span>
              {t('ai.defaultChangedPrefix')}
              <b>{aiConns.find((c) => c.id === pendingDefault)?.name ?? t('ai.otherConn')}</b>
              {t('ai.defaultChangedSuffix')}
            </span>
            <button className="btn sm" onClick={() => run(pendingDefault)}>
              <Icon.refresh /> {t('ai.reanalyze')}
            </button>
            <button
              className="ai-fix-notice-x"
              onClick={() => setPendingDefault('')}
              title={t('ai.dismissNotice')}
            >
              ×
            </button>
          </div>
        )}
        {chat.isPending ? (
          <div className="ai-fix-loading">
            <span className="ai-progress-spin" />
            {t(cfg.loading)}
          </div>
        ) : failed ? (
          <div className="ai-fix-error">{failed}</div>
        ) : result ? (
          <>
            <Markdown text={result.text} />
            <div className="ai-fix-actions">
              {result.sql && (
                <button className="btn sm primary" onClick={() => onApply(result.sql!)} title={t('ai.applyTitle')}>
                  <Icon.check /> {t(cfg.apply)}
                </button>
              )}
              <button
                className="btn sm"
                onClick={() => onEscalate({ sql, error, explain, assistant: result.text })}
                title={t('ai.escalateTitle')}
              >
                <Icon.bolt /> {t('ai.escalate')}
              </button>
              {mode === 'tune' && dbConnId && result.sql && (
                <button
                  className="btn sm"
                  onClick={() => compare(result.sql!)}
                  disabled={explainMut.isPending}
                  title={t('ai.perfCompareTitle')}
                >
                  <Icon.chart /> {explainMut.isPending ? t('ai.analyzing') : t('ai.perfCompare')}
                </button>
              )}
              <button className="btn sm" onClick={() => run(active)} title={t('ai.reanalyze')}>
                <Icon.refresh /> {t('ai.again')}
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
  const t = useT()
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
    return { text: t('ai.noChange'), cls: '' }
  }
  const timeImp = delta(asis.timeMs, tobe.timeMs, t('ai.slower'))
  const costImp = delta(asis.cost, tobe.cost, t('ai.grew'))
  return (
    <div className="ai-perf">
      <div className="ai-perf-title">{t('ai.perfCompare')}</div>
      <table className="ai-perf-table">
        <thead>
          <tr>
            <th />
            <th>{t('ai.perfAsis')}</th>
            <th>{t('ai.perfTobe')}</th>
            <th>{t('ai.perfImprove')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="ai-perf-metric">{t('ai.perfTime')}</td>
            <td>{asis.timeMs != null ? fmtMs(asis.timeMs) : '—'}</td>
            <td>{tobe.timeMs != null ? fmtMs(tobe.timeMs) : '—'}</td>
            <td className={timeImp.cls}>{timeImp.text}</td>
          </tr>
          <tr>
            <td className="ai-perf-metric">{t('ai.perfCost')}</td>
            <td>{asis.cost != null ? asis.cost.toLocaleString() : '—'}</td>
            <td>{tobe.cost != null ? tobe.cost.toLocaleString() : '—'}</td>
            <td className={costImp.cls}>{costImp.text}</td>
          </tr>
        </tbody>
      </table>
      {asis.timeMs == null && (
        <div className="ai-perf-note">
          {t('ai.perfNotePrefix')}
          <b>{t('ai.perfNoteBold')}</b>
          {t('ai.perfNoteSuffix')}
          {analyzed === false ? t('ai.perfNoteEstimated') : '.'}
        </div>
      )}
    </div>
  )
}
