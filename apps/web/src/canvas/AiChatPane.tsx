/** AI 챗 탭 — 자연어로 SQL 을 생성·튜닝하는 대화 창 (설계 문서 §7.5).
 *
 *  파이프라인 탭이 Canvas 를 띄우는 것과 같은 자리에서 렌더된다(SqlEditor.tsx 본문 분기).
 *  두 개의 연결을 참조한다: ① AI 모델(gemini) ② 대상 DB(선택 — 스키마 문맥·실행).
 *  생성된 SQL 은 여기서 실행하지 않고 **새 쿼리 탭**으로 넘겨 기존 안전장치(허용 명령·커밋)
 *  아래에서 실행한다.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type SelectOption } from '../components/SearchSelect'
import { Icon } from '../components/icons'
import { useConnections, useAiChat } from '../api/hooks'
import { specFor } from '../api/connectorFields'
import {
  type ChatIntent,
  type ChatMessage,
  type ChatState,
  chatUid,
  loadChat,
  saveChat,
} from '../api/aiChatStore'

//: 대상 DB 로 쓸 수 있는(스키마 문맥·실행) 커넥터 타입 — 백엔드 ai_service._DIALECT_BY_TYPE 와 맞춘다.
const DB_TARGET_TYPES = new Set(['postgres', 'mysql', 'mssql'])

type OpenAsQuery = (p: { connId: string; mode: 'sql'; text: string; title: string }) => void

export function AiChatPane({
  sessionId,
  hidden,
  onOpenAsQuery,
  onFocus,
}: {
  sessionId: number
  hidden: boolean
  onOpenAsQuery: OpenAsQuery
  onFocus: () => void
}) {
  const navigate = useNavigate()
  const { data: conns = [] } = useConnections()
  const chat = useAiChat()

  const aiConns = useMemo(() => conns.filter((c) => specFor(c.type).category === 'ai'), [conns])
  const dbConns = useMemo(() => conns.filter((c) => DB_TARGET_TYPES.has(c.type)), [conns])

  // 세션별 대화 상태 — 전용 저장소에서 복원하고, 바뀔 때마다 저장한다.
  const [state, setState] = useState<ChatState>(() => loadChat(sessionId))
  useEffect(() => {
    saveChat(sessionId, state)
  }, [sessionId, state])

  // AI 모델 기본값 — 아직 안 골랐고 연결이 하나라도 있으면 첫 번째로.
  useEffect(() => {
    if (!state.aiConnId && aiConns.length > 0) {
      setState((s) => ({ ...s, aiConnId: aiConns[0].id }))
    }
  }, [aiConns, state.aiConnId])

  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 새 메시지가 오면 맨 아래로.
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [state.messages, chat.isPending])

  // 입력창 자동 높이 — 내용에 맞춰 커지다가 최대(200px)에서 멈추고 스크롤(Claude Code 식).
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  // ── AI 연결이 하나도 없으면: 등록 안내 ──
  if (aiConns.length === 0) {
    return (
      <div
        className="sql-tab-pane ai-pane"
        style={{ display: hidden ? 'none' : 'flex' }}
        onMouseDown={onFocus}
      >
        <div className="ai-empty">
          <div className="ai-empty-icon">
            <Icon.bolt />
          </div>
          <h3>등록된 AI 연결이 없습니다</h3>
          <p>「연결 관리」에서 AI 모델(Gemini)을 먼저 등록하세요.</p>
          <button className="btn primary" onClick={() => navigate('/connections?add=gemini')}>
            <Icon.plus />
            AI 모델 등록하기
          </button>
        </div>
      </div>
    )
  }

  const aiOptions: SelectOption[] = aiConns.map((c) => ({
    value: c.id,
    label: c.name,
    hint: specFor(c.type).label,
  }))
  const dbOptions: SelectOption[] = [
    { value: '', label: '대상 DB 없음', hint: '일반 SQL' },
    ...dbConns.map((c) => ({ value: c.id, label: c.name, hint: specFor(c.type).label })),
  ]

  const sendText = (raw: string) => {
    const text = raw.trim()
    if (!text || chat.isPending || !state.aiConnId) return
    const userMsg: ChatMessage = { id: chatUid(), role: 'user', content: text }
    const history = [...state.messages, userMsg]
    setState((s) => ({ ...s, messages: history }))
    setInput('')

    chat.mutate(
      {
        ai_connection_id: state.aiConnId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        intent: state.intent,
        db_connection_id: state.dbConnId || null,
        // 예시 데이터(실제 DB 행)는 opt-in — 사용자가 명시로 켰을 때만 보낸다(백엔드 기본 False 와 일치).
        include_samples: Boolean(state.dbConnId) && state.samples === true,
      },
      {
        onSuccess: (out) => {
          const asst: ChatMessage = {
            id: chatUid(),
            role: 'assistant',
            content: out.message.content,
            sql: out.sql,
            note: out.schema_note,
          }
          setState((s) => ({ ...s, messages: [...s.messages, asst] }))
        },
        onError: (err) => {
          const asst: ChatMessage = {
            id: chatUid(),
            role: 'assistant',
            content: err instanceof Error ? err.message : 'AI 호출에 실패했습니다.',
            error: true,
          }
          setState((s) => ({ ...s, messages: [...s.messages, asst] }))
        },
      },
    )
  }
  const send = () => sendText(input)

  const openSql = (sql: string) => {
    if (!state.dbConnId) return
    onOpenAsQuery({ connId: state.dbConnId, mode: 'sql', text: sql, title: 'AI SQL' })
  }

  const clearAll = () => setState((s) => ({ ...s, messages: [] }))

  return (
    <div
      className="sql-tab-pane ai-pane"
      style={{ display: hidden ? 'none' : 'flex' }}
      onMouseDown={onFocus}
    >
      {/* 메시지 목록 */}
      <div className="ai-messages" ref={listRef}>
        {state.messages.length === 0 && (
          <div className="ai-hint">
            <p>자연어로 물어보세요. 예: “최근 7일 주문을 고객별로 합계 내줘”.</p>
            {!state.dbConnId && <p className="ai-hint-dim">대상 DB 를 고르면 스키마에 맞춘 SQL 을 만듭니다.</p>}
          </div>
        )}
        {state.messages.map((m) => (
          <ChatBubble
            key={m.id}
            msg={m}
            canOpen={Boolean(state.dbConnId)}
            onOpenSql={openSql}
            onPick={sendText}
          />
        ))}
        {chat.isPending && (
          <div className="ai-msg assistant">
            <div className="ai-bubble ai-typing">
              <span /> <span /> <span />
            </div>
          </div>
        )}
      </div>

      {/* 입력 + 설정(모델·대상 DB·의도·예시) — Claude Code 처럼 하단에 모은다 */}
      <div className="ai-composer">
        <textarea
          ref={inputRef}
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={state.intent === 'sql.tune' ? '튜닝할 SQL 과 요청을 적어주세요…' : 'SQL 로 만들 내용을 적어주세요… (Enter 전송 · Shift+Enter 줄바꿈)'}
          rows={1}
        />
        {/* 하단 컨트롤 바 — 왼쪽: 대상 DB·의도·예시 / 오른쪽: 모델·전송 (Claude Code 식) */}
        <div className="ai-composer-bar">
          <div className="ai-composer-left">
            <MiniSelect
              value={state.dbConnId ?? ''}
              options={dbOptions}
              onChange={(v) => setState((s) => ({ ...s, dbConnId: v || undefined }))}
              placeholder="대상 DB"
            />
            <div className="ai-intent">
              {(['sql.generate', 'sql.tune'] as ChatIntent[]).map((it) => (
                <button
                  key={it}
                  className={`ai-intent-btn ${state.intent === it ? 'on' : ''}`}
                  onClick={() => setState((s) => ({ ...s, intent: it }))}
                >
                  {it === 'sql.generate' ? '생성' : '튜닝'}
                </button>
              ))}
            </div>
            {/* 예시 데이터 — 언급 테이블의 실제 행을 프롬프트에 넣어 값→컬럼 매핑 정확도를 높인다. */}
            {state.dbConnId && (
              <button
                className={`ai-icon-btn ${state.samples === true ? 'on' : ''}`}
                onClick={() => setState((s) => ({ ...s, samples: s.samples === true ? false : true }))}
                title={`예시 데이터 ${state.samples === true ? '켜짐' : '꺼짐'} — 언급한 테이블의 실제 행을 AI 에 보내 정확도를 높입니다(데이터가 전송됩니다)`}
              >
                <Icon.table />
              </button>
            )}
          </div>
          <div className="ai-composer-right">
            {state.messages.length > 0 && (
              <button className="ai-icon-btn" onClick={clearAll} title="대화 비우기">
                <Icon.trash />
              </button>
            )}
            <MiniSelect
              value={state.aiConnId ?? ''}
              options={aiOptions}
              onChange={(v) => setState((s) => ({ ...s, aiConnId: v }))}
              placeholder="AI 모델"
              align="right"
            />
            <button
              className="ai-send-btn"
              onClick={send}
              disabled={chat.isPending || !input.trim()}
              title="전송 (Enter)"
            >
              ↵
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 작고 은은한 드롭다운 (Claude Code 식 모델 선택기). 현재 값을 텍스트로 보이고,
 *  클릭하면 팝오버 메뉴가 뜬다. 큰 pill 셀렉트 대신 하단 바에 어울리게 컴팩트하다. */
