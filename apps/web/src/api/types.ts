import { z } from 'zod'

/** 백엔드 응답은 전부 zod 로 검증한다 (코딩 컨벤션 §11) */

export const nodeKindSchema = z.enum([
  'trigger.schedule',
  'trigger.manual',
  // 외부 REST 호출 트리거 — 본문 값을 $변수로 주입한다. 백엔드 NodeKind.API 와 짝
  'trigger.api',
  // 상시 스트리밍 트리거 (Phase 4 CDC) — 백엔드 dag.py 의 NodeKind.CDC 와 짝
  'trigger.cdc',
  // 실시간 DB 동기화 트리거 (SymmetricDS) — 백엔드 NodeKind.SYNC 와 짝.
  // CDC 처럼 '켜둔다'는 뜻이지만 엔진이 다르다 (Kafka 를 거치지 않고 노드끼리 직송).
  'trigger.sync',
  'source.mysql',
  'source.postgres',
  'source.mssql',
  'source.mongo',
  'source.sap',
  // CDC 소스 (실시간) — read() 로 당기지 않고 Debezium 커넥터 설정으로 표현된다
  'source.cdc.mysql',
  'source.cdc.postgres',
  'source.cdc.mssql',
  // 실시간 동기화 소스 — 데이터가 워커를 지나지 않는다(SymmetricDS 가 타깃 DB 로 직송).
  // 그래서 뒤에 변환 노드를 이을 수 없고 target.sync.db 만 연결할 수 있다.
  'source.sync.mssql',
  'transform.filter',
  'transform.map',
  // 사용자 Python 코드 전처리 — 백엔드 dag.py 의 NodeKind.TRANSFORM_PYTHON 과 짝
  'transform.python',
  // 스위치(조건 분기) — 출력이 여러 개. 백엔드 NodeKind.LOGIC_SWITCH 와 짝
  'logic.switch',
  'target.db',
  'target.mongo',
  'target.s3',
  'target.file',
  // 호출자에게 결과를 돌려주는 타깃 — 연결이 없다. 백엔드 NodeKind.TARGET_RESPONSE 와 짝
  'target.response',
  // 실시간 동기화 타깃 — 워커가 write() 하지 않고 '어디로 밀어 넣을지'만 선언한다
  'target.sync.db',
  'note.memo',
  'note.group',
])
export type NodeKind = z.infer<typeof nodeKindSchema>

/** API 트리거가 선언하는 입력 변수 하나. 백엔드 `dag.py` 의 TriggerVariable 과 짝. */
export const triggerVariableSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  required: z.boolean().default(true),
  default: z.union([z.string(), z.number(), z.boolean()]).nullable().default(null),
  example: z.union([z.string(), z.number(), z.boolean()]).nullable().default(null),
  description: z.string().default(''),
})
export type TriggerVariable = z.infer<typeof triggerVariableSchema>

export const pipelineNodeSchema = z.object({
  id: z.string(),
  kind: nodeKindSchema,
  label: z.string().default(''),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  params: z.record(z.unknown()).default({}),
})
export type PipelineNode = z.infer<typeof pipelineNodeSchema>

export const pipelineEdgeSchema = z.object({
  id: z.string().default(''),
  source: z.string(),
  target: z.string(),
  // 스위치 등 다중 출력 노드에서 어느 포트에서 나온 엣지인지 (백엔드 source_handle 과 짝)
  source_handle: z.string().nullish(),
})
export type PipelineEdge = z.infer<typeof pipelineEdgeSchema>

export const pipelineDefinitionSchema = z.object({
  nodes: z.array(pipelineNodeSchema).default([]),
  edges: z.array(pipelineEdgeSchema).default([]),
  variables: z.record(z.unknown()).default({}),
})
export type PipelineDefinition = z.infer<typeof pipelineDefinitionSchema>

export const connectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string().nullable().default(null),
  config: z.record(z.unknown()).default({}),
  pool_size: z.number().default(5),
  ssl: z.boolean().default(false),
  cdc_enabled: z.boolean().default(false),
  has_secret: z.boolean().default(false),
  health_status: z.string().default('unknown'),
  health_message: z.string().nullable().default(null),
  last_tested_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Connection = z.infer<typeof connectionSchema>

export const testResultSchema = z.object({
  status: z.string(),
  message: z.string().default(''),
  latency_ms: z.number().nullable().default(null),
  server_version: z.string().nullable().default(null),
})
export type TestResult = z.infer<typeof testResultSchema>

export const columnSchema = z.object({
  name: z.string(),
  data_type: z.string(),
  nullable: z.boolean().default(true),
  primary_key: z.boolean().default(false),
})

export const tableSchema = z.object({
  name: z.string(),
  namespace: z.string().nullable().default(null),
  qualified_name: z.string(),
  columns: z.array(columnSchema).default([]),
})
export type TableSchema = z.infer<typeof tableSchema>

