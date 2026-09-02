import { SPEC_BY_KIND } from './nodeCatalog'
import { useT } from '../i18n'
import { useCanvasStore } from '../store/canvasStore'

/** 노드 실행 결과 샘플을 표로 보여준다 (엣지의 결과 칩에서 연다). */
export function NodeSampleModal({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const tr = useT()
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId))
  const sample = node?.data.runState?.sample
  if (!node || !sample) return null

  const spec = SPEC_BY_KIND[node.data.kind]
  const IconComp = spec?.icon
  const columns = sample.columns.length
    ? sample.columns
    : Array.from(new Set(sample.rows.flatMap((r) => Object.keys(r))))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <span className="sample-badge" style={{ background: spec?.color ?? 'var(--muted)' }}>
            {IconComp ? <IconComp /> : null}
          </span>
          <h3>
            {tr('cui.sample.title', {
              label: node.data.label || (spec ? tr(spec.titleKey) : node.id),
            })}
          </h3>
          <button className="x" onClick={onClose} aria-label={tr('common.close')}>
            ×
          </button>
        </div>

        <div className="sample-meta">
          {tr(sample.truncated ? 'cui.sample.metaPartial' : 'cui.sample.meta', {
            rows: sample.rows.length,
            cols: columns.length,
          })}
        </div>

        <div className="sample-scroll">
          {sample.rows.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>
              {tr('cui.noResultRows')}
              </div>
          ) : (
            <table className="sample-table">
              <thead>
                <tr>
                  <th className="rownum">#</th>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="rownum">{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c} title={cellText(row[c])}>
                        {cellText(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
