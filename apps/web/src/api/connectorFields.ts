/** 커넥터 타입별 연결 설정 필드 선언.
 *
 * 백엔드 `registry.py` 의 `_ALLOWED_KEYS` 와 짝을 이룬다 — 여기 없는 키를 보내면
 * 백엔드가 `extra` 로 흘려버리므로, 커넥터를 추가할 때 **양쪽을 함께** 고쳐야 한다.
 *
 * 폼을 JSX 로 분기하지 않고 선언으로 두는 이유: Phase 2·3 에서 커넥터를 넷이나
 * 늘리는 동안 폼이 s3 여부로만 갈라져 SAP·MongoDB·MSSQL 이 전부 PostgreSQL
 * 필드를 보여주고 있었다. 선언이면 빠뜨리기 어렵다.
 *
 * 표시 문구는 선언에 직접 담지 않고 **메시지 키**로 가리킨다 (i18n/messages/connectors.ts).
 * `specFor()` 가 부를 때마다 현재 언어로 풀어 주므로, 소비자는 예전처럼
 * `spec.label`·`field.hint` 를 문자열로 읽으면 된다. 기술 예시 placeholder
 * (호스트명·모델명 등)는 번역 대상이 아니라 원문 그대로 둔다.
 */
import { t, type MsgKey } from '../i18n'

export type FieldKind =
  | 'text'
  | 'password'
  | 'number'
  | 'checkbox'
  | 'section'
  | 'statements'
  | 'remote-select' // 서버에서 옵션을 불러와 드롭다운으로 고른다 (예: Bedrock 모델 목록)

/** 화면이 읽는 모양 — specFor() 가 현재 언어로 풀어서 돌려준다. */
export type FieldSpec = {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  hint?: string
  required?: boolean
  default?: string | number | boolean
  /** kind === 'section' 일 때 처음부터 펼쳐 둘지. 기본은 접힘. */
  defaultOpen?: boolean
}

/** 선언 모양 — 문구는 키로, 기술 예시 placeholder 만 원문으로 담는다. */
type FieldDef = {
  key: string
  labelKey: MsgKey
  kind: FieldKind
  /** 번역이 필요 없는 기술 예시 (호스트명 등). placeholderKey 와 함께 쓰지 않는다. */
  placeholder?: string
  placeholderKey?: MsgKey
  hintKey?: MsgKey
  required?: boolean
  default?: string | number | boolean
  defaultOpen?: boolean
}

/** 저장소 유형. 타입 선택 화면에서 이 단위로 묶는다 —
 *  6개를 평평하게 늘어놓는 것보다 "어떤 종류를 찾는가"로 좁히는 편이 빠르다. */
export type ConnectorCategory = 'rdb' | 'document' | 'erp' | 'storage' | 'ai'

/** 표시 순서를 겸한다 — 배열 순서대로 그룹이 나온다 */
export const CATEGORY_ORDER: ConnectorCategory[] = ['rdb', 'document', 'erp', 'storage', 'ai']

const CATEGORY_KEYS: Record<ConnectorCategory, { label: MsgKey; hint: MsgKey }> = {
  rdb: { label: 'connCat.rdb.label', hint: 'connCat.rdb.hint' },
  document: { label: 'connCat.document.label', hint: 'connCat.document.hint' },
  erp: { label: 'connCat.erp.label', hint: 'connCat.erp.hint' },
  storage: { label: 'connCat.storage.label', hint: 'connCat.storage.hint' },
  ai: { label: 'connCat.ai.label', hint: 'connCat.ai.hint' },
}

export function categoryMeta(category: ConnectorCategory): { label: string; hint: string } {
  const keys = CATEGORY_KEYS[category]
  return { label: t(keys.label), hint: t(keys.hint) }
}

/** 커넥터가 파이프라인에서 맡을 수 있는 역할 — 타입을 고를 때 알아야 할 정보다 */
export type ConnectorRole = 'both' | 'source' | 'target' | 'ai'

const ROLE_KEY: Record<ConnectorRole, MsgKey> = {
  both: 'connRole.both',
  source: 'connRole.source',
  target: 'connRole.target',
  ai: 'connRole.ai',
}

export function roleLabel(role: ConnectorRole): string {
  return t(ROLE_KEY[role])
}