export const schemaOutSchema = z.object({
  connection_id: z.string(),
  tables: z.array(tableSchema),
})

// DBeaver 식 카테고리 트리 — 테이블·뷰·함수·프로시저·시퀀스·컬렉션
export const dbObjectSchema = z.object({
  name: z.string(),
  kind: z.string(),
  namespace: z.string().nullable().default(null),
  qualified_name: z.string(),
})
export type DbObject = z.infer<typeof dbObjectSchema>

export const objectsOutSchema = z.object({
  connection_id: z.string(),
  objects: z.array(dbObjectSchema),
})

// 우클릭 → 상세 보기 (컬럼·PK·인덱스·정의 스크립트·부가정보)
export const indexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()).default([]),
  unique: z.boolean().default(false),
  primary: z.boolean().default(false),
  definition: z.string().nullable().default(null),
})
export type DbIndex = z.infer<typeof indexSchema>

export const objectDetailSchema = z.object({
  kind: z.string(),
  name: z.string(),
  namespace: z.string().nullable().default(null),
  qualified_name: z.string(),
  columns: z.array(columnSchema).default([]),
  indexes: z.array(indexSchema).default([]),
  definition: z.string().nullable().default(null),
  info: z.record(z.string()).default({}),
})
export type ObjectDetail = z.infer<typeof objectDetailSchema>

export const usageSchema = z.object({
  pipeline_id: z.string(),
  pipeline_name: z.string(),
  pipeline_status: z.string(),
  node_ids: z.array(z.string()).default([]),
})
export type Usage = z.infer<typeof usageSchema>

export const usagesSchema = z.object({
  connection_id: z.string(),
  connection_name: z.string(),
  in_use: z.boolean(),
  usages: z.array(usageSchema).default([]),
})

export const deleteResultSchema = z.object({
  deleted: z.boolean(),
  affected_pipelines: z.array(z.string()).default([]),
})

export const previewSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
  truncated: z.boolean().default(false),
})
export type Preview = z.infer<typeof previewSchema>

export const queryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
  row_count: z.number(),
  truncated: z.boolean().default(false),
  elapsed_ms: z.number(),
  total: z.number().nullable().default(null),
  /** 실행된 선두 명령 (select·insert·update…). 연결의 허용 명령이 무엇을 허락했는지에 따라 갈린다. */
  statement: z.string().default('select'),
  /** 쓰기 문장이 바꾼 행 수. SELECT 이거나 방언이 알려주지 않으면 null. */
  affected_rows: z.number().nullable().default(null),
})
export type QueryResult = z.infer<typeof queryResultSchema>

// 쿼리 실행 계획 (EXPLAIN [ANALYZE])
export const explainOutSchema = z.object({
  plan: z.string(),
  analyzed: z.boolean().default(false),
})
export type ExplainOut = z.infer<typeof explainOutSchema>

// AI 어시스턴트 (자연어 SQL 생성·튜닝, POST /ai/chat)
export const aiChatOutSchema = z.object({
  message: z.object({ role: z.string(), content: z.string() }),
  sql: z.string().nullable().default(null),
  dialect: z.string().nullable().default(null),
  schema_note: z.string().nullable().default(null),
  usage: z.record(z.string(), z.unknown()).nullable().default(null),
})
export type AiChatOut = z.infer<typeof aiChatOutSchema>

/** 연합 조회를 재현하는 파이썬 스크립트 (`POST /duckdb/script`). */
export const duckScriptSchema = z.object({
  filename: z.string(),
  code: z.string(),
  password_envs: z.array(z.string()).default([]),
})
export type DuckScript = z.infer<typeof duckScriptSchema>

export const pipelineSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  status: z.string(),
  schedule: z.string().nullable().default(null),
  schedule_enabled: z.boolean().default(false),
  flow: z.array(z.string()).default([]),
  last_run_status: z.string().nullable().default(null),
  last_run_at: z.string().nullable().default(null),
  updated_at: z.string(),
})
export type PipelineSummary = z.infer<typeof pipelineSummarySchema>

/** 파이프라인을 지우면 무엇이 함께 사라지고 무엇이 막고 있는지 (백엔드 DeletionImpact).
 *  삭제 전 확인 대화상자가 읽고, 삭제 응답도 같은 모양으로 돌아온다. */
export const deletionImpactSchema = z.object({
  pipeline_id: z.string(),
  pipeline_name: z.string(),
  runs_total: z.number().default(0),
  versions_total: z.number().default(0),
  checkpoints_total: z.number().default(0),
  last_run_at: z.string().nullable().default(null),
  active_run_id: z.string().nullable().default(null),
  active_run_status: z.string().nullable().default(null),
  cdc_stream_id: z.string().nullable().default(null),
  cdc_stream_status: z.string().nullable().default(null),
  deletable: z.boolean().default(true),
  blockers: z.array(z.string()).default([]),
})
export type DeletionImpact = z.infer<typeof deletionImpactSchema>

