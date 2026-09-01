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
import { t, useT, type MsgKey } from '../i18n'
import { rich } from '../i18n/rich'
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
  SPEC_BY_KIND,
  defaultPycode,
  isDefaultPycode,
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

// 라벨은 MsgKey 로만 들고 렌더 시점에 t() 로 푼다 — 모듈 상수에 번역문을 담으면 언어 전환을 못 따라온다.
const FILTER_OPS = [
  ['eq', 'cfg.op.eq'],
  ['ne', 'cfg.op.ne'],
  ['gt', 'cfg.op.gt'],
  ['gte', 'cfg.op.gte'],
  ['lt', 'cfg.op.lt'],
  ['lte', 'cfg.op.lte'],
  ['in', 'cfg.op.in'],
  ['not_in', 'cfg.op.not_in'],
  ['contains', 'cfg.op.contains'],
  ['starts_with', 'cfg.op.starts_with'],
  ['is_null', 'cfg.op.is_null'],
  ['is_not_null', 'cfg.op.is_not_null'],
  ['regex', 'cfg.op.regex'],
] as const satisfies readonly (readonly [string, MsgKey])[]

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
  const tr = useT()
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
        title={tr('cfg.resizeTip')}
      />
      <div className="config-scroll">{children}</div>
    </aside>
  )
}

