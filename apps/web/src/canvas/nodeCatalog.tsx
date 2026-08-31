import type { JSX } from 'react'
import { Icon } from '../components/icons'
import { t, type MsgKey } from '../i18n'
import { nodes as NODE_MESSAGES } from '../i18n/messages/nodes'
import type { NodeKind } from '../api/types'

/** 카테고리 id — 팔레트 그룹핑·비교에 쓰이는 **내부 값**이라 한글 그대로 둔다.
 *  화면에 그릴 때만 CATEGORY_KEY 를 거쳐 번역한다. */
export type NodeCategory = '트리거' | '소스' | '변환' | '타깃' | '주석'

export const CATEGORY_KEY: Record<NodeCategory, MsgKey> = {
  트리거: 'nodeCategory.trigger',
  소스: 'nodeCategory.source',
  변환: 'nodeCategory.transform',
  타깃: 'nodeCategory.target',
  주석: 'nodeCategory.note',
}

/** 스위치에서 아무 case 에도 안 맞은 행이 가는 기본(그 외) 출력 핸들 id. 백엔드와 짝. */
export const SWITCH_DEFAULT_HANDLE = '__default__'

/** 스위치 case 의 안정적인 고유 id. 엣지의 source_handle 로 쓰이므로 순서가 바뀌어도 유지된다. */
export function newCaseId(): string {
  return 'c' + Math.random().toString(36).slice(2, 9)
}

export type SwitchCase = { id?: string; label?: string; match?: string; conditions?: unknown[] }
export type SwitchOutput = { id: string; label: string }

/** 스위치 노드의 출력 포트 목록 — case 들 + 기본(그 외). 핸들·엣지가 이 id 를 쓴다.
 *  라벨은 그릴 때마다 현재 언어로 만든다 — id 는 언어와 무관하게 안정적이다. */
export function switchOutputs(params: Record<string, unknown>): SwitchOutput[] {
  const cases = Array.isArray(params.cases) ? (params.cases as SwitchCase[]) : []
  const outs = cases.map((c, i) => ({
    id: String(c.id ?? `case_${i}`),
    label: String(c.label || t('node.switch.case', { n: i + 1 })),
  }))
  outs.push({ id: SWITCH_DEFAULT_HANDLE, label: t('node.switch.default') })
  return outs
}

/** Python 전처리 골격 — **생성 시점의 언어**로 코드에 박힌다. 이미 만든 노드의 코드는
 *  사용자 데이터라 언어를 바꿔도 따라가지 않는다. */
export function defaultPycode(target: 'row' | 'batch' = 'row'): string {
  return t(target === 'batch' ? 'node.pycode.batch' : 'node.pycode.row')
}

/** 어느 언어·모드로 만들어졌든 기본 골격 그대로인가 — 덮어쓰기 확인을 건너뛸 판단에 쓴다.
 *  현재 언어만 보면 ko 로 만든 노드를 en 화면에서 커스텀 코드로 오판한다. */
const PYCODE_TEMPLATES: readonly string[] = [
  ...NODE_MESSAGES['node.pycode.row'],
  ...NODE_MESSAGES['node.pycode.batch'],
].map((s) => s.trim())

export function isDefaultPycode(code: string): boolean {
  return PYCODE_TEMPLATES.includes(code.trim())
}

export type NodeSpec = {
  kind: NodeKind
  /** 팔레트 표시이자 새 노드 기본 이름의 시드 — 그릴 때 t() 를 거친다. */
  titleKey: MsgKey
  hintKey: MsgKey
  category: NodeCategory
  /** 카테고리 안의 소분류. 팔레트에서 작은 구분선으로 묶는다 (예: 소스 > 실시간(CDC)). */
  groupKey?: MsgKey
  /** 노드 타입별 컬러 (설계 문서 §8) */
  color: string
  icon: () => JSX.Element
  /** 이 노드가 요구하는 커넥터 타입. 없으면 연결이 필요 없는 노드. */
  connectorType?: string
  defaultParams: Record<string, unknown>
}