export function MiniSelect({
  value,
  options,
  onChange,
  placeholder,
  align = 'left',
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    return () => window.removeEventListener('mousedown', onDoc)
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div className={`ai-mini ${align === 'right' ? 'right' : ''}`} ref={ref}>
      <button className="ai-mini-btn" onClick={() => setOpen((o) => !o)}>
        <span className="ai-mini-label">{current?.label ?? placeholder}</span>
        <Icon.chevron />
      </button>
      {open && (
        <div className="ai-mini-menu">
          {options.map((o) => (
            <button
              key={o.value}
              className={`ai-mini-item ${o.value === value ? 'on' : ''}`}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span>{o.label}</span>
              {o.hint && <span className="ai-mini-hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 말풍선 하나. assistant 응답의 SQL 블록은 코드 박스 + 실행 버튼으로 분리해 보여준다. */
function ChatBubble({
  msg,
  canOpen,
  onOpenSql,
  onPick,
}: {
  msg: ChatMessage
  canOpen: boolean
  onOpenSql: (sql: string) => void
  onPick: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* 무시 */
    }
  }

  if (msg.role === 'user') {
    return (
      <div className="ai-msg user">
        <div className="ai-bubble">{msg.content}</div>
      </div>
    )
  }

  // assistant — SQL 이 있으면 본문에서 코드펜스를 떼어 코드 박스로 보여준다.
  const [before, after] = msg.sql
    ? splitAroundFence(msg.content)
    : [msg.content, '']

  // SQL 이 없는 = 되묻는 답변이면, 제시된 후보를 빠른 답장 칩으로 보여준다.
  const options = !msg.sql && !msg.error ? parseOptions(msg.content) : []

  return (
    <div className={`ai-msg assistant ${msg.error ? 'error' : ''}`}>
      <div className="ai-bubble">
        {before && <div className="ai-text">{before}</div>}
        {options.length > 0 && (
          <div className="ai-quick">
            {options.map((o) => (
              <button key={o} className="ai-quick-chip" onClick={() => onPick(o)}>
                {o}
              </button>
            ))}
          </div>
        )}
        {msg.sql && (
          <div className="ai-code">
            <pre>{msg.sql}</pre>
            <div className="ai-code-actions">
              <button className="btn sm" onClick={() => copy(msg.sql!)}>
                <Icon.copy /> {copied ? '복사됨' : '복사'}
              </button>
              <button
                className="btn sm primary"
                onClick={() => onOpenSql(msg.sql!)}
                disabled={!canOpen}
                title={canOpen ? '새 쿼리 탭에서 실행' : '대상 DB 를 먼저 고르세요'}
              >
                <Icon.play /> 새 쿼리 탭
              </button>
            </div>
          </div>
        )}
        {after && <div className="ai-text">{after}</div>}
        {msg.note && <div className="ai-note">{msg.note}</div>}
      </div>
    </div>
  )
}

/** 되묻는 답변에서 제시된 후보를 뽑아 빠른 답장 칩으로 만든다.
 *  원문자(①②③) 또는 1)/2) 형식으로 2개 이상일 때만 — 오탐을 줄인다. */
function parseOptions(content: string): string[] {
  const clean = (s: string) => s.trim().replace(/[.。,·:\s]+$/, '').trim()
  const circled = [...content.matchAll(/[①②③④⑤⑥⑦⑧⑨]\s*([^\n①②③④⑤⑥⑦⑧⑨]{1,40})/g)]
    .map((m) => clean(m[1]))
    .filter(Boolean)
  if (circled.length >= 2) return circled.slice(0, 6)
  const numbered = [...content.matchAll(/(?:^|\n)\s*\d+[)．.]\s*([^\n]{1,40})/g)]
    .map((m) => clean(m[1]))
    .filter(Boolean)
  if (numbered.length >= 2) return numbered.slice(0, 6)
  return []
}

/** 첫 ```sql 블록을 기준으로 앞뒤 텍스트를 가른다 (코드는 msg.sql 로 따로 보여준다). */
function splitAroundFence(content: string): [string, string] {
  const m = content.match(/```(?:sql)?\s*\n[\s\S]*?```/i)
  if (!m || m.index === undefined) return [content.trim(), '']
  return [content.slice(0, m.index).trim(), content.slice(m.index + m[0].length).trim()]
}