/** 외부 호출 창구(웹훅). 토큰 원문은 들어 있지 않다 — 발급 응답에만 나온다. */
export const triggerSchema = z.object({
  id: z.string(),
  pipeline_id: z.string(),
  name: z.string(),
  token_prefix: z.string(),
  enabled: z.boolean().default(true),
  last_called_at: z.string().nullable().default(null),
  call_count: z.number().default(0),
  created_at: z.string(),
})
export type Trigger = z.infer<typeof triggerSchema>

/** 발급 직후에만 오는 응답. `token` 은 이때 한 번만 볼 수 있다. */
export const triggerCreatedSchema = triggerSchema.extend({
  token: z.string(),
  url: z.string(),
})
export type TriggerCreated = z.infer<typeof triggerCreatedSchema>

export const pipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  definition: pipelineDefinitionSchema,
  schedule: z.string().nullable().default(null),
  timezone: z.string().default('Asia/Seoul'),
  schedule_enabled: z.boolean().default(false),
  version: z.number(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Pipeline = z.infer<typeof pipelineSchema>

export const validationIssueSchema = z.object({
  level: z.enum(['error', 'warning']),
  node_id: z.string().nullable().default(null),
  message: z.string(),
})
export type ValidationIssue = z.infer<typeof validationIssueSchema>

export const validationSchema = z.object({
  valid: z.boolean(),
  order: z.array(z.string()).default([]),
  issues: z.array(validationIssueSchema).default([]),
})
export type Validation = z.infer<typeof validationSchema>

export const runSchema = z.object({
  id: z.string(),
  pipeline_id: z.string(),
  pipeline_version: z.number(),
  status: z.string(),
  trigger: z.string(),
  started_at: z.string().nullable().default(null),
  finished_at: z.string().nullable().default(null),
  records: z.number().default(0),
  progress: z.number().default(0),
  error: z.string().nullable().default(null),
  node_states: z.record(z.unknown()).default({}),
  created_at: z.string(),
})
export type Run = z.infer<typeof runSchema>

export const runListItemSchema = z.object({
  id: z.string(),
  pipeline_id: z.string(),
  pipeline_name: z.string(),
  status: z.string(),
  trigger: z.string(),
  records: z.number().default(0),
  progress: z.number().default(0),
  duration_seconds: z.number().nullable().default(null),
  started_at: z.string().nullable().default(null),
})
export type RunListItem = z.infer<typeof runListItemSchema>

export const runPageSchema = z.object({
  items: z.array(runListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
})

export const runLogSchema = z.object({
  id: z.number(),
  run_id: z.string(),
  node_id: z.string().nullable().default(null),
  level: z.string(),
  message: z.string(),
  ts: z.string(),
})
export type RunLog = z.infer<typeof runLogSchema>

export const statsSchema = z.object({
  pipelines_total: z.number().default(0),
  pipelines_active: z.number().default(0),
  pipelines_inactive: z.number().default(0),
  runs_success_today: z.number().default(0),
  runs_failed_today: z.number().default(0),
  runs_total_24h: z.number().default(0),
  runs_scheduled_24h: z.number().default(0),
  runs_manual_24h: z.number().default(0),
  records_24h: z.number().default(0),
  success_rate_24h: z.number().default(0),
  avg_duration_seconds: z.number().nullable().default(null),
  median_duration_seconds: z.number().nullable().default(null),
})
export type Stats = z.infer<typeof statsSchema>

/** WebSocket 이벤트 */
export const runEventSchema = z.object({
  type: z.enum(['snapshot', 'status', 'progress', 'log', 'node']),
  run_id: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  ts: z.string().optional(),
})
export type RunEvent = z.infer<typeof runEventSchema>

/** 노드 실행 결과 샘플 (엣지 위 미리보기) */
export const nodeSampleSchema = z.object({
  columns: z.array(z.string()).default([]),
  rows: z.array(z.record(z.unknown())).default([]),
  truncated: z.boolean().default(false),
})
export type NodeSample = z.infer<typeof nodeSampleSchema>

/** 노드 실행 상태 (Run.node_states 의 값) */
export const nodeStateSchema = z.object({
  status: z.string().default('pending'),
  records: z.number().default(0),
  message: z.string().default(''),
  location: z.string().nullable().default(null),
  sample: nodeSampleSchema.optional(),
  /** API 트리거가 선으로 넘긴 **값 그 자체** {이름: 값} — 엣지 칩에 뜨는 것이 이것이다. */
  handed: z.record(z.unknown()).optional(),
  /** 그 값으로 하류 노드 설정이 어떻게 바뀌었는지 {하류_노드_id: {파라미터: 치환된 값}}.
   *  엣지 상세 모달에서 저작↔실행 대비에 쓴다. 트리거 노드에만 있다. */
  applied: z.record(z.record(z.unknown())).optional(),
})
export type NodeState = z.infer<typeof nodeStateSchema>

/* ------------------------------------------------------------ CDC 스트림 (Phase 4) */

/** 스트림 상세·지표 스냅샷 (백엔드 schemas/stream.py CdcStreamOut) */
export const cdcStreamSchema = z.object({
  id: z.string(),
  pipeline_id: z.string(),
  status: z.string(),
  /** debezium | symmetricds — 무엇이 변경을 잡아 어디로 보내는가 */
  engine: z.string().default('debezium'),
  debezium_connector: z.string().nullable().default(null),
  source_connection_id: z.string().nullable().default(null),
  target_connection_id: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  config: z.record(z.unknown()).default({}),
  last_event_at: z.string().nullable().default(null),
  metrics: z.record(z.unknown()).default({}),
  error: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
})
export type CdcStream = z.infer<typeof cdcStreamSchema>

/** Monitor Streams 탭 한 줄 (CdcStreamListItem) */
export const cdcStreamListItemSchema = z.object({
  id: z.string(),
  pipeline_id: z.string(),
  pipeline_name: z.string(),
  status: z.string(),
  engine: z.string().default('debezium'),
  events_total: z.number().default(0),
  eps: z.number().default(0),
  lag_ms: z.number().nullable().default(null),
  subscribed: z.boolean().default(false),
  last_event_at: z.string().nullable().default(null),
  started_at: z.string().nullable().default(null),
})
export type CdcStreamListItem = z.infer<typeof cdcStreamListItemSchema>

/** 연결 CDC 전제조건 점검 결과 (PreflightOut) */
export const preflightCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  ok: z.boolean(),
  detail: z.string().default(''),
  /** error 면 통과해야 시작할 수 있고, warning·info 는 알리기만 한다 */
  level: z.string().default('error'),
})
export type PreflightCheck = z.infer<typeof preflightCheckSchema>

