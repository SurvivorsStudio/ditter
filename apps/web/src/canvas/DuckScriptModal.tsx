import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { EditorView } from '@codemirror/view'
import { Icon } from '../components/icons'
import { useDuckScript } from '../api/hooks'
import { ApiError } from '../api/client'
import { useT } from '../i18n'

const readOnlyPython = [python(), EditorView.lineWrapping, EditorView.editable.of(false)]

/** 연합 조회를 그대로 돌아가는 파이썬 스크립트로 보여 주는 팝업.
 *
 *  편집기에서 쿼리를 맞춰 놓고 나면 다음에 하는 일은 대개 정해져 있다 — 노트북에 붙이거나,
 *  배치로 돌리거나, 동료에게 보내는 것. 그때마다 ATTACH·시크릿 조립을 손으로 다시 쓰는 건
 *  이 기능이 애초에 없애려던 수고다.
 *
 *  **비밀번호는 코드에 없다.** 환경변수 자리만 있고 무엇을 채워야 하는지 위에 띄운다 —
 *  코드는 복사되고 커밋되므로 한 번 새면 되돌릴 수 없다.
 */
export function DuckScriptModal({ sql, onClose }: { sql: string; onClose: () => void }) {
  const { mutate, data, error, isPending } = useDuckScript()
  const tr = useT()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    mutate({ query: sql })
  }, [mutate, sql])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = () => {
    if (!data) return
    void navigator.clipboard?.writeText(data.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([data.code], { type: 'text/x-python;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = data.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const message = error
    ? error instanceof ApiError
      ? error.message
      : tr('cui.duck.genFailed')
    : null

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div
        className="modal wide duck-script"
        role="dialog"
        aria-modal="true"
        aria-label={tr('cui.duck.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h3>{tr('cui.duck.title')}</h3>
          <button
            className="btn sm"
            style={{ marginLeft: 'auto' }}
            onClick={download}
            disabled={!data}
          >
            <Icon.save />
            {tr('cui.duck.download')}
            </button>
          <button className="btn primary sm" onClick={copy} disabled={!data}>
            {copied ? tr('cui.copied') : tr('cui.copy')}
          </button>
          <button className="x" onClick={onClose} aria-label={tr('common.close')}>
            ×
          </button>
        </div>

        {data && data.password_envs.length > 0 && (
          <div className="duck-script-envs">
            <b>{tr('cui.duck.envsBold')}</b> {tr('cui.duck.envsRest')}{' '}
            {data.password_envs.map((name, i) => (
              <span key={name}>
                {i > 0 && ', '}
                <code>{name}</code>
              </span>
            ))}
          </div>
        )}

        <div className="duck-script-body">
          {isPending && <div className="tree-empty">{tr('cui.duck.generating')}</div>}
          {message && <div className="duck-script-error">{message}</div>}
          {data && (
            <CodeMirror
              value={data.code}
              height="100%"
              theme="light"
              extensions={readOnlyPython}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                autocompletion: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
