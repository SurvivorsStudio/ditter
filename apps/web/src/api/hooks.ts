import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from './client'
import { DUCK_TYPES, duckDatabase, duckRef, type DuckTable } from '../canvas/duckRefs'
import {
  cdcStreamListItemSchema,
  cdcStreamSchema,
  connectionSchema,
  deleteResultSchema,
  deletionImpactSchema,
  pipelineSchema,
  pipelineSummarySchema,
  preflightSchema,
  syncPreflightSchema,
  previewSchema,
  duckScriptSchema,
  objectDetailSchema,
  objectsOutSchema,
  aiChatOutSchema,
  explainOutSchema,
  queryResultSchema,
  runLogSchema,
  runPageSchema,
  runSchema,
  schemaOutSchema,
  statsSchema,
  testResultSchema,
  triggerCreatedSchema,
  triggerSchema,
  usagesSchema,
  validationSchema,
  type Connection,
  type DeletionImpact,
  type Pipeline,
  type PipelineDefinition,
} from './types'

export const queryKeys = {
  connections: ['connections'] as const,
  connectionTypes: ['connection-types'] as const,
  connectionSchema: (id: string) => ['connection-schema', id] as const,
  pipelines: ['pipelines'] as const,
  pipeline: (id: string) => ['pipeline', id] as const,
  deletionImpact: (id: string) => ['deletion-impact', id] as const,
  triggers: (id: string) => ['triggers', id] as const,
  validation: (id: string) => ['validation', id] as const,
  runs: (filters: unknown) => ['runs', filters] as const,
  run: (id: string) => ['run', id] as const,
  runLogs: (id: string) => ['run-logs', id] as const,
  stats: ['stats'] as const,
  streams: (status?: string) => ['streams', status ?? 'all'] as const,
  stream: (id: string) => ['stream', id] as const,
}

/* ------------------------------------------------------------ connections */

export function useConnections(type?: string) {
  return useQuery({
    queryKey: [...queryKeys.connections, type ?? 'all'],
    queryFn: () =>
      api.parsed(
        z.array(connectionSchema),
        `/connections${type ? `?type=${encodeURIComponent(type)}` : ''}`,
      ),
  })
}

export function useConnectorDefaults() {
  return useQuery({
    queryKey: ['connector-defaults'],
    queryFn: () =>
      api.parsed(
        z.object({
          sap: z.object({ default_sidecar_url: z.string().default('') }).default({ default_sidecar_url: '' }),
          local_file: z.object({ root: z.string().default('') }).default({ root: '' }),
        }),
        '/connections/defaults',
      ),
    staleTime: Infinity,
  })
}

export function useConnectionTypes() {
  return useQuery({
    queryKey: queryKeys.connectionTypes,
    queryFn: () => api.parsed(z.array(z.string()), '/connections/types'),
    staleTime: Infinity, // 서버 재배포 전에는 바뀌지 않는다
  })
}

export function useCreateConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.parsed(connectionSchema, '/connections', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connections }),
  })
}

export function useUpdateConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.parsed(connectionSchema, `/connections/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connections }),
  })
}

/** 이 연결을 쓰는 파이프라인 — 삭제 전에 무엇이 깨지는지 보여주기 위한 것 */
export function useConnectionUsages(connectionId?: string) {
  return useQuery({
    queryKey: ['connection-usages', connectionId ?? ''],
    queryFn: () => api.parsed(usagesSchema, `/connections/${connectionId}/usages`),
    enabled: Boolean(connectionId),
    staleTime: 0, // 삭제 직전 확인이므로 항상 최신이어야 한다
  })
}

export function useDeleteConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, force = false }: { id: string; force?: boolean }) =>
      api.parsed(deleteResultSchema, `/connections/${id}?force=${force}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.connections })
      qc.invalidateQueries({ queryKey: queryKeys.pipelines })
    },
  })
}

export function useTestConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api.parsed(testResultSchema, `/connections/${id}/test`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connections }),
  })
}

/** 특정 테이블 하나의 스키마를 조회한다.
 *
 * SAP 처럼 테이블이 수만 개라 열거가 불가능한 소스용 — 연결에 테이블을 박아두면
 * 테이블마다 연결을 만들어야 하므로, 노드 설정에서 이름을 받아 그때 조회한다.
 */
