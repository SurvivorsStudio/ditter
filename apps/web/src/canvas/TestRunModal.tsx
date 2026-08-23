import { useMemo, useState } from 'react'
import type { TriggerVariable } from '../api/types'
import { Banner, Spinner } from '../components/common'
import { Icon } from '../components/icons'

/** 실행에 넘길 값 — JSON 스칼라만 받는다 (백엔드 TriggerVariable.type 과 짝) */
export type VariableValues = Record<string, string | number | boolean>

/** 실행 대상 선택에서 "부분 실행이 아니라 끝까지"를 뜻하는 값 */
const FULL_PIPELINE = '__full__'

/** API 트리거 테스트 실행 — 가짜 호출 본문을 만들어 파이프라인 전체를 돌린다.
 *
 * 실제 외부 호출과 **같은 통로**(`POST /pipelines/{id}/run` 의 `variables`)를 쓴다.
 * 테스트 전용 경로를 따로 두면 테스트가 통과해도 실제 호출이 된다는 보장이 없다.
 *
 * 값은 두 가지 방식으로 채울 수 있다 — 폼으로 한 칸씩, 또는 JSON 을 통째로 붙여넣기.
 * 외부 시스템이 보낼 본문을 그대로 복사해 넣는 경우가 흔해서 후자가 필요하다.
 */
export function TestRunModal({
  triggerNodeId,
  initialTarget,
  initialValues = {},
  variables,
  targets,
  onClose,
  onRun,
}: {
  /** API 트리거 노드 자신 — 값만 확인하는 기본 실행 대상 */
  triggerNodeId: string
  /** 열릴 때 미리 선택할 실행 대상. 노드 재생 버튼으로 들어오면 그 노드가 된다. */
  initialTarget?: string
  /** 직전 실행에 쓴 값 — 다시 타이핑시키지 않는다 */
  initialValues?: Record<string, string | number | boolean>
  variables: TriggerVariable[]
  /** 트리거 바로 다음 노드들 — 부분 실행의 대상 후보 */
  targets: { id: string; label: string }[]
  onClose: () => void
  onRun: (values: VariableValues, onlyNode?: string) => Promise<void>
}) {
  const declared = variables.filter((v) => v.name)

  // 기본은 **트리거만** 확인하는 것이다. 데이터를 옮기지 않으므로 하류 노드의 연결·테이블
  // 설정이 비어 있어도 돌아간다 — 아직 그리는 중일 때 "이 payload 면 값이 이렇게 꽂힌다"를
  // 먼저 보는 것이 이 버튼의 쓸모다. 하류를 실제로 돌리려면 아래에서 그 노드를 고른다.
  // 다만 노드의 재생 버튼으로 들어왔다면 그 노드가 이미 정해진 대상이다.
  const [target, setTarget] = useState<string>(initialTarget ?? triggerNodeId)

  // 직전 값 > 선언된 예시 > 기본값 순으로 채운다. 같은 값으로 여러 번 돌리는 일이 흔하다.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      declared.map((v) => {
        const previous = initialValues[v.name]
        if (previous !== undefined) return [v.name, String(previous)]
        return [v.name, v.example != null ? String(v.example) : String(v.default ?? '')]
      }),
    ),
  )
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // 폼 값 → 실제로 보낼 본문. 타입 변환은 여기서 한 번만 한다.
  const payload = useMemo(() => coerceAll(declared, values), [declared, values])

  const missing = declared
    .filter((v) => v.required !== false && String(values[v.name] ?? '').trim() === '')
    .map((v) => v.name)

  const applyJson = (text: string) => {
    setJsonText(text)
    if (text.trim() === '') {
      setJsonError(null)
      return
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setJsonError('최상위는 객체여야 합니다 — { "이름": 값 } 형태')
        return
      }
      const next = { ...values }
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        next[key] = value == null ? '' : String(value)
      }
      setValues(next)
      setJsonError(null)
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'JSON 을 해석할 수 없습니다')
    }
  }

  const submit = async () => {
    setError(null)
    setPending(true)
    try {
      await onRun(payload, target === FULL_PIPELINE ? undefined : target)
    } catch (e) {
      setError(e instanceof Error ? e.message : '실행에 실패했습니다')
      setPending(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>테스트 실행</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '18px 22px 8px' }}>
          {error && <Banner kind="error">{error}</Banner>}

          <div className="field">
            <label>어디까지 실행할까요</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value={triggerNodeId}>값 확인만 (트리거)</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} 까지 (부분 실행)
                </option>
              ))}
              <option value={FULL_PIPELINE}>파이프라인 전체 (실제 적재)</option>
            </select>
            <div className="hint">{SCOPE_HINT(target, triggerNodeId)}</div>
          </div>


          {declared.length === 0 ? (
            <Banner kind="warn">
              선언된 입력 변수가 없습니다. 값 없이 그대로 실행합니다 — 값을 받으려면 API 트리거
              노드 설정에서 변수를 추가하세요.
            </Banner>
          ) : (
            <>
              <div className="mode-seg" role="group" aria-label="값 입력 방식" style={{ marginBottom: 14 }}>
                <button
                  className={`mode-seg-btn ${mode === 'form' ? 'active' : ''}`}
                  onClick={() => setMode('form')}
                >
                  폼으로 입력
                </button>
                <button
                  className={`mode-seg-btn ${mode === 'json' ? 'active' : ''}`}
                  onClick={() => setMode('json')}
                >
                  JSON 붙여넣기
                </button>
              </div>

              {mode === 'form' ? (
                declared.map((v) => (
                  <div className="field" key={v.name}>
                    <label>
                      <code>${v.name}</code>
                      <span className="type-desc"> · {TYPE_LABEL[v.type] ?? v.type}</span>
                      {v.required === false && <span className="type-desc"> · 선택</span>}
                    </label>
                    {v.type === 'boolean' ? (
                      <select
                        value={String(values[v.name] ?? 'false')}
                        onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        value={String(values[v.name] ?? '')}
                        inputMode={v.type === 'number' ? 'decimal' : undefined}
                        placeholder={v.example != null ? String(v.example) : ''}
                        onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
                      />
                    )}
                    {v.description && <div className="hint">{v.description}</div>}
                  </div>
                ))
              ) : (
                <div className="field">
                  <label>호출 본문 (JSON)</label>
                  <textarea
                    rows={8}
                    value={jsonText}
                    placeholder={JSON.stringify(payload, null, 2)}
                    onChange={(e) => applyJson(e.target.value)}
                    style={{ fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 12 }}
                  />
                  {jsonError && <Banner kind="error">{jsonError}</Banner>}
                </div>
              )}

              <div className="field">
                <label>실제로 보낼 값</label>
                <pre className="codeblock">{JSON.stringify(payload, null, 2)}</pre>
                {missing.length > 0 && (
                  <Banner kind="warn">
                    필수 값이 비어 있습니다: {missing.map((n) => `$${n}`).join(', ')}
                  </Banner>
                )}
              </div>
            </>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={pending || missing.length > 0} onClick={submit}>
            {pending ? <Spinner /> : <Icon.play />}
            실행
          </button>
        </div>
      </div>
    </div>
  )
}