/** 새 노드에 넣을 파라미터 — 언어 의존 시드(스위치 분기 이름·Python 골격)는 여기서
 *  생성 시점 언어로 만든다. 스위치 case 배열도 매번 새로 만들어, 노드끼리 같은 배열을
 *  공유하는 일이 없다. */
export function defaultParamsFor(spec: NodeSpec): Record<string, unknown> {
  if (spec.kind === 'logic.switch')
    return {
      cases: [{ id: newCaseId(), label: t('node.switch.case', { n: 1 }), match: 'all', conditions: [] }],
    }
  if (spec.kind === 'transform.python') return { code: defaultPycode('row') }
  return { ...spec.defaultParams }
}

export const NODE_SPECS: NodeSpec[] = [
  {
    kind: 'trigger.schedule',
    titleKey: 'node.trigger.schedule.title',
    hintKey: 'node.trigger.schedule.hint',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.clock,
    defaultParams: { cron: '0 2 * * *', timezone: 'Asia/Seoul' },
  },
  {
    kind: 'trigger.manual',
    titleKey: 'node.trigger.manual.title',
    hintKey: 'node.trigger.manual.hint',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.bolt,
    defaultParams: {},
  },
  {
    kind: 'trigger.api',
    titleKey: 'node.trigger.api.title',
    hintKey: 'node.trigger.api.hint',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.bolt,
    // 변수를 하나 깔아둔다 — 빈 목록으로 두면 이 노드가 무엇을 하는 것인지 화면에 드러나지 않는다
    defaultParams: {
      variables: [
        { name: 'since', type: 'string', required: true, example: '2026-08-01', description: '' },
      ],
    },
  },
  {
    kind: 'trigger.cdc',
    titleKey: 'node.trigger.cdc.title',
    hintKey: 'node.trigger.cdc.hint',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.broadcast,
    defaultParams: {},
  },
  {
    kind: 'trigger.sync',
    titleKey: 'node.trigger.sync.title',
    hintKey: 'node.trigger.sync.hint',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.broadcast,
    defaultParams: {},
  },
  {
    kind: 'source.mysql',
    titleKey: 'node.source.mysql.title',
    hintKey: 'node.source.mysql.hint',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.db,
    connectorType: 'mysql',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.postgres',
    titleKey: 'node.source.postgres.title',
    hintKey: 'node.source.postgres.hint',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.db,
    connectorType: 'postgres',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.mssql',
    titleKey: 'node.source.mssql.title',
    hintKey: 'node.source.mssql.hint',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.db,
    connectorType: 'mssql',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.mongo',
    titleKey: 'node.source.mongo.title',
    hintKey: 'node.source.mongo.hint',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.leaf,
    connectorType: 'mongo',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.sap',
    titleKey: 'node.source.sap.title',
    hintKey: 'node.source.sap.hint',
    category: '소스',
    color: 'var(--sap)',
    icon: Icon.sap,
    connectorType: 'sap_rfc',
    defaultParams: { mode: 'read_table', batch_size: 2000 },
  },
  {
    kind: 'source.cdc.mysql',
    titleKey: 'node.source.cdc.mysql.title',
    hintKey: 'node.source.cdc.mysql.hint',
    category: '소스',
    groupKey: 'nodeGroup.cdc',
    color: 'var(--src)',
    icon: Icon.broadcast,
    connectorType: 'mysql',
    defaultParams: { tables: [], snapshot: 'initial', delete_mode: 'soft' },
  },
  {
    kind: 'source.cdc.postgres',
    titleKey: 'node.source.cdc.postgres.title',
    hintKey: 'node.source.cdc.postgres.hint',
    category: '소스',
    groupKey: 'nodeGroup.cdc',
    color: 'var(--src)',
    icon: Icon.broadcast,
    connectorType: 'postgres',
    defaultParams: { tables: [], snapshot: 'initial', delete_mode: 'soft' },
  },
  {
    kind: 'source.cdc.mssql',
    titleKey: 'node.source.cdc.mssql.title',
    hintKey: 'node.source.cdc.mssql.hint',
    category: '소스',
    groupKey: 'nodeGroup.cdc',
    color: 'var(--src)',
    icon: Icon.broadcast,
    connectorType: 'mssql',
    defaultParams: { tables: [], snapshot: 'initial', delete_mode: 'soft' },
  },
  {
    kind: 'source.sync.mssql',
    titleKey: 'node.source.sync.mssql.title',
    hintKey: 'node.source.sync.mssql.hint',
    category: '소스',
    groupKey: 'nodeGroup.sync',
    color: 'var(--src)',
    icon: Icon.broadcast,
    connectorType: 'mssql',
    // purpose·load_test_ack 는 사람만 답할 수 있는 것이라 기본값을 '아직 아님'으로 둔다 —
    // 켜진 채로 시작하면 점검이 통과한 것처럼 보인다.
    defaultParams: {
      tables: [],
      namespace: 'dbo',
      purpose: 'readonly',
      load_test_ack: false,
      initial_load: true,
    },
  },
  {
    kind: 'transform.filter',
    titleKey: 'node.transform.filter.title',
    hintKey: 'node.transform.filter.hint',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.filter,
    defaultParams: { match: 'all', conditions: [] },
  },
  {
    kind: 'transform.map',
    titleKey: 'node.transform.map.title',
    hintKey: 'node.transform.map.hint',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.map,
    defaultParams: { mappings: [], drop_unmapped: true },
  },
  {
    kind: 'transform.python',
    titleKey: 'node.transform.python.title',
    hintKey: 'node.transform.python.hint',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.code,
    // 실제 골격 코드는 defaultParamsFor 가 생성 시점 언어로 채운다
    defaultParams: { code: '' },
  },
  {
    kind: 'logic.switch',
    titleKey: 'node.logic.switch.title',
    hintKey: 'node.logic.switch.hint',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.branch,
    // 실제 case 시드는 defaultParamsFor 가 생성 시점 언어로 채운다
    defaultParams: { cases: [] },
  },
  {
    kind: 'target.db',
    titleKey: 'node.target.db.title',
    hintKey: 'node.target.db.hint',
    category: '타깃',
    color: 'var(--tg)',
    icon: Icon.db,
    defaultParams: { mode: 'upsert', key_columns: [] },
  },
  {
    kind: 'target.mongo',
    titleKey: 'node.target.mongo.title',
    hintKey: 'node.target.mongo.hint',
    category: '타깃',
    color: 'var(--tg)',
    icon: Icon.leaf,
    connectorType: 'mongo',
    defaultParams: { mode: 'upsert', key_columns: [] },
  },
  {
    kind: 'target.s3',
    titleKey: 'node.target.s3.title',
    hintKey: 'node.target.s3.hint',
    category: '타깃',
    color: 'var(--amber)',
    icon: Icon.cloud,
    connectorType: 's3',
    defaultParams: { mode: 'append', file_format: 'parquet' },
  },
  {
    kind: 'target.file',
    titleKey: 'node.target.file.title',
    hintKey: 'node.target.file.hint',
    category: '타깃',
    color: 'var(--amber)',
    icon: Icon.file,
    connectorType: 'local_file',
    defaultParams: { mode: 'append', file_format: 'jsonl' },
  },
  {
    kind: 'target.response',
    titleKey: 'node.target.response.title',
    hintKey: 'node.target.response.hint',
    category: '타깃',
    color: 'var(--tg)',
    icon: Icon.bolt,
    // 연결이 없다 — 어디에도 적재하지 않고 돌려주기만 한다.
    // max_rows 는 필수다: 행을 메모리에 모으므로 상한이 없으면 워커가 통째로 삼켜진다.
    defaultParams: { max_rows: 100, columns: [] },
  },
  {
    kind: 'target.sync.db',
    titleKey: 'node.target.sync.db.title',
    hintKey: 'node.target.sync.db.hint',
    category: '타깃',
    groupKey: 'nodeGroup.sync',
    color: 'var(--tg)',
    icon: Icon.broadcast,
    connectorType: 'postgres',
    defaultParams: { namespace: 'public', table_mappings: [] },
  },
  {
    kind: 'note.memo',
    titleKey: 'node.note.memo.title',
    hintKey: 'node.note.memo.hint',
    category: '주석',
    color: 'var(--memo, #f4b740)',
    icon: Icon.note,
    defaultParams: { text: '', color: 'yellow' },
  },
  {
    kind: 'note.group',
    titleKey: 'node.note.group.title',
    hintKey: 'node.note.group.hint',
    category: '주석',
    color: '#5b8ee0',
    icon: Icon.frame,
    defaultParams: { title: '', color: 'blue', w: 320, h: 200 },
  },
]