export function useTableSchema(connectionId?: string, table?: string) {
  const name = (table ?? '').trim()
  return useQuery({
    queryKey: [...queryKeys.connectionSchema(connectionId ?? ''), 'table', name],
    queryFn: () =>
      api.parsed(
        schemaOutSchema,
        `/connections/${connectionId}/schema?table=${encodeURIComponent(name)}`,
      ),
    enabled: Boolean(connectionId) && name.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false, // 없는 테이블을 재시도해봐야 UI 만 느려진다
  })
}

/** 테이블 **이름만** 빠르게 조회한다 (컬럼·PK 없음). 내비게이터 트리를 즉시 띄우는 용도 —
 *  컬럼(자동완성)은 useConnectionSchema 로 백그라운드에서 따로 받는다. */
export function useConnectionTables(connectionId?: string) {
  return useQuery({
    queryKey: [...queryKeys.connectionSchema(connectionId ?? ''), 'names'],
    queryFn: () =>
      api.parsed(schemaOutSchema, `/connections/${connectionId}/schema?columns=false&pk=false`),
    enabled: Boolean(connectionId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

/** DBeaver 식 카테고리 트리 — 테이블·뷰·함수·프로시저·시퀀스(엔진별). 이름만 빠르게.
 *  쿼리 키가 connectionSchema 프리픽스라, 새로고침(invalidate)이 스키마 캐시와 함께 무효화된다. */
export function useConnectionObjects(connectionId?: string) {
  return useQuery({
    queryKey: [...queryKeys.connectionSchema(connectionId ?? ''), 'objects'],
    queryFn: () => api.parsed(objectsOutSchema, `/connections/${connectionId}/objects`),
    enabled: Boolean(connectionId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

/** 우클릭 → 상세 보기. 대상이 있을 때만 조회한다(테이블 컬럼·인덱스, 뷰·함수 정의 등). */
export function useObjectDetail(
  target?: { connId: string; kind: string; schema: string | null; name: string },
) {
  return useQuery({
    queryKey: ['object-detail', target?.connId, target?.kind, target?.schema, target?.name],
    queryFn: () => {
      const p = new URLSearchParams({ kind: target!.kind, name: target!.name })
      if (target!.schema) p.set('schema', target!.schema)
      return api.parsed(objectDetailSchema, `/connections/${target!.connId}/object?${p.toString()}`)
    },
    enabled: Boolean(target),
    staleTime: 60 * 1000,
    retry: false,
  })
}

/** 노드 설정 패널·SQL 편집기에서 테이블/컬럼 목록을 채울 때 쓴다. connectionId 가 없으면 조회 안 함.
 *  ``pk=false`` 면 느린 PK 조회를 건너뛴다 — 트리·자동완성엔 PK 가 필요 없어 대형 DB 로드가 훨씬 빠르다. */
export function useConnectionSchema(connectionId?: string, pk = true) {
  return useQuery({
    queryKey: [...queryKeys.connectionSchema(connectionId ?? ''), pk ? 'pk' : 'nopk'],
    queryFn: () =>
      api.parsed(schemaOutSchema, `/connections/${connectionId}/schema${pk ? '' : '?pk=false'}`),
    enabled: Boolean(connectionId),
    staleTime: 5 * 60 * 1000,
    retry: false, // 소스가 죽어 있으면 재시도해봐야 UI 만 느려진다
  })
}

export function usePreview() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; table?: string; namespace?: string; limit?: number }) =>
      api.parsed(previewSchema, `/connections/${id}/preview`, { method: 'POST', body }),
  })
}

/** MongoDB 를 셸처럼 조회한다 — ``컬렉션.find({필터})`` 또는 ``컬렉션.aggregate([파이프라인])``.
 *  ``offset`` 으로 다음 페이지를 이어 받는다 (결과 그리드 무한 스크롤). */
export function useRunMongo() {
  return useMutation({
    mutationFn: ({
      id,
      command,
      namespace,
      limit,
      offset,
      sortCol,
      sortDir,
      filters,
      signal,
    }: {
      id: string
      command: string
      namespace?: string | null
      limit?: number
      offset?: number
      sortCol?: string | null
      sortDir?: 'asc' | 'desc'
      filters?: { col: string; value: string }[]
      signal?: AbortSignal
    }) =>
      api.parsed(queryResultSchema, `/connections/${id}/mongo`, {
        method: 'POST',
        signal,
        body: {
          command,
          namespace,
          limit,
          offset,
          sort_col: sortCol ?? null,
          sort_dir: sortDir ?? 'asc',
          filters: filters ?? null,
        },
      }),
  })
}

/** 쿼리 실행 계획 — EXPLAIN(analyze=false) / EXPLAIN ANALYZE(analyze=true). PostgreSQL·MySQL. */
export function useExplain() {
  return useMutation({
    mutationFn: ({ id, query, analyze }: { id: string; query: string; analyze: boolean }) =>
      api.parsed(explainOutSchema, `/connections/${id}/explain`, {
        method: 'POST',
        body: { query, analyze },
      }),
  })
}

/** AI 어시스턴트 — 자연어 SQL 생성·튜닝 (POST /ai/chat). */
export function useAiChat() {
  return useMutation({
    mutationFn: (body: {
      ai_connection_id: string
      messages: { role: 'user' | 'assistant'; content: string }[]
      intent:
        | 'sql.generate'
        | 'sql.tune'
        | 'sql.interpret'
        | 'sql.fix'
        | 'data.chart'
        | 'data.report'
      db_connection_id?: string | null
      sql?: string | null
      error?: string | null
      include_samples?: boolean
    }) => api.parsed(aiChatOutSchema, '/ai/chat', { method: 'POST', body }),
  })
}

/** 커스텀 SQL 을 소스에서 실제로 실행한다 (DBeaver 식 쿼리 테스트). 읽기 전용 SELECT 만.
 *  ``offset`` 으로 다음 페이지를 이어 받는다 (결과 그리드 무한 스크롤). */
export function useRunQuery() {
  return useMutation({
    mutationFn: ({
      id,
      query,
      limit,
      offset,
      sortCol,
      sortDir,
      filters,
      signal,
    }: {
      id: string
      query: string
      limit?: number
      offset?: number
      sortCol?: string | null
      sortDir?: 'asc' | 'desc'
      filters?: { col: string; value: string }[]
      signal?: AbortSignal
    }) =>
      api.parsed(queryResultSchema, `/connections/${id}/query`, {
        method: 'POST',
        signal,
        body: {
          query,
          limit,
          offset,
          sort_col: sortCol ?? null,
          sort_dir: sortDir ?? 'asc',
          filters: filters ?? null,
        },
      }),
  })
}

/** 연합 조회 편집기의 자동완성 목록 — MySQL·PostgreSQL 연결의 테이블을 전부 모아
 *  `연결이름.데이터베이스[.스키마].테이블` 로 정규화한다.
 *
 *  연결마다 따로 조회하므로 하나가 죽어 있어도 나머지는 뜬다 (`retry: false` — 죽은
 *  소스를 재시도하면 편집기만 느려진다). `enabled` 가 꺼져 있으면 아무것도 받지 않는다
 *  — DuckDB 탭을 안 열었는데 모든 DB 의 스키마를 끌어올 이유가 없다.
 *
 *  쿼리 키는 `useConnectionSchema(id, false)` 와 같아서 캐시를 공유한다. */
export function useDuckTables(connections: Connection[], enabled = true) {
  const usable = connections.filter(
    (c) => (DUCK_TYPES as readonly string[]).includes(c.type) && duckDatabase(c.config),
  )
  const results = useQueries({
    queries: usable.map((c) => ({
      queryKey: [...queryKeys.connectionSchema(c.id), 'nopk'],
      queryFn: () => api.parsed(schemaOutSchema, `/connections/${c.id}/schema?pk=false`),
      enabled,
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  })

  const tables: DuckTable[] = []
  usable.forEach((conn, i) => {
    const database = duckDatabase(conn.config)
    if (!database) return
    for (const t of results[i]?.data?.tables ?? []) {
      const ref = duckRef({
        connectionName: conn.name,
        connectionType: conn.type,
        database,
        namespace: t.namespace,
        table: t.name,
      })
      if (!ref) continue // PostgreSQL 인데 스키마를 모르면 가리킬 방법이 없다
      tables.push({
        connectionName: conn.name,
        connectionType: conn.type,
        database,
        namespace: t.namespace,
        name: t.name,
        columns: t.columns,
        ref,
      })
    }
  })
  return { tables, loading: enabled && results.some((r) => r.isLoading) }
}

/** DuckDB 연합 조회 — 여러 연결의 테이블을 한 SQL 로 조회한다.
 *  연결 하나에 매이지 않으므로 경로에 connection_id 가 없다. 어느 연결을 쓸지는
 *  SQL 안의 `연결이름.…` 참조가 정한다 (`canvas/duckRefs.ts`). */
export function useRunDuck() {
  return useMutation({
    mutationFn: ({
      query,
      limit,
      offset,
      sortCol,
      sortDir,
      filters,
      signal,
    }: {
      query: string
      limit?: number
      offset?: number
      sortCol?: string | null
      sortDir?: 'asc' | 'desc'
      filters?: { col: string; value: string }[]
      signal?: AbortSignal
    }) =>
      api.parsed(queryResultSchema, '/duckdb/query', {
        method: 'POST',
        signal,
        body: {
          query,
          limit,
          offset,
          sort_col: sortCol ?? null,
          sort_dir: sortDir ?? 'asc',
          filters: filters ?? null,
        },
      }),
  })
}

/** 지금 쓴 연합 쿼리를 붙여 넣고 바로 돌릴 수 있는 파이썬 코드로 바꿔 받는다.
 *  비밀번호는 서버가 넣지 않는다 — `password_envs` 가 채워야 할 환경변수 이름이다. */
export function useDuckScript() {
  return useMutation({
    mutationFn: ({ query }: { query: string }) =>
      api.parsed(duckScriptSchema, '/duckdb/script', { method: 'POST', body: { query } }),
  })
}

/* -------------------------------------------------------------- pipelines */

export function usePipelines() {
  return useQuery({
    queryKey: queryKeys.pipelines,
    queryFn: () => api.parsed(z.array(pipelineSummarySchema), '/pipelines'),
    refetchInterval: 10_000,
  })
}

export function usePipeline(id?: string) {
  return useQuery({
    queryKey: queryKeys.pipeline(id ?? ''),
    queryFn: () => api.parsed(pipelineSchema, `/pipelines/${id}`),
    enabled: Boolean(id),
  })
}

export function useCreatePipeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string; definition?: PipelineDefinition }) =>
      api.parsed(pipelineSchema, '/pipelines', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pipelines }),
  })
}

