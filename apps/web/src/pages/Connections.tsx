import { useEffect, useState } from 'react'
import {
  useConnectionTypes,
  useConnections,
  useConnectionUsages,
  useConnectorDefaults,
  useCreateConnection,
  useDeleteConnection,
  usePreflight,
  useUpdateConnection,
  useTestConnection,
} from '../api/hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { auth } from '../api/auth'
import type { FieldSpec } from '../api/connectorFields'
import {
  CATEGORY_META,
  CONNECTOR_SPECS,
  ROLE_LABEL,
  defaultsFor,
  groupByCategory,
  specFor,
  summarize,
} from '../api/connectorFields'
import type { SqlStatement } from '../api/statements'
import {
  SQL_STATEMENTS,
  STATEMENT_DETAIL,
  STATEMENT_HINT,
  parseStatements,
  riskOf,
  statementsOf,
  toCsv,
} from '../api/statements'
import type { Connection } from '../api/types'
import { Banner, EmptyState, Spinner, Tag, formatDateTime } from '../components/common'
import { Icon } from '../components/icons'

const HEALTH_LABEL: Record<string, string> = {
  ok: '정상',
  warn: '지연',
  error: '오류',
  unknown: '미확인',
}

function hostLine(conn: Connection): string {
  return summarize(conn.type, conn.config)
}