export function ConfigPanel() {
  const tr = useT()
  const selectedId = useCanvasStore((s) => s.selectedId)
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === s.selectedId))

  return (
    <ConfigShell>
      {!selectedId || !node ? (
        <div className="empty">
          {tr('cfg.emptySelect')}
          <br />
          <br />
          {tr('cfg.emptyDrag')}
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
  const tr = useT()
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
    ? tr('cfg.nameRequired')
    : isLabelTaken(nodes, trimmed, node.id)
      ? tr('cfg.nameTaken')
      : null

  return (
    <div className="field">
      <label>{tr('cfg.nodeName')}</label>
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
  const tr = useT()
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
          <div className="ct">{spec ? tr(spec.titleKey) : node.data.kind}</div>
          <div className="csub">{node.id}</div>
        </div>
      </div>

      {!isNote(node.data.kind) && <NodeNameField node={node} />}

      {/* 응답 노드는 타깃이지만 연결이 없다 — 어디에도 적재하지 않고 호출자에게 돌려준다 */}
      {(isSource(node.data.kind) || isTarget(node.data.kind)) &&
        node.data.kind !== 'target.response' && (
        <div className="field">
          <label>{tr('cfg.connection')}</label>
          <select value={connectionId ?? ''} onChange={(e) => set({ connection_id: e.target.value })}>
            <option value="">{tr('cfg.choose')}</option>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
          {usable.length === 0 && (
            <div className="hint">
              {cdcSource ? tr('cfg.noCdcConnections') : tr('cfg.noConnections')}
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
          {tr('cfg.deleteNode')}
        </button>
      </div>
    </>
  )
}

type FieldProps = { params: Record<string, unknown>; set: (patch: Record<string, unknown>) => void }

function TriggerFields({ kind, params, set }: FieldProps & { kind: string }) {
  const tr = useT()
  if (kind === 'trigger.cdc') {
    return (
      <div className="field">
        <div className="hint">{rich(tr('cfg.trg.cdcHint'))}</div>
      </div>
    )
  }
  if (kind === 'trigger.sync') {
    return (
      <div className="field">
        <div className="hint">{rich(tr('cfg.trg.syncHint'))}</div>
      </div>
    )
  }
  if (kind === 'trigger.api') {
    return <ApiTriggerFields params={params} set={set} />
  }
  if (kind !== 'trigger.schedule') {
    return (
      <div className="field">
        <div className="hint">{tr('cfg.trg.manualHint')}</div>
      </div>
    )
  }
  return (
    <>
      <div className="field">
        <label>{tr('cfg.trg.cron')}</label>
        <input
          value={String(params.cron ?? '')}
          placeholder="0 2 * * *"
          onChange={(e) => set({ cron: e.target.value })}
        />
        <div className="hint">{tr('cfg.trg.cronHint')}</div>
      </div>
      <div className="field">
        <label>{tr('cfg.trg.timezone')}</label>
        <select value={String(params.timezone ?? 'Asia/Seoul')} onChange={(e) => set({ timezone: e.target.value })}>
          <option>Asia/Seoul</option>
          <option>UTC</option>
        </select>
        <div className="hint">
          {tr('cfg.trg.timezoneHint')}
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
  const tr = useT()
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
        <div className="hint">{rich(tr('cfg.resp.hint'))}</div>
      </div>

      <div className="field">
        <label>{tr('cfg.resp.maxRows')}</label>
        <input
          type="number"
          min={1}
          max={10000}
          value={String(params.max_rows ?? 100)}
          onChange={(e) => set({ max_rows: Number(e.target.value) })}
        />
        <div className="hint">
          {rich(tr('cfg.resp.maxRowsHint', { code: 'truncated: true' }))}
        </div>
      </div>

      <div className="field">
        <label>{tr('cfg.resp.columns')}</label>
        {columns.length === 0 ? (
          <div className="hint">{rich(tr('cfg.resp.columnsEmpty'))}</div>
        ) : (
          <div className="respcols">
            {columns.map((c) => (
              <span className="respcol" key={c}>
                <code>{c}</code>
                <button
                  onClick={() => set({ columns: columns.filter((x) => x !== c) })}
                  aria-label={tr('cfg.resp.removeCol', { name: c })}
                  title={tr('cfg.resp.remove')}
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
            placeholder={tr('cfg.resp.colNamePh')}
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
            {tr('cfg.resp.add')}
          </button>
        </div>
        <div className="hint">{rich(tr('cfg.resp.rowsVsCols'))}</div>
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
  const tr = useT()
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
          type: tr('cfg.var.firstRow'),
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
            type: tr('cfg.var.allRows'),
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
  const tr = useT()
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
          {rich(
            tr('cfg.api.hint', {
              var: tr('cui.ref.varName'),
              example: "WHERE updated_at >= '$since'",
            }),
          )}
        </div>
      </div>

      <div className="field">
        <label>{tr('cfg.api.varsLabel')}</label>
        {vars.length === 0 && (
          <div className="hint">{tr('cfg.api.noVars')}</div>
        )}

        <div className="varlist">
          {vars.map((v, i) => (
            <div className="varrow" key={i}>
              <div className="varhead">
                <span className="vardollar">$</span>
                <input
                  className="varname"
                  value={String(v.name ?? '')}
                  placeholder={tr('cfg.api.varNamePh')}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
                <select
                  value={String(v.type ?? 'string')}
                  onChange={(e) => patch(i, { type: e.target.value as TriggerVariable['type'] })}
                >
                  <option value="string">{tr('cfg.api.typeString')}</option>
                  <option value="number">{tr('cfg.api.typeNumber')}</option>
                  <option value="boolean">{tr('cfg.api.typeBoolean')}</option>
                </select>
                <button
                  className="btn sm danger"
                  title={tr('cfg.api.deleteVar')}
                  aria-label={tr('cfg.api.deleteVarAria', {
                    name: v.name || tr('cfg.api.unnamedVar'),
                  })}
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
                  {tr('cfg.api.required')}
                </label>
                {v.required === false && (
                  <input
                    className="vardefault"
                    value={String(v.default ?? '')}
                    placeholder={tr('cfg.api.defaultPh')}
                    onChange={(e) => patch(i, { default: e.target.value })}
                  />
                )}
                <input
                  className="varexample"
                  value={String(v.example ?? '')}
                  placeholder={tr('cfg.api.examplePh')}
                  onChange={(e) => patch(i, { example: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <button className="btn sm" onClick={add} style={{ marginTop: 8 }}>
          <Icon.plus />
          {tr('cfg.api.addVar')}
        </button>
      </div>

      {vars.length > 0 && (
        <div className="field">
          <label>{tr('cfg.api.payloadLabel')}</label>
          <pre className="codeblock">{samplePayload(vars)}</pre>
          <div className="hint">
            {rich(tr('cfg.api.payloadHint', { example: "WHERE dt > ''" }))}
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
  const tr = useT()
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
      setIssued(await create.mutateAsync({ name: name.trim() || tr('cfg.hook.defaultName') }))
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('cfg.hook.issueFailed'))
    }
  }

  return (
    <>
      <div className="field">
        <label>{tr('cfg.hook.label')}</label>
        <div className="hint">{rich(tr('cfg.hook.hint'))}</div>

        {error && <Banner kind="error">{error}</Banner>}
        {isLoading && <div className="hint">{tr('cfg.hook.loading')}</div>}

        {triggers.length > 0 && (
          <div className="hook-list">
            {triggers.map((t) => (
              <div className={`hook-row ${t.enabled ? '' : 'off'}`} key={t.id}>
                <div className="hook-meta">
                  <span className="hook-name">{t.name}</span>
                  <code className="hook-prefix">{t.token_prefix}…</code>
                </div>
                <div className="hook-stat">
                  {t.call_count > 0
                    ? tr('cfg.hook.callCount', { n: t.call_count })
                    : tr('cfg.hook.noCalls')}
                  {t.last_called_at && ` · ${formatDateTime(t.last_called_at)}`}
                </div>
                <div className="hook-actions">
                  <button
                    className="btn sm"
                    onClick={() => setEnabled.mutate({ id: t.id, enabled: !t.enabled })}
                    title={t.enabled ? tr('cfg.hook.pauseTip') : tr('cfg.hook.resumeTip')}
                  >
                    {t.enabled ? tr('cfg.hook.pause') : tr('cfg.hook.resume')}
                  </button>
                  <button
                    className="btn sm danger"
                    onClick={() => remove.mutate(t.id)}
                    title={tr('cfg.hook.revokeTip')}
                    aria-label={tr('cfg.hook.revokeAria', { name: t.name })}
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
            placeholder={tr('cfg.hook.namePh')}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn sm" onClick={issue} disabled={create.isPending}>
            <Icon.plus />
            {tr('cfg.hook.issue')}
          </button>
        </div>
      </div>

      {issued && (
        <div className="field">
          <Banner kind="warn">{rich(tr('cfg.hook.onceWarn'))}</Banner>
          <pre className="codeblock">{curlExample(issued, vars)}</pre>
          <div className="hint">{rich(tr('cfg.hook.headerHint', { header: 'X-EAI-Token' }))}</div>
          <button className="btn sm" onClick={() => setIssued(null)} style={{ marginTop: 8 }}>
            {tr('cfg.hook.copied')}
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
    else body[v.name] = example === '' ? t('cfg.api.sampleValue') : String(example)
  }
  return JSON.stringify(body, null, 2)
}

function SourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const tr = useT()
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
    { value: '', label: tr('cfg.src.allSchemas'), hint: String(tables.length) },
    ...[...schemaCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([ns, n]): SelectOption => ({
          value: ns,
          label: ns || tr('cfg.src.defaultSchema'),
          hint: String(n),
        }),
      ),
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
          {tr('cfg.src.customSql')}
        </label>
      </div>

      {useQuery ? (
        <div className="field">
          <div className="code-field-head">
            <label>SQL</label>
            <button
              className="btn sm"
              onClick={() => setSqlExpanded(true)}
              title={tr('cfg.src.expandEdit')}
            >
              <Icon.expand />
              {tr('cfg.src.expand')}
            </button>
          </div>
          <Suspense fallback={<div className="code-loading">{tr('cfg.src.editorLoading')}</div>}>
            <SqlEditor
              value={String(params.query ?? '')}
              onChange={(v) => set({ query: v })}
              height="180px"
              completion={tables}
            />
          </Suspense>
          <div className="hint">{rich(tr('cfg.src.sqlHint', { select: 'SELECT' }))}</div>
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
              <label>{tr('cfg.src.table')}</label>
              <div className="mode-seg" role="group" aria-label={tr('cfg.src.tableViewAria')}>
                <button
                  className={`mode-seg-btn ${tableView === 'list' ? 'active' : ''}`}
                  onClick={() => setTableView('list')}
                >
                  {tr('cfg.src.viewList')}
                </button>
                <button
                  className={`mode-seg-btn ${tableView === 'tree' ? 'active' : ''}`}
                  onClick={() => setTableView('tree')}
                >
                  {tr('cfg.src.viewTree')}
                </button>
              </div>
            </div>
            {isError && <div className="hint">{tr('cfg.src.schemaError')}</div>}

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
                  placeholder={tr('cfg.src.schemaPh')}
                  emptyText={tr('cfg.src.schemaEmpty')}
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
                  placeholder={connectionId ? tr('cfg.src.tablePh') : tr('cfg.src.pickConnFirst')}
                  emptyText={tr('cfg.src.tableEmpty')}
                />
              </>
            )}
          </div>

          <div className="field">
            <label>{tr('cfg.src.watermark')}</label>
            <SearchSelect
              value={String(params.incremental_column ?? '')}
              onChange={(v) => set({ incremental_column: v || undefined })}
              options={[
                { value: '', label: tr('cfg.src.fullLoad') },
                ...(selected?.columns.map(
                  (c): SelectOption => ({ value: c.name, label: c.name, hint: c.data_type }),
                ) ?? []),
              ]}
              disabled={!selected}
              placeholder={tr('cfg.src.fullLoad')}
              emptyText={tr('cfg.src.columnEmpty')}
            />
            <div className="hint">{tr('cfg.src.watermarkHint')}</div>
          </div>
        </>
      )}

      <div className="field">
        <label>{tr('cfg.src.batchSize')}</label>
        <input
          type="number"
          min={1}
          value={Number(params.batch_size ?? 5000)}
          onChange={(e) => set({ batch_size: Number(e.target.value) || 5000 })}
        />
        <div className="hint">{tr('cfg.src.batchSizeHint')}</div>
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
  const tr = useT()
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
        <label>
          {tr('cfg.cdc.tables')}{' '}
          {selected.length > 0 ? tr('cfg.cdc.tablesCount', { n: selected.length }) : ''}
        </label>
        {isLoading && <div className="hint">{tr('cfg.cdc.tablesLoading')}</div>}
        {isError && <div className="hint">{tr('cfg.cdc.schemaError')}</div>}
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
          {tr('cfg.cdc.tablesHint')}
          {tables.length === 0 && tr('cfg.cdc.tablesManual')}
        </div>
      </div>

      <div className="field">
        <label>{tr('cfg.cdc.snapshot')}</label>
        <select value={snapshot} onChange={(e) => set({ snapshot: e.target.value })}>
          <option value="initial">{tr('cfg.cdc.snapInitial')}</option>
          <option value="never">{tr('cfg.cdc.snapNever')}</option>
          <option value="when_needed">{tr('cfg.cdc.snapWhenNeeded')}</option>
        </select>
        <div className="hint">
          {snapshot === 'initial' && tr('cfg.cdc.snapInitialHint')}
          {snapshot === 'never' && tr('cfg.cdc.snapNeverHint')}
          {snapshot === 'when_needed' && tr('cfg.cdc.snapWhenNeededHint')}
        </div>
      </div>

      <div className="field">
        <label>{tr('cfg.cdc.deleteMode')}</label>
        <select value={deleteMode} onChange={(e) => set({ delete_mode: e.target.value })}>
          <option value="soft">{tr('cfg.cdc.delSoft')}</option>
          <option value="hard">{tr('cfg.cdc.delHard')}</option>
          <option value="ignore">{tr('cfg.cdc.delIgnore')}</option>
        </select>
        <div className="hint">
          {deleteMode === 'soft' && tr('cfg.cdc.delSoftHint')}
          {deleteMode === 'hard' && tr('cfg.cdc.delHardHint')}
          {deleteMode === 'ignore' && tr('cfg.cdc.delIgnoreHint')}
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
  const tr = useT()
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
        <label>{tr('cfg.sync.srcSchema')}</label>
        <input
          value={namespace}
          placeholder="dbo"
          onChange={(e) => set({ namespace: e.target.value })}
        />
        <div className="hint">{tr('cfg.sync.srcSchemaHint')}</div>
      </div>

      <div className="field">
        <label>{tr('cfg.sync.configDb')}</label>
        <input
          value={String(params.sync_database ?? '')}
          placeholder={tr('cfg.sync.configDbPh')}
          onChange={(e) => set({ sync_database: e.target.value })}
        />
        <div className="hint">{rich(tr('cfg.sync.configDbHint'))}</div>
      </div>

      <div className="field">
        <label>
          {tr('cfg.sync.tables')} {rows.length > 0 ? tr('cfg.cdc.tablesCount', { n: rows.length }) : ''}
        </label>
        {isLoading && <div className="hint">{tr('cfg.cdc.tablesLoading')}</div>}
        {rows.map((row, index) => (
          <div className="sync-row" key={index}>
            <input
              placeholder={tr('cfg.sync.tableNamePh')}
              list="sync-table-list"
              value={String(row.name ?? '')}
              onChange={(e) => update(index, { name: e.target.value })}
            />
            <select
              value={String(row.channel ?? 'standard')}
              onChange={(e) => update(index, { channel: e.target.value })}
              title={tr('cfg.sync.channelTip')}
            >
              {SYNC_CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {tr(`sync.channel.${c.id}.label`)}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="narrow"
              title={tr('cfg.sync.loadOrderTip')}
              value={String(row.initial_load_order ?? 100)}
              onChange={(e) => update(index, { initial_load_order: Number(e.target.value) })}
            />
            <button
              className="rm"
              title={tr('cfg.sync.excludeTable')}
              onClick={() => set({ tables: rows.filter((_, i) => i !== index) })}
            >
              ×
            </button>
            <input
              className="wide"
              placeholder={tr('cfg.sync.rowFilterPh')}
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
          {tr('cfg.sync.addTable')}
        </button>
        <div className="hint">{rich(tr('cfg.sync.tablesHint'))}</div>
      </div>

      <div className="field">
        <label>{tr('cfg.sync.purpose')}</label>
        <select value={purpose} onChange={(e) => set({ purpose: e.target.value })}>
          {SYNC_PURPOSES.map((p) => (
            <option key={p.id} value={p.id}>
              {tr(`sync.purpose.${p.id}`)}
            </option>
          ))}
        </select>
        {purpose === 'operational' && (
          <div className="hint warn">{rich(tr('cfg.sync.purposeWarn'))}</div>
        )}
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(params.initial_load ?? true)}
            onChange={(e) => set({ initial_load: e.target.checked })}
          />
          {tr('cfg.sync.initialLoad')}
        </label>
        <div className="hint">{tr('cfg.sync.initialLoadHint')}</div>
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(params.load_test_ack)}
            onChange={(e) => set({ load_test_ack: e.target.checked })}
          />
          {tr('cfg.sync.loadTestAck')}
        </label>
        <div className="hint">{rich(tr('cfg.sync.loadTestHint'))}</div>
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
  const tr = useT()
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
        <label>{tr('cfg.synct.schema')}</label>
        <input
          value={namespace}
          placeholder="public"
          onChange={(e) => set({ namespace: e.target.value })}
        />
      </div>

      <div className="field">
        <label>{tr('cfg.synct.mappings')}</label>
        {mappings.map((m, index) => (
          <div className="map-row" key={index}>
            <input
              placeholder={tr('cfg.synct.srcTablePh')}
              value={String(m.source_table ?? '')}
              onChange={(e) => update(index, { source_table: e.target.value })}
            />
            <span className="arrow">→</span>
            <input
              placeholder={tr('cfg.synct.tgtTablePh')}
              value={String(m.target_table ?? '')}
              onChange={(e) => update(index, { target_table: e.target.value })}
            />
            <button
              className="rm"
              title={tr('cfg.synct.deleteMapping')}
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
            {tr('cfg.synct.importFromSource', { n: missing.length })}
          </button>
        )}
        <div className="hint">
          {rich(tr('cfg.synct.hint'))}
          {sourceTables.length === 0 && tr('cfg.synct.pickSourceFirst')}
        </div>
      </div>
    </>
  )
}

function FilterFields({ params, set }: FieldProps) {
  const tr = useT()
  const conditions = asArray<Cond>(params.conditions)
  const update = (index: number, patch: Partial<Cond>) =>
    set({ conditions: conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) })

  return (
    <>
      <div className="field">
        <label>{tr('cfg.flt.match')}</label>
        <select value={String(params.match ?? 'all')} onChange={(e) => set({ match: e.target.value })}>
          <option value="all">{tr('cfg.flt.matchAll')}</option>
          <option value="any">{tr('cfg.flt.matchAny')}</option>
        </select>
      </div>
      <div className="field">
        <label>{tr('cfg.flt.conditions')}</label>
        {conditions.map((cond, index) => (
          <div className="map-row" key={index}>
            <input
              placeholder={tr('cfg.flt.columnPh')}
              value={String(cond.field ?? '')}
              onChange={(e) => update(index, { field: e.target.value })}
            />
            <select value={cond.op ?? 'eq'} onChange={(e) => update(index, { op: e.target.value })}>
              {FILTER_OPS.map(([value, labelKey]) => (
                <option key={value} value={value}>
                  {tr(labelKey)}
                </option>
              ))}
            </select>
            <input
              placeholder={tr('cfg.flt.valuePh')}
              value={cond.value === undefined || cond.value === null ? '' : String(cond.value)}
              onChange={(e) => update(index, { value: e.target.value })}
              disabled={cond.op === 'is_null' || cond.op === 'is_not_null'}
            />
            <button
              className="rm"
              title={tr('cfg.flt.deleteCond')}
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
          {tr('cfg.flt.addCond')}
        </button>
      </div>
    </>
  )
}

function SwitchFields({ params, set }: FieldProps) {
  const tr = useT()
  const cases = asArray<SwitchCase>(params.cases)
  const updateCase = (index: number, patch: Partial<SwitchCase>) =>
    set({ cases: cases.map((c, i) => (i === index ? { ...c, ...patch } : c)) })
  const updateConds = (index: number, conditions: Cond[]) => updateCase(index, { conditions })
  const addCase = () =>
    set({
      cases: [
        ...cases,
        {
          id: newCaseId(),
          label: t('node.switch.case', { n: cases.length + 1 }),
          match: 'all',
          conditions: [],
        },
      ],
    })

  return (
    <div className="switch-cfg">
      <p className="switch-lead">{rich(tr('cfg.sw.lead'))}</p>

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
                placeholder={tr('node.switch.case', { n: ci + 1 })}
                value={String(c.label ?? '')}
                onChange={(e) => updateCase(ci, { label: e.target.value })}
              />
              <button
                className="switch-case-del"
                title={tr('cfg.sw.deleteCase')}
                disabled={cases.length <= 1}
                onClick={() => set({ cases: cases.filter((_, i) => i !== ci) })}
              >
                <Icon.trash />
              </button>
            </div>

            {conds.length === 0 && (
              <p className="switch-empty">{tr('cfg.sw.noCond')}</p>
            )}
            {conds.map((cond, i) => {
              const nullOp = cond.op === 'is_null' || cond.op === 'is_not_null'
              return (
                <div className="cond" key={i}>
                  <div className="cond-top">
                    <input
                      className="cond-field"
                      placeholder={tr('cfg.sw.columnPh')}
                      value={String(cond.field ?? '')}
                      onChange={(e) => setCond(i, { field: e.target.value })}
                    />
                    <button
                      className="cond-del"
                      title={tr('cfg.flt.deleteCond')}
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
                      {FILTER_OPS.map(([value, labelKey]) => (
                        <option key={value} value={value}>
                          {tr(labelKey)}
                        </option>
                      ))}
                    </select>
                    {!nullOp && (
                      <input
                        className="cond-val"
                        placeholder={tr('cfg.flt.valuePh')}
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
                {tr('cfg.flt.addCond')}
              </button>
              {conds.length >= 2 && (
                <select
                  className="cond-join"
                  value={String(c.match ?? 'all')}
                  onChange={(e) => updateCase(ci, { match: e.target.value })}
                >
                  <option value="all">{tr('cfg.sw.joinAll')}</option>
                  <option value="any">{tr('cfg.sw.joinAny')}</option>
                </select>
              )}
            </div>
          </div>
        )
      })}

      <button className="switch-add" onClick={addCase}>
        <Icon.plus />
        {tr('cfg.sw.addCase')}
      </button>

      <div className="switch-default">
        <span className="switch-default-dot" />
        <span>{rich(tr('cfg.sw.otherwise'))}</span>
      </div>
    </div>
  )
}

function MapFields({ params, set }: FieldProps) {
  const tr = useT()
  const mappings = asArray<Mapping>(params.mappings)
  const update = (index: number, patch: Partial<Mapping>) =>
    set({ mappings: mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)) })

  return (
    <>
      <div className="field">
        <label>{tr('cfg.map.label')}</label>
        {mappings.map((mapping, index) => (
          <div className="map-row" key={index}>
            <input
              placeholder={tr('cfg.map.sourcePh')}
              value={String(mapping.source ?? '')}
              onChange={(e) => update(index, { source: e.target.value })}
            />
            <span className="ar">→</span>
            <input
              placeholder={tr('cfg.map.targetPh')}
              value={String(mapping.target ?? '')}
              onChange={(e) => update(index, { target: e.target.value })}
            />
            <select value={mapping.cast ?? ''} onChange={(e) => update(index, { cast: e.target.value || undefined })}>
              {CASTS.map((c) => (
                <option key={c} value={c}>
                  {c || tr('cfg.map.noCast')}
                </option>
              ))}
            </select>
            <button
              className="rm"
              title={tr('cfg.map.deleteMapping')}
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
          {tr('cfg.map.addMapping')}
        </button>
      </div>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={params.drop_unmapped !== false}
            onChange={(e) => set({ drop_unmapped: e.target.checked })}
          />
          {tr('cfg.map.dropUnmapped')}
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
  const trimmed = code.trim()
  if (!trimmed) return true
  if (isDefaultPycode(code)) return true // 어느 언어로 만들어졌든 기본 골격이면 안전
  return !/^\s*def\s+/m.test(code) // def 가 없으면 주석·빈 골격뿐 → 안전
}

// 라벨은 MsgKey 로만 들고 렌더 시점에 t() 로 푼다 — 모듈 상수에 번역문을 담으면 언어 전환을 못 따라온다.
const MODE_LABEL = { row: 'cfg.py.rowMode', batch: 'cfg.py.batchMode' } as const satisfies Record<
  'row' | 'batch',
  MsgKey
>

function scaffoldFor(target: 'row' | 'batch'): string {
  return defaultPycode(target)
}

function PyCodeFields({ params, set }: FieldProps) {
  const tr = useT()
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
        <label>{tr('cfg.py.label')}</label>
        <button className="btn sm" onClick={() => setExpanded(true)} title={tr('cfg.src.expandEdit')}>
          <Icon.expand />
          {tr('cfg.src.expand')}
        </button>
      </div>
      <div className="mode-seg" role="group" aria-label={tr('cfg.py.modeAria')}>
        <button
          className={`mode-seg-btn ${mode === 'row' ? 'active' : ''}`}
          onClick={() => selectMode('row')}
          title={tr('cfg.py.rowTip')}
        >
          {tr('cfg.py.rowMode')}
        </button>
        <button
          className={`mode-seg-btn ${mode === 'batch' ? 'active' : ''}`}
          onClick={() => selectMode('batch')}
          title={tr('cfg.py.batchTip')}
        >
          {tr('cfg.py.batchMode')}
        </button>
      </div>
      {pendingSwap && (
        <div className="mode-swap-confirm">
          <span>{rich(tr('cfg.py.swapWarn', { mode: tr(MODE_LABEL[pendingSwap]) }))}</span>
          <div className="mode-swap-actions">
            <button className="btn sm" onClick={() => setPendingSwap(null)}>
              {tr('common.cancel')}
            </button>
            <button className="btn sm danger" onClick={confirmSwap}>
              {tr('cfg.py.swap')}
            </button>
          </div>
        </div>
      )}
      <Suspense fallback={<div className="code-loading">{tr('cfg.src.editorLoading')}</div>}>
        <PyCodeEditor value={code} onChange={setCode} height="220px" />
      </Suspense>
      <div className="hint">
        {rich(tr('cfg.py.rowHint', { fn: 'transform(row: dict)', none: 'None' }))}
      </div>
      <div className="hint">{rich(tr('cfg.py.batchHint', { fn: 'transform_batch(df)' }))}</div>
      <div className="hint">{rich(tr('cfg.py.sandboxHint', { import: 'import pandas as pd' }))}</div>
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
  const tr = useT()
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
          <h3>{tr('cfg.cm.title')}</h3>
          <button className="x" onClick={onClose} aria-label={tr('common.close')}>
            ×
          </button>
        </div>

        <div className="mb" style={{ padding: '14px 20px' }}>
          {sourceTables.length > 1 && (
            <div className="field">
              <label>{tr('cfg.cm.srcTable')}</label>
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
            {rich(tr('cfg.cm.hint'))}
          </div>

          {srcLoading && <div className="hint">{tr('cfg.cm.srcLoading')}</div>}
          {!srcLoading && sourceCols.length === 0 && (
            <Banner kind="warn">{tr('cfg.cm.srcFailed')}</Banner>
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
                    <option value="">{tr('cfg.cm.sameName', { col })}</option>
                    {targetCols.map((tc) => (
                      <option key={tc} value={tc}>
                        {tc}
                      </option>
                    ))}
                  </select>
                  <button
                    className={`btn sm ${disabled ? 'danger' : ''}`}
                    onClick={() => setEntry(col, { disabled: !disabled })}
                    title={disabled ? tr('cfg.cm.include') : tr('cfg.cm.exclude')}
                  >
                    {disabled ? tr('cfg.cm.excluded') : tr('cfg.cm.disable')}
                  </button>
                </div>
              )
            })}
          </div>
          {targetCols.length === 0 && targetTable && (
            <div className="hint" style={{ marginTop: 8 }}>{tr('cfg.cm.tgtFailed')}</div>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>
            {tr('common.cancel')}
          </button>
          <button className="btn primary" onClick={save}>
            <Icon.save />
            {tr('cfg.cm.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TargetDbFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  // CDC 파이프라인이면 컬럼 매핑 옵션(팝업)을 추가로 보여준다. 나머지는 기존 단일 테이블 UI 그대로.
  const tr = useT()
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
        <label>{tr('cfg.tgt.table')}</label>
        <select
          value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
          onChange={(e) => {
            const [namespace, name] = e.target.value.split('|')
            set({ namespace: namespace || undefined, table: name || undefined })
          }}
          disabled={tables.length === 0}
        >
          <option value="">{tr('cfg.choose')}</option>
          {tables.map((t) => (
            <option key={t.qualified_name} value={`${t.namespace ?? ''}|${t.name}`}>
              {t.qualified_name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{tr('cfg.tgt.mode')}</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="upsert">{tr('cfg.tgt.upsert')}</option>
          <option value="append">{tr('cfg.tgt.append')}</option>
          <option value="overwrite">{tr('cfg.tgt.overwrite')}</option>
        </select>
        <div className="hint">
          {mode === 'upsert' && tr('cfg.tgt.upsertHint')}
          {mode === 'append' && tr('cfg.tgt.appendHint')}
          {mode === 'overwrite' && tr('cfg.tgt.overwriteHint')}
        </div>
      </div>

      {mode === 'upsert' && (
        <div className="field">
          <label>{tr('cfg.tgt.keyColumns')}</label>
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
          <div className="hint">{tr('cfg.tgt.keyColumnsHint')}</div>
        </div>
      )}

      {cdcSource && (
        <div className="field">
          <label>{tr('cfg.tgt.colMap')}</label>
          <div className="colmap-status">
            <span className={`tag ${colMap.length > 0 ? 'ok' : 'stopped'}`}>
              {colMap.length > 0
                ? tr('cfg.tgt.colMapSet', { n: colMap.length })
                : tr('cfg.tgt.colMapUnset')}
            </span>
            <button className="btn sm" onClick={() => setShowColMap(true)}>
              <Icon.map />
              {colMap.length > 0 ? tr('cfg.tgt.colMapEdit') : tr('cfg.tgt.colMapConfigure')}
            </button>
            {colMap.length > 0 && (
              <button
                className="btn sm danger"
                onClick={() => set({ column_map: undefined })}
                title={tr('cfg.tgt.colMapResetTip')}
              >
                {tr('cfg.tgt.colMapReset')}
              </button>
            )}
          </div>
          <div className="hint">
            {colMap.length > 0
              ? rich(tr('cfg.tgt.colMapSetHint'))
              : rich(tr('cfg.tgt.colMapUnsetHint'))}
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
  const tr = useT()
  return (
    <>
      <div className="field">
        <label>{tr('cfg.s3.prefix')}</label>
        <input
          placeholder="raw/customers"
          value={String(params.path_prefix ?? '')}
          onChange={(e) => set({ path_prefix: e.target.value })}
        />
        <div className="hint">{tr('cfg.s3.prefixHint')}</div>
      </div>
      <div className="field">
        <label>{tr('cfg.s3.format')}</label>
        <select value={String(params.file_format ?? 'parquet')} onChange={(e) => set({ file_format: e.target.value })}>
          <option value="parquet">{tr('cfg.s3.parquet')}</option>
          <option value="jsonl">JSON Lines</option>
          <option value="csv">CSV</option>
        </select>
      </div>
      <div className="field">
        <label>{tr('cfg.s3.mode')}</label>
        <select value={String(params.mode ?? 'append')} onChange={(e) => set({ mode: e.target.value })}>
          <option value="append">Append</option>
          <option value="overwrite">{tr('cfg.s3.overwrite')}</option>
        </select>
        <div className="hint">{tr('cfg.s3.modeHint')}</div>
      </div>
    </>
  )
}


function ColorSwatches({ value, onPick }: { value: unknown; onPick: (key: string) => void }) {
  const tr = useT()
  const current = value ?? DEFAULT_MEMO_COLOR
  return (
    <div className="field">
      <label>{tr('cfg.memo.color')}</label>
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
  const tr = useT()
  return (
    <>
      <div className="field">
        <label>{tr('cfg.memo.text')}</label>
        <textarea
          rows={6}
          value={String(params.text ?? '')}
          placeholder={tr('cfg.memo.textPh')}
          onChange={(e) => set({ text: e.target.value })}
        />
        <div className="hint">{tr('cfg.memo.hint')}</div>
      </div>
      <ColorSwatches value={params.color} onPick={(color) => set({ color })} />
    </>
  )
}

function GroupFields({ params, set }: FieldProps) {
  const tr = useT()
  return (
    <>
      <div className="field">
        <label>{tr('cfg.grp.title')}</label>
        <input
          value={String(params.title ?? '')}
          placeholder={tr('cfg.grp.titlePh')}
          onChange={(e) => set({ title: e.target.value })}
        />
        <div className="hint">{tr('cfg.grp.hint')}</div>
      </div>
      <ColorSwatches value={params.color} onPick={(color) => set({ color })} />
    </>
  )
}

function TargetFileFields({ params, set }: FieldProps) {
  const tr = useT()
  const { data: defaults } = useConnectorDefaults()
  const root = defaults?.local_file?.root
  const fmt = String(params.file_format ?? 'jsonl')
  const mode = String(params.mode ?? 'append')
  return (
    <>
      <div className="field">
        <label>{tr('cfg.s3.prefixOptional')}</label>
        <input
          placeholder="customers"
          value={String(params.path_prefix ?? '')}
          onChange={(e) => set({ path_prefix: e.target.value })}
        />
        <div className="hint">
          {tr('cfg.file.pathHint', {
            root: root ? `${root}/` : '',
            prefix: params.path_prefix ? `${String(params.path_prefix)}/` : '',
            fmt,
          })}
        </div>
      </div>
      <div className="field">
        <label>{tr('cfg.s3.format')}</label>
        <select value={fmt} onChange={(e) => set({ file_format: e.target.value })}>
          <option value="jsonl">{tr('cfg.s3.jsonl')}</option>
          <option value="csv">CSV</option>
          <option value="parquet">Parquet</option>
        </select>
      </div>
      <div className="field">
        <label>{tr('cfg.s3.mode')}</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="append">Append</option>
          <option value="overwrite">{tr('cfg.s3.overwrite')}</option>
        </select>
        <div className="hint">{tr('cfg.file.modeHint')}</div>
      </div>
    </>
  )
}

function MongoSourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const tr = useT()
  const { data: schema, isLoading, isError } = useConnectionSchema(connectionId)
  const collections = schema?.tables ?? []
  const selected = collections.find(
    (t) => t.name === params.table && t.namespace === params.namespace,
  )
  const filterError = jsonError(params.query)

  return (
    <>
      <div className="field">
        <label>{tr('cfg.mgo.collection')}</label>
        {isLoading && <div className="hint">{tr('cfg.mgo.loading')}</div>}
        {isError && <div className="hint">{tr('cfg.mgo.readError')}</div>}
        <select
          value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
          onChange={(e) => {
            const [namespace, name] = e.target.value.split('|')
            set({ namespace: namespace || undefined, table: name || undefined })
          }}
          disabled={!connectionId || collections.length === 0}
        >
          <option value="">{tr('cfg.choose')}</option>
          {collections.map((c) => (
            <option key={c.qualified_name} value={`${c.namespace ?? ''}|${c.name}`}>
              {c.qualified_name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{tr('cfg.mgo.filter')}</label>
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
          <div className="hint">{tr('cfg.mgo.filterHint')}</div>
        )}
      </div>

      <div className="field">
        <label>{tr('cfg.mgo.watermark')}</label>
        <select
          value={String(params.incremental_column ?? '')}
          onChange={(e) => set({ incremental_column: e.target.value || undefined })}
          disabled={!selected}
        >
          <option value="">{tr('cfg.src.fullLoad')}</option>
          {(selected?.columns ?? []).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.data_type})
            </option>
          ))}
        </select>
        <div className="hint">{tr('cfg.mgo.watermarkHint')}</div>
      </div>

      <div className="field">
        <label>{tr('cfg.src.batchSize')}</label>
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
  const tr = useT()
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
        <label>{tr('cfg.mgo.targetCollection')}</label>
        <select
          value={selected ? `${selected.namespace ?? ''}|${selected.name}` : ''}
          onChange={(e) => {
            const [namespace, name] = e.target.value.split('|')
            set({ namespace: namespace || undefined, table: name || undefined })
          }}
        >
          <option value="">{tr('cfg.choose')}</option>
          {collections.map((c) => (
            <option key={c.qualified_name} value={`${c.namespace ?? ''}|${c.name}`}>
              {c.qualified_name}
            </option>
          ))}
        </select>
        <div className="hint">{tr('cfg.mgo.targetHint')}</div>
        <input
          style={{ marginTop: 6 }}
          placeholder={tr('cfg.mgo.targetPh')}
          value={String(params.table ?? '')}
          onChange={(e) => set({ table: e.target.value || undefined })}
        />
      </div>

      <div className="field">
        <label>{tr('cfg.tgt.mode')}</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="upsert">{tr('cfg.mgo.upsert')}</option>
          <option value="append">{tr('cfg.tgt.append')}</option>
          <option value="overwrite">{tr('cfg.tgt.overwrite')}</option>
        </select>
      </div>

      {mode === 'upsert' && (
        <div className="field">
          <label>{tr('cfg.mgo.keyFields')}</label>
          <input
            placeholder={tr('cfg.mgo.keyFieldsPh')}
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
          <div className="hint">{tr('cfg.mgo.keyFieldsHint')}</div>
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
      return t('cfg.json.mustBeObject')
    }
  } catch (e) {
    return t('cfg.json.invalid', { detail: e instanceof Error ? e.message : '' })
  }
  return null
}


/** SAP 소스 — 읽기 모드에 따라 필요한 설정이 완전히 다르다 (설계 문서 §5).
 *
 * 테이블은 **여기서** 정한다. 연결은 SAP 시스템 하나만 가리키므로,
 * 테이블마다 연결을 만들 필요가 없다.
 */
function SapSourceFields({ params, set, connectionId }: FieldProps & { connectionId?: string }) {
  const tr = useT()
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
        <label>{tr('cfg.sap.mode')}</label>
        <select value={mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="bapi">{tr('cfg.sap.bapi')}</option>
          <option value="read_table">RFC_READ_TABLE</option>
        </select>
        <div className="hint">
          {mode === 'bapi' ? tr('cfg.sap.bapiHint') : tr('cfg.sap.readTableHint')}
        </div>
      </div>

      {mode === 'bapi' ? (
        <>
          <div className="field">
            <label>{tr('cfg.sap.functionName')}</label>
            <input
              placeholder="BAPI_MATERIAL_GETLIST"
              value={String(params.function_name ?? '')}
              onChange={(e) => set({ function_name: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="field">
            <label>{tr('cfg.sap.resultTable')}</label>
            <input
              placeholder={tr('cfg.sap.resultTablePh')}
              value={String(params.result_table ?? '')}
              onChange={(e) => set({ result_table: e.target.value.toUpperCase() || undefined })}
            />
            <div className="hint">{tr('cfg.sap.resultTableHint')}</div>
          </div>
          <div className="field">
            <label>{tr('cfg.sap.parameters')}</label>
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
            <label>{tr('cfg.sap.table')}</label>
            <input
              placeholder="MARA"
              value={table}
              onChange={(e) => {
                const next = e.target.value.toUpperCase()
                // 테이블이 바뀌면 이전 테이블의 필드 선택은 무의미하다
                set({ table: next || undefined, columns: [], incremental_column: undefined })
              }}
            />
            {isLoading && <div className="hint">{tr('cfg.sap.fieldsLoading')}</div>}
            {isError && (
              <div className="hint" style={{ color: 'var(--red)' }}>
                {error instanceof Error ? error.message : tr('cfg.sap.tableReadFailed')}
              </div>
            )}
            {!table && <div className="hint">{tr('cfg.sap.tableHint')}</div>}
            {found && (
              <div className="hint">
                {tr('cfg.sap.tableMeta', {
                  name: found.name,
                  n: fields.length,
                  width: totalWidth,
                })}
              </div>
            )}
          </div>

          {fields.length > 0 && (
            <div className="field">
              <label>
                {tr('cfg.sap.fields')}{' '}
                {columns.length > 0
                  ? tr('cfg.sap.fieldsChosen', { n: columns.length })
                  : tr('cfg.sap.fieldsAll')}
              </label>
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
                {tr('cfg.sap.widthMeter', { width: effectiveWidth })}
                {willSplit && tr('cfg.sap.willSplit')}
              </div>
            </div>
          )}

          <div className="field">
            <label>{tr('cfg.sap.where')}</label>
            <input
              placeholder="MTART = 'FERT'"
              value={String(params.where ?? '')}
              onChange={(e) => set({ where: e.target.value })}
            />
            <div className="hint">{tr('cfg.sap.whereHint')}</div>
          </div>

          <div className="field">
            <label>{tr('cfg.mgo.watermark')}</label>
            <select
              value={String(params.incremental_column ?? '')}
              onChange={(e) => set({ incremental_column: e.target.value || undefined })}
              disabled={fields.length === 0}
            >
              <option value="">{tr('cfg.src.fullLoad')}</option>
              {fields.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} · {c.data_type}
                </option>
              ))}
            </select>
            <div className="hint">{tr('cfg.sap.watermarkHint')}</div>
          </div>
        </>
      )}

      <div className="field">
        <label>{tr('cfg.src.batchSize')}</label>
        <input
          type="number"
          min={1}
          value={Number(params.batch_size ?? 2000)}
          onChange={(e) => set({ batch_size: Number(e.target.value) || 2000 })}
        />
        <div className="hint">{tr('cfg.sap.batchHint')}</div>
      </div>
    </>
  )
}

/** Mongo 필터가 JSON 객체인지 즉시 알려준다 — 저장 후 실행에서 터지면 늦다 */

