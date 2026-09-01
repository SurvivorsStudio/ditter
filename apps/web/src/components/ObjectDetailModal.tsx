import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { useObjectDetail } from '../api/hooks'
import { Icon } from './icons'
import { useT, type MsgKey } from '../i18n'

export type DetailTarget = {
  connId: string
  kind: string
  schema: string | null
  name: string
}

/** 종류 배지 라벨 (MsgKey — 렌더 시점에 t() 로 푼다). */
const KIND_LABEL: Record<string, MsgKey> = {
  table: 'navi.kind.table',
  view: 'navi.kind.view',
  materialized_view: 'navi.kind.materialized_view',
  function: 'navi.kind.function',
  procedure: 'navi.kind.procedure',
  sequence: 'navi.kind.sequence',
  collection: 'navi.kind.collection',
  extension: 'navi.kind.extension',
  event_trigger: 'navi.kind.event_trigger',
  tablespace: 'navi.kind.tablespace',
  role: 'navi.kind.role',
}

/** 우클릭 → 상세 보기 모달. kind 에 따라 컬럼·인덱스·정의 스크립트·부가정보를 보여준다. */
export function ObjectDetailModal({
  target,
  onClose,
}: {
  target: DetailTarget
  onClose: () => void
}) {
  const t = useT()
  const { data, isLoading, isError } = useObjectDetail(target)
  const [copied, setCopied] = useState(false)

  const extensions = useMemo(
    () => [sql(), EditorView.lineWrapping, EditorState.readOnly.of(true)],
    [],
  )

  const copyDef = async () => {
    if (!data?.definition) return
    try {
      await navigator.clipboard.writeText(data.definition)
    } catch {
      /* 무시 */
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return createPortal(
    <div className="obj-modal-backdrop" onClick={onClose}>
      <div className="obj-modal" onClick={(e) => e.stopPropagation()}>
        <div className="obj-modal-hd">
          <span className="obj-modal-kind">
            {KIND_LABEL[target.kind] ? t(KIND_LABEL[target.kind]) : target.kind}
          </span>
          <span className="obj-modal-name">{target.schema ? `${target.schema}.` : ''}{target.name}</span>
          <button className="obj-modal-x" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className="obj-modal-body">
          {isLoading ? (
            <div className="obj-modal-msg">{t('runs.loading')}</div>
          ) : isError ? (
            <div className="obj-modal-msg err">{t('navi.detailFetchFailed')}</div>
          ) : !data ? null : (
            <>
              {data.info && Object.keys(data.info).length > 0 && (
                <section className="obj-sec">
                  <h4>{t('navi.info')}</h4>
                  <table className="obj-kv">
                    <tbody>
                      {Object.entries(data.info).map(([k, v]) => (
                        <tr key={k}>
                          <td className="obj-kv-k">{k}</td>
                          <td className="obj-kv-v">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {data.columns.length > 0 && (
                <section className="obj-sec">
                  <h4>{t('navi.columnsCount', { n: data.columns.length })}</h4>
                  <div className="obj-table-wrap">
                    <table className="obj-cols">
                      <thead>
                        <tr>
                          <th>{t('common.name')}</th>
                          <th>{t('navi.colType')}</th>
                          <th>NULL</th>
                          <th>PK</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.columns.map((c) => (
                          <tr key={c.name}>
                            <td className="obj-col-name">{c.name}</td>
                            <td className="obj-col-type">{c.data_type}</td>
                            <td>{c.nullable ? '' : 'NOT NULL'}</td>
                            <td>{c.primary_key ? <span className="obj-pk">PK</span> : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {data.indexes.length > 0 && (
                <section className="obj-sec">
                  <h4>{t('navi.indexesCount', { n: data.indexes.length })}</h4>
                  <div className="obj-table-wrap">
                    <table className="obj-idx">
                      <thead>
                        <tr>
                          <th>{t('common.name')}</th>
                          <th>{t('navi.colColumns')}</th>
                          <th>{t('navi.colAttrs')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.indexes.map((ix) => (
                          <tr key={ix.name}>
                            <td className="obj-col-name">{ix.name}</td>
                            <td>{ix.columns.join(', ')}</td>
                            <td>
                              {ix.primary && <span className="obj-badge pk">PK</span>}
                              {ix.unique && !ix.primary && <span className="obj-badge uq">UNIQUE</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {data.definition && (
                <section className="obj-sec">
                  <div className="obj-sec-hd">
                    <h4>{t('navi.definition')}</h4>
                    <button className="btn sm" onClick={copyDef}>
                      <Icon.copy />
                      {copied ? t('navi.copied') : t('navi.copy')}
                    </button>
                  </div>
                  <div className="obj-def">
                    <CodeMirror
                      value={data.definition}
                      theme="light"
                      editable={false}
                      extensions={extensions}
                      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                    />
                  </div>
                </section>
              )}

              {data.columns.length === 0 &&
                data.indexes.length === 0 &&
                !data.definition &&
                (!data.info || Object.keys(data.info).length === 0) && (
                  <div className="obj-modal-msg">{t('navi.noDetail')}</div>
                )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
