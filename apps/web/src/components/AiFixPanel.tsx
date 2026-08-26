/** 오류 자리에 뜨는 AI 수정 패널 — 편집기·노트북 공용.
 *
 *  실패한 쿼리와 오류 메시지를 AI(sql.fix 의도)에 보내 "진단 한 줄 + 고친 SQL"을 받는다.
 *  고친 SQL 은 바로 실행하지 않고 **편집기에 적용**(되돌리기 가능)하거나, 부족하면
 *  **AI 탭에서 이어가기**로 대화로 승격한다. 응답은 공용 Markdown 렌더러로 그린다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { Markdown } from './Markdown'
import { MiniSelect } from '../canvas/AiChatPane'
import { useAiChat, useConnections } from '../api/hooks'
import { specFor } from '../api/connectorFields'
import type { SelectOption } from './SearchSelect'

export function AiFixPanel({
  sql,
  error,
  dbConnId,
  onApply,
  onEscalate,
  onClose,
}: {
  sql: string
  error: string
  /** 스키마 문맥용 대상 DB (SQL 모드에서만). */
  dbConnId?: string
  onApply: (sql: string) => void
  onEscalate: (payload: { sql: string; error: string; assistant: string }) => void
  onClose: () => void
}) {
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

  const runFix = (connId: string) => {
    if (!connId) return
    setResult(null)
    setFailed(null)
    chat.mutate(
      {
        ai_connection_id: connId,
        messages: [{ role: 'user', content: '이 쿼리의 오류를 고쳐줘.' }],
        intent: 'sql.fix',
        db_connection_id: dbConnId ?? null,
        sql,
        error,
      },
      {
        onSuccess: (out) => setResult({ text: out.message.content, sql: out.sql }),
        onError: (e) => setFailed(e instanceof Error ? e.message : 'AI 호출에 실패했습니다.'),
      },
    )
  }

  // 모델이 정해지면 한 번 자동 실행한다(오류 자리에서 바로 진단을 보여주려는 것).
  const started = useRef(false)
  useEffect(() => {
    if (aiConnId && !started.current) {
      started.current = true
      runFix(aiConnId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConnId])

  if (aiConns.length === 0) {
    return (
      <div className="ai-fix">
        <div className="ai-fix-head">
          <Icon.bolt />
          <span>AI 수정</span>
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
        <span>AI 수정</span>
        <div className="ai-fix-head-right">
          <MiniSelect
            value={aiConnId}
            options={aiOptions}
            onChange={(v) => {
              setAiConnId(v)
              runFix(v)
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
            오류를 분석하는 중…
          </div>
        ) : failed ? (
          <div className="ai-fix-error">{failed}</div>
        ) : result ? (
          <>
            <Markdown text={result.text} />
            <div className="ai-fix-actions">
              {result.sql && (
                <button className="btn sm primary" onClick={() => onApply(result.sql!)} title="고친 쿼리를 편집기에 넣습니다(되돌리기 가능)">
                  <Icon.check /> 편집기에 적용
                </button>
              )}
              <button
                className="btn sm"
                onClick={() => onEscalate({ sql, error, assistant: result.text })}
                title="AI 어시스턴트 탭에서 대화로 이어갑니다"
              >
                <Icon.bolt /> AI 탭에서 이어가기
              </button>
              <button className="btn sm" onClick={() => runFix(aiConnId)} title="다시 분석">
                <Icon.refresh /> 다시
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
