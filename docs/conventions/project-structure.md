# 프로젝트 구조

## 모노레포

TypeScript 모노레포로 구성한다. 최소한 다음 패키지 경계를 둔다.

- 프런트엔드 앱 (React + Vite)
- 백엔드 앱 (Fastify)
- 공유 타입 패키지 — 스키마 조회 결과, EXPLAIN 트리, 컨텍스트 JSON 등 프런트/백엔드가 공유하는 타입

[파이프라인(F7)](../pipeline/README.md)이 붙으면 둘이 더 늘어난다.

- 워커 앱 (BullMQ) — DAG 실행
- 커넥터 패키지 — 백엔드·워커가 공유하는 순수 라이브러리. Fastify도 BullMQ도 모른다

## 파이프라인이 추가하는 의존 규칙

패키지가 늘면 의존 방향을 명시해 둬야 한다. 아래 셋은 어겼을 때 되돌리기가 특히 비싸다.

- **백엔드는 워커 코드를 import 하지 않는다.** 큐에 잡 이름과 페이로드만 넣는다. 반대 방향으로,
  워커는 메타 저장을 직접 갱신하므로 백엔드의 모델·DAG 스펙에 의존한다.
- **DAG 스펙은 공유 타입 패키지에 zod로 한 벌만 둔다.** 프런트·백엔드·워커가 같은 정의를
  import 한다. 복제하면 반드시 어긋난다 ([dag-and-nodes.md](../pipeline/dag-and-nodes.md)).
- **커넥터 드라이버는 동적 `import()`로 지연 로딩한다.** 커넥터 레지스트리를 import 했다고
  드라이버까지 올라오면 안 된다 ([connector-contract.md](../pipeline/connector-contract.md)).

## 메타 저장도 인터페이스 뒤에 둔다

DB 어댑터와 같은 이유다. 파이프라인 메타(`pipelines` · `pipeline_runs` · 체크포인트)는 지금
SQLite에 있지만, 워커를 여러 호스트로 늘리는 순간 SQLite로는 감당이 안 된다. 그때 PostgreSQL로
옮길 수 있게 **접근 코드를 인터페이스 뒤에 둔다.** 배경은
[pipeline/README.md](../pipeline/README.md#️-메타-저장을-sqlite로-두는-것의-한계).

## DB 어댑터 인터페이스

DB 접근 코드는 **처음부터 어댑터 인터페이스로 감싼다.** MVP 구현은 PostgreSQL 하나뿐이지만, 어댑터 경계를 지금 그어두면:

- 실제 구현 비용은 거의 늘지 않는다.
- "멀티 DB 확장 설계가 되어 있다"고 정직하게 말할 수 있다 ([STEP 13](../todo/step-13-demo-submission.md)에서 이 인터페이스를 문서화한다).

어댑터가 감싸야 하는 책임:

- 접속 풀 관리
- 스키마·통계 조회 (`information_schema`, `pg_catalog`)
- 쿼리 실행 (timeout, 행수 제한 포함)
- EXPLAIN 실행·파싱

이 어댑터 인터페이스 바깥에서 PostgreSQL 전용 SQL을 직접 조립하지 않는다.

## AI 컨텍스트 빌더는 순수 서비스로 분리

[STEP 3](../todo/step-03-ai-context-builder.md)의 컨텍스트 빌더·프롬프트 조립 로직은 **Fastify를 모르는 순수 서비스**로 분리한다. 이렇게 분리해야:

- 가짜(mock) 스키마·EXPLAIN JSON만으로 백엔드 완성 전에 프롬프트 실험을 시작할 수 있다.
- 유닛 테스트에서 HTTP 서버를 띄우지 않고 이 로직만 검증할 수 있다.

## 관련

- [backend-fastify.md](backend-fastify.md)
- [docs/pipeline](../pipeline/README.md) — 파이프라인 패키지 구성의 근거
- 담당 STEP: [step-00-dev-environment.md](../todo/step-00-dev-environment.md), [1A 어댑터 인터페이스](../todo/step-01a-connection-registry.md), [step-03-ai-context-builder.md](../todo/step-03-ai-context-builder.md), [9B 커넥터](../todo/step-09b-connectors.md) · [9D 워커](../todo/step-09d-execution-engine.md)
