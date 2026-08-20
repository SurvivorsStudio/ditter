/** 쿼리 탭 가운데 뜨는 AI 프롬프트 — `/aiQuery` 명령으로 열린다.
 *
 *  자연어를 입력하면 이 탭의 연결(대상 DB·스키마 문맥)과 AI 모델로 SQL 을 생성해
 *  명령어 자리에 꽂는다. 입력창은 **쿼리 편집기와 같은 테이블·컬럼 자동완성**을 준다
 *  (makeTableCompletion 재사용) — 실제 테이블/컬럼명을 언급하면 스키마 문맥에 그 테이블이
 *  실려 정확도가 올라간다. 한글 프롬프트는 \w 에 안 걸려 팝업이 뜨지 않는다.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  startCompletion,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { Icon } from '../components/icons'
import { useAiChat, useConnectionSchema, useConnections } from '../api/hooks'
import { specFor } from '../api/connectorFields'
import type { SelectOption } from '../components/SearchSelect'
import { MiniSelect } from './AiChatPane'
import type { CompletionTable } from './SqlEditor'

type Msg = { role: 'user' | 'assistant'; content: string }

/** 프롬프트용 스키마 자동완성 — **`@` 로 테이블을 멘션**하고, 이후 `.` 로 그 컬럼을 낸다.
 *  산문 아무 단어에서 뜨지 않게 `@` 를 트리거로 둔다(먼저 테이블, 다음 컬럼).
 *  쿼리 편집기의 makeTableCompletion 은 FROM/JOIN 문맥 전용이라 여기선 못 쓴다. */
function schemaPromptCompletion(tables: CompletionTable[]): CompletionSource {
  const tableOptions = tables.map((t) => {
    const qualified = t.namespace ? `${t.namespace}.${t.name}` : t.name
    return { label: t.name, detail: t.namespace ?? '테이블', type: 'class', apply: qualified }
  })
  const colsByTable = new Map<string, NonNullable<CompletionTable['columns']>>()
  for (const t of tables) {
    if (t.columns?.length) colsByTable.set(t.name.toLowerCase(), t.columns)
  }
  return (ctx) => {
    // `테이블.컬럼조각` → 그 테이블의 컬럼 (@ 로 넣은 테이블 뒤에 . 만 찍으면 된다)
    const dotted = ctx.matchBefore(/(\w+)\.(\w*)$/)
    if (dotted) {
      const m = /(\w+)\.(\w*)$/.exec(dotted.text)!
      const cols = colsByTable.get(m[1].toLowerCase())
      if (!cols?.length) return null
      const from = dotted.from + m[1].length + 1
      return {
        from,
        options: cols.map((c) => ({ label: c.name, detail: c.data_type, type: 'property' })),
        validFor: /^\w*$/,
      }
    }
    // `@테이블조각` → 테이블 (멘션). `@` 위치부터 정식 이름으로 교체한다.
    const at = ctx.matchBefore(/@\w*/)
    if (at) {
      const frag = at.text.slice(1).toLowerCase()
      const matched = frag
        ? tableOptions.filter((o) => o.label.toLowerCase().includes(frag))
        : tableOptions
      if (!matched.length) return null
      return { from: at.from, options: matched, filter: false }
    }
    return null
  }
}

export function AiInlinePrompt({
  dbConnId,
  onInsert,
  onClose,
}: {
  /** 이 쿼리 탭의 연결 — 스키마 문맥·방언·예시 데이터·자동완성에 쓴다. */
  dbConnId?: string
  onInsert: (sql: string) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { data: conns = [] } = useConnections()
  const aiConns = useMemo(() => conns.filter((c) => specFor(c.type).category === 'ai'), [conns])
  const chat = useAiChat()
  // 쿼리 편집기와 같은 스키마(테이블·컬럼) — pk=false 로 가볍게.
  const { data: schema } = useConnectionSchema(dbConnId || undefined, false)
  const tables = schema?.tables ?? []

  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<Msg[]>([])

  useEffect(() => {
    if (!model && aiConns[0]) setModel(aiConns[0].id)
  }, [aiConns, model])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 자동완성 팝업이 열려 있으면 Escape 는 팝업부터 닫는다(박스는 그대로).
      if (e.key === 'Escape' && !document.querySelector('.cm-tooltip-autocomplete')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const aiOptions: SelectOption[] = aiConns.map((c) => ({
    value: c.id,
    label: c.name,
    hint: specFor(c.type).label,
  }))

  // 최신 submit 을 키맵에서 부르기 위한 ref (에디터를 재구성하지 않는다).
  const submitRef = useRef<() => void>(() => {})
  const extensions = useMemo(() => {
    const src = tables.length ? schemaPromptCompletion(tables) : null
    const keys = Prec.highest(
      keymap.of([
        // 팝업이 열려 있으면 Enter 로 확정, 아니면 전송. Shift+Enter 는 줄바꿈(기본).
        { key: 'Enter', run: acceptCompletion },
        {
          key: 'Enter',
          run: () => {
            submitRef.current()
            return true
          },
        },
      ]),
    )
    // `@단어` 또는 `테이블.단어` 를 치면 자동완성을 연다 (@ 는 낱단어 트리거가 아니라 직접 연다).
    const trigger = EditorView.updateListener.of((u) => {
      if (!src || (!u.docChanged && !u.selectionSet)) return
      if (completionStatus(u.state) === 'active') return
      const pos = u.state.selection.main.head
      const before = u.state.sliceDoc(Math.max(0, pos - 40), pos)
      if (/@\w*$|\w+\.\w*$/.test(before)) setTimeout(() => startCompletion(u.view), 0)
    })
    return [
      EditorView.lineWrapping,
      keys,
      trigger,
      autocompletion(src ? { override: [src] } : {}),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables])

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
            onInsert(out.sql)
          } else {
            historyRef.current = [...historyRef.current, { role: 'assistant', content: out.message.content }]
            setNote(out.message.content)
          }
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'AI 호출에 실패했습니다.'),
      },
    )
  }
  submitRef.current = submit

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
            <CodeMirror
              className="ai-inline-cm"
              value={input}
              onChange={setInput}
              extensions={extensions}
              theme="light"
              autoFocus
              placeholder={
                note
                  ? '이어서 답하거나 더 구체적으로…'
                  : '만들 SQL 을 자연어로… @ 로 테이블, 이후 . 로 컬럼 (Enter 생성 · Shift+Enter 줄바꿈)'
              }
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                autocompletion: true,
                bracketMatching: false,
                closeBrackets: false,
                indentOnInput: false,
              }}
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
              {dbConnId
                ? '이 탭의 연결 스키마에 맞춰 만듭니다. @ 로 테이블, 이후 . 로 컬럼을 자동완성합니다.'
                : '대상 연결이 없어 일반 SQL 로 만듭니다.'}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
