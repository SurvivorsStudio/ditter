import type { JSX } from 'react'
import { Icon } from '../components/icons'
import type { NodeKind } from '../api/types'

export type NodeCategory = '트리거' | '소스' | '변환' | '타깃' | '주석'

/** 스위치에서 아무 case 에도 안 맞은 행이 가는 기본(그 외) 출력 핸들 id. 백엔드와 짝. */
export const SWITCH_DEFAULT_HANDLE = '__default__'

/** 스위치 case 의 안정적인 고유 id. 엣지의 source_handle 로 쓰이므로 순서가 바뀌어도 유지된다. */
export function newCaseId(): string {
  return 'c' + Math.random().toString(36).slice(2, 9)
}

export type SwitchCase = { id?: string; label?: string; match?: string; conditions?: unknown[] }
export type SwitchOutput = { id: string; label: string }

/** 스위치 노드의 출력 포트 목록 — case 들 + 기본(그 외). 핸들·엣지가 이 id 를 쓴다. */
export function switchOutputs(params: Record<string, unknown>): SwitchOutput[] {
  const cases = Array.isArray(params.cases) ? (params.cases as SwitchCase[]) : []
  const outs = cases.map((c, i) => ({
    id: String(c.id ?? `case_${i}`),
    label: String(c.label || `분기 ${i + 1}`),
  }))
  outs.push({ id: SWITCH_DEFAULT_HANDLE, label: '그 외' })
  return outs
}

/** Python 전처리 노드 — 행 단위 골격. 각 레코드(row)를 받아 변환해 돌려준다. */
export const DEFAULT_PYCODE = `# 각 레코드(row: dict)를 받아 변환해 돌려줍니다.
# None 을 반환하면 그 행은 제외됩니다.
# pandas 사용 가능: import pandas as pd
# 그 외: datetime, re, json, math, hashlib, decimal, base64, uuid 등 (표준 모듈 일부)
def transform(row):
    return row
`

/** Python 전처리 노드 — 배치 단위 골격. 전체 행을 DataFrame 으로 한 번에 처리한다. */
export const DEFAULT_PYCODE_BATCH = `# 전체 행을 pandas DataFrame(df)으로 한 번에 받아 처리합니다.
# DataFrame 을 반환하세요 (groupby·정렬·중복제거 등).
import pandas as pd

def transform_batch(df):
    return df
`

export type NodeSpec = {
  kind: NodeKind
  title: string
  hint: string
  category: NodeCategory
  /** 카테고리 안의 소분류. 팔레트에서 작은 구분선으로 묶는다 (예: 소스 > 실시간(CDC)). */
  group?: string
  /** 노드 타입별 컬러 (설계 문서 §8) */
  color: string
  icon: () => JSX.Element
  /** 이 노드가 요구하는 커넥터 타입. 없으면 연결이 필요 없는 노드. */
  connectorType?: string
  defaultParams: Record<string, unknown>
}