/** 화면이 읽는 모양 — specFor() 가 돌려준다. */
export type ConnectorSpec = {
  label: string
  category: ConnectorCategory
  /** 카드 뱃지에 쓰는 약자 */
  abbr: string
  /** 브랜드 컬러 */
  color: string
  /** 타입 선택 카드의 한 줄 설명 */
  description: string
  role: ConnectorRole
  /** 연결 카드에 한 줄로 보여줄 요약 */
  summary: (config: Record<string, unknown>) => string
  fields: FieldSpec[]
}

type ConnectorDef = {
  labelKey: MsgKey
  category: ConnectorCategory
  abbr: string
  /** 뱃지 약자에 한글이 든 타입만 (local_file). 나머지는 abbr 원문. */
  abbrKey?: MsgKey
  color: string
  descriptionKey: MsgKey
  role: ConnectorRole
  summary: (config: Record<string, unknown>) => string
  fields: FieldDef[]
}

const POOL: FieldDef = {
  key: 'pool_size',
  labelKey: 'connField.pool.label',
  kind: 'number',
  default: 5,
}
const SSL: FieldDef = { key: 'ssl', labelKey: 'connField.ssl.label', kind: 'checkbox', default: false }
/** CDC(실시간 변경 수집) 사용 여부. Connection 의 상위 컬럼이라 pool_size·ssl 처럼 config 밖으로 뺀다.
 *  MySQL·PostgreSQL·MSSQL(SQL Server) 을 지원한다 (Phase 4).
 *  백엔드 cdc_service.CDC_SUPPORTED_TYPES 와 반드시 같아야 한다. */
const CDC_ENABLED: FieldDef = {
  key: 'cdc_enabled',
  labelKey: 'connField.cdc.label',
  kind: 'checkbox',
  default: false,
  hintKey: 'connField.cdc.hint',
}

/** 쿼리 편집기에서 실행할 수 있는 SQL 명령. 값은 `allowed_statements`(문자열 배열)로
 *  config 에 저장되고, 폼 안에서는 CSV 문자열로 들고 있다(`api/statements.ts`).
 *  RDB(mysql·postgres·mssql)에만 붙는다 — SQL 편집기가 그 셋만 실행한다. */
const ALLOWED_STATEMENTS: FieldDef = {
  key: 'allowed_statements',
  labelKey: 'connField.stmts.label',
  kind: 'statements',
  default: 'select',
  hintKey: 'connField.stmts.hint',
}

const PASSWORD: FieldDef = {
  key: 'password',
  labelKey: 'connField.password.label',
  kind: 'password',
  hintKey: 'connField.secret.hint',
}

function sqlFields(defaultPort: number): FieldDef[] {
  return [
    { key: 'host', labelKey: 'connField.host.label', kind: 'text', required: true, placeholder: 'db.internal' },
    { key: 'port', labelKey: 'connField.port.label', kind: 'number', default: defaultPort },
    { key: 'database', labelKey: 'connField.database.label', kind: 'text', required: true },
    { key: 'user', labelKey: 'connField.user.label', kind: 'text', required: true },
    PASSWORD,
    POOL,
    SSL,
  ]
}

function sqlSummary(c: Record<string, unknown>): string {
  return `${String(c.host ?? '?')}:${String(c.port ?? '?')} / ${String(c.database ?? '?')}`
}

