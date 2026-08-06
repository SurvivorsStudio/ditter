# 커넥터 계약

파이프라인 확장의 핵심이다. **신규 저장소 지원은 구현체 하나를 추가하는 일**이어야 하고, 그러려면
계약이 먼저 고정돼야 한다.

## 인터페이스

```ts
// packages/pipeline-connectors/src/types.ts

export type ConnectorType = 'postgres' | 's3' | 'local_file' | 'http_json';
export type WriteMode = 'append' | 'upsert' | 'overwrite';

/** 커넥터가 주고받는 유일한 데이터 단위. 배치 = 레코드 배열 + 소속 정보 */
export interface RecordBatch {
  readonly rows: readonly Record<string, unknown>[];
  readonly schema: TableSchema | null;
  /** 이 배치까지 읽은 워터마크 값. 소스가 채우고 엔진이 커밋 시점에 사용한다 */
  readonly watermark?: WatermarkValue;
}

/** 소스를 지정하는 방법은 셋 중 하나다 (서로 배타적) */
export type ReadSpec =
  | { kind: 'table'; table: string; params?: Readonly<Record<string, unknown>> }
  | { kind: 'query'; query: string; params?: Readonly<Record<string, unknown>> }
  | { kind: 'function'; fn: string; params?: Readonly<Record<string, unknown>> };

export interface Connector {
  readonly type: ConnectorType;
  testConnection(): Promise<HealthResult>;
  discoverSchema(table?: string): Promise<TableSchema[]>;
  /** 소스: 비동기 제너레이터로 스트리밍한다. 전량을 메모리에 올리지 않는다 */
  read(spec: ReadSpec): AsyncIterable<RecordBatch>;
  /** 타깃: 배치 단위 쓰기 */
  write(batch: RecordBatch, mode: WriteMode): Promise<WriteResult>;
  close(): Promise<void>;
}
```

### 계약이 강제하는 것

- **`read`는 반드시 `AsyncIterable`이다.** 배열을 반환하는 커넥터는 계약 위반이다. 전량 로드는
  실행 엔진의 스트리밍 설계([execution-engine.md](execution-engine.md))를 통째로 무력화한다.
- **`function`은 MVP에서 쓰지 않는다.** SAP BAPI 같은 "테이블도 쿼리도 아닌 소스" 자리로 미리
  열어둔 것이다. 나중에 추가하면 `ReadSpec`을 union에 끼워 넣느라 모든 커넥터를 건드리게 된다.
- **커넥터별 옵션은 `params`로만 전달한다.** 인터페이스에 커넥터 전용 인자를 추가하지 않는다.
  하나 추가하는 순간 나머지 커넥터 전부가 그 인자를 무시해야 하는 관계가 된다.
- **`close()`는 항상 호출된다.** 실행이 실패해도 `finally`에서 부른다. 접속 풀이 새면 프로덕션
  DB의 커넥션 상한을 갉아먹는다 ([query-safety-limits.md](../policy/query-safety-limits.md)).

## 소스 커넥터는 읽기 전용 어댑터 위에 얹는다

`postgres` 소스 커넥터는 **자체 접속을 만들지 않는다.** [STEP 1](../todo/step-01-db-connection.md)에서
만든 DB 어댑터 인터페이스를 그대로 쓴다. 이유는 하나다 — 읽기 전용 강제, `statement_timeout`,
풀 상한이 전부 그 어댑터에 붙어 있기 때문이다. 파이프라인이 자체 접속을 열면 그 방어가 전부
우회된다.

단 하나 예외가 있다. 어댑터가 콘솔용으로 거는 **`max_rows`(응답 행 수 상한)는 이 경로에 걸지
않는다** — 스트리밍에는 "응답"이라는 단위가 없고, 걸면 대량 적재가 조용히 잘린다. 그 자리를
대신하는 것은 **한 배치의 크기 상한**이다 ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md)
규칙 8, [connections](../schema/connections.md)의 `max_rows`).

`ReadSpec`이 `kind: 'query'`인 경우 **콘솔과 동일한 AST 검증기를 통과해야 한다.** 파이프라인
소스라고 예외를 두지 않는다 ([read-only-enforcement.md](../policy/read-only-enforcement.md)).

## 레지스트리와 지연 로딩

