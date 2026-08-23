import { Banner, Spinner } from '../components/common'
import { Icon } from '../components/icons'
import type { SyncPreflight } from '../api/types'

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
          <h3>실시간 동기화 착수 점검</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '14px 22px' }}>
          {loading && (
            <div className="preflight-detail">
              <Spinner /> 원본을 점검하는 중입니다 — 읽기만 하므로 아무것도 바뀌지 않습니다.
            </div>
          )}
          {error && <Banner kind="error">{error}</Banner>}

          {result && !loading && (
            <>
              <div className="preflight-detail" style={{ marginBottom: 10 }}>
                <b>{result.source_connection_name || '소스'}</b> →{' '}
                <b>{result.target_connection_name || '타깃'}</b>
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
                  <div className="preflight-label">대상 테이블 {tables.length}개</div>
                  <table className="sample-table" style={{ marginTop: 6 }}>
                    <thead>
                      <tr>
                        <th>테이블</th>
                        <th>채널</th>
                        <th>존재</th>
                        <th>기본키</th>
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
                    기본키가 없으면 갱신·삭제를 어느 행에 적용할지 정할 수 없어 동기화가
                    성립하지 않습니다. 기본키를 추가하거나 대상에서 빼세요.
                  </div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <Banner kind="warn">
                  시작하면 <b>원본 테이블에 트리거가 생깁니다.</b> 쓰기 트랜잭션이 느려지고,
                  변경분이 원본 DB 의 SYM_DATA 에 쌓입니다. 전송이 밀리면 원본 용량이 늘어나므로
                  모니터에서 미전송 건수를 지켜보세요.
                </Banner>
              </div>
            </>
          )}
        </div>

        <div className="mf">
          {unmet.length > 0 && result?.ready && (
            <span className="preflight-detail" style={{ marginRight: 'auto' }}>
              확인이 필요한 항목 {unmet.length}건
            </span>
          )}
          <button className="btn" onClick={onClose}>
            닫기
          </button>
          <button
            className="btn primary"
            onClick={onStart}
            disabled={!result?.ready || starting || loading}
            title={
              result?.ready
                ? '원본에 트리거를 심고 동기화를 시작합니다'
                : '통과하지 못한 점검이 있어 시작할 수 없습니다'
            }
          >
            {starting ? <Spinner /> : <Icon.broadcast />}
            동기화 시작
          </button>
        </div>
      </div>
    </div>
  )
}
