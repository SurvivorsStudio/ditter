/** 노트북 셀 아래에 붙는 AI 챗 — 자연어로 SQL 을 만들어 그 셀(또는 아래 새 셀)에 넣는다.
 *
 *  메인 AI 탭(AiChatPane)의 축소판이다. 셀 문맥에 맞춰 두 가지가 다르다:
 *   - 셀에 이미 SQL 이 있으면 그 SQL 을 문맥으로 함께 보낸다(표시는 하지 않고 전송에만).
 *   - 생성된 SQL 은 실행하지 않고 「이 셀에 넣기」·「아래 새 셀」 로 노트북에 꽂는다.
 *  응답 마크다운(코드펜스 포함)은 공용 Markdown 렌더러로 그린다.
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { Markdown } from './Markdown'
import { MiniSelect } from '../canvas/AiChatPane'
import { useAiChat } from '../api/hooks'
import type { SelectOption } from './SearchSelect'

type CellMsg = {
  id: string
  role: 'user' | 'assistant'
  display: string // 화면에 보이는 것 (사용자가 실제 입력한 문장)
  content: string // AI 에 보내는 것 (셀 SQL 문맥이 붙을 수 있음)
  sql?: string | null
  error?: boolean
}

let seq = 0
const uid = () => `cai_${seq++}_${Math.round(performance.now())}`

export function CellAiChat({
  cellSrc,
  dbConnId,
  aiConnId,
  modelOptions,
  onModelChange,
  onClose,
  onInsert,
  onInsertBelow,
}: {
  cellSrc: string
  /** 스키마 문맥용 대상 DB (SQL 모드에서만 — mongo·duck 은 undefined). */
  dbConnId?: string
  aiConnId: string
  /** 노트북 공용 AI 모델 — 헤더에서 고르며 어느 블럭에서 바꿔도 함께 바뀐다. */
  modelOptions: SelectOption[]
  onModelChange: (v: string) => void
  /** 이 블럭의 AI 챗을 닫는다(비활성). */
  onClose: () => void
  onInsert: (sql: string) => void
  onInsertBelow: (sql: string) => void
}) {
  const chat = useAiChat()
  const [messages, setMessages] = useState<CellMsg[]>([])
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, chat.isPending])

  const send = () => {
    const text = input.trim()
    if (!text || chat.isPending) return
    // 셀에 SQL 이 있으면 문맥으로 실어 보낸다(표시는 사용자 문장만).
    const content = cellSrc.trim()
      ? `현재 셀 SQL:\n\`\`\`sql\n${cellSrc.trim()}\n\`\`\`\n\n요청: ${text}`
      : text
    const userMsg: CellMsg = { id: uid(), role: 'user', display: text, content }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    chat.mutate(
      {
        ai_connection_id: aiConnId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        intent: 'sql.generate',
        db_connection_id: dbConnId ?? null,
      },
      {
        onSuccess: (out) =>
          setMessages((m) => [
            ...m,
            {
              id: uid(),
              role: 'assistant',
              display: out.message.content,
              content: out.message.content,
              sql: out.sql,
            },
          ]),
        onError: (err) =>
          setMessages((m) => [
            ...m,
            {
              id: uid(),
              role: 'assistant',
              display: err instanceof Error ? err.message : 'AI 호출에 실패했습니다.',
              content: '',
              error: true,
            },
          ]),
      },
    )
  }

  return (
    <div className={`nb-ai ${collapsed ? 'collapsed' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div
        className="nb-ai-head"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? '펼치기' : '접기'}
      >
        <span className={`nb-ai-caret ${collapsed ? '' : 'open'}`}>
          <Icon.chevron />
        </span>
        <Icon.bolt />
        <span>AI 어시스턴트</span>
        {collapsed && messages.length > 0 && (
          <span className="nb-ai-count">{messages.filter((m) => m.role === 'user').length}개 대화</span>
        )}
        <div className="nb-ai-head-right" onClick={(e) => e.stopPropagation()}>
          {!collapsed && (
            <MiniSelect
              value={aiConnId}
              options={modelOptions}
              onChange={onModelChange}
              placeholder="AI 모델"
              align="right"
              up={false}
            />
          )}
          {messages.length > 0 && (
            <button className="nb-ai-clear" onClick={() => setMessages([])} title="대화 비우기">
              <Icon.trash />
            </button>
          )}
          <button className="nb-ai-clear nb-ai-close" onClick={onClose} title="AI 챗 닫기">
            ×
          </button>
        </div>
      </div>

      {!collapsed && messages.length > 0 && (
        <div className="nb-ai-msgs" ref={listRef}>
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="nb-ai-msg user">
                <div className="nb-ai-bubble">{m.display}</div>
              </div>
            ) : (
              <div key={m.id} className={`nb-ai-msg assistant ${m.error ? 'error' : ''}`}>
                <div className="nb-ai-bubble">
                  {m.error ? (
                    <div className="ai-text">{m.display}</div>
                  ) : (
                    <Markdown text={m.display} />
                  )}
                  {m.sql && (
                    <div className="nb-ai-actions">
                      <button className="btn sm primary" onClick={() => onInsert(m.sql!)} title="이 셀의 SQL 을 이 결과로 바꿉니다">
                        <Icon.edit /> 이 셀에 넣기
                      </button>
                      <button className="btn sm" onClick={() => onInsertBelow(m.sql!)} title="아래에 새 셀을 만들어 넣습니다">
                        <Icon.plus /> 아래 새 셀
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {chat.isPending && (
            <div className="nb-ai-msg assistant">
              <div className="nb-ai-bubble nb-ai-loading">
                <span className="ai-progress-spin" />
                생성 중…
              </div>
            </div>
          )}
        </div>
      )}

      {!collapsed && (
        <div className="nb-ai-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                send()
              }
            }}
            placeholder={cellSrc.trim() ? '이 SQL 을 어떻게 바꿀까요…' : 'SQL 로 만들 내용을 적어주세요…'}
          />
          <button
            className="btn sm primary"
            onClick={send}
            disabled={chat.isPending || !input.trim()}
            title="전송 (Enter)"
          >
            ↵
          </button>
        </div>
      )}
    </div>
  )
}
