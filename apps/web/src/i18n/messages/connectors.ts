/** 연결 관리 — 커넥터 타입·필드 카탈로그 (api/connectorFields.ts 가 가리킨다).
 *  기술 예시 placeholder(호스트명·모델명 등)는 번역 대상이 아니라 여기 없다. */
export const connectors = {
  'connCat.rdb.label': ['관계형 DB', 'Relational DB'],
  'connCat.rdb.hint': ['RDS · 테이블 기반', 'RDS · table-based'],
  'connCat.document.label': ['문서형 DB', 'Document DB'],
  'connCat.document.hint': ['DocumentDB · 컬렉션 기반', 'DocumentDB · collection-based'],
  'connCat.erp.label': ['전사 시스템', 'Enterprise systems'],
  'connCat.erp.hint': ['SAP · ERP', 'SAP · ERP'],
  'connCat.storage.label': ['파일 스토리지', 'File storage'],
  'connCat.storage.hint': ['오브젝트 스토리지', 'Object storage'],
  'connCat.ai.label': ['AI 모델', 'AI models'],
  'connCat.ai.hint': ['자연어 SQL 생성 · 튜닝', 'Natural-language SQL · tuning'],

  'connRole.both': ['소스 · 타깃', 'Source · target'],
  'connRole.source': ['소스 전용', 'Source only'],
  'connRole.target': ['타깃 전용', 'Target only'],
  'connRole.ai': ['AI 어시스턴트', 'AI assistant'],

  // ── 여러 타입이 공유하는 필드 ──
  'connField.pool.label': ['커넥션 풀 크기', 'Connection pool size'],
  'connField.ssl.label': ['SSL 사용', 'Use SSL'],
  'connField.cdc.label': ['CDC 사용 (실시간 변경 수집)', 'Enable CDC (real-time change capture)'],
  'connField.cdc.hint': [
    '켜면 이 연결을 캔버스의 CDC 소스로 쓸 수 있습니다. 저장 후 아래 「전제조건 점검」으로 준비 상태를 확인하세요.',
    'When enabled, this connection can be a CDC source on the canvas. After saving, verify readiness with "Prerequisite checks" below.',
  ],
  'connField.stmts.label': ['허용 명령 (쿼리 편집기)', 'Allowed statements (SQL editor)'],
  'connField.stmts.hint': [
    '체크한 명령만 SQL 편집기에서 실행됩니다. 쓰기는 operator, 스키마 변경은 editor 권한도 필요합니다.',
    'Only checked statements run in the SQL editor. Writes also need the operator role; schema changes need editor.',
  ],
  'connField.host.label': ['호스트', 'Host'],
  'connField.port.label': ['포트', 'Port'],
  'connField.database.label': ['데이터베이스', 'Database'],
  'connField.user.label': ['사용자', 'User'],
  'connField.password.label': ['비밀번호', 'Password'],
  'connField.secret.hint': [
    '암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
    'Stored encrypted and never shown on screen again.',
  ],
  'connField.endpointOptional.label': ['엔드포인트 (선택)', 'Endpoint (optional)'],

  // ── 타입별 ──
  'conn.mysql.label': ['MySQL', 'MySQL'],
  'conn.mysql.desc': ['테이블 조회 · 증분 적재 · CDC', 'Table reads · incremental load · CDC'],
  'conn.postgres.label': ['PostgreSQL', 'PostgreSQL'],
  'conn.postgres.desc': ['테이블 조회 · 증분 적재 · CDC', 'Table reads · incremental load · CDC'],
  'conn.mssql.label': ['MSSQL', 'MSSQL'],
  'conn.mssql.desc': ['SQL Server · MERGE upsert · CDC', 'SQL Server · MERGE upsert · CDC'],
  'conn.mssql.odbc.label': ['ODBC 드라이버', 'ODBC driver'],
  'conn.mssql.odbc.hint': [
    '컨테이너에 설치된 드라이버 이름과 같아야 합니다.',
    'Must match the driver name installed in the container.',
  ],
  'conn.mssql.trustCert.label': ['서버 인증서 신뢰', 'Trust server certificate'],
  'conn.mssql.trustCert.hint': [
    '사내 SQL Server 는 자체 서명 인증서를 쓰는 경우가 많습니다.',
    'On-prem SQL Server commonly uses a self-signed certificate.',
  ],

  'conn.mongo.label': ['MongoDB', 'MongoDB'],
  'conn.mongo.desc': ['컬렉션 · JSON 필터', 'Collections · JSON filters'],
  'conn.mongo.uri.label': ['접속 URI (선택)', 'Connection URI (optional)'],
  'conn.mongo.uri.hint': [
    'URI 를 넣으면 아래 호스트·포트 대신 이것을 씁니다.',
    'If set, this is used instead of the host/port below.',
  ],
  'conn.mongo.authSource.label': ['인증 DB (authSource)', 'Auth DB (authSource)'],
  'conn.mongo.authSource.ph': ['admin — 비우면 위 데이터베이스', 'admin — empty = database above'],
  'conn.mongo.replicaSet.label': ['레플리카셋', 'Replica set'],

  'conn.sap_rfc.label': ['SAP RFC', 'SAP RFC'],
  'conn.sap_rfc.desc': ['BAPI · RFC_READ_TABLE (사이드카 경유)', 'BAPI · RFC_READ_TABLE (via sidecar)'],
  'conn.sap_rfc.ashost.label': ['SAP 호스트 (ashost)', 'SAP host (ashost)'],
  'conn.sap_rfc.ashost.hint': [
    '단일 서버 직접 접속. 로드밸런싱은 mshost 를 쓰세요(고급).',
    'Direct single-server access. Use mshost for load balancing (advanced).',
  ],
  'conn.sap_rfc.sysnr.label': ['시스템 번호 (sysnr)', 'System number (sysnr)'],
  'conn.sap_rfc.client.label': ['클라이언트 (client)', 'Client (client)'],
  'conn.sap_rfc.user.label': ['사용자 (user)', 'User (user)'],
  'conn.sap_rfc.passwd.label': ['비밀번호 (passwd)', 'Password (passwd)'],
  'conn.sap_rfc.passwd.hint': [
    'SAP 계정 비밀번호. 암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
    'SAP account password. Stored encrypted and never shown again.',
  ],
  'conn.sap_rfc.lang.label': ['로그온 언어 (lang)', 'Logon language (lang)'],
  'conn.sap_rfc.lang.ph': ['KO 또는 EN', 'KO or EN'],
  'conn.sap_rfc.pageSize.label': ['페이지 크기', 'Page size'],
  'conn.sap_rfc.sidecarSection.label': ['사이드카 설정 (선택)', 'Sidecar settings (optional)'],
  'conn.sap_rfc.sidecarSection.hint': [
    '보통 손대지 않습니다 — 사이드카가 하나면 비워두세요.',
    'Usually untouched — leave empty when there is a single sidecar.',
  ],
  'conn.sap_rfc.sidecarUrl.label': ['사이드카 주소', 'Sidecar URL'],
  'conn.sap_rfc.sidecarUrl.ph': ['비워두면 시스템 기본값 사용', 'Empty = system default'],
  'conn.sap_rfc.sidecarUrl.hint': [
    '워커→사이드카→SAP 게이트웨이. 사이드카가 하나면 비워두세요 — 시스템 기본값을 씁니다. 다른 사이드카를 쓸 때만 입력합니다.',
    'Worker → sidecar → SAP gateway. Leave empty for a single sidecar — the system default is used. Set only for an alternate sidecar.',
  ],
  'conn.sap_rfc.apiToken.label': ['사이드카 토큰', 'Sidecar token'],
  'conn.sap_rfc.apiToken.hint': [
    '워커 ↔ 사이드카 공유 토큰 (SAP 비밀번호 아님). 사이드카에 토큰을 설정한 경우에만.',
    'Shared worker ↔ sidecar token (not the SAP password). Only if the sidecar has one configured.',
  ],
  'conn.sap_rfc.timeout.label': ['읽기 타임아웃(초)', 'Read timeout (s)'],
  'conn.sap_rfc.verifyTls.label': ['TLS 인증서 검증', 'Verify TLS certificate'],

  'conn.s3.label': ['Amazon S3', 'Amazon S3'],
  'conn.s3.desc': ['Parquet · JSONL · CSV 적재', 'Parquet · JSONL · CSV load'],
  'conn.s3.bucket.label': ['버킷', 'Bucket'],
  'conn.s3.region.label': ['리전', 'Region'],
  'conn.s3.accessKey.label': ['Access Key ID', 'Access Key ID'],
  'conn.s3.accessKey.hint': [
    '비우면 인스턴스 역할(IAM Role)을 사용합니다.',
    'Empty = use the instance IAM role.',
  ],
  'conn.s3.secretKey.label': ['Secret Access Key', 'Secret Access Key'],
  'conn.s3.endpoint.ph': ['MinIO 등 S3 호환 저장소를 쓸 때만', 'Only for S3-compatible stores (MinIO, …)'],
  'conn.s3.kmsKey.label': ['KMS 키 ID (선택)', 'KMS key ID (optional)'],

  'conn.local_file.label': ['로컬 파일', 'Local file'],
  'conn.local_file.abbr': ['파일', 'File'],
  'conn.local_file.desc': ['테스트용 · Parquet/JSONL/CSV 저장', 'For testing · Parquet/JSONL/CSV output'],
  'conn.local_file.baseDir.label': ['저장 폴더', 'Output folder'],
  'conn.local_file.baseDir.hint': [
    '서버의 파일 루트 아래 하위 폴더명입니다. 실제 경로는 노드의 경로 prefix·실행ID로 더 나뉩니다.',
    "Subfolder under the server's file root. Actual paths add the node's prefix and run id.",
  ],
  'conn.local_file.summary': ['{dir} 아래에 저장', 'Saved under {dir}'],
  'conn.local_file.rootDir': ['(루트)', '(root)'],

  'conn.gemini.label': ['Google Gemini', 'Google Gemini'],
  'conn.gemini.desc': ['자연어로 SQL 생성 · 튜닝', 'Natural-language SQL generation · tuning'],
  'conn.gemini.model.label': ['모델', 'Model'],
  'conn.gemini.model.hint': [
    'Google AI Studio 에서 쓸 수 있는 모델 이름. 폐기된 모델은 404 로 최신 모델을 안내합니다.',
    'A model name available in Google AI Studio. Retired models 404 with a pointer to current ones.',
  ],
  'conn.gemini.apiKey.label': ['API Key', 'API Key'],
  'conn.gemini.apiKey.hint': [
    'Google AI Studio 의 API 키. 암호화 저장되며 이후 화면에 다시 표시되지 않습니다.',
    'Google AI Studio API key. Stored encrypted and never shown again.',
  ],
  'conn.gemini.endpoint.hint': [
    '프록시·리전 엔드포인트를 쓸 때만. 비우면 기본값.',
    'Only for proxy/region endpoints. Empty = default.',
  ],

  'conn.ollama.label': ['Ollama (로컬 모델)', 'Ollama (local model)'],
  'conn.ollama.desc': ['내 장비에서 도는 오픈웨이트 모델', 'Open-weight models on your own hardware'],
  'conn.ollama.model.label': ['모델', 'Model'],
  'conn.ollama.model.hint': [
    '먼저 `ollama pull <모델>` 로 내려받아야 합니다. 없으면 연결 테스트가 알려 줍니다.',
    'Pull it first with `ollama pull <model>`. The connection test will tell you if it is missing.',
  ],
  'conn.ollama.endpoint.hint': [
    'compose 로 띄운 ollama 는 기본값 그대로. 호스트에서 직접 돌리면 http://host.docker.internal:11434.',
    'Default works for compose-run ollama. Running on the host: http://host.docker.internal:11434.',
  ],
  'conn.ollama.timeout.label': ['응답 대기 (초)', 'Response timeout (s)'],
  'conn.ollama.timeout.hint': [
    '로컬 추론은 상용 API 보다 느립니다. GPU 없이 큰 모델을 쓰면 늘리세요.',
    'Local inference is slower than hosted APIs. Increase for large models without a GPU.',
  ],

  'conn.bedrock.label': ['AWS Bedrock', 'AWS Bedrock'],
  'conn.bedrock.desc': ['자연어로 SQL 생성 · 튜닝', 'Natural-language SQL generation · tuning'],
  'conn.bedrock.model.label': ['모델 ID', 'Model ID'],
  'conn.bedrock.model.hint': [
    '리전·자격증명 입력 후 「모델 불러오기」로 사용 가능한 모델을 드롭다운에서 고르세요.',
    'Enter region/credentials, then pick from the dropdown via "Load models".',
  ],
  'conn.bedrock.region.label': ['리전', 'Region'],
  'conn.bedrock.region.hint': ['Bedrock 을 활성화한 AWS 리전.', 'AWS region with Bedrock enabled.'],
  'conn.bedrock.accessKey.label': ['Access Key ID', 'Access Key ID'],
  'conn.bedrock.accessKey.hint': [
    'IAM 자격증명의 액세스 키 ID (bedrock:Converse·InvokeModel 권한 필요).',
    'IAM access key ID (needs bedrock:Converse / InvokeModel).',
  ],
  'conn.bedrock.secretKey.label': ['Secret Access Key', 'Secret Access Key'],
  'conn.bedrock.sessionToken.label': ['Session Token (선택)', 'Session Token (optional)'],
  'conn.bedrock.sessionToken.hint': [
    '임시 자격증명(STS)을 쓸 때만. 비우면 사용하지 않습니다.',
    'Only for temporary (STS) credentials. Empty = unused.',
  ],

  'conn.unknown.desc': ['알 수 없는 커넥터', 'Unknown connector'],
} as const