export const NODE_SPECS: NodeSpec[] = [
  {
    kind: 'trigger.schedule',
    title: '스케줄 (Cron)',
    hint: '주기 실행',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.clock,
    defaultParams: { cron: '0 2 * * *', timezone: 'Asia/Seoul' },
  },
  {
    kind: 'trigger.manual',
    title: '수동 실행',
    hint: '버튼 트리거',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.bolt,
    defaultParams: {},
  },
  {
    kind: 'trigger.api',
    title: 'API 호출',
    hint: '외부에서 값 받아 실행',
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
    title: 'CDC 스트림',
    hint: '상시 실시간 수집',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.broadcast,
    defaultParams: {},
  },
  {
    kind: 'trigger.sync',
    title: '실시간 동기화',
    hint: '원본 트리거로 상시 복제',
    category: '트리거',
    color: 'var(--trig)',
    icon: Icon.broadcast,
    defaultParams: {},
  },
  {
    kind: 'source.mysql',
    title: 'MySQL',
    hint: '테이블 조회',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.db,
    connectorType: 'mysql',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.postgres',
    title: 'PostgreSQL',
    hint: '테이블/쿼리',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.db,
    connectorType: 'postgres',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.mssql',
    title: 'MSSQL',
    hint: '테이블/쿼리',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.db,
    connectorType: 'mssql',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.mongo',
    title: 'MongoDB',
    hint: '컬렉션',
    category: '소스',
    color: 'var(--src)',
    icon: Icon.leaf,
    connectorType: 'mongo',
    defaultParams: { batch_size: 5000 },
  },
  {
    kind: 'source.sap',
    title: 'SAP (RFC)',
    hint: 'BAPI / RFC_READ',
    category: '소스',
    color: 'var(--sap)',
    icon: Icon.sap,
    connectorType: 'sap_rfc',
    defaultParams: { mode: 'read_table', batch_size: 2000 },
  },
  {
    kind: 'source.cdc.mysql',
    title: 'MySQL (CDC)',
    hint: 'binlog 실시간 변경',
    category: '소스',
    group: '실시간 (CDC)',
    color: 'var(--src)',
    icon: Icon.broadcast,
    connectorType: 'mysql',
    defaultParams: { tables: [], snapshot: 'initial', delete_mode: 'soft' },
  },
  {
    kind: 'source.cdc.postgres',
    title: 'PostgreSQL (CDC)',
    hint: 'WAL 논리복제',
    category: '소스',
    group: '실시간 (CDC)',
    color: 'var(--src)',
    icon: Icon.broadcast,
    connectorType: 'postgres',
    defaultParams: { tables: [], snapshot: 'initial', delete_mode: 'soft' },
  },
  {
    kind: 'source.cdc.mssql',
    title: 'MSSQL (CDC)',
    hint: 'SQL Server CDC',
    category: '소스',
    group: '실시간 (CDC)',
    color: 'var(--src)',
    icon: Icon.broadcast,
    connectorType: 'mssql',
    defaultParams: { tables: [], snapshot: 'initial', delete_mode: 'soft' },
  },
  {
    kind: 'source.sync.mssql',
    title: 'MSSQL (실시간 동기화)',
    hint: '트리거 기반 · CDC 불필요',
    category: '소스',
    group: '실시간 동기화',
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
    title: '필터',
    hint: '조건 필터링',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.filter,
    defaultParams: { match: 'all', conditions: [] },
  },
  {
    kind: 'transform.map',
    title: '필드 매핑',
    hint: '컬럼 변환',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.map,
    defaultParams: { mappings: [], drop_unmapped: true },
  },
  {
    kind: 'transform.python',
    title: 'Python 코드',
    hint: '전처리 스크립트',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.code,
    defaultParams: { code: DEFAULT_PYCODE },
  },
  {
    kind: 'logic.switch',
    title: '스위치',
    hint: '조건 분기',
    category: '변환',
    color: 'var(--tr)',
    icon: Icon.branch,
    defaultParams: {
      cases: [{ id: newCaseId(), label: '분기 1', match: 'all', conditions: [] }],
    },
  },
  {
    kind: 'target.db',
    title: 'Target DB',
    hint: 'Upsert 적재',
    category: '타깃',
    color: 'var(--tg)',
    icon: Icon.db,
    defaultParams: { mode: 'upsert', key_columns: [] },
  },
  {
    kind: 'target.mongo',
    title: 'MongoDB',
    hint: '컬렉션 적재',
    category: '타깃',
    color: 'var(--tg)',
    icon: Icon.leaf,
    connectorType: 'mongo',
    defaultParams: { mode: 'upsert', key_columns: [] },
  },
  {
    kind: 'target.s3',
    title: 'Amazon S3',
    hint: 'Parquet 적재',
    category: '타깃',
    color: 'var(--amber)',
    icon: Icon.cloud,
    connectorType: 's3',
    defaultParams: { mode: 'append', file_format: 'parquet' },
  },
  {
    kind: 'target.file',
    title: '로컬 파일',
    hint: '테스트용 파일 저장',
    category: '타깃',
    color: 'var(--amber)',
    icon: Icon.file,
    connectorType: 'local_file',
    defaultParams: { mode: 'append', file_format: 'jsonl' },
  },
  {
    kind: 'target.response',
    title: 'API 응답',
    hint: '호출자에게 결과 반환',
    category: '타깃',
    color: 'var(--tg)',
    icon: Icon.bolt,
    // 연결이 없다 — 어디에도 적재하지 않고 돌려주기만 한다.
    // max_rows 는 필수다: 행을 메모리에 모으므로 상한이 없으면 워커가 통째로 삼켜진다.
    defaultParams: { max_rows: 100, columns: [] },
  },
  {
    kind: 'target.sync.db',
    title: '동기화 타깃 DB',
    hint: 'SymmetricDS 직송',
    category: '타깃',
    group: '실시간 동기화',
    color: 'var(--tg)',
    icon: Icon.broadcast,
    connectorType: 'postgres',
    defaultParams: { namespace: 'public', table_mappings: [] },
  },
  {
    kind: 'note.memo',
    title: '메모',
    hint: '캔버스 주석 (실행 안 함)',
    category: '주석',
    color: 'var(--memo, #f4b740)',
    icon: Icon.note,
    defaultParams: { text: '', color: 'yellow' },
  },
  {
    kind: 'note.group',
    title: '그룹 영역',
    hint: '노드를 사각형으로 묶어 구분',
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