export const SPEC_BY_KIND: Record<string, NodeSpec> = Object.fromEntries(
  NODE_SPECS.map((s) => [s.kind, s]),
)

export const CATEGORIES: NodeCategory[] = ['트리거', '소스', '변환', '타깃', '주석']

export function isTrigger(kind: string): boolean {
  return kind.startsWith('trigger.')
}
export function isSource(kind: string): boolean {
  return kind.startsWith('source.')
}
/** 실시간 CDC 소스. is_source 이기도 하지만 배치 read() 경로를 타지 않는다.
 *  백엔드 dag.py 의 CDC_SOURCE_KINDS 와 짝이다. */
export function isCdcSource(kind: string): boolean {
  return (
    kind === 'source.cdc.mysql' ||
    kind === 'source.cdc.postgres' ||
    kind === 'source.cdc.mssql'
  )
}
/** 상시 스트리밍 트리거. 배치 트리거와 실행 모델이 다르다. */
export function isCdcTrigger(kind: string): boolean {
  return kind === 'trigger.cdc'
}
/** 실시간 동기화 소스 (SymmetricDS). 백엔드 dag.py 의 SYNC_SOURCE_KINDS 와 짝이다.
 *  CDC 소스와 다른 점 하나가 결정적이다 — **데이터가 워커를 지나지 않는다.** */