export const CONNECTOR_SPECS: Record<string, ConnectorDef> = {
  mysql: {
    labelKey: 'conn.mysql.label',
    category: 'rdb',
    abbr: 'My',
    color: '#00758f',
    descriptionKey: 'conn.mysql.desc',
    role: 'both',
    summary: sqlSummary,
    fields: [...sqlFields(3306), ALLOWED_STATEMENTS, CDC_ENABLED],
  },
  postgres: {
    labelKey: 'conn.postgres.label',
    category: 'rdb',
    abbr: 'PG',
    color: '#336791',
    descriptionKey: 'conn.postgres.desc',
    role: 'both',
    summary: sqlSummary,
    fields: [...sqlFields(5432), ALLOWED_STATEMENTS, CDC_ENABLED],
  },

  mssql: {
    labelKey: 'conn.mssql.label',
    category: 'rdb',
    abbr: 'MS',
    color: '#a91d22',
    descriptionKey: 'conn.mssql.desc',
    role: 'both',
    summary: sqlSummary,
    fields: [
      ...sqlFields(1433),
      {
        key: 'odbc_driver',
        labelKey: 'conn.mssql.odbc.label',
        kind: 'text',
        default: 'ODBC Driver 18 for SQL Server',
        hintKey: 'conn.mssql.odbc.hint',
      },
      {
        key: 'trust_server_certificate',
        labelKey: 'conn.mssql.trustCert.label',
        kind: 'checkbox',
        default: true,
        hintKey: 'conn.mssql.trustCert.hint',
      },
      ALLOWED_STATEMENTS,
      CDC_ENABLED,
    ],
  },

  mongo: {
    labelKey: 'conn.mongo.label',
    category: 'document',
    abbr: 'MG',
    color: '#12924a',
    descriptionKey: 'conn.mongo.desc',
    role: 'both',
    summary: (c) =>
      c.uri
        ? String(c.uri)
        : `${String(c.host ?? '?')}:${String(c.port ?? '?')} / ${String(c.database ?? '?')}`,
    fields: [
      {
        key: 'uri',
        labelKey: 'conn.mongo.uri.label',
        kind: 'text',
        placeholder: 'mongodb://host1,host2/?replicaSet=rs0',
        hintKey: 'conn.mongo.uri.hint',
      },
      { key: 'host', labelKey: 'connField.host.label', kind: 'text', placeholder: 'mongo.internal' },
      { key: 'port', labelKey: 'connField.port.label', kind: 'number', default: 27017 },
      { key: 'database', labelKey: 'connField.database.label', kind: 'text', required: true },
      { key: 'user', labelKey: 'connField.user.label', kind: 'text' },
      PASSWORD,
      {
        key: 'auth_source',
        labelKey: 'conn.mongo.authSource.label',
        kind: 'text',
        placeholderKey: 'conn.mongo.authSource.ph',
      },
      { key: 'replica_set', labelKey: 'conn.mongo.replicaSet.label', kind: 'text', placeholder: 'rs0' },
      POOL,
      SSL,
    ],
  },

  sap_rfc: {
    labelKey: 'conn.sap_rfc.label',
    category: 'erp',
    abbr: 'SAP',
    color: '#ea4b71',
    descriptionKey: 'conn.sap_rfc.desc',
    role: 'source',
    summary: (c) => `${String(c.ashost || c.mshost || '?')}${c.client ? ' · client ' + String(c.client) : ''}`,
    fields: [
      // ── SAP 접속 정보 (연결마다 다른 값) ──
      {
        key: 'ashost',
        labelKey: 'conn.sap_rfc.ashost.label',
        kind: 'text',
        required: true,
        placeholder: 'sap-prd.company.com',
        hintKey: 'conn.sap_rfc.ashost.hint',
      },
      { key: 'sysnr', labelKey: 'conn.sap_rfc.sysnr.label', kind: 'text', placeholder: '00' },
      { key: 'client', labelKey: 'conn.sap_rfc.client.label', kind: 'text', required: true, placeholder: '100' },
      { key: 'user', labelKey: 'conn.sap_rfc.user.label', kind: 'text', required: true, placeholder: 'EAI_RFC' },
      {
        key: 'passwd',
        labelKey: 'conn.sap_rfc.passwd.label',
        kind: 'password',
        hintKey: 'conn.sap_rfc.passwd.hint',
      },
      { key: 'lang', labelKey: 'conn.sap_rfc.lang.label', kind: 'text', placeholderKey: 'conn.sap_rfc.lang.ph' },
      { key: 'page_size', labelKey: 'conn.sap_rfc.pageSize.label', kind: 'number', default: 2000 },

      // ── 사이드카 (인프라 설정 — 보통 손대지 않는다) ──
      {
        key: '__sidecar_section',
        labelKey: 'conn.sap_rfc.sidecarSection.label',
        kind: 'section',
        hintKey: 'conn.sap_rfc.sidecarSection.hint',
      },
      {
        key: 'sidecar_url',
        labelKey: 'conn.sap_rfc.sidecarUrl.label',
        kind: 'text',
        placeholderKey: 'conn.sap_rfc.sidecarUrl.ph',
        hintKey: 'conn.sap_rfc.sidecarUrl.hint',
      },
      {
        key: 'api_token',
        labelKey: 'conn.sap_rfc.apiToken.label',
        kind: 'password',
        hintKey: 'conn.sap_rfc.apiToken.hint',
      },
      { key: 'timeout', labelKey: 'conn.sap_rfc.timeout.label', kind: 'number', default: 300 },
      { key: 'verify_tls', labelKey: 'conn.sap_rfc.verifyTls.label', kind: 'checkbox', default: true },
    ],
  },

  s3: {
    labelKey: 'conn.s3.label',
    category: 'storage',
    abbr: 'S3',
    color: '#f59e0b',
    descriptionKey: 'conn.s3.desc',
    role: 'target',
    summary: (c) => `s3://${String(c.bucket ?? '?')} · ${String(c.region ?? '')}`,
    fields: [
      { key: 'bucket', labelKey: 'conn.s3.bucket.label', kind: 'text', required: true },
      { key: 'region', labelKey: 'conn.s3.region.label', kind: 'text', default: 'ap-northeast-2' },
      {
        key: 'access_key_id',
        labelKey: 'conn.s3.accessKey.label',
        kind: 'text',
        hintKey: 'conn.s3.accessKey.hint',
      },
      {
        key: 'secret_access_key',
        labelKey: 'conn.s3.secretKey.label',
        kind: 'password',
        hintKey: 'connField.secret.hint',
      },
      {
        key: 'endpoint_url',
        labelKey: 'connField.endpointOptional.label',
        kind: 'text',
        placeholderKey: 'conn.s3.endpoint.ph',
      },
      { key: 'sse_kms_key_id', labelKey: 'conn.s3.kmsKey.label', kind: 'text' },
    ],
  },

  local_file: {
    labelKey: 'conn.local_file.label',
    category: 'storage',
    abbr: '파일',
    abbrKey: 'conn.local_file.abbr',
    color: '#f59e0b',
    descriptionKey: 'conn.local_file.desc',
    role: 'target',
    summary: (c) =>
      t('conn.local_file.summary', { dir: String(c.base_dir || t('conn.local_file.rootDir')) }),
    fields: [
      {
        key: 'base_dir',
        labelKey: 'conn.local_file.baseDir.label',
        kind: 'text',
        required: true,
        placeholder: 'exports',
        hintKey: 'conn.local_file.baseDir.hint',
      },
    ],
  },

  gemini: {
    labelKey: 'conn.gemini.label',
    category: 'ai',
    abbr: 'AI',
    color: '#7c3aed',
    descriptionKey: 'conn.gemini.desc',
    role: 'ai',
    summary: (c) => String(c.model || 'gemini'),
    // 필드 키는 백엔드 registry.py 의 _GEMINI_KEYS 와 반드시 같아야 한다.
    fields: [
      {
        key: 'model',
        labelKey: 'conn.gemini.model.label',
        kind: 'text',
        required: true,
        default: 'gemini-3.6-flash',
        placeholder: 'gemini-3.6-flash · gemini-3.6-pro …',
        hintKey: 'conn.gemini.model.hint',
      },
      {
        key: 'api_key',
        labelKey: 'conn.gemini.apiKey.label',
        kind: 'password',
        required: true,
        hintKey: 'conn.gemini.apiKey.hint',
      },
      {
        key: 'endpoint',
        labelKey: 'connField.endpointOptional.label',
        kind: 'text',
        placeholder: 'https://generativelanguage.googleapis.com',
        hintKey: 'conn.gemini.endpoint.hint',
      },
    ],
  },

  ollama: {
    labelKey: 'conn.ollama.label',
    category: 'ai',
    abbr: 'AI',
    color: '#0f766e',
    descriptionKey: 'conn.ollama.desc',
    role: 'ai',
    summary: (c) => String(c.model || 'ollama'),
    // 필드 키는 백엔드 registry.py 의 _OLLAMA_KEYS 와 반드시 같아야 한다.
    // 자격증명 필드가 없다 — 자기 장비에서 도는 모델이라 받을 키가 없다.
    fields: [
      {
        key: 'model',
        labelKey: 'conn.ollama.model.label',
        kind: 'text',
        required: true,
        default: 'qwen3:8b',
        placeholder: 'qwen3:8b · gemma3:4b · llama3.1:8b …',
        hintKey: 'conn.ollama.model.hint',
      },
      {
        key: 'endpoint',
        labelKey: 'connField.endpointOptional.label',
        kind: 'text',
        placeholder: 'http://ollama:11434',
        hintKey: 'conn.ollama.endpoint.hint',
      },
      {
        key: 'timeout',
        labelKey: 'conn.ollama.timeout.label',
        kind: 'number',
        default: 180,
        hintKey: 'conn.ollama.timeout.hint',
      },
    ],
  },

  bedrock: {
    labelKey: 'conn.bedrock.label',
    category: 'ai',
    abbr: 'AI',
    color: '#ff9900',
    descriptionKey: 'conn.bedrock.desc',
    role: 'ai',
    summary: (c) => String(c.model || 'bedrock'),
    // 필드 키는 백엔드 registry.py 의 _BEDROCK_KEYS 와 반드시 같아야 한다.
    fields: [
      {
        key: 'model',
        labelKey: 'conn.bedrock.model.label',
        kind: 'remote-select',
        required: true,
        default: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        placeholder: 'anthropic.claude-3-5-sonnet-20241022-v2:0 …',
        hintKey: 'conn.bedrock.model.hint',
      },
      {
        key: 'region',
        labelKey: 'conn.bedrock.region.label',
        kind: 'text',
        required: true,
        default: 'us-east-1',
        placeholder: 'us-east-1 · us-west-2 · ap-northeast-2 …',
        hintKey: 'conn.bedrock.region.hint',
      },
      {
        key: 'access_key_id',
        labelKey: 'conn.bedrock.accessKey.label',
        kind: 'text',
        required: true,
        hintKey: 'conn.bedrock.accessKey.hint',
      },
      {
        key: 'secret_access_key',
        labelKey: 'conn.bedrock.secretKey.label',
        kind: 'password',
        required: true,
        hintKey: 'connField.secret.hint',
      },
      {
        key: 'session_token',
        labelKey: 'conn.bedrock.sessionToken.label',
        kind: 'password',
        hintKey: 'conn.bedrock.sessionToken.hint',
      },
    ],
  },
}

