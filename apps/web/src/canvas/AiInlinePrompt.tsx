/** 쿼리 탭 가운데 뜨는 AI 프롬프트 — `/aiQuery` 명령으로 열린다.
 *
 *  자연어를 입력하면 이 탭의 연결(대상 DB·스키마 문맥)과 AI 모델로 SQL 을 생성해
 *  명령어 자리에 꽂는다. AI 챗 탭과 같은 백엔드(/ai/chat)라 정확도 개선(예시 데이터·되묻기)도
 *  그대로 적용된다. SQL 이 바로 안 나오고 되물으면 그 질문을 보여주고 이어서 답할 수 있다.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/icons'
import { useAiChat, useConnections } from '../api/hooks'
import { specFor } from '../api/connectorFields'
import type { SelectOption } from '../components/SearchSelect'
import { MiniSelect } from './AiChatPane'

type Msg = { role: 'user' | 'assistant'; content: string }

export function AiInlinePrompt({
  dbConnId,
  onInsert,
  onClose,
}: {
  /** 이 쿼리 탭의 연결 — 스키마 문맥·방언·예시 데이터에 쓴다. 없으면 일반 SQL. */
  dbConnId?: string
  onInsert: (sql: string) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { data: conns = [] } = useConnections()
  const aiConns = useMemo(() => conns.filter((c) => specFor(c.type).category === 'ai'), [conns])
  const chat = useAiChat()

  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [note, setNote] = useState<string | null>(null) // AI 되묻기/설명
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<Msg[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    if (!model && aiConns[0]) setModel(aiConns[0].id)
  }, [aiConns, model])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const aiOptions: SelectOption[] = aiConns.map((c) => ({
    value: c.id,
    label: c.name,
    hint: specFor(c.type).label,
  }))

  const submit = () => {
    const text = input.trim()
    if (!text || chat.isPending || !model) return
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]
    setInput('')
    setError(null)
    setNote(null)
    chat.mutate(
      {
        ai_connection_id: model,
        messages: historyRef.current,
        intent: 'sql.generate',
        db_connection_id: dbConnId || null,
        include_samples: Boolean(dbConnId),
      },
      {
        onSuccess: (out) => {
          if (out.sql) {
            onInsert(out.sql) // 부모가 명령어 자리에 꽂고 닫는다
          } else {
            // SQL 없이 되물었다 — 질문을 보여주고 이어서 답하게 한다
            historyRef.current = [...historyRef.current, { role: 'assistant', content: out.message.content }]
            setNote(out.message.content)
            setTimeout(() => inputRef.current?.focus(), 0)
          }
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'AI 호출에 실패했습니다.'),
      },
    )
  }

  return (
    <div className="ai-inline-backdrop" onMouseDown={onClose}>
      <div className="ai-inline-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ai-inline-head">
          <span className="ai-badge">
            <Icon.bolt /> AI
          </span>
          <span className="ai-inline-title">SQL 생성</span>
          <button className="ai-inline-x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {aiConns.length === 0 ? (
          <div className="ai-inline-empty">
            <p>등록된 AI 연결이 없습니다.</p>
            <button className="btn primary" onClick={() => navigate('/connections?add=gemini')}>
              <Icon.plus /> AI 모델 등록하기
            </button>
          </div>
        ) : (
          <>
            {note && <div className="ai-inline-note">{note}</div>}
            {error && <div className="ai-inline-error">{error}</div>}
            <textarea
              ref={inputRef}
              className="ai-inline-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={
                note
                  ? '이어서 답하거나 더 구체적으로…'
                  : '만들 SQL 을 자연어로… 예: “최근 7일 주문을 고객별로 합계” (Enter 생성)'
              }
              rows={2}
            />
            <div className="ai-inline-bar">
              <MiniSelect value={model} options={aiOptions} onChange={setModel} placeholder="AI 모델" />
              <span className="ai-inline-sp" />
              {chat.isPending ? (
                <span className="ai-inline-loading">생성 중…</span>
              ) : (
                <button
                  className="btn primary ai-inline-go"
                  onClick={submit}
                  disabled={!input.trim() || !model}
                >
                  <Icon.bolt /> 생성
                </button>
              )}
            </div>
            <div className="ai-inline-hint">
              {dbConnId ? '이 탭의 연결 스키마에 맞춰 만듭니다.' : '대상 연결이 없어 일반 SQL 로 만듭니다.'}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