/** 고른 범위가 실제로 무엇을 하는지 — 특히 "적재하는가"를 분명히 한다. */
function SCOPE_HINT(target: string, triggerNodeId: string): string {
  if (target === triggerNodeId) {
    return '데이터를 옮기지 않고, 받은 값이 다음 노드 설정에 어떻게 꽂히는지만 보여줍니다. 하류 노드 설정이 비어 있어도 됩니다.'
  }
  if (target === FULL_PIPELINE) {
    return '타깃까지 실제로 적재합니다. 파이프라인 전체가 검증을 통과해야 합니다.'
  }
  return '그 노드까지 실제로 돌려 출력을 훑습니다 (적재 없음, 워터마크 미변경). 그 노드의 연결·테이블 설정이 갖춰져 있어야 합니다.'
}

const TYPE_LABEL: Record<string, string> = {
  string: '문자',
  number: '숫자',
  boolean: '참/거짓',
}

/** 폼의 문자열 입력을 선언된 타입으로 되돌린다.
 *
 * 숫자 칸에 `abc` 를 넣은 경우처럼 변환이 안 되면 **문자열 그대로 보낸다** — 여기서
 * 조용히 0 으로 바꾸면 사용자가 잘못 넣은 걸 모른 채 실행된다. 서버가 거절하고 이유를 말한다.
 */
function coerceAll(declared: TriggerVariable[], values: Record<string, string>): VariableValues {
  const out: VariableValues = {}
  for (const v of declared) {
    const raw = values[v.name] ?? ''
    if (v.required === false && raw.trim() === '') continue

    if (v.type === 'number') {
      const n = Number(raw)
      out[v.name] = raw.trim() !== '' && !Number.isNaN(n) ? n : raw
    } else if (v.type === 'boolean') {
      out[v.name] = raw === 'true'
    } else {
      out[v.name] = raw
    }
  }
  return out
}
