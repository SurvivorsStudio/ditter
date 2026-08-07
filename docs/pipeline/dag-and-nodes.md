# DAG 스펙과 노드

파이프라인 하나는 **노드 + 엣지로 이루어진 DAG**다. 이 스펙은 프런트(캔버스)·백엔드(검증·저장)·
워커(실행)가 **모두** 읽는다.

## 스펙은 한 벌만 존재한다

**DAG 스펙은 `packages/shared-types`에 zod 스키마로 한 벌만 둔다.** 세 곳이 각자 정의를 갖는
순간 어긋난다 — 이건 가능성이 아니라 시간 문제다.

```
packages/shared-types/src/pipeline/dag.ts   ← 유일한 정의
        ├── frontend  : 캔버스가 노드를 만들고 검증
        ├── backend   : 저장 전 검증, 실행 전 검증
        └── worker    : 실행 직전 재파싱
```

워커는 큐에서 꺼낸 페이로드를 **그대로 믿지 않고 다시 파싱한다.** 백엔드가 검증했더라도, 큐에
들어간 시점과 실행 시점 사이에 스펙 버전이 달라질 수 있다.

### ⚠️ zod 스키마를 함수 인자로 받을 때

DAG 스펙을 다루는 헬퍼를 만들 때 자주 밟는 함정이다.

```ts
// ✗ 나쁨 — .default()가 optional로 새어나가 타입이 실제와 어긋난다
function parseNode<T>(schema: z.ZodType<T>, raw: unknown): T { ... }

// ✓ 좋음 — 스키마 타입을 그대로 보존한다
function parseNode<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> { ... }
```

`z.ZodType<T>`로 받으면 `.default()`가 붙은 필드가 결과 타입에서 optional이 된다. DAG 스펙은
기본값이 많아서(모드, 배치 크기, 타임아웃) 이 실수가 곧장 런타임 `undefined`로 이어진다.

## 노드 종류

| 분류 | 노드 타입 | 설명 |
|---|---|---|
| 트리거 | `trigger.schedule` | cron 스케줄 실행 |
| | `trigger.manual` | 화면에서 수동 실행 |
| 소스 | `source.postgres` | 읽기 전용 어댑터 경유. `table` 또는 `query` |
| | `source.http_json` | JSON API 페이지네이션 수집 |
| 변환 | `transform.filter` | 행 조건 필터 |
| | `transform.map` | 컬럼 선택·이름변경·타입 캐스팅 |
| 타깃 | `target.postgres` | 쓰기 허용 커넥션에만 붙는다 (P9) |
| | `target.s3` | 오브젝트 스토리지 |
| | `target.file` | 격리 루트 하위 로컬 파일 |
| 주석 | `note.memo` | 캔버스 메모 |
| | `note.group` | 영역 그룹(제목·색상) |

### 주석 노드는 실행에 전혀 관여하지 않는다

`note.*`는 **`NOTE_KINDS` 한 곳에 모아두고**, 다음 전부에서 제외한다.

- 위상 정렬 · 실행
- DAG 검증(고아 노드 검사, 순환 검사)
- 흐름 요약 · 노드 수 집계

제외를 각 지점에 흩어서 하드코딩하면 하나를 빼먹고, 그러면 **"메모를 붙였더니 파이프라인이 검증에
실패한다"** 같은 증상이 나온다. 상수 하나를 참조하게 만든다.

`note.group`은 실행에는 없지만 **편집에는 있다** — 그룹 영역을 옮기면 안에 든 노드가 함께
움직인다 ([canvas-ux.md](canvas-ux.md)).

## 검증 규칙

저장 시점과 실행 시점 **양쪽에서** 검증한다.

| 규칙 | 위반 시 |
|---|---|
| 순환이 없다 | 저장 거부 |
| 모든 타깃은 상류에 소스가 하나 이상 있다 | 저장 거부 |
| 소스에서 도달 불가능한 실행 노드가 없다 | 경고 (저장은 허용) |
| 타깃 노드의 커넥션은 `role='target'`이다 | **저장 거부** — P9의 핵심 |
| 소스 노드의 커넥션은 `role='source'`이다 | **저장 거부** |
| 노드 타입과 커넥션의 `adapter_type`이 일치한다 | **저장 거부** (아래 표) |
| `source.postgres`의 `query`가 AST 검증을 통과한다 | **저장 거부** |
| 트리거는 파이프라인당 하나다 | 저장 거부 |

### 노드 타입 ↔ `adapter_type` 대응

`role`만 맞으면 통과시키면, `source.postgres` 노드에 `http_json` 커넥션을 붙인 파이프라인이 저장을
통과한다. 그 실패는 저장할 때가 아니라 **스케줄이 처음 도는 새벽에** 드러난다.

| 노드 | `adapter_type` |
|---|---|
| `source.postgres` · `target.postgres` | `postgres` |
| `source.http_json` | `http_json` |
| `target.s3` | `s3` |
| `target.file` | `local_file` |

- **`local_file`은 타깃 전용이다.** `source.local_file` 노드는 두지 않는다 — 파일을 소스로 읽는
  기능은 MVP 범위 밖이다.
- 노드 이름(`target.file`)과 커넥터 이름(`local_file`)이 다른 것은 위 표가 유일한 대응 근거다.
  화면·백엔드가 각자 매핑을 만들지 않도록 이 표를 `packages/shared-types`에서 파생시킨다.

읽기 전용 강제와 관련된 규칙(커넥션 역할, `adapter_type` 일치, 소스 쿼리 AST)은 **저장 시
통과했더라도 실행 직전에 다시 검사한다.** 커넥션의 역할이나 종류가 저장 이후에 바뀌었을 수 있다.

## 버전

- `pipelines.version`은 정의가 바뀔 때마다 올린다.
- 실행 레코드는 **실행 시점의 `pipeline_version`을 함께 저장한다.** 이게 없으면 "3주 전 그 실행이
  지금 정의와 같은 것이었나"에 답할 수 없다 — 감사 로그와 같은 이유다.
- 실행 중에 정의가 바뀌어도 **진행 중인 실행은 시작 시점 정의로 끝까지 간다.**

## 여러 상류가 한 노드로 모이면

**순차 concat(UNION ALL)** 이다. 상류를 하나씩 끝까지 소비한 뒤 다음으로 넘어간다.

조인은 범위 밖이다. 조인을 하려면 양쪽을 동시에 메모리에 들고 있거나 정렬 병합을 해야 하는데,
그러면 스트리밍 설계가 무너진다. 조인이 필요하면 **`source.postgres`의 `query`에서 SQL로 조인해서
읽는다** — DB가 훨씬 잘하는 일이다.

## 관련

- [connector-contract.md](connector-contract.md) — 소스·타깃 노드가 호출하는 계약
- [execution-engine.md](execution-engine.md) — 이 DAG를 실제로 돌리는 쪽
- [canvas-ux.md](canvas-ux.md) — 이 DAG를 사람이 만드는 쪽
- 담당 STEP: [9C DAG 스펙과 저장](../todo/step-09c-dag-spec.md)
