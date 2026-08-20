/** 커넥터 타입별 연결 설정 필드 선언.
 *
 * 백엔드 `registry.py` 의 `_ALLOWED_KEYS` 와 짝을 이룬다 — 여기 없는 키를 보내면
 * 백엔드가 `extra` 로 흘려버리므로, 커넥터를 추가할 때 **양쪽을 함께** 고쳐야 한다.
 *
 * 폼을 JSX 로 분기하지 않고 선언으로 두는 이유: Phase 2·3 에서 커넥터를 넷이나
 * 늘리는 동안 폼이 s3 여부로만 갈라져 SAP·MongoDB·MSSQL 이 전부 PostgreSQL
 * 필드를 보여주고 있었다. 선언이면 빠뜨리기 어렵다.
 */

export type FieldKind = 'text' | 'password' | 'number' | 'checkbox' | 'section' | 'statements'

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

/** 저장소 유형. 타입 선택 화면에서 이 단위로 묶는다 —
 *  6개를 평평하게 늘어놓는 것보다 "어떤 종류를 찾는가"로 좁히는 편이 빠르다. */
export type ConnectorCategory = 'rdb' | 'document' | 'erp' | 'storage' | 'ai'

/** 표시 순서를 겸한다 — 배열 순서대로 그룹이 나온다 */
export const CATEGORY_ORDER: ConnectorCategory[] = ['rdb', 'document', 'erp', 'storage', 'ai']

export const CATEGORY_META: Record<ConnectorCategory, { label: string; hint: string }> = {
  rdb: { label: '관계형 DB', hint: 'RDS · 테이블 기반' },
  document: { label: '문서형 DB', hint: 'DocumentDB · 컬렉션 기반' },
  erp: { label: '전사 시스템', hint: 'SAP · ERP' },
  storage: { label: '파일 스토리지', hint: '오브젝트 스토리지' },
  ai: { label: 'AI 모델', hint: '자연어 SQL 생성 · 튜닝' },
}

/** 커넥터가 파이프라인에서 맡을 수 있는 역할 — 타입을 고를 때 알아야 할 정보다 */
export type ConnectorRole = 'both' | 'source' | 'target' | 'ai'

export const ROLE_LABEL: Record<ConnectorRole, string> = {
  both: '소스 · 타깃',
  source: '소스 전용',
  target: '타깃 전용',
  ai: 'AI 어시스턴트',
}

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

const POOL: FieldSpec = {
  key: 'pool_size',
  label: '커넥션 풀 크기',
  kind: 'number',
  default: 5,
}
const SSL: FieldSpec = { key: 'ssl', label: 'SSL 사용', kind: 'checkbox', default: false }
/** CDC(실시간 변경 수집) 사용 여부. Connection 의 상위 컬럼이라 pool_size·ssl 처럼 config 밖으로 뺀다.
 *  MySQL·PostgreSQL·MSSQL(SQL Server) 을 지원한다 (Phase 4).
 *  백엔드 cdc_service.CDC_SUPPORTED_TYPES 와 반드시 같아야 한다. */
const CDC_ENABLED: FieldSpec = {
  key: 'cdc_enabled',
  label: 'CDC 사용 (실시간 변경 수집)',
  kind: 'checkbox',
  default: false,
  hint: '켜면 이 연결을 캔버스의 CDC 소스로 쓸 수 있습니다. 저장 후 아래 「전제조건 점검」으로 준비 상태를 확인하세요.',
}

/** 쿼리 편집기에서 실행할 수 있는 SQL 명령. 값은 `allowed_statements`(문자열 배열)로
 *  config 에 저장되고, 폼 안에서는 CSV 문자열로 들고 있다(`api/statements.ts`).
 *  RDB(mysql·postgres·mssql)에만 붙는다 — SQL 편집기가 그 셋만 실행한다. */
const ALLOWED_STATEMENTS: FieldSpec = {
  key: 'allowed_statements',
  label: '허용 명령 (쿼리 편집기)',
  kind: 'statements',
  default: 'select',
  hint: '체크한 명령만 SQL 편집기에서 실행됩니다. 쓰기는 operator, 스키마 변경은 editor 권한도 필요합니다.',
}

function sqlFields(defaultPort: number): FieldSpec[] {
  return [
    { key: 'host', label: '호스트', kind: 'text', required: true, placeholder: 'db.internal' },
    { key: 'port', label: '포트', kind: 'number', default: defaultPort },
    { key: 'database', label: '데이터베이스', kind: 'text', required: true },
    { key: 'user', label: '사용자', kind: 'text', required: true },
    {
      key: 'password',
      label: '비밀번호',
      kind: 'password',
      hint: '암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
    },
    POOL,
    SSL,
  ]
}

