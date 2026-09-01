import { createPortal } from 'react-dom'
import CodeMirror, { EditorState } from '@uiw/react-codemirror'
import { indentUnit } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { Icon } from '../components/icons'
import { useT } from '../i18n'

// Python 은 4칸 들여쓰기가 표준이다. CodeMirror 기본값(2칸)과 코드 템플릿(4칸)이
// 어긋나면 자동 들여쓰기가 두 번 된 것처럼 보인다 — 4칸으로 통일한다.
const PY_INDENT = '    '
const pyEditorExtensions = [
  python(),
  indentUnit.of(PY_INDENT),
  EditorState.tabSize.of(4),
]

/** CodeMirror 기반 Python 코드 에디터.
 *
 * 라인 번호·문법 하이라이트·Tab 들여쓰기를 제공한다. autocompletion 은 끈다 —
 * 실행 환경(격리 샌드박스)의 심볼을 알 수 없어 잘못된 제안이 오히려 방해가 된다.
 */
export function PyCodeEditor({
  value,
  onChange,
  height,
}: {
  value: string
  onChange: (value: string) => void
  height: string
}) {
  return (
    <CodeMirror
      value={value}
      height={height}
      theme="light"
      extensions={pyEditorExtensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: false,
        autocompletion: false,
        highlightActiveLineGutter: true,
        bracketMatching: true,
      }}
    />
  )
}

/** 코드를 크게 편집하는 팝업. 우측 패널의 좁은 인라인 에디터로는 부족할 때 연다.
 *
 * body 로 포탈해 캔버스/사이드바에 클리핑되지 않게 하고, 변경은 즉시 반영한다
 * (닫으면 그대로 저장된 상태 — 별도 적용 단계 없음).
 */
export function PyCodeModal({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  const tr = useT()
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal code-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{tr('cui.py.title')}</h3>
          <button className="x" onClick={onClose} aria-label={tr('common.close')}>
            ×
          </button>
        </div>
        <div className="mb code-modal-body">
          <PyCodeEditor value={value} onChange={onChange} height="62vh" />
          <div className="hint">
            <code>transform(row: dict)</code>
            {tr('cui.py.hint1')}
            <code>transform_batch(df)</code>
            {tr('cui.py.hint2')}
            <code>import pandas as pd</code>
            {tr('cui.py.hint3')}
          </div>
        </div>
        <div className="mf">
          <button className="btn primary" onClick={onClose}>
            <Icon.save />
            {tr('cui.py.done')}
            </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
