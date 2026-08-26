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
import { Markdown } from '../components/Markdown'
import { AiChart, parseChart } from '../components/AiChart'
import { useConnections, useAiChat, useConnectionSchema, useRunQuery } from '../api/hooks'
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

/** @멘션 후보 하나 — 테이블 또는 컬럼. */
type MentionItem = { insert: string; label: string; hint: string; kind: 'table' | 'column' }

/** 커서 위치 기준으로 활성 @멘션을 찾는다. 커서 바로 앞에 공백 없이 이어진 ``@…`` 이 있고,
 *  그 ``@`` 가 문장 맨 앞이거나 공백/괄호 뒤에 있을 때만 인정한다(이메일·데코레이터 오탐 방지).
 *  쿼리에는 ``.`` 을 허용한다(``@테이블.컬럼``). 공백을 만나면 멘션이 아니다. */
function detectMention(value: string, caret: number): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '@') {
      const prev = i > 0 ? value[i - 1] : ''
      if (prev === '' || /\s/.test(prev) || '([,'.includes(prev)) {
        return { start: i, query: value.slice(i + 1, caret) }
      }
      return null
    }
    if (/\s/.test(ch)) return null // @ 앞에 공백 → 멘션 안에 있지 않다
  }
  return null
}

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
  const runQuery = useRunQuery()

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

  // ── @멘션 자동완성 — 대상 DB 의 테이블·컬럼을 입력창에 꽂는다 ──
  // 대상 DB 스키마(테이블+컬럼). PK 는 필요 없어 pk=false 로 빠르게 받는다.
  const schemaQ = useConnectionSchema(state.dbConnId, false)
  const [ment, setMent] = useState<{ start: number; query: string } | null>(null)
  const [mentIdx, setMentIdx] = useState(0)

  // 현재 @쿼리에 맞는 후보 — '.' 이 있고 앞이 테이블명과 일치하면 컬럼, 아니면 테이블 목록.
  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!ment) return []
    const tables = schemaQ.data?.tables ?? []
    const q = ment.query
    const dot = q.lastIndexOf('.')
    if (dot >= 0) {
      const tablePart = q.slice(0, dot)
      const colPart = q.slice(dot + 1).toLowerCase()
      const tp = tablePart.toLowerCase()
      const t = tables.find(
        (t) => t.name.toLowerCase() === tp || t.qualified_name.toLowerCase() === tp,
      )
      if (t) {
        return t.columns
          .filter((c) => !colPart || c.name.toLowerCase().includes(colPart))
          .slice(0, 8)
          .map((c) => ({
            insert: `${tablePart}.${c.name}`,
            label: c.name,
            hint: c.data_type + (c.primary_key ? ' · PK' : ''),
            kind: 'column' as const,
          }))
      }
    }
    const ql = q.toLowerCase()
    return tables
      .filter(
        (t) => !ql || t.name.toLowerCase().includes(ql) || t.qualified_name.toLowerCase().includes(ql),
      )
      .slice(0, 8)
      .map((t) => ({
        insert: t.qualified_name,
        label: t.name,
        hint: `${t.namespace ? t.namespace + ' · ' : ''}${t.columns.length}열`,
        kind: 'table' as const,
      }))
  }, [ment, schemaQ.data])

  // 후보 수가 바뀌면 선택 인덱스를 범위 안으로 되돌린다.
  useEffect(() => {
    setMentIdx((i) => (mentionItems.length ? Math.min(i, mentionItems.length - 1) : 0))
  }, [mentionItems.length])

  const refreshMention = (v: string, caret: number) => {
    setMent(detectMention(v, caret))
    setMentIdx(0)
  }
  const applyMention = (item: MentionItem) => {
    if (!ment) return
    const before = input.slice(0, ment.start)
    const after = input.slice(ment.start + 1 + ment.query.length) // '@' + query 를 걷어낸다
    const insert = item.insert + (item.kind === 'column' ? ' ' : '') // 컬럼까지 골랐으면 공백으로 마무리
    const next = before + insert + after
    setInput(next)
    setMent(null)
    const caret = (before + insert).length
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(caret, caret)
      }
    })
  }
  const mentionOpen = ment !== null

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

  // 초기 화면(대화 없음)에서 입력창 위에 보여줄 추천 시작 프롬프트. 클릭하면 입력창에 채운다.
  const suggestions = [
    { label: '테이블 목록 보기', prompt: '이 데이터베이스에 어떤 테이블들이 있는지 목록을 보여줘' },
    { label: '테이블 구조 설명', prompt: '주요 테이블의 컬럼 구조와 의미를 설명해줘' },
    { label: '분석 아이디어 추천', prompt: '이 데이터베이스로 할 수 있는 유용한 분석을 추천해줘' },
  ]
  const applySuggestion = (prompt: string) => {
    sendText(prompt) // 클릭 즉시 전송
  }

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

  // 결과 기반 작업 — SQL 을 대상 DB 에서 실제로 실행하고, 그 결과를 AI 에 보낸다.
  // intent 에 따라 해석(prose)·차트(```chart)·보고서(markdown)로 갈린다.
  const RUN_ASK: Record<'sql.interpret' | 'data.chart' | 'data.report', string> = {
    'sql.interpret': '결과를 해석해 주세요.',
    'data.chart': '이 결과를 가장 잘 드러내는 차트로 표현해 주세요.',
    'data.report': '이 결과로 분석 보고서를 작성해 주세요.',
  }
  const runAndAsk = (sql: string, intent: 'sql.interpret' | 'data.chart' | 'data.report') => {
    if (!state.dbConnId || !state.aiConnId || chat.isPending || runQuery.isPending) return
    const dbId = state.dbConnId
    const aiId = state.aiConnId
    runQuery.mutate(
      { id: dbId, query: sql, limit: 50 },
      {
        onSuccess: (res) => {
          const shownRows = res.rows.length
          const totalNote =
            res.total != null && res.total > shownRows ? ` / 총 ${res.total}행` : ''
          const table = formatResultForAi(res.columns, res.rows)
          const userContent =
            `방금 실행한 SQL 과 그 결과입니다. ${RUN_ASK[intent]}\n\n` +
            `\`\`\`sql\n${sql}\n\`\`\`\n\n` +
            `실행 결과 (${shownRows}행${totalNote}):\n${table}`
          const userMsg: ChatMessage = {
            id: chatUid(),
            role: 'user',
            content: userContent,
          }
          const history = [...state.messages, userMsg]
          setState((s) => ({ ...s, messages: history }))
          chat.mutate(
            {
              ai_connection_id: aiId,
              messages: history.map((m) => ({ role: m.role, content: m.content })),
              intent,
              db_connection_id: dbId,
              sql,
            },
            {
              onSuccess: (out) =>
                setState((s) => ({
                  ...s,
                  messages: [
                    ...s.messages,
                    {
                      id: chatUid(),
                      role: 'assistant',
                      content: out.message.content,
                      sql: out.sql,
                      // 해석·보고서는 산문이라 번호 목록을 옵션으로 오인하면 안 된다(차트는 chart 로 이미 구분).
                      plain: true,
                    },
                  ],
                })),
              onError: (err) =>
                setState((s) => ({
                  ...s,
                  messages: [
                    ...s.messages,
                    {
                      id: chatUid(),
                      role: 'assistant',
                      content: err instanceof Error ? err.message : 'AI 호출에 실패했습니다.',
                      error: true,
                    },
                  ],
                })),
            },
          )
        },
        onError: (err) =>
          setState((s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: chatUid(),
                role: 'assistant',
                content: `쿼리 실행에 실패해 해석할 수 없습니다: ${err instanceof Error ? err.message : String(err)}`,
                error: true,
              },
            ],
          })),
      },
    )
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
            busy={chat.isPending || runQuery.isPending}
            onOpenSql={openSql}
            onRun={runAndAsk}
            onPick={sendText}
          />
        ))}
        {(chat.isPending || runQuery.isPending) && (
          <AiProgress
            hasDb={Boolean(state.dbConnId)}
            samples={state.samples === true}
            running={runQuery.isPending}
          />
        )}
      </div>

      {/* 초기 화면: 입력창 위 추천 시작 칩 */}
      {state.messages.length === 0 && (
        <div className="ai-suggests">
          {suggestions.map((s) => (
            <button
              key={s.label}
              className="ai-suggest-chip"
              onClick={() => applySuggestion(s.prompt)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* 입력 + 설정(모델·대상 DB·의도·예시) — Claude Code 처럼 하단에 모은다 */}
      <div className="ai-composer">
        {/* @멘션 자동완성 팝업 — 입력창 위로 뜬다 */}
        {mentionOpen && (
          <div className="ai-mention" role="listbox">
            {!state.dbConnId ? (
              <div className="ai-mention-empty">대상 DB 를 먼저 고르세요</div>
            ) : schemaQ.isLoading ? (
              <div className="ai-mention-empty">스키마 불러오는 중…</div>
            ) : mentionItems.length === 0 ? (
              <div className="ai-mention-empty">
                {schemaQ.isError ? '스키마를 불러오지 못했습니다' : '일치하는 항목이 없습니다'}
              </div>
            ) : (
              mentionItems.map((it, i) => (
                <button
                  key={`${it.kind}:${it.insert}`}
                  role="option"
                  aria-selected={i === mentIdx}
                  className={`ai-mention-item ${i === mentIdx ? 'on' : ''}`}
                  // mousedown: textarea 의 blur 보다 먼저 실행돼 포커스를 잃지 않는다
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applyMention(it)
                  }}
                  onMouseEnter={() => setMentIdx(i)}
                >
                  <Icon.table />
                  <span className="ai-mention-label">{it.label}</span>
                  <span className={`ai-mention-kind ${it.kind}`}>
                    {it.kind === 'table' ? '테이블' : '컬럼'}
                  </span>
                  <span className="ai-mention-hint">{it.hint}</span>
                </button>
              ))
            )}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="ai-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            refreshMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onClick={(e) => refreshMention(input, e.currentTarget.selectionStart ?? 0)}
          onBlur={() => window.setTimeout(() => setMent(null), 120)}
          onKeyDown={(e) => {
            // 멘션 팝업이 떠 있으면 방향키·Enter·Tab·Esc 를 팝업이 가져간다
            if (mentionOpen && mentionItems.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentIdx((i) => (i + 1) % mentionItems.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentIdx((i) => (i - 1 + mentionItems.length) % mentionItems.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                applyMention(mentionItems[mentIdx])
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMent(null)
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={state.intent === 'sql.tune' ? '튜닝할 SQL 과 요청을 적어주세요…' : 'SQL 로 만들 내용을 적어주세요… (@ 로 테이블·컬럼 참조 · Enter 전송)'}
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

/** AI 응답 생성 중 진행 상태. 백엔드 흐름(스키마 문맥 → 예시 데이터 → 모델 질의 → SQL 작성)에
 *  맞춰 단계 라벨을 순차로 보여준다 — 실제 이벤트 스트림이 아니라 흐름을 반영한 추정 단계다. */
function AiProgress({
  hasDb,
  samples,
  running = false,
}: {
  hasDb: boolean
  samples: boolean
  running?: boolean
}) {
  // 응답이 SQL 일지 되묻는 질문일지는 미리 알 수 없으므로 마지막 단계는 중립적으로 둔다.
  // running=true 면 결과 해석 흐름 — 먼저 쿼리를 실행하고, 그 결과를 AI 가 해석한다.
  const steps = useMemo(
    () =>
      [
        running ? '쿼리 실행 중' : '요청 준비 중',
        running ? '실행 결과 정리 중' : hasDb ? '스키마 문맥 구성 중' : null,
        !running && hasDb && samples ? '예시 데이터 읽는 중' : null,
        'AI 모델에 질의 중',
        running ? '결과 해석 중' : '응답 생성 중',
      ].filter((s): s is string => Boolean(s)),
    [hasDb, samples, running],
  )
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    const id = window.setInterval(() => setI((p) => Math.min(p + 1, steps.length - 1)), 900)
    return () => window.clearInterval(id)
  }, [steps])
  return (
    <div className="ai-msg assistant">
      <div className="ai-bubble ai-progress">
        <span className="ai-progress-spin" />
        <span className="ai-progress-label">{steps[i]}…</span>
        <span className="ai-progress-count">
          {i + 1}/{steps.length}
        </span>
      </div>
    </div>
  )
}

/** 말풍선 하나. assistant 응답의 SQL 블록은 코드 박스 + 실행 버튼으로 분리해 보여준다. */
function ChatBubble({
  msg,
  canOpen,
  busy,
  onOpenSql,
  onRun,
  onPick,
}: {
  msg: ChatMessage
  canOpen: boolean
  busy: boolean
  onOpenSql: (sql: string) => void
  onRun: (sql: string, intent: 'sql.interpret' | 'data.chart' | 'data.report') => void
  onPick: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
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

  // assistant — ```chart 블록이 있으면 떼어 차트로 그리고, 나머지 텍스트만 마크다운으로 보여준다.
  const chart = !msg.error ? parseChart(msg.content) : null
  const content = chart ? msg.content.replace(chart.raw, '').trim() : msg.content

  // 해석·보고서(plain): 전체를 마크다운으로만 보여준다. 안에 든 SQL 은 **읽기 전용 코드 블록**이지,
  // 실행 버튼이 붙는 액션 박스가 아니다 — 보고서 맥락의 쿼리는 보여주기용이라 그렇게 다룬다.
  if (msg.plain) {
    return (
      <div className="ai-msg assistant">
        <div className="ai-bubble">
          <Markdown text={content} className="ai-text" />
          {chart && <AiChart spec={chart.spec} />}
        </div>
      </div>
    )
  }

  // SQL 이 있으면 본문에서 코드펜스를 떼어 코드 박스로 보여준다.
  const [before, after] = msg.sql ? splitAroundFence(content) : [content, '']

  // SQL 이 없는 = 되묻는 답변이면, 제시된 후보를 클릭 가능한 번호 목록으로 보여준다.
  // 해석·보고서(plain) 는 산문이라 번호 목록을 옵션으로 오인하지 않는다.
  const options = !msg.sql && !msg.error && !chart && !msg.plain ? parseOptions(content) : []
  // 옵션이 있으면 본문에서 번호 줄을 떼어 질문 리드만 남긴다(중복 방지).
  const intro = options.length > 0 ? stripOptionLines(before) : before

  return (
    <div className={`ai-msg assistant ${msg.error ? 'error' : ''}`}>
      <div className="ai-bubble">
        {intro &&
          (msg.error ? (
            <div className="ai-text">{intro}</div>
          ) : (
            <Markdown text={intro} className="ai-text" />
          ))}
        {chart && <AiChart spec={chart.spec} />}
        {options.length > 0 && (
          <div className="ai-options">
            {options.map((o, i) => (
              <button key={o} className="ai-option" onClick={() => onPick(o)}>
                <span className="ai-option-no">{i + 1}</span>
                <span className="ai-option-label">{o}</span>
              </button>
            ))}
            {!otherOpen ? (
              <button className="ai-option ai-option-other" onClick={() => setOtherOpen(true)}>
                <span className="ai-option-no">＋</span>
                <span className="ai-option-label">기타 — 직접 입력</span>
              </button>
            ) : (
              <div className="ai-option-input">
                <input
                  autoFocus
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && otherText.trim()) onPick(otherText.trim())
                  }}
                  placeholder="직접 답변을 입력하세요…"
                />
                <button
                  className="btn sm primary"
                  disabled={!otherText.trim()}
                  onClick={() => otherText.trim() && onPick(otherText.trim())}
                >
                  보내기
                </button>
              </div>
            )}
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
              <button
                className="btn sm"
                onClick={() => onRun(msg.sql!, 'sql.interpret')}
                disabled={!canOpen || busy}
                title={canOpen ? '이 SQL 을 실행하고 결과를 AI 가 해석합니다' : '대상 DB 를 먼저 고르세요'}
              >
                <Icon.bolt /> 결과 해석
              </button>
              <button
                className="btn sm"
                onClick={() => onRun(msg.sql!, 'data.chart')}
                disabled={!canOpen || busy}
                title={canOpen ? '이 SQL 을 실행하고 결과를 차트로 그립니다' : '대상 DB 를 먼저 고르세요'}
              >
                <Icon.chart /> 차트
              </button>
              <button
                className="btn sm"
                onClick={() => onRun(msg.sql!, 'data.report')}
                disabled={!canOpen || busy}
                title={canOpen ? '이 SQL 을 실행하고 결과로 보고서를 작성합니다' : '대상 DB 를 먼저 고르세요'}
              >
                <Icon.file /> 보고서
              </button>
            </div>
          </div>
        )}
        {after && <Markdown text={after} className="ai-text" />}
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

/** 옵션 목록을 클릭 카드로 따로 보여주므로, 본문에서는 그 번호 줄을 지워 중복을 없앤다.
 *  ①②③… 또는 1)/2)/1. 형식으로 시작하는 줄만 제거한다. */
function stripOptionLines(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*(?:[①②③④⑤⑥⑦⑧⑨]|\d+[)．.])\s*/.test(l))
    .join('\n')
    .trim()
}

/** 실행 결과를 AI 프롬프트용 컴팩트 표로 만든다. 토큰·데이터 노출을 줄이려
 *  상위 20행·앞 20컬럼만 싣고, 넘치면 잘렸음을 문장으로 밝힌다. */
function formatResultForAi(columns: string[], rows: Record<string, unknown>[]): string {
  const MAX_ROWS = 20
  const MAX_COLS = 20
  const cols = columns.slice(0, MAX_COLS)
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.length > 60 ? s.slice(0, 60) + '…' : s
  }
  const header = cols.join(' | ')
  const body = rows
    .slice(0, MAX_ROWS)
    .map((r) => cols.map((c) => cell(r[c])).join(' | '))
    .join('\n')
  const notes: string[] = []
  if (rows.length > MAX_ROWS) notes.push(`(상위 ${MAX_ROWS}행만 표시)`)
  if (columns.length > MAX_COLS) notes.push(`(앞 ${MAX_COLS}개 컬럼만 표시)`)
  if (rows.length === 0) return '(결과 0행 — 조건에 맞는 데이터가 없습니다)'
  return [header, '-'.repeat(Math.min(header.length, 80)), body, ...notes].join('\n')
}

/** 첫 ```sql 블록을 기준으로 앞뒤 텍스트를 가른다 (코드는 msg.sql 로 따로 보여준다). */
function splitAroundFence(content: string): [string, string] {
  const m = content.match(/```(?:sql)?\s*\n[\s\S]*?```/i)
  if (!m || m.index === undefined) return [content.trim(), '']
  return [content.slice(0, m.index).trim(), content.slice(m.index + m[0].length).trim()]
}