function sqlSummary(c: Record<string, unknown>): string {
  return `${String(c.host ?? '?')}:${String(c.port ?? '?')} / ${String(c.database ?? '?')}`
}

export const CONNECTOR_SPECS: Record<string, ConnectorSpec> = {
  mysql: {
    label: 'MySQL',
    category: 'rdb',
    abbr: 'My',
    color: '#00758f',
    description: '테이블 조회 · 증분 적재 · CDC',
    role: 'both',
    summary: sqlSummary,
    fields: [...sqlFields(3306), ALLOWED_STATEMENTS, CDC_ENABLED],
  },
  postgres: {
    label: 'PostgreSQL',
    category: 'rdb',
    abbr: 'PG',
    color: '#336791',
    description: '테이블 조회 · 증분 적재 · CDC',
    role: 'both',
    summary: sqlSummary,
    fields: [...sqlFields(5432), ALLOWED_STATEMENTS, CDC_ENABLED],
  },

  mssql: {
    label: 'MSSQL',
    category: 'rdb',
    abbr: 'MS',
    color: '#a91d22',
    description: 'SQL Server · MERGE upsert · CDC',
    role: 'both',
    summary: sqlSummary,
    fields: [
      ...sqlFields(1433),
      {
        key: 'odbc_driver',
        label: 'ODBC 드라이버',
        kind: 'text',
        default: 'ODBC Driver 18 for SQL Server',
        hint: '컨테이너에 설치된 드라이버 이름과 같아야 합니다.',
      },
      {
        key: 'trust_server_certificate',
        label: '서버 인증서 신뢰',
        kind: 'checkbox',
        default: true,
        hint: '사내 SQL Server 는 자체 서명 인증서를 쓰는 경우가 많습니다.',
      },
      ALLOWED_STATEMENTS,
      CDC_ENABLED,
    ],
  },

  mongo: {
    label: 'MongoDB',
    category: 'document',
    abbr: 'MG',
    color: '#12924a',
    description: '컬렉션 · JSON 필터',
    role: 'both',
    summary: (c) =>
      c.uri
        ? String(c.uri)
        : `${String(c.host ?? '?')}:${String(c.port ?? '?')} / ${String(c.database ?? '?')}`,
    fields: [
      {
        key: 'uri',
        label: '접속 URI (선택)',
        kind: 'text',
        placeholder: 'mongodb://host1,host2/?replicaSet=rs0',
        hint: 'URI 를 넣으면 아래 호스트·포트 대신 이것을 씁니다.',
      },
      { key: 'host', label: '호스트', kind: 'text', placeholder: 'mongo.internal' },
      { key: 'port', label: '포트', kind: 'number', default: 27017 },
      { key: 'database', label: '데이터베이스', kind: 'text', required: true },
      { key: 'user', label: '사용자', kind: 'text' },
      {
        key: 'password',
        label: '비밀번호',
        kind: 'password',
        hint: '암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
      },
      {
        key: 'auth_source',
        label: '인증 DB (authSource)',
        kind: 'text',
        placeholder: 'admin — 비우면 위 데이터베이스',
      },
      { key: 'replica_set', label: '레플리카셋', kind: 'text', placeholder: 'rs0' },
      POOL,
      SSL,
    ],
  },

  sap_rfc: {
    label: 'SAP RFC',
    category: 'erp',
    abbr: 'SAP',
    color: '#ea4b71',
    description: 'BAPI · RFC_READ_TABLE (사이드카 경유)',
    role: 'source',
    summary: (c) => `${String(c.ashost || c.mshost || '?')}${c.client ? ' · client ' + String(c.client) : ''}`,
    fields: [
      // ── SAP 접속 정보 (연결마다 다른 값) ──
      {
        key: 'ashost',
        label: 'SAP 호스트 (ashost)',
        kind: 'text',
        required: true,
        placeholder: 'sap-prd.company.com',
        hint: '단일 서버 직접 접속. 로드밸런싱은 mshost 를 쓰세요(고급).',
      },
      { key: 'sysnr', label: '시스템 번호 (sysnr)', kind: 'text', placeholder: '00' },
      { key: 'client', label: '클라이언트 (client)', kind: 'text', required: true, placeholder: '100' },
      { key: 'user', label: '사용자 (user)', kind: 'text', required: true, placeholder: 'EAI_RFC' },
      {
        key: 'passwd',
        label: '비밀번호 (passwd)',
        kind: 'password',
        hint: 'SAP 계정 비밀번호. 암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
      },
      { key: 'lang', label: '로그온 언어 (lang)', kind: 'text', placeholder: 'KO 또는 EN' },
      { key: 'page_size', label: '페이지 크기', kind: 'number', default: 2000 },

      // ── 사이드카 (인프라 설정 — 보통 손대지 않는다) ──
      {
        key: '__sidecar_section',
        label: '사이드카 설정 (선택)',
        kind: 'section',
        hint: '보통 손대지 않습니다 — 사이드카가 하나면 비워두세요.',
      },
      {
        key: 'sidecar_url',
        label: '사이드카 주소',
        kind: 'text',
        placeholder: '비워두면 시스템 기본값 사용',
        hint: '워커→사이드카→SAP 게이트웨이. 사이드카가 하나면 비워두세요 — 시스템 기본값을 씁니다. '
          + '다른 사이드카를 쓸 때만 입력합니다.',
      },
      {
        key: 'api_token',
        label: '사이드카 토큰',
        kind: 'password',
        hint: '워커 ↔ 사이드카 공유 토큰 (SAP 비밀번호 아님). 사이드카에 토큰을 설정한 경우에만.',
      },
      { key: 'timeout', label: '읽기 타임아웃(초)', kind: 'number', default: 300 },
      { key: 'verify_tls', label: 'TLS 인증서 검증', kind: 'checkbox', default: true },
    ],
  },

  s3: {
    label: 'Amazon S3',
    category: 'storage',
    abbr: 'S3',
    color: '#f59e0b',
    description: 'Parquet · JSONL · CSV 적재',
    role: 'target',
    summary: (c) => `s3://${String(c.bucket ?? '?')} · ${String(c.region ?? '')}`,
    fields: [
      { key: 'bucket', label: '버킷', kind: 'text', required: true },
      { key: 'region', label: '리전', kind: 'text', default: 'ap-northeast-2' },
      {
        key: 'access_key_id',
        label: 'Access Key ID',
        kind: 'text',
        hint: '비우면 인스턴스 역할(IAM Role)을 사용합니다.',
      },
      {
        key: 'secret_access_key',
        label: 'Secret Access Key',
        kind: 'password',
        hint: '암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
      },
      {
        key: 'endpoint_url',
        label: '엔드포인트 (선택)',
        kind: 'text',
        placeholder: 'MinIO 등 S3 호환 저장소를 쓸 때만',
      },
      { key: 'sse_kms_key_id', label: 'KMS 키 ID (선택)', kind: 'text' },
    ],
  },

  local_file: {
    label: '로컬 파일',
    category: 'storage',
    abbr: '파일',
    color: '#f59e0b',
    description: '테스트용 · Parquet/JSONL/CSV 저장',
    role: 'target',
    summary: (c) => `${String(c.base_dir || '(루트)')} 아래에 저장`,
    fields: [
      {
        key: 'base_dir',
        label: '저장 폴더',
        kind: 'text',
        required: true,
        placeholder: 'exports',
        hint: '서버의 파일 루트 아래 하위 폴더명입니다. 실제 경로는 노드의 경로 prefix·실행ID로 더 나뉩니다.',
      },
    ],
  },

  gemini: {
    label: 'Google Gemini',
    category: 'ai',
    abbr: 'AI',
    color: '#7c3aed',
    description: '자연어로 SQL 생성 · 튜닝',
    role: 'ai',
    summary: (c) => String(c.model || 'gemini'),
    // 필드 키는 백엔드 registry.py 의 _GEMINI_KEYS 와 반드시 같아야 한다.
    fields: [
      {
        key: 'model',
        label: '모델',
        kind: 'text',
        required: true,
        default: 'gemini-2.0-flash',
        placeholder: 'gemini-2.0-flash · gemini-1.5-pro …',
        hint: 'Google AI Studio 에서 쓸 수 있는 모델 이름.',
      },
      {
        key: 'api_key',
        label: 'API Key',
        kind: 'password',
        required: true,
        hint: 'Google AI Studio 의 API 키. 암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
      },
      {
        key: 'endpoint',
        label: '엔드포인트 (선택)',
        kind: 'text',
        placeholder: 'https://generativelanguage.googleapis.com',
        hint: '프록시·리전 엔드포인트를 쓸 때만. 비우면 기본값.',
      },
    ],
  },
}

export function specFor(type: string): ConnectorSpec {
  return (
    CONNECTOR_SPECS[type] ?? {
      label: type,
      category: 'rdb',
      abbr: type.slice(0, 2).toUpperCase(),
      color: '#6b7180',
      description: '알 수 없는 커넥터',
      role: 'both',
      summary: () => type,
      fields: [],
    }
  )
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