export const preflightSchema = z.object({
  connection_id: z.string(),
  connection_name: z.string(),
  ready: z.boolean(),
  checks: z.array(preflightCheckSchema).default([]),
})
export type Preflight = z.infer<typeof preflightSchema>

/* --------------------------------------------- 실시간 DB 동기화 (SymmetricDS) */

/** 동기화 대상 테이블 한 줄의 점검 결과 (백엔드 SyncTableCheck) */
export const syncTableCheckSchema = z.object({
  name: z.string(),
  namespace: z.string().default(''),
  exists: z.boolean().default(false),
  has_primary_key: z.boolean().default(false),
  channel: z.string().default(''),
  row_count: z.number().nullable().default(null),
})
export type SyncTableCheck = z.infer<typeof syncTableCheckSchema>

/** 착수 전 점검 결과 (백엔드 SyncPreflightOut).
 *  ready 는 **error 레벨만** 본다 — 부하 테스트·복제본 용도처럼 코드가 판정할 수 없는
 *  것은 warning 이라 시작을 막지 않는다. */
export const syncPreflightSchema = z.object({
  pipeline_id: z.string(),
  source_connection_id: z.string().default(''),
  source_connection_name: z.string().default(''),
  target_connection_id: z.string().default(''),
  target_connection_name: z.string().default(''),
  ready: z.boolean().default(false),
  server_version: z.string().default(''),
  edition: z.string().default(''),
  checks: z.array(preflightCheckSchema).default([]),
  tables: z.array(syncTableCheckSchema).default([]),
})
export type SyncPreflight = z.infer<typeof syncPreflightSchema>

/** SymmetricDS 채널 — 전송 단위이자 우선순위 단위. 백엔드 dag.py 의 SYNC_CHANNELS 와 짝.
 *  대량 배치가 발생하는 테이블을 realtime 에 넣으면 채널을 점유해 다른 테이블의
 *  실시간성을 망친다 — 그래서 테이블마다 고르게 한다. */
//  라벨·설명은 여기 두지 않는다 — 화면은 `sync.channel.<id>.label|hint` 사전을 본다.
//  같은 문자열을 두 군데 두면 한쪽만 고쳤을 때 조용히 갈라진다.
export const SYNC_CHANNELS = [{ id: 'realtime' }, { id: 'standard' }, { id: 'bulk' }] as const

/** 복제본의 최종 용도. 백엔드 SYNC_PURPOSES 와 짝. */
//  라벨은 `sync.purpose.<id>` 사전을 본다 (위와 같은 이유).
export const SYNC_PURPOSES = [{ id: 'readonly' }, { id: 'operational' }] as const
