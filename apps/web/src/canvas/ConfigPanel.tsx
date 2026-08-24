import { Suspense, lazy, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  useConnectionSchema,
  useConnections,
  useConnectorDefaults,
  useCreateTrigger,
  useDeleteTrigger,
  useSetTriggerEnabled,
  useTableSchema,
  useTriggers,
} from '../api/hooks'
import { SYNC_CHANNELS, SYNC_PURPOSES } from '../api/types'
import type { TriggerCreated, TriggerVariable } from '../api/types'
import { Banner, formatDateTime } from '../components/common'
import { Icon } from '../components/icons'
import { SchemaTableTree } from '../components/SchemaTableTree'
import { SearchSelect, type SelectOption } from '../components/SearchSelect'
import { isLabelTaken, resultEntries, useCanvasStore, type EaiNode } from '../store/canvasStore'
import { nodeRefText } from './variables'
import { DEFAULT_MEMO_COLOR, MEMO_COLORS } from './memoColors'

// CodeMirror 는 무거워서(≈160KB gzip) 실제로 편집할 때만 지연 로딩한다.
const PyCodeEditor = lazy(() => import('./PyCodeEditor').then((m) => ({ default: m.PyCodeEditor })))
const PyCodeModal = lazy(() => import('./PyCodeEditor').then((m) => ({ default: m.PyCodeModal })))
const SqlEditor = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlEditor })))
const SqlModal = lazy(() => import('./SqlEditor').then((m) => ({ default: m.SqlModal })))
import type { EditorVariable } from './SqlEditor'
import {
  DEFAULT_PYCODE,
  DEFAULT_PYCODE_BATCH,
  SPEC_BY_KIND,
  type SwitchCase,
  allowedConnectorTypes,
  isCdcSource,
  isSyncSource,
  isSyncTarget,
  isDocumentKind,
  isNote,
  isSource,
  isTarget,
  isTrigger,
  newCaseId,
} from './nodeCatalog'

const FILTER_OPS = [
  ['eq', '= 같음'],
  ['ne', '≠ 다름'],
  ['gt', '> 초과'],
  ['gte', '≥ 이상'],
  ['lt', '< 미만'],
  ['lte', '≤ 이하'],
  ['in', 'in 포함됨'],
  ['not_in', 'not in 미포함'],
  ['contains', '문자열 포함'],
  ['starts_with', '~로 시작'],
  ['is_null', '값 없음'],
  ['is_not_null', '값 있음'],
  ['regex', '정규식'],
] as const

const CASTS = ['', 'str', 'int', 'float', 'bool', 'upper', 'lower', 'strip'] as const

type Cond = { field?: string; op?: string; value?: unknown }
type Mapping = { source?: string; target?: string; cast?: string }

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

const CONFIG_MIN = 260
const CONFIG_MAX = 760
const CONFIG_WIDTH_KEY = 'eai.configWidth'

/** 설정 패널 껍데기 — 좌측 가장자리를 드래그해 너비를 조절한다.
 *
 * 너비 상태는 ConfigPanel(노드 전환에도 안 바뀌는 부모)에 두고 localStorage 에 저장한다.
 * 스크롤 영역은 안쪽 .config-scroll 로 분리해, 리사이저가 내용과 함께 스크롤되지 않게 한다.
 */
function ConfigShell({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(CONFIG_WIDTH_KEY))
    return saved >= CONFIG_MIN && saved <= CONFIG_MAX ? saved : 300
  })

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    document.body.classList.add('resizing-col')
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(CONFIG_MAX, Math.max(CONFIG_MIN, window.innerWidth - ev.clientX))
      setWidth(next)
    }
    const onUp = () => {
      document.body.classList.remove('resizing-col')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setWidth((w) => {
        localStorage.setItem(CONFIG_WIDTH_KEY, String(w))
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <aside className="config" style={{ width }}>
      <div
        className="config-resizer"
        onMouseDown={startResize}
        onDoubleClick={() => {
          setWidth(300)
          localStorage.setItem(CONFIG_WIDTH_KEY, '300')
        }}
        title="드래그해서 너비 조절 · 더블클릭으로 초기화"
      />
      <div className="config-scroll">{children}</div>
    </aside>
  )
}

export function ConfigPanel() {
  const selectedId = useCanvasStore((s) => s.selectedId)
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === s.selectedId))

  return (
    <ConfigShell>
      {!selectedId || !node ? (
        <div className="empty">
          노드를 선택하면
          <br />
          설정을 편집할 수 있습니다.
          <br />
          <br />
          좌측 팔레트에서 노드를
          <br />
          캔버스로 드래그해 추가하세요.
        </div>
      ) : (
        <NodeConfig key={node.id} node={node} />
      )}
    </ConfigShell>
  )
}

/** 노드 이름 입력 — 캔버스 안에서 이름은 유일해야 한다.
 *
 * 입력칸은 사용자가 친 글자를 그대로 들고 있는다. 겹치는 순간 되돌려 버리면 이름을
 * 고치는 도중에 손이 묶이기 때문이다. 대신 이름이 비었거나 다른 노드와 겹치는 동안에는
 * 그래프에 반영하지 않고(스토어의 updateLabel 도 같은 조건으로 거절한다) 이유를 보여준다.
 * 끝내 고치지 않고 포커스를 옮기면 마지막으로 유효했던 이름으로 되돌린다.
 */
function NodeNameField({ node }: { node: EaiNode }) {
  const updateLabel = useCanvasStore((s) => s.updateLabel)
  const nodes = useCanvasStore((s) => s.nodes)
  const committed = node.data.label
  const [draft, setDraft] = useState(committed)
  // 되돌리기 등 밖에서 이름이 바뀌면 입력칸도 따라간다
  const [synced, setSynced] = useState(committed)
  if (synced !== committed) {
    setSynced(committed)
    setDraft(committed)
  }

  const trimmed = draft.trim()
  const error = !trimmed
    ? '노드 이름을 입력하세요.'
    : isLabelTaken(nodes, trimmed, node.id)
      ? '같은 이름의 노드가 이미 있습니다.'
      : null

  return (
    <div className="field">
      <label>노드 이름</label>
      <input
        className={error ? 'bad' : undefined}
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          if (next.trim() && !isLabelTaken(nodes, next.trim(), node.id)) {
            updateLabel(node.id, next)
            setSynced(next.trim())
          }
        }}
        onBlur={() => {
          if (error) setDraft(committed)
        }}
      />
      {error && <div className="hint bad">{error}</div>}
    </div>
  )
}

function NodeConfig({ node }: { node: EaiNode }) {
  const { updateParams, removeNode } = useCanvasStore()
  const spec = SPEC_BY_KIND[node.data.kind]
  const IconComp = spec?.icon
  const params = node.data.params
  const set = (patch: Record<string, unknown>) => updateParams(node.id, patch)

  const allowed = allowedConnectorTypes(node.data.kind)
  const { data: connections = [] } = useConnections()
  // CDC 소스는 같은 RDB 연결을 쓰되 'CDC 사용'이 켜진 연결만 대상이다 (기획안 §5·§7)
  const cdcSource = isCdcSource(node.data.kind)
  const usable = (allowed ? connections.filter((c) => allowed.includes(c.type)) : connections).filter(
    (c) => (cdcSource ? c.cdc_enabled : true),
  )
  const connectionId = params.connection_id ? String(params.connection_id) : undefined

  return (
    <>
      <div className="ch">
        <div className="cic" style={{ background: spec?.color ?? 'var(--muted)' }}>
          {IconComp ? <IconComp /> : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="ct">{spec?.title ?? node.data.kind}</div>
          <div className="csub">{node.id}</div>
        </div>
      </div>

      {!isNote(node.data.kind) && <NodeNameField node={node} />}

      {/* 응답 노드는 타깃이지만 연결이 없다 — 어디에도 적재하지 않고 호출자에게 돌려준다 */}
      {(isSource(node.data.kind) || isTarget(node.data.kind)) &&
        node.data.kind !== 'target.response' && (
        <div className="field">
          <label>연결</label>
          <select value={connectionId ?? ''} onChange={(e) => set({ connection_id: e.target.value })}>
            <option value="">— 선택 —</option>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
          {usable.length === 0 && (
            <div className="hint">
              {cdcSource
                ? 'CDC 를 켠 연결이 없습니다. [연결] 화면에서 이 소스 타입 연결의 「CDC 사용」을 켜고 전제조건을 점검하세요.'
                : '사용 가능한 연결이 없습니다. [연결] 화면에서 먼저 등록하세요.'}
            </div>
          )}
        </div>
      )}

      {isTrigger(node.data.kind) && <TriggerFields kind={node.data.kind} params={params} set={set} />}
      {isCdcSource(node.data.kind) && (
        <CdcSourceFields params={params} set={set} connectionId={connectionId} />
      )}
      {isSyncSource(node.data.kind) && (
        <SyncSourceFields params={params} set={set} connectionId={connectionId} />
      )}
      {isSyncTarget(node.data.kind) && <SyncTargetFields params={params} set={set} />}
      {node.data.kind === 'source.sap' && (
        <SapSourceFields params={params} set={set} connectionId={connectionId} />
      )}
      {node.data.kind === 'source.mongo' && (
        <MongoSourceFields params={params} set={set} connectionId={connectionId} />
      )}
      {isSource(node.data.kind) &&
        !isDocumentKind(node.data.kind) &&
        !isCdcSource(node.data.kind) &&
        !isSyncSource(node.data.kind) &&
        node.data.kind !== 'source.sap' && (
          <SourceFields params={params} set={set} connectionId={connectionId} />
        )}
      {node.data.kind === 'transform.filter' && <FilterFields params={params} set={set} />}
      {node.data.kind === 'transform.map' && <MapFields params={params} set={set} />}
      {node.data.kind === 'transform.python' && <PyCodeFields params={params} set={set} />}
      {node.data.kind === 'logic.switch' && <SwitchFields params={params} set={set} />}
      {node.data.kind === 'target.db' && (
        <TargetDbFields params={params} set={set} connectionId={connectionId} />
      )}
      {node.data.kind === 'target.mongo' && (
        <MongoTargetFields params={params} set={set} connectionId={connectionId} />
      )}
      {node.data.kind === 'target.response' && <ResponseFields params={params} set={set} />}
      {node.data.kind === 'target.s3' && <TargetS3Fields params={params} set={set} />}
      {node.data.kind === 'target.file' && <TargetFileFields params={params} set={set} />}
      {node.data.kind === 'note.memo' && <MemoFields params={params} set={set} />}
      {node.data.kind === 'note.group' && <GroupFields params={params} set={set} />}

      <div className="cfoot">
        <button className="btn danger" onClick={() => removeNode(node.id)}>
          <Icon.trash />
          노드 삭제
        </button>
      </div>
    </>
  )
}

type FieldProps = { params: Record<string, unknown>; set: (patch: Record<string, unknown>) => void }

function TriggerFields({ kind, params, set }: FieldProps & { kind: string }) {
  if (kind === 'trigger.cdc') {
    return (
      <div className="field">
        <div className="hint">
          CDC 트리거는 파이프라인을 <b>상시 스트리밍</b>으로 표시합니다. 별도 설정은 없으며,
          저장 후 [스트림 시작] 버튼으로 켜고 [모니터] Streams 탭에서 상태를 봅니다.
          배치 트리거(스케줄·수동)와 같은 파이프라인에 섞을 수 없습니다.
        </div>
      </div>
    )
  }
  if (kind === 'trigger.sync') {
    return (
      <div className="field">
        <div className="hint">
          실시간 동기화 트리거는 파이프라인을 <b>상시 복제</b>로 표시합니다. 별도 설정은 없으며,
          저장 후 [동기화 시작] 버튼으로 켜고 [모니터] 스트림 탭에서 상태를 봅니다.
          데이터가 워커를 지나지 않으므로 <b>변환 노드를 둘 수 없습니다</b> — 소스와 타깃을
          바로 이으세요.
        </div>
      </div>
    )
  }
  if (kind === 'trigger.api') {
    return <ApiTriggerFields params={params} set={set} />
  }
  if (kind !== 'trigger.schedule') {
    return (
      <div className="field">
        <div className="hint">수동 트리거는 별도 설정이 없습니다. 실행 버튼으로 시작합니다.</div>
      </div>
    )
  }
  return (
    <>
      <div className="field">
        <label>실행 주기 (Cron)</label>
        <input
          value={String(params.cron ?? '')}
          placeholder="0 2 * * *"
          onChange={(e) => set({ cron: e.target.value })}
        />
        <div className="hint">분 시 일 월 요일 · 예) 0 2 * * * = 매일 02:00</div>
      </div>
      <div className="field">
        <label>타임존</label>
        <select value={String(params.timezone ?? 'Asia/Seoul')} onChange={(e) => set({ timezone: e.target.value })}>
          <option>Asia/Seoul</option>
          <option>UTC</option>
        </select>
        <div className="hint">
          실제 스케줄은 파이프라인 설정의 cron 을 따릅니다. 상단 [저장] 시 함께 반영됩니다.
        </div>
      </div>
    </>
  )
}