export function Connections() {
  const { data: connections, isLoading, error } = useConnections()
  const [showForm, setShowForm] = useState(false)
  const [addType, setAddType] = useState<string | null>(null)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [viewing, setViewing] = useState<Connection | null>(null)
  const [deleting, setDeleting] = useState<Connection | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  // AI 탭의 「AI 모델 등록하기」가 ?add=gemini 로 들어온다 — 생성 폼을 그 타입으로 바로 연다.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const add = params.get('add')
    if (add && CONNECTOR_SPECS[add]) {
      setAddType(add)
      setShowForm(true)
      params.delete('add')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const canEdit = auth.can('editor')
  const canOperate = auth.can('operator')

  const test = useTestConnection()

  const runTest = async (id: string) => {
    setTestResult(null)
    try {
      const result = await test.mutateAsync(id)
      setTestResult({
        id,
        ok: result.status === 'ok',
        text:
          result.status === 'ok'
            ? `정상 · ${result.latency_ms ?? '?'}ms${result.server_version ? ` · ${result.server_version}` : ''}`
            : result.message || '연결 실패',
      })
    } catch (e) {
      setTestResult({ id, ok: false, text: e instanceof Error ? e.message : '연결 실패' })
    }
  }

  return (
    <div className="view">
      <div className="pad">
        <div className="badge-note">🔒 연결 시크릿은 암호화되어 저장되며 화면에 다시 표시되지 않습니다</div>

        <div className="section-h">
          <h2>연결 (Connections)</h2>
        </div>

        {error && <Banner kind="error">연결 목록을 불러오지 못했습니다: {String(error)}</Banner>}
        {testResult && (
          <Banner kind={testResult.ok ? 'ok' : 'error'}>연결 테스트: {testResult.text}</Banner>
        )}

        {isLoading && !connections && <EmptyState title="불러오는 중…" />}

        <div className="conn-grid">
          {(connections ?? []).map((conn) => {
            const m = specFor(conn.type)
            return (
              <div className="conn" key={conn.id}>
                <div className="top">
                  <div className="db" style={{ background: m.color }}>
                    {m.abbr}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="nm">{conn.name}</div>
                    <div className="host">{hostLine(conn)}</div>
                  </div>
                </div>
                <div className="meta">
                  <span className="kv">{m.label}</span>
                  <span className="kv">풀 {conn.pool_size}</span>
                  {conn.ssl && <span className="kv">SSL</span>}
                  {conn.cdc_enabled && <span className="kv">CDC</span>}
                  {conn.has_secret && <span className="kv">🔒 시크릿</span>}
                  {/* 쓰기가 열린 연결은 목록에서 바로 보여야 한다 — 편집 창을 열어야 알면 늦다 */}
                  {statementsOf(conn).some((s) => s !== 'select') && (
                    <span className="kv warn" title={statementTitle(conn)}>
                      쓰기 허용
                    </span>
                  )}
                </div>
                <div className="foot">
                  <div className="foot-status">
                    <span className={`health ${conn.health_status}`}>
                      <span className="hd" />
                      {HEALTH_LABEL[conn.health_status] ?? conn.health_status}
                    </span>
                    {conn.last_tested_at && (
                      <span className="foot-time">{formatDateTime(conn.last_tested_at)}</span>
                    )}
                  </div>
                  <div className="actions">
                    <button
                      className="btn sm"
                      title="이 연결을 사용하는 파이프라인 보기"
                      onClick={() => setViewing(conn)}
                    >
                      <Icon.flow />
                      사용 파이프라인
                    </button>
                    {canOperate && (
                      <button
                        className="btn sm"
                        disabled={test.isPending}
                        onClick={() => runTest(conn.id)}
                      >
                        {test.isPending && test.variables === conn.id ? <Spinner /> : '테스트'}
                      </button>
                    )}
                    {canEdit && (
                      <button className="btn sm" onClick={() => setEditing(conn)} title="설정 편집">
                        편집
                      </button>
                    )}
                    {canEdit && (
                      <button
                        className="btn sm danger"
                        title="연결 삭제"
                        onClick={() => setDeleting(conn)}
                      >
                        <Icon.trash />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {canEdit && (
            <div className="add-conn" onClick={() => setShowForm(true)}>
              <Icon.plus />
              새 연결 추가
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <ConnectionForm
          initialType={addType}
          onClose={() => {
            setShowForm(false)
            setAddType(null)
          }}
        />
      )}
      {editing && (
        <ConnectionForm connection={editing} onClose={() => setEditing(null)} />
      )}
      {viewing && <UsageDialog connection={viewing} onClose={() => setViewing(null)} />}
      {deleting && (
        <DeleteDialog
          connection={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(affected) =>
            setTestResult(
              affected.length > 0
                ? {
                    id: deleting.id,
                    ok: false,
                    text: `'${deleting.name}' 을(를) 삭제했습니다. 다음 파이프라인은 연결을 다시 지정해야 합니다: ${affected.join(', ')}`,
                  }
                : { id: deleting.id, ok: true, text: `'${deleting.name}' 을(를) 삭제했습니다.` },
            )
          }
        />
      )}
    </div>
  )
}

/** 연결 추가·편집.
 *
 * 추가: 1단계에서 커넥터 타입을 카드로 고르고 2단계에서 설정을 채운다. 타입마다 필요한
 * 설정이 완전히 달라서(사이드카 주소 vs 버킷 vs 호스트) 고르는 일과 채우는 일을 나눈다.
 *
 * 편집: 타입은 바꿀 수 없다 — 바꾸면 기존 config 가 통째로 무의미해지고, 그 연결을 쓰던
 * 파이프라인 노드가 조용히 깨진다. 타입을 바꾸려면 새로 만드는 편이 안전하다.
 */
function ConnectionForm({
  connection,
  initialType,
  onClose,
}: {
  connection?: Connection
  /** 생성 시 타입 선택을 건너뛰고 이 타입으로 바로 연다 (AI 탭 딥링크 ?add=gemini). */
  initialType?: string | null
  onClose: () => void
}) {
  const { data: types } = useConnectionTypes()
  const create = useCreateConnection()
  const update = useUpdateConnection()
  const isEdit = connection !== undefined

  const [type, setType] = useState<string | null>(connection?.type ?? initialType ?? null)
  const [name, setName] = useState(connection?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    connection ? initialValues(connection) : initialType ? defaultsFor(initialType) : {},
  )

  const available = types ?? Object.keys(CONNECTOR_SPECS)

  const choose = (next: string) => {
    setType(next)
    setValues(defaultsFor(next))
    setName('')
    setError(null)
  }

  const back = () => {
    setType(null)
    setError(null)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className={`modal ${type === null ? 'wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh">
          {type !== null && !isEdit && (
            <button className="mh-back" onClick={back} title="커넥터 타입 다시 고르기">
              ←
            </button>
          )}
          <h3>
            {type === null
              ? '커넥터 타입 선택'
              : isEdit
                ? `${connection.name} 편집`
                : `새 ${specFor(type).label} 연결`}
          </h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {type === null ? (
          <TypePicker types={available} onPick={choose} />
        ) : (
          <ConnectorSettings
            type={type}
            isEdit={isEdit}
            connectionId={connection?.id}
            cdcEnabledSaved={connection?.cdc_enabled ?? false}
            hasSecret={connection?.has_secret ?? false}
            name={name}
            setName={setName}
            values={values}
            setValues={setValues}
            error={error}
            setError={setError}
            pending={create.isPending || update.isPending}
            onSubmit={async (payload) => {
              setError(null)
              try {
                if (isEdit) {
                  await update.mutateAsync({ id: connection.id, body: payload })
                } else {
                  await create.mutateAsync(payload)
                }
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : '저장에 실패했습니다')
              }
            }}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  )
}

/** 기존 연결을 폼 값으로 편다. 시크릿은 서버가 돌려주지 않으므로 비워 둔다. */
type FieldSection = { header: FieldSpec; fields: FieldSpec[] }

/** 필드를 '섹션 앞 기본 필드'와 '접히는 섹션들'로 나눈다.
 *
 * kind === 'section' 을 만나면 새 섹션이 열리고, 다음 섹션 전까지의 필드가 그 안에 들어간다.
 */
function groupFields(fields: FieldSpec[]): { leading: FieldSpec[]; sections: FieldSection[] } {
  const leading: FieldSpec[] = []
  const sections: FieldSection[] = []
  for (const f of fields) {
    if (f.kind === 'section') {
      sections.push({ header: f, fields: [] })
    } else if (sections.length > 0) {
      sections[sections.length - 1].fields.push(f)
    } else {
      leading.push(f)
    }
  }
  return { leading, sections }
}

/** 필드 하나를 그린다. 섹션 안/밖 어디서든 재사용한다. */
function FieldInput({
  field,
  value,
  isEdit,
  placeholder,
  onChange,
}: {
  field: FieldSpec
  value: string | boolean | undefined
  isEdit: boolean
  placeholder?: string
  onChange: (value: string | boolean) => void
}) {
  return (
    <div className="field">
      {field.kind === 'statements' ? (
        <>
          <label>{field.label}</label>
          <StatementChecks value={String(value ?? '')} onChange={onChange} />
        </>
      ) : field.kind === 'checkbox' ? (
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
        </label>
      ) : (
        <>
          <label>
            {field.label}
            {field.required && <span style={{ color: 'var(--red)' }}> *</span>}
          </label>
          <input
            type={
              field.kind === 'password' ? 'password' : field.kind === 'number' ? 'number' : 'text'
            }
            autoComplete={field.kind === 'password' ? 'new-password' : 'off'}
            placeholder={placeholder}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        </>
      )}
      {isEdit && field.kind === 'password' ? (
        <div className="hint">비워두면 기존 값을 그대로 유지합니다.</div>
      ) : (
        field.hint && <div className="hint">{field.hint}</div>
      )}
    </div>
  )
}


/** 카드·태그의 툴팁 문구 — 무엇이 열려 있는지 한 줄로. */
function statementTitle(conn: Connection): string {
  return `허용 명령: ${statementsOf(conn)
    .map((s) => s.toUpperCase())
    .join(', ')}`
}

/** 허용 명령 체크박스 묶음. 값은 CSV 문자열(`'select,update'`)로 오간다 —
 *  폼의 값 맵이 `string | boolean` 이라 배열을 담을 수 없다.
 *
 *  마지막 하나를 꺼도 되돌려 켜지 않는다(저장할 때 「하나 이상」으로 막는다).
 *  조용히 되돌리면 사용자는 껐다고 믿는데 실제로는 켜져 있게 된다. */
function StatementChecks({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const picked = parseStatements(value)
  const toggle = (s: SqlStatement) => {
    const next = picked.includes(s) ? picked.filter((p) => p !== s) : [...picked, s]
    onChange(toCsv(SQL_STATEMENTS.filter((x) => next.includes(x))))
  }
  return (
    <div className="stmt-checks">
      {SQL_STATEMENTS.map((s) => (
        <label
          key={s}
          className={`stmt-check risk-${riskOf(s)} ${picked.includes(s) ? 'on' : ''}`}
          title={STATEMENT_DETAIL[s]}
        >
          <input type="checkbox" checked={picked.includes(s)} onChange={() => toggle(s)} />
          <b>{s.toUpperCase()}</b>
          <span>{STATEMENT_HINT[s]}</span>
        </label>
      ))}
    </div>
  )
}

function initialValues(connection: Connection): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const f of specFor(connection.type).fields) {
    if (f.key === 'pool_size') {
      out[f.key] = String(connection.pool_size)
      continue
    }
    if (f.key === 'ssl') {
      out[f.key] = connection.ssl
      continue
    }
    if (f.key === 'cdc_enabled') {
      out[f.key] = connection.cdc_enabled
      continue
    }
    const raw = connection.config[f.key]
    if (f.kind === 'statements') {
      // 저장된 것이 없으면 읽기 전용 — 백엔드가 그렇게 보므로 화면도 그래야 한다.
      out[f.key] = toCsv(statementsOf(connection))
      continue
    }
    if (raw === undefined || raw === null) {
      out[f.key] = f.kind === 'checkbox' ? Boolean(f.default) : ''
      continue
    }
    out[f.key] = f.kind === 'checkbox' ? Boolean(raw) : String(raw)
  }
  return out
}

function TypePicker({ types, onPick }: { types: string[]; onPick: (type: string) => void }) {
  const groups = groupByCategory(types)

  return (
    <div className="mb type-picker">
      <p className="type-picker-lead">
        연결할 시스템 종류를 고르세요. 종류에 따라 필요한 설정이 달라집니다.
      </p>

      {groups.map(({ category, types: members }) => {
        const meta = CATEGORY_META[category]
        return (
          <section className="type-group" key={category}>
            <h4 className="type-group-head">
              {meta.label}
              <span className="type-group-hint">{meta.hint}</span>
            </h4>
            <div className="type-grid">
              {members.map((t) => {
                const spec = specFor(t)
                return (
                  <button key={t} className="type-card" onClick={() => onPick(t)}>
                    <span className="type-badge" style={{ background: spec.color }}>
                      {spec.abbr}
                    </span>
                    <span className="type-body">
                      <span className="type-name">{spec.label}</span>
                      <span className="type-desc">{spec.description}</span>
                    </span>
                    <span className={`type-role role-${spec.role}`}>{ROLE_LABEL[spec.role]}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

type SettingsProps = {
  type: string
  isEdit: boolean
  /** 편집 중인 연결 id — CDC 전제조건 점검(preflight)에 필요하다 */
  connectionId?: string
  /** 서버에 저장된 cdc_enabled 값 — 점검 가능 여부·안내에 쓴다 */
  cdcEnabledSaved: boolean
  /** 편집 대상에 이미 저장된 시크릿이 있는가 — 안내 문구를 바꾼다 */
  hasSecret: boolean
  name: string
  setName: (v: string) => void
  values: Record<string, string | boolean>
  setValues: (fn: (v: Record<string, string | boolean>) => Record<string, string | boolean>) => void
  error: string | null
  setError: (v: string | null) => void
  pending: boolean
  onSubmit: (payload: Record<string, unknown>) => void | Promise<void>
  onCancel: () => void
}

function ConnectorSettings({
  type,
  isEdit,
  connectionId,
  cdcEnabledSaved,
  hasSecret,
  name,
  setName,
  values,
  setValues,
  error,
  setError,
  pending,
  onSubmit,
  onCancel,
}: SettingsProps) {
  const spec = specFor(type)
  // CDC 를 지원하는 타입(mysql·postgres)이고 편집 중이면 전제조건 점검을 노출한다
  const cdcCapable = type === 'mysql' || type === 'postgres'
  const { data: defaults } = useConnectorDefaults()
  const set = (key: string, value: string | boolean) => setValues((v) => ({ ...v, [key]: value }))

  // 필드를 '섹션 앞 기본 필드' + '접히는 섹션들'로 나눈다
  const { leading, sections } = groupFields(spec.fields)
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.header.key, Boolean(s.header.defaultOpen)])),
  )
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  // 사이드카 주소를 비워두면 쓰이는 시스템 기본값을 placeholder 로 보여준다
  const placeholderFor = (f: (typeof spec.fields)[number]): string | undefined => {
    if (isEdit && f.kind === 'password' && hasSecret) return '●●●●●●●● 저장됨 — 바꿀 때만 입력'
    if (f.key === 'sidecar_url' && defaults?.sap.default_sidecar_url) {
      return `비워두면 ${defaults.sap.default_sidecar_url}`
    }
    return f.placeholder
  }

  const submit = () => {
    const missingFields = spec.fields.filter(
      (f) => f.required && !String(values[f.key] ?? '').trim(),
    )
    // 빠진 필수 항목이 접힌 섹션에 있으면 펼쳐서 보여준다 (안 보이는 걸 채우라 하면 안 되니까)
    const toOpen: Record<string, boolean> = {}
    for (const s of sections) {
      if (s.fields.some((f) => missingFields.includes(f))) toOpen[s.header.key] = true
    }
    if (Object.keys(toOpen).length > 0) setOpen((o) => ({ ...o, ...toOpen }))

    const missing = missingFields.map((f) => f.label)
    if (!name.trim()) missing.unshift('이름')
    if (missing.length > 0) {
      setError(`필수 항목이 비어 있습니다: ${missing.join(', ')}`)
      return
    }
    // 허용 명령을 다 끄면 편집기에서 아무것도 못 돌린다 — 조용히 SELECT 로 되돌리지 않고 묻는다.
    const stmtField = spec.fields.find((f) => f.kind === 'statements')
    if (stmtField && parseStatements(values[stmtField.key]).length === 0) {
      setError('허용 명령을 하나 이상 선택하세요 (읽기만 하려면 SELECT).')
      return
    }

    // 선언된 필드만 config 로 보낸다. pool_size·ssl·cdc_enabled 은 Connection 의 상위 컬럼이라 분리한다.
    const config: Record<string, unknown> = {}
    let poolSize = 5
    let ssl = false
    let cdcEnabled = false
    for (const f of spec.fields) {
      const raw = values[f.key]
      if (f.key === 'pool_size') {
        poolSize = Number(raw) || 5
        continue
      }
      if (f.key === 'ssl') {
        ssl = Boolean(raw)
        continue
      }
      if (f.key === 'cdc_enabled') {
        cdcEnabled = Boolean(raw)
        continue
      }
      if (f.kind === 'checkbox') {
        config[f.key] = Boolean(raw)
        continue
      }
      if (f.kind === 'statements') {
        config[f.key] = parseStatements(raw) // 서버는 문자열 배열을 받는다
        continue
      }
      const text = String(raw ?? '').trim()
      // 빈 값은 보내지 않는다. 특히 편집 시 비운 비밀번호는 "변경 없음"을 뜻하며,
      // 서버가 시크릿을 함께 받았을 때만 교체하므로 기존 값이 유지된다.
      if (!text) continue
      config[f.key] = f.kind === 'number' ? Number(text) : text
    }

    void onSubmit({ name: name.trim(), type, config, pool_size: poolSize, ssl, cdc_enabled: cdcEnabled })
  }

  return (
    <>
      <div className="mb">
        <div className="chosen-type">
          <span className="type-badge sm" style={{ background: spec.color }}>
            {spec.abbr}
          </span>
          <span>
            <b>{spec.label}</b>
            <span className="type-desc"> · {spec.description}</span>
          </span>
          <span className={`type-role role-${spec.role}`}>{ROLE_LABEL[spec.role]}</span>
        </div>

        {error && (
          <div style={{ padding: '0 18px' }}>
            <Banner kind="error">{error}</Banner>
          </div>
        )}

        <div className="field">
          <label>
            이름<span style={{ color: 'var(--red)' }}> *</span>
          </label>
          <input
            autoFocus
            value={name}
            placeholder={`${spec.label} 운영`}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {leading.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key]}
            isEdit={isEdit}
            placeholder={placeholderFor(f)}
            onChange={(v) => set(f.key, v)}
          />
        ))}

        {sections.map((s) => (
          <div className="form-section" key={s.header.key}>
            <button
              type="button"
              className={`section-toggle ${open[s.header.key] ? 'open' : ''}`}
              onClick={() => toggle(s.header.key)}
            >
              <span className="section-chevron">{open[s.header.key] ? '▾' : '▸'}</span>
              {s.header.label}
              {s.header.hint && <span className="section-hint">{s.header.hint}</span>}
            </button>
            {open[s.header.key] &&
              s.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  isEdit={isEdit}
                  placeholder={placeholderFor(f)}
                  onChange={(v) => set(f.key, v)}
                />
              ))}
          </div>
        ))}

        {cdcCapable && isEdit && connectionId && (
          <PreflightPanel
            connectionId={connectionId}
            cdcEnabledSaved={cdcEnabledSaved}
            cdcEnabledDraft={Boolean(values.cdc_enabled)}
          />
        )}
      </div>

      <div className="mf">
        <button className="btn" onClick={onCancel}>
          취소
        </button>
        <button className="btn primary" disabled={pending} onClick={submit}>
          {pending ? <Spinner /> : <Icon.save />}
          {isEdit ? '저장' : '등록'}
        </button>
      </div>
    </>
  )
}


/** CDC 전제조건 점검 (기획안 §7). 연결이 CDC 소스로 쓸 준비가 됐는지
 *  타입·cdc_enabled·접속 세 가지를 서버가 점검해 초록/빨강으로 보여준다.
 *
 *  주의: 점검은 **저장된** 연결 상태를 본다 — 방금 켠 CDC 토글은 저장 후에야 반영된다.
 */
function PreflightPanel({
  connectionId,
  cdcEnabledSaved,
  cdcEnabledDraft,
}: {
  connectionId: string
  cdcEnabledSaved: boolean
  cdcEnabledDraft: boolean
}) {
  const preflight = usePreflight()
  const result = preflight.data
  const dirtyToggle = cdcEnabledSaved !== cdcEnabledDraft

  return (
    <div className="form-section">
      <div className="section-toggle open" style={{ cursor: 'default' }}>
        <span className="section-chevron">◈</span>
        CDC 전제조건 점검
        <span className="section-hint">실시간 소스로 쓸 준비 상태</span>
      </div>
      <div className="field">
        {dirtyToggle && (
          <Banner kind="warn">
            「CDC 사용」 변경은 아직 저장되지 않았습니다. 먼저 저장한 뒤 점검하세요.
          </Banner>
        )}
        <button
          className="btn"
          disabled={preflight.isPending}
          onClick={() => preflight.mutate(connectionId)}
        >
          {preflight.isPending ? <Spinner /> : <Icon.search />}
          전제조건 점검
        </button>
        {preflight.error && (
          <div style={{ marginTop: 10 }}>
            <Banner kind="error">
              점검 실패: {preflight.error instanceof Error ? preflight.error.message : '오류'}
            </Banner>
          </div>
        )}
        {result && (
          <div style={{ marginTop: 10 }}>
            <div style={{ marginBottom: 8 }}>
              <Tag status={result.ready ? 'ok' : 'error'} />{' '}
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {result.ready ? 'CDC 소스로 사용할 수 있습니다.' : '아직 준비되지 않았습니다.'}
              </span>
            </div>
            <div className="preflight-list">
              {result.checks.map((c) => (
                <div className="preflight-row" key={c.key}>
                  <span className={`preflight-dot ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? '✓' : '✕'}</span>
                  <span className="preflight-label">{c.label}</span>
                  <span className="preflight-detail">{c.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 이 연결을 사용하는 파이프라인 목록 (읽기 전용).
 *
 * 삭제 흐름과 같은 사용처 데이터(`useConnectionUsages`)를 쓰지만, 경고·삭제 없이
 * "어디서 이 연결을 쓰고 있나"만 보여준다. 파이프라인 이름을 누르면 캔버스로 이동한다.
 */
function UsageDialog({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useConnectionUsages(connection.id)

  const usages = data?.usages ?? []
  const inUse = data?.in_use ?? false
  const nodeCount = usages.reduce((sum, u) => sum + u.node_ids.length, 0)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>사용 파이프라인</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '18px 22px 8px' }}>
          <div className="chosen-type" style={{ margin: '0 0 16px' }}>
            <span className="type-badge sm" style={{ background: specFor(connection.type).color }}>
              {specFor(connection.type).abbr}
            </span>
            <span>
              <b>{connection.name}</b>
              <span className="type-desc"> · {hostLine(connection)}</span>
            </span>
          </div>

          {error && <Banner kind="error">사용처를 불러오지 못했습니다: {String(error)}</Banner>}
          {isLoading && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              <Spinner /> 사용처를 확인하는 중…
            </p>
          )}

          {data && !inUse && (
            <Banner kind="ok">이 연결을 사용하는 파이프라인이 없습니다.</Banner>
          )}

          {data && inUse && (
            <>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>
                파이프라인 {usages.length}개 · 노드 {nodeCount}개가 이 연결을 사용 중입니다.
              </p>
              <div className="usage-list">
                {usages.map((u) => (
                  <div className="usage-row" key={u.pipeline_id}>
                    <button
                      className="usage-name"
                      onClick={() => {
                        onClose()
                        navigate(`/canvas/${u.pipeline_id}`)
                      }}
                      title="이 파이프라인 열기"
                    >
                      {u.pipeline_name}
                    </button>
                    <span className="usage-nodes">
                      {u.node_ids.map((n) => (
                        <code key={n}>{n}</code>
                      ))}
                    </span>
                    <Tag status={u.pipeline_status} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

/** 삭제 확인 — 사용 중이면 어디서 쓰는지 먼저 보여주고 경고한다.
 *
 * 사용 중인 연결을 말없이 지우면 해당 파이프라인은 **다음 실행에서야** 깨진다.
 * 그래서 서버도 force 없이는 409 로 거부하고, 여기서는 무엇이 깨지는지 먼저 펼쳐 보인다.
 */
function DeleteDialog({
  connection,
  onClose,
  onDeleted,
}: {
  connection: Connection
  onClose: () => void
  onDeleted: (affectedPipelines: string[]) => void
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useConnectionUsages(connection.id)
  const remove = useDeleteConnection()
  const [error, setError] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const usages = data?.usages ?? []
  const inUse = data?.in_use ?? false
  const nodeCount = usages.reduce((sum, u) => sum + u.node_ids.length, 0)

  const submit = async () => {
    setError(null)
    try {
      const result = await remove.mutateAsync({ id: connection.id, force: inUse })
      onDeleted(result.affected_pipelines)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제에 실패했습니다')
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>연결 삭제</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '18px 22px 8px' }}>
          <div className="chosen-type" style={{ margin: '0 0 16px' }}>
            <span className="type-badge sm" style={{ background: specFor(connection.type).color }}>
              {specFor(connection.type).abbr}
            </span>
            <span>
              <b>{connection.name}</b>
              <span className="type-desc"> · {hostLine(connection)}</span>
            </span>
          </div>

          {error && <Banner kind="error">{error}</Banner>}
          {isLoading && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              <Spinner /> 사용처를 확인하는 중…
            </p>
          )}

          {data && !inUse && (
            <>
              <Banner kind="ok">이 연결을 사용하는 파이프라인이 없습니다.</Banner>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>
                삭제하면 저장된 시크릿도 함께 지워지며 되돌릴 수 없습니다.
              </p>
            </>
          )}

          {data && inUse && (
            <>
              <Banner kind="error">
                파이프라인 {usages.length}개 · 노드 {nodeCount}개가 이 연결을 사용 중입니다.
                삭제하면 해당 노드는 연결을 잃고 <b>다음 실행에서 실패</b>합니다.
              </Banner>

              <div className="usage-list">
                {usages.map((u) => (
                  <div className="usage-row" key={u.pipeline_id}>
                    <button
                      className="usage-name"
                      onClick={() => {
                        onClose()
                        navigate(`/canvas/${u.pipeline_id}`)
                      }}
                      title="이 파이프라인 열기"
                    >
                      {u.pipeline_name}
                    </button>
                    <span className="usage-nodes">
                      {u.node_ids.map((n) => (
                        <code key={n}>{n}</code>
                      ))}
                    </span>
                    <Tag status={u.pipeline_status} />
                  </div>
                ))}
              </div>

              <label className="check ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                위 파이프라인이 깨진다는 것을 이해했고, 그래도 삭제합니다.
              </label>
            </>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn danger-solid"
            disabled={isLoading || remove.isPending || (inUse && !acknowledged)}
            onClick={submit}
          >
            {remove.isPending ? <Spinner /> : <Icon.trash />}
            {inUse ? '그래도 삭제' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