```ts
// packages/pipeline-connectors/src/registry.ts

const loaders: Record<ConnectorType, () => Promise<ConnectorFactory>> = {
  postgres:   async () => (await import('./postgres.ts')).factory,
  s3:         async () => (await import('./s3.ts')).factory,
  local_file: async () => (await import('./local-file.ts')).factory,
  http_json:  async () => (await import('./http-json.ts')).factory,
};

export async function build(type: ConnectorType, config: ConnectorConfig): Promise<Connector> {
  const loader = loaders[type];
  if (!loader) throw new UnknownConnectorError(type);
  return (await loader())(config);
}
```

**드라이버는 동적 `import()`로 지연 로딩한다.** 레지스트리를 import 했다고 해서 AWS SDK가 같이
올라오면 안 된다.

원본 청사진에서 이 규칙의 이유는 Celery의 `fork()` 안정성이었다. Node에는 그 문제가 없으므로
**같은 규칙을 다른 이유로 지킨다**:

- 백엔드는 커넥터 목록만 알면 되고 드라이버는 필요 없다 — 기동 시간과 메모리를 낭비할 이유가 없다.
- 평가되는 모듈이 적을수록 공급망 노출면이 좁다 ([supply-chain-security.md](../policy/supply-chain-security.md)).
- 특정 커넥터를 안 쓰는 배포에서 그 드라이버를 optional dependency로 뺄 수 있다.

## 신규 커넥터 추가 절차

네 군데를 **동시에** 건드려야 한다. 하나라도 빠지면 화면에는 보이는데 저장이 안 되거나, 저장은
되는데 필드가 안 보인다.

| # | 위치 | 하는 일 |
|---|---|---|
| 1 | `packages/pipeline-connectors/src/<name>.ts` | `Connector` 구현 + 팩토리 export |
| 2 | `registry.ts` | 지연 로더 등록 |
| 3 | 백엔드 설정 허용 키 목록 | 이 커넥터가 받는 config 키를 화이트리스트에 추가 |
| 4 | 프런트 `connectorFields.ts` | 설정 패널에 그릴 필드 선언 |

**3번과 4번은 반드시 짝이다.** 프런트에 필드를 추가하고 백엔드 화이트리스트를 안 고치면 값이
조용히 버려진다. 이 짝을 어긋나게 두지 않도록 **필드 선언을 `packages/shared-types`의 한 곳에서
파생시키고, 양쪽 테스트로 고정한다.**

## 시크릿 취급

커넥터 config 중 다음 키는 **저장 시 자동으로 분리 암호화**하고, API 응답에 **절대 포함하지
않는다.**

```
password · secretAccessKey · sessionToken · privateKey · passphrase · apiToken
```

- 암호화 메커니즘은 새로 만들지 않는다. [자격증명 관리(P4)](../policy/credential-management.md)의
  기존 방식을 그대로 쓴다.
- 응답 직렬화에서 제외하는 것에 그치지 않고, **키 목록을 한 곳에 두고 직렬화 계층에서 강제**한다.
  새 커넥터가 새 시크릿 키를 들고 오면 그 목록에 추가하는 것이 체크리스트에 포함된다.
- 로그·에러 메시지에도 나가지 않아야 한다. 커넥터가 던지는 에러에 config를 통째로 붙이지 않는다.

## 테스트 요건

- 각 커넥터는 **`read`가 배치를 여러 번 yield 하는지** 검증한다(한 번에 다 주면 스트리밍이 아니다).
- `write`의 세 모드가 **멱등한지** 검증한다 — 같은 배치를 두 번 써도 결과가 같아야 한다
  (`append` 제외).
- 소스 커넥터는 **DML이 담긴 `ReadSpec`을 거부하는지** 검증한다. 이건 회귀 테스트로 고정한다
  ([testing.md](../conventions/testing.md)).
- 실패 시 `close()`가 호출되는지 검증한다.

## 관련

- [execution-engine.md](execution-engine.md) — 이 계약을 소비하는 쪽
- [read-only-enforcement.md](../policy/read-only-enforcement.md) — 소스 읽기에 적용되는 방어
- [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) — `write`가 허용되는 범위
- 담당 STEP: [step-09-pipeline-foundation.md](../todo/step-09-pipeline-foundation.md)