export function useSavePipeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.parsed(pipelineSchema, `/pipelines/${id}`, { method: 'PATCH', body }),
    onSuccess: (pipeline: Pipeline) => {
      qc.invalidateQueries({ queryKey: queryKeys.pipelines })
      qc.invalidateQueries({ queryKey: queryKeys.pipeline(pipeline.id) })
      qc.invalidateQueries({ queryKey: queryKeys.validation(pipeline.id) })
    },
  })
}

/** 지우면 무엇이 함께 사라지는지 — 확인 대화상자가 열릴 때만 부른다.
 *
 *  실행이 끝나거나 CDC 를 중지하면 막힘이 풀리므로, 대화상자를 열어둔 채로도 최신을 보게
 *  짧은 주기로 다시 읽는다. `staleTime: 0` 이라 대화상자를 다시 열면 항상 새로 확인한다. */
export function usePipelineDeletionImpact(id?: string) {
  return useQuery({
    queryKey: queryKeys.deletionImpact(id ?? ''),
    queryFn: () => api.parsed(deletionImpactSchema, `/pipelines/${id}/deletion-impact`),
    enabled: Boolean(id),
    staleTime: 0,
    refetchInterval: 5_000,
  })
}

export function useDeletePipeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.parsed(
        deletionImpactSchema,
        `/pipelines/${id}${force ? '?force=true' : ''}`,
        { method: 'DELETE' },
      ),
    onSuccess: (deleted: DeletionImpact) => {
      qc.invalidateQueries({ queryKey: queryKeys.pipelines })
      qc.invalidateQueries({ queryKey: queryKeys.stats })
      // 실행 이력도 함께 사라졌다 — Monitor 가 없는 파이프라인의 실행을 들고 있으면 안 된다
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.removeQueries({ queryKey: queryKeys.pipeline(deleted.pipeline_id) })
      qc.removeQueries({ queryKey: queryKeys.deletionImpact(deleted.pipeline_id) })
    },
  })
}