function resolveField(f: FieldDef): FieldSpec {
  return {
    key: f.key,
    label: t(f.labelKey),
    kind: f.kind,
    placeholder: f.placeholderKey ? t(f.placeholderKey) : f.placeholder,
    hint: f.hintKey ? t(f.hintKey) : undefined,
    required: f.required,
    default: f.default,
    defaultOpen: f.defaultOpen,
  }
}

export function specFor(type: string): ConnectorSpec {
  const def = CONNECTOR_SPECS[type]
  if (!def)
    return {
      label: type,
      category: 'rdb',
      abbr: type.slice(0, 2).toUpperCase(),
      color: '#6b7180',
      description: t('conn.unknown.desc'),
      role: 'both',
      summary: () => type,
      fields: [],
    }
  return {
    label: t(def.labelKey),
    category: def.category,
    abbr: def.abbrKey ? t(def.abbrKey) : def.abbr,
    color: def.color,
    description: t(def.descriptionKey),
    role: def.role,
    summary: def.summary,
    fields: def.fields.map(resolveField),
  }
}

/** 카드 한 줄 요약 — 타입을 모르면 타입명만 보여준다 */
export function summarize(type: string, config: Record<string, unknown>): string {
  return specFor(type).summary(config)
}

/** 폼 기본값 */
export function defaultsFor(type: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const f of specFor(type).fields) {
    if (f.kind === 'section') continue
    if (f.default === undefined) continue
    out[f.key] = typeof f.default === 'boolean' ? f.default : String(f.default)
  }
  return out
}


/** 타입 목록을 카테고리 순서대로 묶는다. 비어 있는 그룹은 내보내지 않는다. */
export function groupByCategory(
  types: string[],
): { category: ConnectorCategory; types: string[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    types: types.filter((t) => specFor(t).category === category),
  })).filter((group) => group.types.length > 0)
}