export function isSyncSource(kind: string): boolean {
  return kind === 'source.sync.mssql'
}
/** 실시간 동기화 타깃. 워커가 write() 하지 않고 '어디로 밀어 넣을지'만 선언한다. */
export function isSyncTarget(kind: string): boolean {
  return kind === 'target.sync.db'
}
export function isSyncTrigger(kind: string): boolean {
  return kind === 'trigger.sync'
}
/** 이 노드가 실시간 동기화 파이프라인에 속하는가 — 캔버스가 실행 버튼과 연결 규칙을 가른다. */
export function isSyncKind(kind: string): boolean {
  return isSyncSource(kind) || isSyncTarget(kind) || isSyncTrigger(kind)
}
export function isTarget(kind: string): boolean {
  return kind.startsWith('target.')
}
export function isTransform(kind: string): boolean {
  return kind.startsWith('transform.')
}
/** 실행되지 않는 캔버스 주석. 백엔드 dag.py 의 NOTE_KINDS 와 짝이다. */
export function isNote(kind: string): boolean {
  return kind.startsWith('note.')
}
/** React Flow 노드 타입 — 메모·그룹은 완전히 다른 모양이라 별도 컴포넌트로 그린다 */
export function nodeTypeForKind(kind: string): string {
  if (kind === 'note.group') return 'frame'
  if (isNote(kind)) return 'memo'
  return 'eai'
}
/** 영역 그룹(프레임)인가 — 크기·z-order를 다르게 다룬다 */
export function isFrame(kind: string): boolean {
  return kind === 'note.group'
}

/** target.db 는 어떤 RDB 든 될 수 있어 커넥터 타입이 고정되지 않는다.
 *  백엔드 dag.py 의 DB_TARGET_TYPES 와 반드시 같아야 한다. */
export const DB_TARGET_TYPES = ['mysql', 'postgres', 'mssql']

/** 문서 지향 노드 — table 은 컬렉션, query 는 SQL 이 아니라 JSON 필터다 */
export function isDocumentKind(kind: string): boolean {
  return kind === 'source.mongo' || kind === 'target.mongo'
}

export function allowedConnectorTypes(kind: string): string[] | null {
  if (kind === 'target.db') return DB_TARGET_TYPES
  const spec = SPEC_BY_KIND[kind]
  return spec?.connectorType ? [spec.connectorType] : null
}