/* ------------------------------------------------- 외부 호출 창구(웹훅) */

export function useTriggers(pipelineId?: string) {
  return useQuery({
    queryKey: queryKeys.triggers(pipelineId ?? ''),
    queryFn: () => api.parsed(z.array(triggerSchema), `/pipelines/${pipelineId}/triggers`),
    enabled: Boolean(pipelineId),
  })
}

/** 창구 발급. 응답의 `token` 은 **이때 한 번만** 온다 — 화면이 놓치면 재발급뿐이다. */
export function useCreateTrigger(pipelineId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api.parsed(triggerCreatedSchema, `/pipelines/${pipelineId}/triggers`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.triggers(pipelineId ?? '') }),
  })
}

export function useSetTriggerEnabled(pipelineId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.parsed(triggerSchema, `/pipelines/${pipelineId}/triggers/${id}`, {
        method: 'PATCH',
        body: { enabled },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.triggers(pipelineId ?? '') }),
  })
}

export function useDeleteTrigger(pipelineId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api.request(`/pipelines/${pipelineId}/triggers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.triggers(pipelineId ?? '') }),
  })
}

export function useValidatePipeline(id?: string) {
  return useQuery({
    queryKey: queryKeys.validation(id ?? ''),
    queryFn: () => api.parsed(validationSchema, `/pipelines/${id}/validate`, { method: 'POST' }),
    enabled: Boolean(id),
  })
}

export function useRunPipeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      fullRefresh = false,
      onlyNode,
      trigger = 'manual',
      variables,
    }: {
      id: string
      fullRefresh?: boolean
      /** 지정하면 그 노드만 독립 실행 (그 노드까지 필요한 상류만) */
      onlyNode?: string
      trigger?: 'manual' | 'api'
      /** API 트리거의 `$변수` 값. 테스트 실행도 실제 호출과 같은 통로를 쓴다 —
       *  경로가 갈리면 테스트가 실제를 보증하지 못한다. */
      variables?: Record<string, string | number | boolean>
    }) =>
      api.parsed(runSchema, `/pipelines/${id}/run`, {
        method: 'POST',
        body: {
          trigger,
          full_refresh: fullRefresh,
          ...(onlyNode ? { only_node: onlyNode } : {}),
          ...(variables ? { variables } : {}),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

/* ------------------------------------------------------------------- runs */

export type RunFilters = {
  status?: string
  pipelineId?: string
  hours?: number
  limit?: number
}

export function useRuns(filters: RunFilters = {}) {
  return useQuery({
    queryKey: queryKeys.runs(filters),
    queryFn: () => {
      const q = new URLSearchParams()
      if (filters.status) q.set('status', filters.status)
      if (filters.pipelineId) q.set('pipeline_id', filters.pipelineId)
      if (filters.hours) q.set('hours', String(filters.hours))
      q.set('limit', String(filters.limit ?? 50))
      return api.parsed(runPageSchema, `/runs?${q.toString()}`)
    },
    refetchInterval: 5_000, // 실행 중 행이 있으면 표가 살아 움직여야 한다
  })
}

export function useRun(id?: string) {
  return useQuery({
    queryKey: queryKeys.run(id ?? ''),
    queryFn: () => api.parsed(runSchema, `/runs/${id}`),
    enabled: Boolean(id),
  })
}

export function useRunLogs(id?: string, opts: { level?: string; nodeId?: string } = {}) {
  return useQuery({
    queryKey: [...queryKeys.runLogs(id ?? ''), opts.level ?? 'all', opts.nodeId ?? 'all'],
    queryFn: () => {
      const q = new URLSearchParams({ limit: '500' })
      if (opts.level) q.set('level', opts.level)
      if (opts.nodeId) q.set('node_id', opts.nodeId)
      return api.parsed(z.array(runLogSchema), `/runs/${id}/logs?${q.toString()}`)
    },
    enabled: Boolean(id),
  })
}

export function useRetryRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fullRefresh = false }: { id: string; fullRefresh?: boolean }) =>
      api.parsed(runSchema, `/runs/${id}/retry?full_refresh=${fullRefresh}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.parsed(runSchema, `/runs/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
}

export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api.parsed(statsSchema, '/runs/stats'),
    refetchInterval: 15_000,
  })
}

/* ---------------------------------------------------------- CDC 스트림 (Phase 4) */

/** Monitor Streams 탭 목록. 실행 중 스트림 지표가 살아 움직이도록 주기적으로 갱신한다. */
export function useStreams(status?: string) {
  return useQuery({
    queryKey: queryKeys.streams(status),
    queryFn: () =>
      api.parsed(
        z.array(cdcStreamListItemSchema),
        `/streams${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      ),
    refetchInterval: 5_000,
  })
}

