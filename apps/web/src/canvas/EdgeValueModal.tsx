import { createPortal } from 'react-dom'
import { useCanvasStore } from '../store/canvasStore'
import { Banner } from '../components/common'
import { t, useT } from '../i18n'

/** 엣지 하나로 넘어간 값을 펼쳐 본다.
 *
 * 결과 샘플 모달(행 데이터)과 목적이 다르다. 이쪽은 **상류가 하류에 건네준 값**이다 —
 * API 트리거가 넘긴 `$since` 가 하류 노드의 WHERE 절을 무엇으로 바꿨는지.
 *
 * 로그에도 같은 내용이 남지만, 로그는 시간순이라 "어느 선에서 무엇이 넘어갔나"를 찾으려면
 * 훑어야 한다. 선을 눌러 보는 편이 직관적이라 둘 다 둔다.
 */
export function EdgeValueModal({
  sourceId,
  targetId,
  onClose,
}: {
  sourceId: string
  targetId: string
  onClose: () => void
}) {
  const tr = useT()
  const nodes = useCanvasStore((s) => s.nodes)
  const source = nodes.find((n) => n.id === sourceId)
  const target = nodes.find((n) => n.id === targetId)

  // 이 선으로 넘어간 값 그 자체 — 호출 본문 그대로다
  const handed = source?.data.runState?.handed ?? {}
  // 그 값이 하류 설정을 무엇으로 바꿨는지 (트리거 상태에 하류 노드별로 담겨 있다)
  const applied = source?.data.runState?.applied?.[targetId] ?? {}
  // 원본은 캔버스 정의 그대로다 — 엔진이 사본을 만들어 치환하므로 여기는 `$이름` 이 남아 있다
  const before = target?.data.params ?? {}

  const handedRows = Object.entries(handed)
  const rows = Object.entries(applied)

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>
            {tr('cui.edge.title', {
              source: source?.data.label || sourceId,
              target: target?.data.label || targetId,
            })}
          </h3>
          <button className="x" onClick={onClose} aria-label={tr('common.close')}>
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '18px 22px 8px' }}>
          {handedRows.length === 0 && rows.length === 0 ? (
            <Banner kind="warn">{tr('cui.edge.empty')}</Banner>
          ) : (
            <>
              {handedRows.length > 0 && (
                <div className="field">
                  <label>{tr('cui.edge.handed')}</label>
                  <pre className="codeblock">{JSON.stringify(handed, null, 2)}</pre>
                  <div className="hint">
                    {tr('cui.edge.handedHint1')}
                    <code>{tr('cui.ref.varName')}</code>
                    {tr('cui.edge.handedHint2')}
                  </div>
                </div>
              )}

              {rows.length > 0 && (
                <div className="hint" style={{ margin: '16px 0 12px' }}>
                  {tr('cui.edge.applied1')}
                  <b>{target?.data.label || targetId}</b>
                  {tr('cui.edge.applied2')}
                </div>
              )}
              <div className="edge-val-list">
                {rows.map(([key, after]) => (
                  <div className="edge-val-item" key={key}>
                    <div className="evi-key">{key}</div>
                    <div className="evi-pair">
                      <div className="evi-before">
                        <span className="evi-tag">{tr('cui.edge.authored')}</span>
                        <pre>{text(before[key])}</pre>
                      </div>
                      <div className="evi-after">
                        <span className="evi-tag on">{tr('cui.edge.executed')}</span>
                        <pre>{text(after)}</pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mf">
          <button className="btn primary" onClick={onClose}>
            {tr('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 값 하나를 그대로 읽을 수 있게. 자르지 않는다 — 여기가 전문을 보는 자리다. */
function text(value: unknown): string {
  if (value === undefined) return t('cui.edge.noValue')
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
