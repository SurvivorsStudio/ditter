import { Banner, Spinner } from '../components/common'
import { Icon } from '../components/icons'
import type { SyncPreflight } from '../api/types'
import { useT } from '../i18n'

/** 실시간 동기화 착수 점검 결과.
 *
 * 시작 버튼을 곧장 누르게 하지 않고 이 화면을 한 번 거치게 하는 이유는, 이 동작이
 * **운영 중인 원본 테이블에 트리거를 심는 일**이기 때문이다. 되돌릴 수는 있지만 그 사이
 * 현장의 쓰기 응답이 느려진다 — 무엇을 하려는지 보고 나서 누르는 편이 맞다.
 *
 * 점검은 세 등급이고, 등급이 곧 "막느냐"다.
 * - `error`   — 통과해야 시작된다 (테이블 존재·기본키·트리거 권한·접속)
 * - `warning` — 코드가 판정할 수 없는 것 (복제본 용도·부하 테스트). 막지 않고 드러낸다.
 * - `info`    — 참고 (서버 버전·에디션)
 */
export function SyncPreflightModal({
  result,
  loading,
  starting,
  error,
  onStart,
  onClose,
}: {
  result: SyncPreflight | null
  loading: boolean
  starting: boolean
  error: string | null
  onStart: () => void
  onClose: () => void
}) {
  const tr = useT()
  const checks = result?.checks ?? []
  // 막는 것과 알리는 것을 갈라 보여준다 — 섞으면 무엇 때문에 못 켜는지 찾아야 한다.
  const blocking = checks.filter((c) => c.level === 'error')
  const advisory = checks.filter((c) => c.level !== 'error')
  const unmet = advisory.filter((c) => !c.ok)
  const tables = result?.tables ?? []

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{tr('cui.sync.title')}</h3>
          <button className="x" onClick={onClose} aria-label={tr('common.close')}>
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '14px 22px' }}>
          {loading && (
            <div className="preflight-detail">
              <Spinner /> {tr('cui.sync.checking')}
            </div>
          )}
          {error && <Banner kind="error">{error}</Banner>}

          {result && !loading && (
            <>
              <div className="preflight-detail" style={{ marginBottom: 10 }}>
                <b>{result.source_connection_name || tr('cui.sync.source')}</b> →{' '}
                <b>{result.target_connection_name || tr('cui.sync.target')}</b>
                {result.edition ? ` · ${result.edition}` : ''}
                {result.server_version ? ` · ${result.server_version}` : ''}
              </div>

              <div className="preflight-list">
                {blocking.map((c) => (
                  <div className="preflight-row" key={c.key}>
                    <span className={`preflight-dot ${c.ok ? 'ok' : 'bad'}`}>
                      {c.ok ? '✓' : '✕'}
                    </span>
                    <span className="preflight-label">{c.label}</span>
                    <span className="preflight-detail">{c.detail}</span>
                  </div>
                ))}
                {advisory.map((c) => (
                  <div className="preflight-row" key={c.key}>
                    <span className={`preflight-dot ${c.ok ? 'ok' : ''}`}>{c.ok ? '✓' : '!'}</span>
                    <span className="preflight-label">{c.label}</span>
                    <span className="preflight-detail">{c.detail}</span>
                  </div>
                ))}
              </div>

              {tables.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="preflight-label">{tr('cui.sync.tableCount', { n: tables.length })}</div>
                  <table className="sample-table" style={{ marginTop: 6 }}>
                    <thead>
                      <tr>
                        <th>{tr('cui.sync.thTable')}</th>
                        <th>{tr('cui.sync.thChannel')}</th>
                        <th>{tr('cui.sync.thExists')}</th>
                        <th>{tr('cui.sync.thPk')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tables.map((t) => (
                        <tr key={`${t.namespace}.${t.name}`}>
                          <td>
                            {t.namespace ? `${t.namespace}.` : ''}
                            {t.name}
                          </td>
                          <td>{t.channel}</td>
                          <td>{t.exists ? '✓' : '✕'}</td>
                          <td>{t.has_primary_key ? '✓' : '✕'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="preflight-detail" style={{ marginTop: 6 }}>
                    {tr('cui.sync.pkNote')}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <Banner kind="warn">
                  {tr('cui.sync.warn1')}
                  <b>{tr('cui.sync.warnBold')}</b>
                  {tr('cui.sync.warn2')}
                </Banner>
              </div>
            </>
          )}
        </div>

        <div className="mf">
          {unmet.length > 0 && result?.ready && (
            <span className="preflight-detail" style={{ marginRight: 'auto' }}>
              {tr('cui.sync.unmet', { n: unmet.length })}
              </span>
          )}
          <button className="btn" onClick={onClose}>
            {tr('common.close')}
          </button>
          <button
            className="btn primary"
            onClick={onStart}
            disabled={!result?.ready || starting || loading}
            title={
              result?.ready
                ? tr('cui.sync.startTitle')
                : tr('cui.sync.blockedTitle')
            }
          >
            {starting ? <Spinner /> : <Icon.broadcast />}
{tr('cui.sync.start')}
</button>
        </div>
      </div>
    </div>
  )
}