/** 스트림 상세·지표. 조회 시 백엔드가 Debezium 실제 상태와 맞춰 돌려준다. */
export function useStream(id?: string, intervalMs = 5_000) {
  return useQuery({
    queryKey: queryKeys.stream(id ?? ''),
    queryFn: () => api.parsed(cdcStreamSchema, `/streams/${id}`),
    enabled: Boolean(id),
    refetchInterval: intervalMs,
  })
}

/** CDC 파이프라인을 켜서 스트림을 시작한다 (Debezium 커넥터 등록). */
export function useStartStream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pipelineId: string) =>
      api.parsed(cdcStreamSchema, `/pipelines/${pipelineId}/cdc/start`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['streams'] }),
  })
}

/** pause | resume | stop — 백엔드 StreamAction 과 짝. stop 은 멱등. */
export function useStreamAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'stop' }) =>
      api.parsed(cdcStreamSchema, `/streams/${id}/${action}`, { method: 'POST' }),
    onSuccess: (stream) => {
      qc.invalidateQueries({ queryKey: ['streams'] })
      qc.invalidateQueries({ queryKey: queryKeys.stream(stream.id) })
    },
  })
}

/** 중지·실패한 스트림 이력을 삭제한다 (활성 스트림은 서버가 409). */
export function useDeleteStream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.request(`/streams/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['streams'] }),
  })
}

/** 연결이 CDC 소스로 쓸 준비가 됐는지 점검한다 (타입·cdc_enabled·접속). */
export function usePreflight() {
  return useMutation({
    mutationFn: (connectionId: string) =>
      api.parsed(preflightSchema, `/connections/${connectionId}/cdc/preflight`, { method: 'POST' }),
  })
}

/* --------------------------------------------- 실시간 DB 동기화 (SymmetricDS) */

/** 착수 전 점검. 원본을 **읽기만** 하므로 몇 번을 눌러도 안전하다.
 *  SQL Server 버전·에디션, 대상 테이블 존재와 기본키, 트리거 생성 권한, 타깃·사이드카 접속. */
export function useSyncPreflight() {
  return useMutation({
    mutationFn: (pipelineId: string) =>
      api.parsed(syncPreflightSchema, `/pipelines/${pipelineId}/sync/preflight`, {
        method: 'POST',
      }),
  })
}

/** 동기화를 켠다 — 원본 테이블에 **트리거가 생긴다.**
 *  기본은 점검을 통과해야 시작되고, skipPreflight 는 사이드카 미기동 같은 예외 상황용이다. */
export function useStartSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pipelineId, skipPreflight }: { pipelineId: string; skipPreflight?: boolean }) =>
      api.parsed(
        cdcStreamSchema,
        `/pipelines/${pipelineId}/sync/start${skipPreflight ? '?skip_preflight=true' : ''}`,
        { method: 'POST' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['streams'] }),
  })
}

export type { Connection, Pipeline }