/** 응답 노드 설정 — 호출자에게 무엇을, 얼마나 돌려줄지.
 *
 * 이 노드는 스트리밍 원칙의 **의도된 예외**다. 다른 타깃은 배치를 받는 즉시 흘려보내
 * 메모리를 상수로 유지하지만, 응답은 전부 모여야 한 번에 돌려줄 수 있다. 그래서
 * `max_rows` 상한이 필수다 — 없으면 큰 테이블 하나가 워커를 통째로 삼킨다.
 */
function ResponseFields({ params, set }: FieldProps) {
  const columns: string[] = Array.isArray(params.columns) ? (params.columns as string[]) : []
  const [draft, setDraft] = useState('')

  const add = () => {
    const name = draft.trim()
    if (!name || columns.includes(name)) return
    set({ columns: [...columns, name] })
    setDraft('')
  }

  return (
    <>
      <div className="field">
        <div className="hint">
          이 노드에 흘러온 데이터를 <b>API 호출자에게 돌려줍니다.</b> 어디에도 적재하지 않으므로
          연결이 필요 없습니다. API 트리거로 호출하면 실행이 끝날 때까지 기다렸다가 결과를
          응답 본문으로 받습니다.
        </div>
      </div>

      <div className="field">
        <label>최대 행 수</label>
        <input
          type="number"
          min={1}
          max={10000}
          value={String(params.max_rows ?? 100)}
          onChange={(e) => set({ max_rows: Number(e.target.value) })}
        />
        <div className="hint">
          응답은 행을 메모리에 모으므로 상한이 필요합니다 (최대 10,000). 넘치면 잘라서
          돌려주고 <code>truncated: true</code> 로 알립니다 — 조용히 자르지 않습니다.
        </div>
      </div>

      <div className="field">
        <label>돌려줄 컬럼</label>
        {columns.length === 0 ? (
          <div className="hint">
            비워두면 <b>들어온 컬럼을 전부</b> 돌려줍니다. 외부에 무엇을 노출할지 정하려면
            컬럼을 골라 넣으세요.
          </div>
        ) : (
          <div className="respcols">
            {columns.map((c) => (
              <span className="respcol" key={c}>
                <code>{c}</code>
                <button
                  onClick={() => set({ columns: columns.filter((x) => x !== c) })}
                  aria-label={`${c} 제거`}
                  title="제거"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="hook-new" style={{ marginTop: 8 }}>
          <input
            value={draft}
            placeholder="컬럼명"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <button className="btn sm" onClick={add} disabled={!draft.trim()}>
            <Icon.plus />
            추가
          </button>
        </div>
        <div className="hint">
          <b>행</b>을 걸러내려면 상류에 [변환 &gt; 필터] 노드를 두세요. 여기서 고르는 것은
          <b> 컬럼</b>입니다.
        </div>
      </div>
    </>
  )
}

/** 편집기 왼쪽 패널에 띄울 자리표시자 목록 — 트리거 변수 + 노드 결과 참조.
 *
 * 트리거 변수의 선언은 캔버스의 API 트리거 노드에서, 값은 마지막 테스트 실행에서 가져온다.
 * 아직 돌린 적이 없으면 선언된 예시 값을 대신 보여주고 그렇다고 표시한다 — 예시를 실측처럼
 * 보여주면 "이 값으로 돈다"고 오해한다.
 *
 * 노드 결과는 결과 서랍과 같은 것을 본다. **자기 자신은 뺀다** — 자기 결과를 자기 설정에
 * 꽂는 것은 순환이라 저장 시점에 거절된다. 목록에 두면 눌러 볼 수밖에 없다.
 */
function useEditorVariables(): EditorVariable[] {
  const nodes = useCanvasStore((s) => s.nodes)
  const runVariables = useCanvasStore((s) => s.runVariables)
  const nodeResults = useCanvasStore((s) => s.nodeResults)
  // 설정 패널은 언제나 선택된 노드를 편집한다 — 그것이 "자기 자신"이다
  const selfNodeId = useCanvasStore((s) => s.selectedId)

  const declared = nodes
    .filter((n) => n.data.kind === 'trigger.api')
    .flatMap((n) =>
      Array.isArray(n.data.params.variables) ? (n.data.params.variables as TriggerVariable[]) : [],
    )
    .filter((v) => v.name)

  const triggerVars: EditorVariable[] = declared.map((v) => {
    const actual = runVariables[v.name]
    if (actual !== undefined) {
      return { name: v.name, type: v.type, value: actual, isExample: false, source: 'trigger' }
    }
    return {
      name: v.name,
      type: v.type,
      value: v.example ?? v.default ?? null,
      isExample: v.example != null || v.default != null,
      source: 'trigger',
    }
  })

  // 트리거가 넘긴 값은 위 목록(선언된 변수)에 이미 있다 — 여기 또 넣으면 같은 값이 두 줄로
  // 뜨고, 게다가 표기가 달라(`$since` ↔ `${웹훅.since}`) 쓸 수 없는 쪽을 누르게 된다.
  const nodeVars: EditorVariable[] = resultEntries(nodes, nodeResults)
    .filter(
      (entry) =>
        entry.nodeId !== selfNodeId && !isTarget(entry.kind) && !isTrigger(entry.kind),
    )
    .flatMap((entry) => {
      const first = entry.sample.rows[0] ?? {}
      const columns = entry.sample.columns.length ? entry.sample.columns : Object.keys(first)
      const multiRow = entry.sample.rows.length > 1 || entry.sample.truncated
      return columns.flatMap((column) => {
        const scalar: EditorVariable = {
          name: `${entry.label}.${column}`,
          type: '첫 행',
          value: scalarOrNull(first[column]),
          isExample: false,
          insert: nodeRefText({ node: entry.label, column }),
          source: 'node' as const,
        }
        if (!multiRow) return [scalar]
        // 여러 행이면 `IN (...)` 자리에 쓸 목록 표기도 함께 준다
        return [
          scalar,
          {
            ...scalar,
            name: `${entry.label}.${column}[]`,
            type: '모든 행',
            value: entry.sample.rows
              .slice(0, 3)
              .map((r) => String(r[column] ?? '∅'))
              .join(', '),
            insert: nodeRefText({ node: entry.label, column, many: true }),
          },
        ]
      })
    })

  return [...triggerVars, ...nodeVars]
}

/** 편집기 패널이 보여줄 수 있는 값만 남긴다 (중첩 객체는 미리보기로 의미가 없다) */
function scalarOrNull(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return JSON.stringify(value)
  return value as string | number | boolean
}

/** API 트리거 설정 — 호출 본문으로 받을 변수를 선언한다.
 *
 * 선언이 곧 계약이다. 여기 없는 `$이름` 을 다른 노드가 쓰면 저장 시점에 에러로 잡히고,
 * 여기 있는 이름은 테스트 실행 화면이 예시 값으로 미리 채운다.
 */
function ApiTriggerFields({ params, set }: FieldProps) {
  const vars: TriggerVariable[] = Array.isArray(params.variables)
    ? (params.variables as TriggerVariable[])
    : []

  const patch = (index: number, changes: Partial<TriggerVariable>) =>
    set({ variables: vars.map((v, i) => (i === index ? { ...v, ...changes } : v)) })

  const add = () =>
    set({
      variables: [...vars, { name: '', type: 'string', required: true, example: '', description: '' }],
    })

  const remove = (index: number) => set({ variables: vars.filter((_, i) => i !== index) })

  return (
    <>
      <div className="field">
        <div className="hint">
          외부에서 <b>REST 호출</b>로 이 파이프라인을 실행합니다. 호출 본문(JSON)의 값이 아래
          변수로 들어오고, 다른 노드에서 <code>$이름</code> 으로 씁니다 — 예){' '}
          <code>WHERE updated_at &gt;= &apos;$since&apos;</code>. 저장하면 상단 [API] 버튼에서
          호출 주소·토큰과 테스트 실행을 볼 수 있습니다.
        </div>
      </div>

      <div className="field">
        <label>입력 변수</label>
        {vars.length === 0 && (
          <div className="hint">
            아직 변수가 없습니다. 값을 받지 않고 실행만 시키는 창구라면 그대로 두어도 됩니다.
          </div>
        )}

        <div className="varlist">
          {vars.map((v, i) => (
            <div className="varrow" key={i}>
              <div className="varhead">
                <span className="vardollar">$</span>
                <input
                  className="varname"
                  value={String(v.name ?? '')}
                  placeholder="변수명 (영문/숫자/_)"
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
                <select
                  value={String(v.type ?? 'string')}
                  onChange={(e) => patch(i, { type: e.target.value as TriggerVariable['type'] })}
                >
                  <option value="string">문자</option>
                  <option value="number">숫자</option>
                  <option value="boolean">참/거짓</option>
                </select>
                <button
                  className="btn sm danger"
                  title="변수 삭제"
                  aria-label={`${v.name || '이름 없는 변수'} 삭제`}
                  onClick={() => remove(i)}
                >
                  <Icon.trash />
                </button>
              </div>

              <div className="varopts">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={v.required !== false}
                    onChange={(e) => patch(i, { required: e.target.checked })}
                  />
                  필수
                </label>
                {v.required === false && (
                  <input
                    className="vardefault"
                    value={String(v.default ?? '')}
                    placeholder="기본값 (없으면 실행 실패)"
                    onChange={(e) => patch(i, { default: e.target.value })}
                  />
                )}
                <input
                  className="varexample"
                  value={String(v.example ?? '')}
                  placeholder="예시 값 (테스트에 사용)"
                  onChange={(e) => patch(i, { example: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <button className="btn sm" onClick={add} style={{ marginTop: 8 }}>
          <Icon.plus />
          변수 추가
        </button>
      </div>

      {vars.length > 0 && (
        <div className="field">
          <label>호출 본문 예시</label>
          <pre className="codeblock">{samplePayload(vars)}</pre>
          <div className="hint">
            값이 없으면 실행을 <b>실패시킵니다</b>. 빈 값으로 넘기면{' '}
            <code>WHERE dt &gt; &apos;&apos;</code> 같은 조건이 되어 전체 재적재가 조용히
            일어나기 때문입니다.
          </div>
        </div>
      )}

      <WebhookFields vars={vars} />
    </>
  )
}

/** 외부 호출 창구(웹훅) 관리 — 토큰 발급·중지·삭제와 호출 예시.
 *
 * 토큰 원문은 **발급 응답에만** 온다. 서버는 해시만 저장하므로 다시 만들어낼 수 없다 —
 * 그래서 발급 직후 화면에서 놓치지 않도록 따로 띄우고, 목록에는 앞 8자만 남긴다.
 */
function WebhookFields({ vars }: { vars: TriggerVariable[] }) {
  const { pipelineId } = useParams<{ pipelineId: string }>()
  const { data: triggers = [], isLoading } = useTriggers(pipelineId)
  const create = useCreateTrigger(pipelineId)
  const setEnabled = useSetTriggerEnabled(pipelineId)
  const remove = useDeleteTrigger(pipelineId)

  const [name, setName] = useState('')
  const [issued, setIssued] = useState<TriggerCreated | null>(null)
  const [error, setError] = useState<string | null>(null)

  const issue = async () => {
    setError(null)
    try {
      setIssued(await create.mutateAsync({ name: name.trim() || '기본' }))
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '발급에 실패했습니다')
    }
  }

  return (
    <>
      <div className="field">
        <label>외부 호출 창구</label>
        <div className="hint">
          외부 시스템이 이 주소로 POST 하면 파이프라인이 실행됩니다. 로그인 없이 <b>토큰</b>만으로
          호출하므로, 토큰은 비밀번호처럼 다루세요.
        </div>

        {error && <Banner kind="error">{error}</Banner>}
        {isLoading && <div className="hint">불러오는 중…</div>}

        {triggers.length > 0 && (
          <div className="hook-list">
            {triggers.map((t) => (
              <div className={`hook-row ${t.enabled ? '' : 'off'}`} key={t.id}>
                <div className="hook-meta">
                  <span className="hook-name">{t.name}</span>
                  <code className="hook-prefix">{t.token_prefix}…</code>
                </div>
                <div className="hook-stat">
                  {t.call_count > 0 ? `${t.call_count.toLocaleString()}회 호출` : '호출 없음'}
                  {t.last_called_at && ` · ${formatDateTime(t.last_called_at)}`}
                </div>
                <div className="hook-actions">
                  <button
                    className="btn sm"
                    onClick={() => setEnabled.mutate({ id: t.id, enabled: !t.enabled })}
                    title={t.enabled ? '호출을 잠시 막습니다' : '다시 받습니다'}
                  >
                    {t.enabled ? '중지' : '재개'}
                  </button>
                  <button
                    className="btn sm danger"
                    onClick={() => remove.mutate(t.id)}
                    title="이 토큰을 폐기합니다 (되돌릴 수 없음)"
                    aria-label={`${t.name} 창구 삭제`}
                  >
                    <Icon.trash />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="hook-new">
          <input
            value={name}
            placeholder="창구 이름 (예: 주문시스템)"
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn sm" onClick={issue} disabled={create.isPending}>
            <Icon.plus />
            발급
          </button>
        </div>
      </div>

      {issued && (
        <div className="field">
          <Banner kind="warn">
            토큰은 <b>지금 한 번만</b> 보입니다. 서버는 해시만 저장하므로 다시 볼 수 없습니다 —
            지금 복사해 두세요.
          </Banner>
          <pre className="codeblock">{curlExample(issued, vars)}</pre>
          <div className="hint">
            토큰을 URL 대신 <code>X-EAI-Token</code> 헤더로 보내면 액세스 로그·프록시에 남지
            않습니다. 위 예시가 그 방식입니다.
          </div>
          <button className="btn sm" onClick={() => setIssued(null)} style={{ marginTop: 8 }}>
            복사했습니다 — 닫기
          </button>
        </div>
      )}
    </>
  )
}

/** 그대로 붙여 쓸 수 있는 호출 예시. 헤더 방식을 보여준다 — 토큰이 로그에 안 남는 쪽이라. */
function curlExample(issued: TriggerCreated, vars: TriggerVariable[]): string {
  const base = issued.url.replace(/\/hooks\/.*$/, '/hooks')
  return [
    `curl -X POST ${base} \\`,
    `  -H 'X-EAI-Token: ${issued.token}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${samplePayload(vars).replace(/\s+/g, ' ')}'`,
  ].join('\n')
}

/** 선언된 변수로 호출 본문 예시를 만든다. 예시 값이 있으면 그걸, 없으면 타입별 자리표시자를 쓴다. */
function samplePayload(vars: TriggerVariable[]): string {
  const body: Record<string, unknown> = {}
  for (const v of vars) {
    if (!v.name) continue
    const example = v.example ?? ''
    if (v.type === 'number') body[v.name] = example === '' ? 0 : Number(example)
    else if (v.type === 'boolean') body[v.name] = example === '' ? false : example === 'true'
    else body[v.name] = example === '' ? '값' : String(example)
  }
  return JSON.stringify(body, null, 2)
}

function SourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const editorVariables = useEditorVariables()
  const { data: schema, isLoading, isError } = useConnectionSchema(connectionId)
  const tables = schema?.tables ?? []
  const selected = tables.find((t) => t.name === params.table && t.namespace === params.namespace)
  const useQuery = Boolean(params.query)

  // 테이블 고르기 방식 — 목록(스키마 필터+검색) / 트리(스키마→테이블 펼치기)
  const [tableView, setTableView] = useState<'list' | 'tree'>('list')
  const [sqlExpanded, setSqlExpanded] = useState(false)
  // 스키마별 조회 — 스키마를 고르면 그 스키마의 테이블만 목록에 나온다. '' = 전체.
  const [schemaSel, setSchemaSel] = useState(() => String(params.namespace ?? ''))
  const schemaCounts = new Map<string, number>()
  for (const t of tables) schemaCounts.set(t.namespace ?? '', (schemaCounts.get(t.namespace ?? '') ?? 0) + 1)
  const schemaOptions: SelectOption[] = [
    { value: '', label: '전체 스키마', hint: String(tables.length) },
    ...[...schemaCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ns, n]): SelectOption => ({ value: ns, label: ns || '(기본)', hint: String(n) })),
  ]
  const visibleTables = schemaSel ? tables.filter((t) => (t.namespace ?? '') === schemaSel) : tables

  return (
    <>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={useQuery}
            onChange={(e) =>
              set(
                e.target.checked
                  ? { table: undefined, namespace: undefined, query: 'SELECT *\nFROM ' }
                  : { query: undefined },
              )
            }
          />
          커스텀 SQL 사용
        </label>
      </div>

      {useQuery ? (
        <div className="field">
          <div className="code-field-head">
            <label>SQL</label>
            <button className="btn sm" onClick={() => setSqlExpanded(true)} title="큰 화면에서 편집">
              <Icon.expand />
              크게 편집
            </button>
          </div>
          <Suspense fallback={<div className="code-loading">에디터를 불러오는 중…</div>}>
            <SqlEditor
              value={String(params.query ?? '')}
              onChange={(v) => set({ query: v })}
              height="180px"
              completion={tables}
            />
          </Suspense>
          <div className="hint">
            소스에서 실행할 <code>SELECT</code> 문입니다. 커스텀 SQL 모드에서는 증분 워터마크가
            적용되지 않습니다 — 전량을 읽습니다.
          </div>
          {sqlExpanded && (
            <Suspense fallback={null}>
              <SqlModal
                value={String(params.query ?? '')}
                onChange={(v) => set({ query: v })}
                onClose={() => setSqlExpanded(false)}
                connectionId={connectionId}
                tables={tables}
                loading={isLoading}
                variables={editorVariables}
              />
            </Suspense>
          )}
        </div>
      ) : (
        <>
          <div className="field">
            <div className="code-field-head">
              <label>테이블</label>
              <div className="mode-seg" role="group" aria-label="테이블 보기 방식">
                <button
                  className={`mode-seg-btn ${tableView === 'list' ? 'active' : ''}`}
                  onClick={() => setTableView('list')}
                >
                  목록
                </button>
                <button
                  className={`mode-seg-btn ${tableView === 'tree' ? 'active' : ''}`}
                  onClick={() => setTableView('tree')}
                >
                  트리
                </button>
              </div>
            </div>
            {isError && <div className="hint">스키마를 읽지 못했습니다. 연결 상태를 확인하세요.</div>}

            {tableView === 'tree' ? (
              <SchemaTableTree
                tables={tables}
                value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
                loading={isLoading}
                onChange={(v) => {
                  const [namespace, name] = v.split('|')
                  set({ namespace: namespace || undefined, table: name || undefined })
                }}
              />
            ) : (
              <>
                <SearchSelect
                  value={schemaSel}
                  onChange={(v) => {
                    setSchemaSel(v)
                    if (v && params.namespace && params.namespace !== v) {
                      set({ namespace: undefined, table: undefined })
                    }
                  }}
                  options={schemaOptions}
                  disabled={!connectionId || tables.length === 0}
                  loading={isLoading}
                  placeholder="스키마 선택 또는 검색…"
                  emptyText="스키마가 없습니다"
                />
                <div style={{ height: 7 }} />
                <SearchSelect
                  value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
                  onChange={(v) => {
                    const [namespace, name] = v.split('|')
                    set({ namespace: namespace || undefined, table: name || undefined })
                  }}
                  options={visibleTables.map((t) => ({
                    value: `${t.namespace ?? ''}|${t.name}`,
                    label: schemaSel ? t.name : t.qualified_name,
                  }))}
                  disabled={!connectionId}
                  loading={isLoading}
                  placeholder={connectionId ? '테이블 선택 또는 검색…' : '먼저 연결을 고르세요'}
                  emptyText="일치하는 테이블이 없습니다"
                />
              </>
            )}
          </div>

          <div className="field">
            <label>증분 컬럼 (watermark)</label>
            <SearchSelect
              value={String(params.incremental_column ?? '')}
              onChange={(v) => set({ incremental_column: v || undefined })}
              options={[
                { value: '', label: '— 전체 적재 —' },
                ...(selected?.columns.map(
                  (c): SelectOption => ({ value: c.name, label: c.name, hint: c.data_type }),
                ) ?? []),
              ]}
              disabled={!selected}
              placeholder="— 전체 적재 —"
              emptyText="컬럼이 없습니다"
            />
            <div className="hint">
              지정하면 이 컬럼이 마지막 실행값보다 큰 행만 읽습니다 (updated_at, id 등).
            </div>
          </div>
        </>
      )}

      <div className="field">
        <label>배치 크기</label>
        <input
          type="number"
          min={1}
          value={Number(params.batch_size ?? 5000)}
          onChange={(e) => set({ batch_size: Number(e.target.value) || 5000 })}
        />
        <div className="hint">한 번에 읽어 흘려보낼 행 수. 클수록 빠르지만 메모리를 더 씁니다.</div>
      </div>
    </>
  )
}

/** CDC 소스 — 실시간 변경 수집 (기획안 §5.2).
 *
 * 배치 소스와 달리 read() 로 당기지 않는다. 여기서 정한 값은 Debezium 커넥터 설정으로
 * 옮겨진다: 캡처 테이블 → table.include.list, 스냅샷 → snapshot.mode,
 * 삭제 처리 → ExtractNewRecordState SMT. 백엔드 검증 규칙(dag.py _cdc_source_issues)과 짝이다.
 */
function CdcSourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const { data: schema, isLoading, isError } = useConnectionSchema(connectionId)
  const tables = schema?.tables ?? []
  const selected = asArray<string>(params.tables)
  const snapshot = String(params.snapshot ?? 'initial')
  const deleteMode = String(params.delete_mode ?? 'soft')

  // 스키마 목록에 있으면 정규화 이름(namespace.name), 없으면 직접 입력값을 그대로 쓴다
  const nameOf = (t: { namespace: string | null; name: string }) =>
    t.namespace ? `${t.namespace}.${t.name}` : t.name

  return (
    <>
      <div className="field">
        <label>캡처할 테이블 {selected.length > 0 ? `(${selected.length}개)` : ''}</label>
        {isLoading && <div className="hint">테이블을 불러오는 중…</div>}
        {isError && <div className="hint">스키마를 읽지 못했습니다. 연결·CDC 전제조건을 확인하세요.</div>}
        {tables.length > 0 ? (
          <select
            multiple
            size={Math.min(8, Math.max(3, tables.length))}
            value={selected}
            onChange={(e) =>
              set({ tables: Array.from(e.target.selectedOptions, (o) => o.value), table: undefined })
            }
          >
            {tables.map((t) => (
              <option key={t.qualified_name} value={nameOf(t)}>
                {t.qualified_name}
              </option>
            ))}
          </select>
        ) : (
          <textarea
            rows={3}
            placeholder={'orders\ncustomers'}
            value={selected.join('\n')}
            onChange={(e) =>
              set({
                tables: e.target.value
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
                table: undefined,
              })
            }
          />
        )}
        <div className="hint">
          변경을 실시간으로 잡아낼 테이블입니다. 최소 1개가 필요합니다.
          {tables.length === 0 && ' 목록을 못 불러오면 한 줄에 하나씩 직접 입력하세요.'}
        </div>
      </div>

      <div className="field">
        <label>초기 스냅샷</label>
        <select value={snapshot} onChange={(e) => set({ snapshot: e.target.value })}>
          <option value="initial">initial — 기존 데이터를 먼저 전량 적재 후 변경 추적</option>
          <option value="never">never — 지금 이후 변경만 추적</option>
          <option value="when_needed">when_needed — 필요할 때만 스냅샷</option>
        </select>
        <div className="hint">
          {snapshot === 'initial' && '처음 켤 때 테이블 전체를 한 번 읽고 이후 변경분을 잇습니다.'}
          {snapshot === 'never' &&
            '과거 데이터는 건너뛰고 켠 시점 이후의 변경만 반영합니다. SQL Server 는 no_data 로 대체됩니다.'}
          {snapshot === 'when_needed' &&
            'PostgreSQL 은 이 모드가 없어 initial 로 대체됩니다.'}
        </div>
      </div>

      <div className="field">
        <label>삭제(DELETE) 이벤트 처리</label>
        <select value={deleteMode} onChange={(e) => set({ delete_mode: e.target.value })}>
          <option value="soft">soft — __deleted 플래그로 표시 (기본·안전)</option>
          <option value="hard">hard — 타깃에서도 실제 삭제</option>
          <option value="ignore">ignore — 삭제 이벤트 무시</option>
        </select>
        <div className="hint">
          {deleteMode === 'soft' &&
            '삭제된 행을 지우지 않고 __deleted=true 로 남깁니다. 이력 보존에 안전합니다.'}
          {deleteMode === 'hard' &&
            '소스에서 지워지면 타깃에서도 지웁니다. upsert 타깃 + 키 컬럼이 필요합니다.'}
          {deleteMode === 'ignore' && '삽입·수정만 반영하고 삭제는 흘려보냅니다.'}
        </div>
      </div>
    </>
  )
}

/** 실시간 동기화 대상 테이블 한 줄. 백엔드 dag.py `_sync_source_issues` 와 짝이다. */
type SyncTableRow = {
  name?: string
  namespace?: string
  channel?: string
  initial_load_order?: number
  row_filter?: string
}

/** 동기화 소스 설정 — 테이블마다 **전송 정책**이 붙는 것이 배치·CDC 와 다른 점이다.
 *
 * CDC 는 테이블 목록만 있으면 되지만, SymmetricDS 는 채널(우선순위)·초기 적재 순서·행 필터가
 * 테이블별로 달라야 한다. 대량 배치가 몰리는 테이블을 실시간 채널에 넣으면 그 한 번이
 * 채널을 점유해 재고·출고의 실시간성을 통째로 망치기 때문이다.
 */
function SyncSourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const { data: schema, isLoading } = useConnectionSchema(connectionId)
  const catalog = schema?.tables ?? []
  const rows = asArray<SyncTableRow>(params.tables)
  const namespace = String(params.namespace ?? 'dbo')
  const purpose = String(params.purpose ?? 'readonly')

  const update = (index: number, patch: Partial<SyncTableRow>) =>
    set({ tables: rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) })
  const add = (name = '') =>
    set({ tables: [...rows, { name, channel: 'standard', initial_load_order: 100 }] })

  const chosen = new Set(rows.map((r) => String(r.name ?? '').toLowerCase()))
  const unused = catalog.filter((t) => !chosen.has(t.name.toLowerCase()))

  return (
    <>
      <div className="field">
        <label>소스 스키마</label>
        <input
          value={namespace}
          placeholder="dbo"
          onChange={(e) => set({ namespace: e.target.value })}
        />
        <div className="hint">테이블마다 따로 적지 않으면 이 스키마를 씁니다.</div>
      </div>

      <div className="field">
        <label>SymmetricDS 설정 DB (선택)</label>
        <input
          value={String(params.sync_database ?? '')}
          placeholder="비우면 소스와 같은 DB"
          onChange={(e) => set({ sync_database: e.target.value })}
        />
        <div className="hint">
          SymmetricDS 는 자기 테이블 <b>45개</b>를 만듭니다. 여기에 DB 이름을 적으면 업무 DB
          대신 그쪽에 만들어져 <b>dbo 가 깨끗해집니다.</b> 동기화 대상이 1개든 200개든 45개로
          고정입니다. <b>같은 인스턴스</b>여야 하고, 그 DB 에 테이블 생성 권한이 필요합니다.
          트리거는 그래도 업무 테이블에 붙고, 이 DB 가 꽉 차면 업무 쓰기가 실패하므로
          장애가 격리되는 것은 아닙니다.
        </div>
      </div>

      <div className="field">
        <label>동기화할 테이블 {rows.length > 0 ? `(${rows.length}개)` : ''}</label>
        {isLoading && <div className="hint">테이블을 불러오는 중…</div>}
        {rows.map((row, index) => (
          <div className="sync-row" key={index}>
            <input
              placeholder="테이블명"
              list="sync-table-list"
              value={String(row.name ?? '')}
              onChange={(e) => update(index, { name: e.target.value })}
            />
            <select
              value={String(row.channel ?? 'standard')}
              onChange={(e) => update(index, { channel: e.target.value })}
              title="전송 채널"
            >
              {SYNC_CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="narrow"
              title="초기 적재 순서 — 작을수록 먼저"
              value={String(row.initial_load_order ?? 100)}
              onChange={(e) => update(index, { initial_load_order: Number(e.target.value) })}
            />
            <button
              className="rm"
              title="테이블 제외"
              onClick={() => set({ tables: rows.filter((_, i) => i !== index) })}
            >
              ×
            </button>
            <input
              className="wide"
              placeholder="행 필터 (선택) — 예) c.WAREHOUSE_CD = 'WH01'"
              value={String(row.row_filter ?? '')}
              onChange={(e) => update(index, { row_filter: e.target.value })}
            />
          </div>
        ))}
        <datalist id="sync-table-list">
          {unused.map((t) => (
            <option key={t.qualified_name} value={t.name} />
          ))}
        </datalist>
        <button className="btn ghost" onClick={() => add()}>
          <Icon.plus />
          테이블 추가
        </button>
        <div className="hint">
          채널은 전송 단위이자 우선순위입니다. <b>대량 배치가 발생하는 테이블을 실시간 채널에
          넣지 마세요</b> — 한 번의 대량 작업이 채널을 점유해 다른 테이블의 실시간성을 망칩니다.
          숫자는 초기 적재 순서로, FK 의존을 고려해 마스터 테이블을 작은 값으로 둡니다.
        </div>
      </div>

      <div className="field">
        <label>복제 데이터의 최종 용도</label>
        <select value={purpose} onChange={(e) => set({ purpose: e.target.value })}>
          {SYNC_PURPOSES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {purpose === 'operational' && (
          <div className="hint warn">
            복제본은 아무리 빨라도 원본과 <b>순간적으로 다를 수 있습니다.</b> 출고·재고 판단에
            쓰면 이중 출고 같은 사고로 이어집니다 — 원본 직접 조회나 API 연동이 맞는지 먼저
            확인하세요.
          </div>
        )}
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(params.initial_load ?? true)}
            onChange={(e) => set({ initial_load: e.target.checked })}
          />
          시작할 때 기존 데이터를 전량 적재
        </label>
        <div className="hint">
          끄면 켠 시점 이후의 변경만 반영됩니다. 운영계는 업무 저부하 시간대에 켜세요.
        </div>
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(params.load_test_ack)}
            onChange={(e) => set({ load_test_ack: e.target.checked })}
          />
          부하 테스트를 마쳤습니다
        </label>
        <div className="hint">
          동기화를 켜면 <b>원본 테이블에 트리거가 생겨</b> 쓰기 트랜잭션이 느려집니다. 현장에서
          스캐너로 실시간 처리하는 시스템이라면 응답 지연이 파이프라인 지연보다 훨씬 민감합니다.
          현장 스캔 응답이 0.3초 이상 느려지면 재검토하세요. 이 확인이 없어도 시작은 되지만
          점검 결과에 경고가 남습니다 — <b>운영 적용 전에는 필수</b>입니다.
        </div>
      </div>
    </>
  )
}

/** 동기화 타깃 설정 — 테이블명 매핑이 전부다.
 *
 * PostgreSQL 은 인용하지 않은 식별자를 소문자로 접는다(`INVENTORY` → `inventory`). 비워 두면
 * 서버가 소문자로 확정하지만, 무엇으로 들어갔는지 보이는 편이 낫다 — [소스에서 가져오기]가
 * 그 목록을 그대로 채워 준다.
 */
function SyncTargetFields({ params, set }: FieldProps) {
  const nodes = useCanvasStore((s) => s.nodes)
  const source = nodes.find((n) => isSyncSource(n.data.kind))
  const sourceTables = asArray<SyncTableRow>(source?.data.params.tables)
  const mappings = asArray<{ source_table?: string; target_table?: string; target_namespace?: string }>(
    params.table_mappings,
  )
  const namespace = String(params.namespace ?? 'public')

  const mapped = new Set(mappings.map((m) => String(m.source_table ?? '').toLowerCase()))
  const missing = sourceTables
    .map((t) => String(t.name ?? '').trim())
    .filter((n) => n && !mapped.has(n.toLowerCase()))

  const update = (index: number, patch: Record<string, string>) =>
    set({ table_mappings: mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)) })

  return (
    <>
      <div className="field">
        <label>타깃 스키마</label>
        <input
          value={namespace}
          placeholder="public"
          onChange={(e) => set({ namespace: e.target.value })}
        />
      </div>

      <div className="field">
        <label>테이블명 매핑</label>
        {mappings.map((m, index) => (
          <div className="map-row" key={index}>
            <input
              placeholder="소스 테이블"
              value={String(m.source_table ?? '')}
              onChange={(e) => update(index, { source_table: e.target.value })}
            />
            <span className="arrow">→</span>
            <input
              placeholder="타깃 테이블"
              value={String(m.target_table ?? '')}
              onChange={(e) => update(index, { target_table: e.target.value })}
            />
            <button
              className="rm"
              title="매핑 삭제"
              onClick={() => set({ table_mappings: mappings.filter((_, i) => i !== index) })}
            >
              ×
            </button>
          </div>
        ))}
        {missing.length > 0 && (
          <button
            className="btn ghost"
            onClick={() =>
              set({
                table_mappings: [
                  ...mappings,
                  ...missing.map((n) => ({ source_table: n, target_table: n.toLowerCase() })),
                ],
              })
            }
          >
            <Icon.plus />
            소스에서 가져오기 ({missing.length}개)
          </button>
        )}
        <div className="hint">
          PostgreSQL 은 인용하지 않은 식별자를 <b>소문자로 접습니다</b> (INVENTORY → inventory).
          비워 두면 서버가 소문자로 확정하지만, 여기에 적어 두면 무엇으로 들어갔는지 보입니다.
          {sourceTables.length === 0 && ' 소스 노드에서 테이블을 먼저 고르세요.'}
        </div>
      </div>
    </>
  )
}

function FilterFields({ params, set }: FieldProps) {
  const conditions = asArray<Cond>(params.conditions)
  const update = (index: number, patch: Partial<Cond>) =>
    set({ conditions: conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) })

  return (
    <>
      <div className="field">
        <label>결합 방식</label>
        <select value={String(params.match ?? 'all')} onChange={(e) => set({ match: e.target.value })}>
          <option value="all">모든 조건 만족 (AND)</option>
          <option value="any">하나라도 만족 (OR)</option>
        </select>
      </div>
      <div className="field">
        <label>조건</label>
        {conditions.map((cond, index) => (
          <div className="map-row" key={index}>
            <input
              placeholder="컬럼"
              value={String(cond.field ?? '')}
              onChange={(e) => update(index, { field: e.target.value })}
            />
            <select value={cond.op ?? 'eq'} onChange={(e) => update(index, { op: e.target.value })}>
              {FILTER_OPS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              placeholder="값"
              value={cond.value === undefined || cond.value === null ? '' : String(cond.value)}
              onChange={(e) => update(index, { value: e.target.value })}
              disabled={cond.op === 'is_null' || cond.op === 'is_not_null'}
            />
            <button
              className="rm"
              title="조건 삭제"
              onClick={() => set({ conditions: conditions.filter((_, i) => i !== index) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="btn sm"
          onClick={() => set({ conditions: [...conditions, { field: '', op: 'eq', value: '' }] })}
        >
          <Icon.plus />
          조건 추가
        </button>
      </div>
    </>
  )
}

function SwitchFields({ params, set }: FieldProps) {
  const cases = asArray<SwitchCase>(params.cases)
  const updateCase = (index: number, patch: Partial<SwitchCase>) =>
    set({ cases: cases.map((c, i) => (i === index ? { ...c, ...patch } : c)) })
  const updateConds = (index: number, conditions: Cond[]) => updateCase(index, { conditions })
  const addCase = () =>
    set({
      cases: [
        ...cases,
        { id: newCaseId(), label: `분기 ${cases.length + 1}`, match: 'all', conditions: [] },
      ],
    })

  return (
    <div className="switch-cfg">
      <p className="switch-lead">
        각 행을 <b>위에서부터 처음 맞는 분기</b>로 보냅니다.
      </p>

      {cases.map((c, ci) => {
        const conds = asArray<Cond>(c.conditions)
        const setCond = (i: number, patch: Partial<Cond>) =>
          updateConds(ci, conds.map((x, j) => (j === i ? { ...x, ...patch } : x)))
        return (
          <div className="switch-case" key={c.id ?? ci}>
            <div className="switch-case-head">
              <span className="switch-case-no">{ci + 1}</span>
              <input
                className="switch-case-name"
                placeholder={`분기 ${ci + 1}`}
                value={String(c.label ?? '')}
                onChange={(e) => updateCase(ci, { label: e.target.value })}
              />
              <button
                className="switch-case-del"
                title="분기 삭제"
                disabled={cases.length <= 1}
                onClick={() => set({ cases: cases.filter((_, i) => i !== ci) })}
              >
                <Icon.trash />
              </button>
            </div>

            {conds.length === 0 && (
              <p className="switch-empty">조건을 추가하세요. 없으면 모든 행이 이 분기로 갑니다.</p>
            )}
            {conds.map((cond, i) => {
              const nullOp = cond.op === 'is_null' || cond.op === 'is_not_null'
              return (
                <div className="cond" key={i}>
                  <div className="cond-top">
                    <input
                      className="cond-field"
                      placeholder="컬럼명"
                      value={String(cond.field ?? '')}
                      onChange={(e) => setCond(i, { field: e.target.value })}
                    />
                    <button
                      className="cond-del"
                      title="조건 삭제"
                      onClick={() => updateConds(ci, conds.filter((_, j) => j !== i))}
                    >
                      <Icon.trash />
                    </button>
                  </div>
                  <div className="cond-bot">
                    <select
                      className="cond-op"
                      value={cond.op ?? 'eq'}
                      onChange={(e) => setCond(i, { op: e.target.value })}
                    >
                      {FILTER_OPS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {!nullOp && (
                      <input
                        className="cond-val"
                        placeholder="값"
                        value={
                          cond.value === undefined || cond.value === null ? '' : String(cond.value)
                        }
                        onChange={(e) => setCond(i, { value: e.target.value })}
                      />
                    )}
                  </div>
                </div>
              )
            })}

            <div className="switch-case-foot">
              <button
                className="linkbtn"
                onClick={() => updateConds(ci, [...conds, { field: '', op: 'eq', value: '' }])}
              >
                <Icon.plus />
                조건 추가
              </button>
              {conds.length >= 2 && (
                <select
                  className="cond-join"
                  value={String(c.match ?? 'all')}
                  onChange={(e) => updateCase(ci, { match: e.target.value })}
                >
                  <option value="all">모두 만족(AND)</option>
                  <option value="any">하나라도(OR)</option>
                </select>
              )}
            </div>
          </div>
        )
      })}

      <button className="switch-add" onClick={addCase}>
        <Icon.plus />
        분기 추가
      </button>

      <div className="switch-default">
        <span className="switch-default-dot" />
        <span>
          <b>그 외</b> — 위 분기에 하나도 안 맞는 행이 나가는 출력 (자동)
        </span>
      </div>
    </div>
  )
}

function MapFields({ params, set }: FieldProps) {
  const mappings = asArray<Mapping>(params.mappings)
  const update = (index: number, patch: Partial<Mapping>) =>
    set({ mappings: mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)) })

  return (
    <>
      <div className="field">
        <label>필드 매핑</label>
        {mappings.map((mapping, index) => (
          <div className="map-row" key={index}>
            <input
              placeholder="원본"
              value={String(mapping.source ?? '')}
              onChange={(e) => update(index, { source: e.target.value })}
            />
            <span className="ar">→</span>
            <input
              placeholder="대상"
              value={String(mapping.target ?? '')}
              onChange={(e) => update(index, { target: e.target.value })}
            />
            <select value={mapping.cast ?? ''} onChange={(e) => update(index, { cast: e.target.value || undefined })}>
              {CASTS.map((c) => (
                <option key={c} value={c}>
                  {c || '변환없음'}
                </option>
              ))}
            </select>
            <button
              className="rm"
              title="매핑 삭제"
              onClick={() => set({ mappings: mappings.filter((_, i) => i !== index) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="btn sm"
          onClick={() => set({ mappings: [...mappings, { source: '', target: '' }] })}
        >
          <Icon.plus />
          매핑 추가
        </button>
      </div>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={params.drop_unmapped !== false}
            onChange={(e) => set({ drop_unmapped: e.target.checked })}
          />
          매핑에 없는 컬럼 버리기
        </label>
      </div>
    </>
  )
}

/** 코드에서 처리 모드를 감지한다 (백엔드도 함수 이름으로 같은 판별을 한다). */
export function detectPyMode(code: string): 'row' | 'batch' | null {
  if (/^\s*def\s+transform_batch\s*\(/m.test(code)) return 'batch'
  if (/^\s*def\s+transform\s*\(/m.test(code)) return 'row'
  return null
}

/** 커스텀 코드를 덮어써도 안전한가 — 비어 있거나 기본 골격 그대로면 확인 없이 교체한다. */
export function isReplaceablePyCode(code: string): boolean {
  const t = code.trim()
  if (!t) return true
  if (t === DEFAULT_PYCODE.trim() || t === DEFAULT_PYCODE_BATCH.trim()) return true
  return !/^\s*def\s+/m.test(code) // def 가 없으면 주석·빈 골격뿐 → 안전
}

const MODE_LABEL: Record<'row' | 'batch', string> = { row: '행 단위', batch: '배치 단위' }

function scaffoldFor(target: 'row' | 'batch'): string {
  return target === 'batch' ? DEFAULT_PYCODE_BATCH : DEFAULT_PYCODE
}

function PyCodeFields({ params, set }: FieldProps) {
  const [expanded, setExpanded] = useState(false)
  // 커스텀 코드를 덮어쓰기 전 앱 내부 확인 — 네이티브 confirm() 은 브라우저가 막으면
  // 조용히 false 를 돌려줘 토글이 안 먹는 것처럼 보인다.
  const [pendingSwap, setPendingSwap] = useState<'row' | 'batch' | null>(null)
  const code = String(params.code ?? '')
  const setCode = (value: string) => set({ code: value })
  const mode = detectPyMode(code)

  const selectMode = (target: 'row' | 'batch') => {
    if (mode === target) {
      setPendingSwap(null)
      return
    }
    if (isReplaceablePyCode(code)) {
      setCode(scaffoldFor(target)) // 비었거나 기본 골격 — 바로 교체
      setPendingSwap(null)
    } else {
      setPendingSwap(target) // 커스텀 코드 — 인라인 확인 표시
    }
  }

  const confirmSwap = () => {
    if (pendingSwap) setCode(scaffoldFor(pendingSwap))
    setPendingSwap(null)
  }

  return (
    <div className="field">
      <div className="code-field-head">
        <label>Python 코드</label>
        <button className="btn sm" onClick={() => setExpanded(true)} title="큰 화면에서 편집">
          <Icon.expand />
          크게 편집
        </button>
      </div>
      <div className="mode-seg" role="group" aria-label="처리 모드">
        <button
          className={`mode-seg-btn ${mode === 'row' ? 'active' : ''}`}
          onClick={() => selectMode('row')}
          title="각 행마다 transform(row) 호출"
        >
          행 단위
        </button>
        <button
          className={`mode-seg-btn ${mode === 'batch' ? 'active' : ''}`}
          onClick={() => selectMode('batch')}
          title="전체 행을 transform_batch(df) 로 한 번에"
        >
          배치 단위
        </button>
      </div>
      {pendingSwap && (
        <div className="mode-swap-confirm">
          <span>
            작성한 코드를 <b>{MODE_LABEL[pendingSwap]}</b> 골격으로 교체합니다. 되돌릴 수 없어요.
          </span>
          <div className="mode-swap-actions">
            <button className="btn sm" onClick={() => setPendingSwap(null)}>
              취소
            </button>
            <button className="btn sm danger" onClick={confirmSwap}>
              교체
            </button>
          </div>
        </div>
      )}
      <Suspense fallback={<div className="code-loading">에디터를 불러오는 중…</div>}>
        <PyCodeEditor value={code} onChange={setCode} height="220px" />
      </Suspense>
      <div className="hint">
        <strong>행 단위</strong> — <code>transform(row: dict)</code> 가 각 레코드마다 호출됩니다.
        변환한 dict 를 반환하고, <code>None</code> 을 반환하면 그 행은 제외됩니다.
      </div>
      <div className="hint">
        <strong>배치 단위</strong> — <code>transform_batch(df)</code> 를 대신 정의하면 전체 행을
        pandas DataFrame 으로 한 번에 받아 DataFrame 을 반환합니다(groupby·정렬·중복제거 등).
        둘 중 하나만 정의하세요.
      </div>
      <div className="hint">
        코드는 격리된 프로세스에서 실행됩니다 — DB·시크릿·네트워크에 접근할 수 없습니다.
        <code>import pandas as pd</code> 및 표준 모듈 일부(datetime·re·json·math·hashlib·decimal
        등)를 쓸 수 있습니다. 값은 JSON 기준으로 정규화됩니다(날짜→ISO 문자열, Decimal→숫자).
      </div>
      {expanded && (
        <Suspense fallback={null}>
          <PyCodeModal value={code} onChange={setCode} onClose={() => setExpanded(false)} />
        </Suspense>
      )}
    </div>
  )
}

type ColEntry = { source: string; target?: string; disabled?: boolean }

function tableNameOf(qualified?: string): string {
  return (qualified ?? '').split('.').pop() ?? ''
}

/** 스키마 응답에서 한 테이블의 컬럼 이름들을 뽑는다. namespace 는 있으면 맞춰서 고른다. */
function columnsOf(
  schema: { tables: { name: string; namespace: string | null; columns: { name: string }[] }[] } | undefined,
  table?: string,
  namespace?: string,
): string[] {
  if (!schema || !table) return []
  const name = tableNameOf(table)
  const t =
    schema.tables.find((x) => x.name === name && (namespace ? x.namespace === namespace : true)) ??
    schema.tables.find((x) => x.name === name)
  return t ? t.columns.map((c) => c.name) : []
}

/** 컬럼 매핑 팝업 (사용자 요청 UX).
 *
 * 좌측 = 소스 테이블 컬럼(전부), 우측 = 타깃 컬럼 select. 비활성화 버튼으로 제외.
 * 설정 안 한 컬럼은 저장하지 않는다 → 엔진이 **동일 이름으로 자동 매칭**한다.
 * 결과는 타깃 노드 params.column_map (list of {source, target?, disabled?}) 으로 저장.
 */
function ColumnMapModal({
  sourceConnId,
  sourceTables,
  targetConnId,
  targetTable,
  targetNamespace,
  value,
  onSave,
  onClose,
}: {
  sourceConnId?: string
  sourceTables: string[]
  targetConnId?: string
  targetTable?: string
  targetNamespace?: string
  value: ColEntry[]
  onSave: (next: ColEntry[]) => void
  onClose: () => void
}) {
  const [srcTable, setSrcTable] = useState(() => sourceTables[0] ?? '')
  const { data: srcSchema, isLoading: srcLoading } = useConnectionSchema(sourceConnId)
  const { data: tgtSchema } = useConnectionSchema(targetConnId)
  const sourceCols = columnsOf(srcSchema, srcTable)
  const targetCols = columnsOf(tgtSchema, targetTable, targetNamespace)

  const [draft, setDraft] = useState<Record<string, ColEntry>>(() =>
    Object.fromEntries(value.map((e) => [e.source, e])),
  )
  const entryOf = (col: string): ColEntry => draft[col] ?? { source: col }
  const setEntry = (col: string, patch: Partial<ColEntry>) =>
    setDraft((d) => ({ ...d, [col]: { ...entryOf(col), source: col, ...patch } }))

  const save = () => {
    const out: ColEntry[] = []
    for (const col of sourceCols) {
      const e = draft[col]
      if (!e) continue
      if (e.disabled) out.push({ source: col, disabled: true })
      else if (e.target && e.target !== col) out.push({ source: col, target: e.target })
      // 그 외(동일 이름) → 저장 안 함 = 엔진이 항등 매칭
    }
    onSave(out)
    onClose()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>컬럼 매핑</h3>
          <button className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '14px 20px' }}>
          {sourceTables.length > 1 && (
            <div className="field">
              <label>소스 테이블</label>
              <select value={srcTable} onChange={(e) => setSrcTable(e.target.value)}>
                {sourceTables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="hint" style={{ marginBottom: 10 }}>
            설정하지 않은 컬럼은 <b>동일 이름</b>으로 자동 저장됩니다. 필요 없는 컬럼은 [비활성화]로 제외하세요.
          </div>

          {srcLoading && <div className="hint">소스 컬럼을 불러오는 중…</div>}
          {!srcLoading && sourceCols.length === 0 && (
            <Banner kind="warn">
              소스 컬럼을 읽지 못했습니다. CDC 소스 연결·테이블을 확인하세요.
            </Banner>
          )}

          <div className="colmap-list">
            {sourceCols.map((col) => {
              const e = entryOf(col)
              const disabled = e.disabled === true
              return (
                <div className={`colmap-row ${disabled ? 'off' : ''}`} key={col}>
                  <span className="colmap-src">{col}</span>
                  <span className="ar">→</span>
                  <select
                    disabled={disabled}
                    value={disabled ? '' : e.target ?? ''}
                    onChange={(ev) => setEntry(col, { target: ev.target.value || undefined, disabled: false })}
                  >
                    <option value="">(동일 이름: {col})</option>
                    {targetCols.map((tc) => (
                      <option key={tc} value={tc}>
                        {tc}
                      </option>
                    ))}
                  </select>
                  <button
                    className={`btn sm ${disabled ? 'danger' : ''}`}
                    onClick={() => setEntry(col, { disabled: !disabled })}
                    title={disabled ? '다시 포함' : '이 컬럼 제외'}
                  >
                    {disabled ? '제외됨' : '비활성화'}
                  </button>
                </div>
              )
            })}
          </div>
          {targetCols.length === 0 && targetTable && (
            <div className="hint" style={{ marginTop: 8 }}>
              타깃 테이블 컬럼을 못 읽었습니다. 직접 이름을 맞추려면 대상 테이블을 먼저 고르세요.
            </div>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={save}>
            <Icon.save />
            적용
          </button>
        </div>
      </div>
    </div>
  )
}

function TargetDbFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  // CDC 파이프라인이면 컬럼 매핑 옵션(팝업)을 추가로 보여준다. 나머지는 기존 단일 테이블 UI 그대로.
  const nodes = useCanvasStore((s) => s.nodes)
  const cdcSource = nodes.find((n) => isCdcSource(n.data.kind))
  const [showColMap, setShowColMap] = useState(false)
  const { data: schema } = useConnectionSchema(connectionId)
  const tables = schema?.tables ?? []
  const selected = tables.find((t) => t.name === params.table && t.namespace === params.namespace)
  const keyColumns = asArray<string>(params.key_columns)
  const mode = String(params.mode ?? 'upsert')
  const colMap = asArray<ColEntry>(params.column_map)

  return (
    <>
      <div className="field">
        <label>대상 테이블</label>
        <select
          value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
          onChange={(e) => {
            const [namespace, name] = e.target.value.split('|')
            set({ namespace: namespace || undefined, table: name || undefined })
          }}
          disabled={tables.length === 0}
        >
          <option value="">— 선택 —</option>
          {tables.map((t) => (
            <option key={t.qualified_name} value={`${t.namespace ?? ''}|${t.name}`}>
              {t.qualified_name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>적재 모드</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="upsert">Upsert (키 기준 갱신)</option>
          <option value="append">Append (단순 추가)</option>
          <option value="overwrite">Overwrite (전체 교체)</option>
        </select>
        <div className="hint">
          {mode === 'upsert' && '재실행해도 결과가 같습니다 (멱등).'}
          {mode === 'append' && '재실행하면 행이 중복될 수 있습니다.'}
          {mode === 'overwrite' && '적재 전에 대상 테이블을 비웁니다.'}
        </div>
      </div>

      {mode === 'upsert' && (
        <div className="field">
          <label>키 컬럼</label>
          {selected ? (
            <select
              multiple
              size={Math.min(6, Math.max(3, selected.columns.length))}
              value={keyColumns}
              onChange={(e) =>
                set({ key_columns: Array.from(e.target.selectedOptions, (o) => o.value) })
              }
            >
              {selected.columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.primary_key ? ' (PK)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              placeholder="id, tenant_id"
              value={keyColumns.join(', ')}
              onChange={(e) =>
                set({
                  key_columns: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          )}
          <div className="hint">이 컬럼들이 같으면 같은 행으로 보고 갱신합니다.</div>
        </div>
      )}

      {cdcSource && (
        <div className="field">
          <label>컬럼 매핑 (옵션)</label>
          <div className="colmap-status">
            <span className={`tag ${colMap.length > 0 ? 'ok' : 'stopped'}`}>
              {colMap.length > 0 ? `● 설정됨 · ${colMap.length}개` : '○ 미설정'}
            </span>
            <button className="btn sm" onClick={() => setShowColMap(true)}>
              <Icon.map />
              {colMap.length > 0 ? '편집' : '설정'}
            </button>
            {colMap.length > 0 && (
              <button
                className="btn sm danger"
                onClick={() => set({ column_map: undefined })}
                title="컬럼 매핑 초기화 (전부 동일 이름으로)"
              >
                초기화
              </button>
            )}
          </div>
          <div className="hint">
            {colMap.length > 0 ? (
              <>
                지정한 컬럼만 이름 변경/제외되고, <b>나머지는 동일 이름으로 자동 저장</b>됩니다.
              </>
            ) : (
              <>
                설정하지 않으면 모든 컬럼이 소스와 <b>동일한 이름</b>으로 자동 저장됩니다.
              </>
            )}
          </div>
        </div>
      )}

      {showColMap && (
        <ColumnMapModal
          sourceConnId={cdcSource ? String(cdcSource.data.params.connection_id ?? '') || undefined : undefined}
          sourceTables={cdcSource ? asArray<string>(cdcSource.data.params.tables) : []}
          targetConnId={connectionId}
          targetTable={params.table ? String(params.table) : undefined}
          targetNamespace={params.namespace ? String(params.namespace) : undefined}
          value={colMap}
          onSave={(next) => set({ column_map: next })}
          onClose={() => setShowColMap(false)}
        />
      )}
    </>
  )
}

function TargetS3Fields({ params, set }: FieldProps) {
  return (
    <>
      <div className="field">
        <label>경로 prefix</label>
        <input
          placeholder="raw/customers"
          value={String(params.path_prefix ?? '')}
          onChange={(e) => set({ path_prefix: e.target.value })}
        />
        <div className="hint">실제 경로는 prefix/run_id=&lt;실행ID&gt;/part-00000.parquet 입니다.</div>
      </div>
      <div className="field">
        <label>파일 포맷</label>
        <select value={String(params.file_format ?? 'parquet')} onChange={(e) => set({ file_format: e.target.value })}>
          <option value="parquet">Parquet (권장)</option>
          <option value="jsonl">JSON Lines</option>
          <option value="csv">CSV</option>
        </select>
      </div>
      <div className="field">
        <label>적재 모드</label>
        <select value={String(params.mode ?? 'append')} onChange={(e) => set({ mode: e.target.value })}>
          <option value="append">Append</option>
          <option value="overwrite">Overwrite (실행 경로 선정리)</option>
        </select>
        <div className="hint">
          S3 는 upsert 를 지원하지 않습니다. 실행별 경로 분리로 멱등성을 확보합니다.
        </div>
      </div>
    </>
  )
}


function ColorSwatches({ value, onPick }: { value: unknown; onPick: (key: string) => void }) {
  const current = value ?? DEFAULT_MEMO_COLOR
  return (
    <div className="field">
      <label>색상</label>
      <div className="memo-swatches">
        {MEMO_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`memo-swatch ${current === c.key ? 'active' : ''}`}
            style={{ background: c.bg, borderColor: current === c.key ? c.dot : undefined }}
            title={c.label}
            aria-label={c.label}
            onClick={() => onPick(c.key)}
          />
        ))}
      </div>
    </div>
  )
}

function MemoFields({ params, set }: FieldProps) {
  return (
    <>
      <div className="field">
        <label>메모 내용</label>
        <textarea
          rows={6}
          value={String(params.text ?? '')}
          placeholder="이 파이프라인에 대한 설명, 할 일, 주의사항 등을 적어두세요."
          onChange={(e) => set({ text: e.target.value })}
        />
        <div className="hint">메모는 문서용 주석입니다 — 실행되지 않고 다른 노드와 연결할 수 없습니다.</div>
      </div>
      <ColorSwatches value={params.color} onPick={(color) => set({ color })} />
    </>
  )
}

function GroupFields({ params, set }: FieldProps) {
  return (
    <>
      <div className="field">
        <label>영역 제목</label>
        <input
          value={String(params.title ?? '')}
          placeholder="예: 수집 · 적재"
          onChange={(e) => set({ title: e.target.value })}
        />
        <div className="hint">
          노드를 사각형으로 묶어 구분하는 영역입니다. 모서리를 끌어 크기를 조절하세요 — 실행·연결과 무관합니다.
        </div>
      </div>
      <ColorSwatches value={params.color} onPick={(color) => set({ color })} />
    </>
  )
}

function TargetFileFields({ params, set }: FieldProps) {
  const { data: defaults } = useConnectorDefaults()
  const root = defaults?.local_file?.root
  const fmt = String(params.file_format ?? 'jsonl')
  const mode = String(params.mode ?? 'append')
  return (
    <>
      <div className="field">
        <label>경로 prefix (선택)</label>
        <input
          placeholder="customers"
          value={String(params.path_prefix ?? '')}
          onChange={(e) => set({ path_prefix: e.target.value })}
        />
        <div className="hint">
          실제 경로: {root ? `${root}/` : ''}
          &lt;연결 폴더&gt;/{params.path_prefix ? `${String(params.path_prefix)}/` : ''}run_id=&lt;실행ID&gt;/part-00000.
          {fmt}
        </div>
      </div>
      <div className="field">
        <label>파일 포맷</label>
        <select value={fmt} onChange={(e) => set({ file_format: e.target.value })}>
          <option value="jsonl">JSON Lines (권장)</option>
          <option value="csv">CSV</option>
          <option value="parquet">Parquet</option>
        </select>
      </div>
      <div className="field">
        <label>적재 모드</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="append">Append</option>
          <option value="overwrite">Overwrite (실행 경로 선정리)</option>
        </select>
        <div className="hint">
          로컬 파일은 upsert 를 지원하지 않습니다. 실행별 경로 분리로 멱등성을 확보합니다.
        </div>
      </div>
    </>
  )
}

function MongoSourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const { data: schema, isLoading, isError } = useConnectionSchema(connectionId)
  const collections = schema?.tables ?? []
  const selected = collections.find(
    (t) => t.name === params.table && t.namespace === params.namespace,
  )
  const filterError = jsonError(params.query)

  return (
    <>
      <div className="field">
        <label>컬렉션</label>
        {isLoading && <div className="hint">컬렉션을 불러오는 중…</div>}
        {isError && <div className="hint">읽지 못했습니다. 연결 상태를 확인하세요.</div>}
        <select
          value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
          onChange={(e) => {
            const [namespace, name] = e.target.value.split('|')
            set({ namespace: namespace || undefined, table: name || undefined })
          }}
          disabled={!connectionId || collections.length === 0}
        >
          <option value="">— 선택 —</option>
          {collections.map((c) => (
            <option key={c.qualified_name} value={`${c.namespace ?? ''}|${c.name}`}>
              {c.qualified_name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>필터 (JSON)</label>
        <textarea
          rows={4}
          value={String(params.query ?? '')}
          placeholder={'{"status": "active"}'}
          onChange={(e) => set({ query: e.target.value })}
        />
        {filterError ? (
          <div className="hint" style={{ color: 'var(--red)' }}>
            {filterError}
          </div>
        ) : (
          <div className="hint">비우면 전체 조회. Mongo 필터는 증분 컬럼과 함께 쓸 수 있습니다.</div>
        )}
      </div>

      <div className="field">
        <label>증분 필드 (watermark)</label>
        <select
          value={String(params.incremental_column ?? '')}
          onChange={(e) => set({ incremental_column: e.target.value || undefined })}
          disabled={!selected}
        >
          <option value="">— 전체 적재 —</option>
          {(selected?.columns ?? []).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.data_type})
            </option>
          ))}
        </select>
        <div className="hint">표본 문서에서 추론한 필드 목록입니다.</div>
      </div>

      <div className="field">
        <label>배치 크기</label>
        <input
          type="number"
          min={1}
          value={Number(params.batch_size ?? 5000)}
          onChange={(e) => set({ batch_size: Number(e.target.value) || 5000 })}
        />
      </div>
    </>
  )
}

function MongoTargetFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const { data: schema } = useConnectionSchema(connectionId)
  const collections = schema?.tables ?? []
  const selected = collections.find(
    (t) => t.name === params.table && t.namespace === params.namespace,
  )
  const keyColumns = asArray<string>(params.key_columns)
  const mode = String(params.mode ?? 'upsert')

  return (
    <>
      <div className="field">
        <label>대상 컬렉션</label>
        <select
          value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
          onChange={(e) => {
            const [namespace, name] = e.target.value.split('|')
            set({ namespace: namespace || undefined, table: name || undefined })
          }}
        >
          <option value="">— 선택 —</option>
          {collections.map((c) => (
            <option key={c.qualified_name} value={`${c.namespace ?? ''}|${c.name}`}>
              {c.qualified_name}
            </option>
          ))}
        </select>
        <div className="hint">목록에 없으면 직접 입력하세요 — 없는 컬렉션은 적재 시 생성됩니다.</div>
        <input
          style={{ marginTop: 6 }}
          placeholder="컬렉션 이름 직접 입력"
          value={String(params.table ?? '')}
          onChange={(e) => set({ table: e.target.value || undefined })}
        />
      </div>

      <div className="field">
        <label>적재 모드</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="upsert">Upsert (키 기준 교체)</option>
          <option value="append">Append (단순 추가)</option>
          <option value="overwrite">Overwrite (전체 교체)</option>
        </select>
      </div>

      {mode === 'upsert' && (
        <div className="field">
          <label>키 필드</label>
          <input
            placeholder="_id 또는 order_no, tenant_id"
            value={keyColumns.join(', ')}
            onChange={(e) =>
              set({
                key_columns: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <div className="hint">이 필드들이 같으면 같은 문서로 보고 교체합니다.</div>
        </div>
      )}
    </>
  )
}

/** Mongo 필터가 JSON 객체인지 즉시 알려준다 — 저장 후 실행에서 터지면 늦다 */
function jsonError(raw: unknown): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'JSON 객체여야 합니다'
    }
  } catch (e) {
    return `올바른 JSON 이 아닙니다: ${e instanceof Error ? e.message : ''}`
  }
  return null
}


/** SAP 소스 — 읽기 모드에 따라 필요한 설정이 완전히 다르다 (설계 문서 §5).
 *
 * 테이블은 **여기서** 정한다. 연결은 SAP 시스템 하나만 가리키므로,
 * 테이블마다 연결을 만들 필요가 없다.
 */
function SapSourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const mode = String(params.mode ?? 'read_table')
  const table = String(params.table ?? '')
  const columns = asArray<string>(params.columns)

  // 입력한 테이블 이름으로 그때그때 조회한다 (연결에 박아두지 않는다)
  const { data: schema, isLoading, isError, error } = useTableSchema(connectionId, table)
  const found = schema?.tables[0]
  const fields = found?.columns ?? []

  const widthOf = (name: string) => {
    const match = fields.find((c) => c.name === name)?.data_type.match(/\((\d+)\)/)
    return match ? Number(match[1]) : 0
  }
  const totalWidth = fields.reduce((sum, c) => sum + widthOf(c.name), 0)
  const chosenWidth = columns.reduce((sum, c) => sum + widthOf(c), 0)
  const effectiveWidth = columns.length ? chosenWidth : totalWidth
  const willSplit = effectiveWidth > 512

  return (
    <>
      <div className="field">
        <label>읽기 방식</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="bapi">BAPI 호출 (권장)</option>
          <option value="read_table">RFC_READ_TABLE</option>
        </select>
        <div className="hint">
          {mode === 'bapi'
            ? 'BAPI 는 512자 행폭 제약이 없고 결과가 구조화되어 있습니다.'
            : 'RFC_READ_TABLE 은 행폭 512자 제약이 있어 넓은 테이블은 나눠 호출합니다.'}
        </div>
      </div>

      {mode === 'bapi' ? (
        <>
          <div className="field">
            <label>함수 이름</label>
            <input
              placeholder="BAPI_MATERIAL_GETLIST"
              value={String(params.function_name ?? '')}
              onChange={(e) => set({ function_name: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="field">
            <label>결과 테이블 (선택)</label>
            <input
              placeholder="MATNRLIST — 비우면 자동 판별"
              value={String(params.result_table ?? '')}
              onChange={(e) => set({ result_table: e.target.value.toUpperCase() || undefined })}
            />
            <div className="hint">결과 테이블 후보가 여러 개면 반드시 지정해야 합니다.</div>
          </div>
          <div className="field">
            <label>파라미터 (JSON)</label>
            <textarea
              rows={4}
              placeholder={'{"MAXROWS": 1000}'}
              value={String(params.bapi_parameters_text ?? '')}
              onChange={(e) => {
                const text = e.target.value
                let parsed: unknown
                try {
                  parsed = text.trim() ? JSON.parse(text) : {}
                } catch {
                  parsed = undefined
                }
                set({
                  bapi_parameters_text: text,
                  ...(parsed !== undefined ? { bapi_parameters: parsed } : {}),
                })
              }}
            />
            {jsonError(params.bapi_parameters_text) && (
              <div className="hint" style={{ color: 'var(--red)' }}>
                {jsonError(params.bapi_parameters_text)}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>테이블</label>
            <input
              placeholder="MARA"
              value={table}
              onChange={(e) => {
                const next = e.target.value.toUpperCase()
                // 테이블이 바뀌면 이전 테이블의 필드 선택은 무의미하다
                set({ table: next || undefined, columns: [], incremental_column: undefined })
              }}
            />
            {isLoading && <div className="hint">필드를 불러오는 중…</div>}
            {isError && (
              <div className="hint" style={{ color: 'var(--red)' }}>
                {error instanceof Error ? error.message : '테이블을 읽지 못했습니다'}
              </div>
            )}
            {!table && (
              <div className="hint">
                SAP 테이블 이름을 입력하면 필드를 조회합니다 (예: MARA, MAKT, CSKT).
              </div>
            )}
            {found && (
              <div className="hint">
                {found.name} · 필드 {fields.length}개 · 전체 폭 {totalWidth}자
              </div>
            )}
          </div>

          {fields.length > 0 && (
            <div className="field">
              <label>필드 {columns.length > 0 ? `(${columns.length}개 선택)` : '(전체)'}</label>
              <select
                multiple
                size={8}
                value={columns}
                onChange={(e) =>
                  set({ columns: Array.from(e.target.selectedOptions, (o) => o.value) })
                }
              >
                {fields.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} · {c.data_type}
                  </option>
                ))}
              </select>
              <div className="hint" style={{ color: willSplit ? 'var(--amber)' : undefined }}>
                선택 폭 {effectiveWidth}자 / 한계 512자
                {willSplit && ' — 512자를 넘어 나눠 호출합니다. 필드를 줄이거나 BAPI 를 쓰세요.'}
              </div>
            </div>
          )}

          <div className="field">
            <label>WHERE 조건</label>
            <input
              placeholder="MTART = 'FERT'"
              value={String(params.where ?? '')}
              onChange={(e) => set({ where: e.target.value })}
            />
            <div className="hint">ABAP OpenSQL 문법. 72자 단위 분할은 서버가 처리합니다.</div>
          </div>

          <div className="field">
            <label>증분 필드 (watermark)</label>
            <select
              value={String(params.incremental_column ?? '')}
              onChange={(e) => set({ incremental_column: e.target.value || undefined })}
              disabled={fields.length === 0}
            >
              <option value="">— 전체 적재 —</option>
              {fields.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} · {c.data_type}
                </option>
              ))}
            </select>
            <div className="hint">SAP 날짜(YYYYMMDD)는 사전순 비교가 곧 크기순 비교입니다.</div>
          </div>
        </>
      )}

      <div className="field">
        <label>배치 크기</label>
        <input
          type="number"
          min={1}
          value={Number(params.batch_size ?? 2000)}
          onChange={(e) => set({ batch_size: Number(e.target.value) || 2000 })}
        />
        <div className="hint">SAP 게이트웨이 타임아웃을 피하려면 한 번에 다 읽지 않습니다.</div>
      </div>
    </>
  )
}

/** Mongo 필터가 JSON 객체인지 즉시 알려준다 — 저장 후 실행에서 터지면 늦다 */

