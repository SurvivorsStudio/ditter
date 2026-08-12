# 프로젝트 구조

## 모노레포 (다중 언어)

프런트엔드는 TypeScript, 백엔드·워커는 Python이다. 언어가 갈리므로 **패키지 경계 = 언어 경계**이기도 하다.

- 프런트엔드 앱 (React + Vite, TypeScript)
- 백엔드 앱 (FastAPI, Python)
- 공유 Python 패키지 — DAG 스펙(Pydantic v2 모델), 커넥터 라이브러리 등 **백엔드·워커가 공유**하는 코드. 프런트엔드와는 언어가 달라 공유하지 못한다 — 그 경계는 아래 [프런트엔드-백엔드 타입 공유](#프런트엔드-백엔드-타입-공유)에서 다룬다.

[파이프라인(F7)](../pipeline/README.md)이 붙으면 하나가 더 늘어난다.

- 워커 앱 (Celery) — DAG 실행. 백엔드와 같은 Python이므로 공유 패키지를 그대로 import한다.

## 프런트엔드-백엔드 타입 공유

TypeScript 하나였던 시절에는 `packages/shared-types`에 zod 스키마를 두고 양쪽이 같은 정의를
import했다. 백엔드가 Python이 되면서 그 방식은 그대로 못 쓴다 — **손으로 두 벌 관리하지 않고
생성한다.**

- **FastAPI가 OpenAPI 스펙을 자동으로 만든다** (Pydantic 모델 → JSON Schema → OpenAPI). 이게
  유일한 정의다.
- 프런트엔드 빌드 과정에서 그 스펙으로부터 **TypeScript 타입을 생성**한다
  (`frontend/src/generated/api-types.ts`, 커밋 대상 아님 — `npm run build`·`npm run dev` 전에
  항상 새로 생성한다).
- **손으로 프런트에 타입을 다시 선언하지 않는다.** 스키마 조회 결과, EXPLAIN 트리, DAG 스펙 전부
  이 경로로 온다.
- 이름 규칙 차이(백엔드 `snake_case` ↔ 프런트 `camelCase`)는 백엔드가 직렬화 시점에 흡수한다
  ([python-style.md](python-style.md)) — 생성된 타입도 이미 camelCase다.

## 파이프라인이 추가하는 의존 규칙

패키지가 늘면 의존 방향을 명시해 둬야 한다. 아래 셋은 어겼을 때 되돌리기가 특히 비싸다.

- **백엔드는 워커 코드를 import 하지 않는다.** 큐에 태스크 이름(`pipeline.execute`)과 페이로드만 넣는다. 반대 방향으로,
  워커는 메타 저장을 직접 갱신하므로 백엔드의 모델·DAG 스펙에 의존한다.
- **DAG 스펙은 공유 Python 패키지에 Pydantic v2로 한 벌만 둔다.** 백엔드·워커가 같은 정의를
  import한다. 복제하면 반드시 어긋난다 ([dag-and-nodes.md](../pipeline/dag-and-nodes.md)). 프런트엔드는 위
  [타입 공유](#프런트엔드-백엔드-타입-공유) 경로로 파생된 타입을 쓴다 — Pydantic 모델을 다시
  선언하지 않는다.
- **커넥터 드라이버는 지연 로딩한다** (`importlib.import_module()`을 레지스트리 안에서 호출).
  레지스트리를 import 했다고 드라이버까지 로드되면 안 된다
  ([connector-contract.md](../pipeline/connector-contract.md)).

## 메타 저장도 인터페이스 뒤에 둔다

DB 어댑터와 같은 이유다. 파이프라인 메타(`pipelines` · `pipeline_runs` · 체크포인트)는 지금
SQLite에 있지만, 워커를 여러 호스트로 늘리는 순간 SQLite로는 감당이 안 된다. 그때 PostgreSQL로
옮길 수 있게 **접근 코드를 인터페이스 뒤에 둔다.** 배경은
[pipeline/README.md](../pipeline/README.md#️-메타-저장을-sqlite로-두는-것의-한계).

## DB 어댑터 인터페이스

DB 접근 코드는 **처음부터 어댑터 인터페이스(Python `Protocol` 또는 ABC)로 감싼다.** MVP는
PostgreSQL 하나로 시작하지만, [이기종 데이터 쿼리엔진](../todo/step-02a-federated-query-engine.md)에서
**MySQL이 두 번째 구현체로 실제로 들어온다** — 그래서 어댑터 경계를 지금 그어두는 것은 이론상
확장성이 아니라 이번 스코프에서 바로 쓰이는 설계다.

어댑터가 감싸야 하는 책임:

- 접속 풀 관리
- 스키마·통계 조회 (`information_schema`, `pg_catalog` / MySQL은 `information_schema`, `performance_schema`)
- 쿼리 실행 (timeout, 행수 제한 포함)
- EXPLAIN 실행·파싱 (엔진마다 포맷이 다르므로 어댑터가 공통 형태로 정규화한다)

이 어댑터 인터페이스 바깥에서 특정 엔진 전용 SQL을 직접 조립하지 않는다.

## AI 컨텍스트 빌더는 순수 서비스로 분리

[STEP 3](../todo/step-03-ai-context-builder.md)의 컨텍스트 빌더·프롬프트 조립 로직은 **FastAPI를 모르는 순수 Python 모듈**로 분리한다. 이렇게 분리해야:

- 가짜(mock) 스키마·EXPLAIN JSON만으로 백엔드 완성 전에 프롬프트 실험을 시작할 수 있다.
- 유닛 테스트에서 ASGI 서버를 띄우지 않고 이 로직만 검증할 수 있다.

## 관련

- [backend-fastapi.md](backend-fastapi.md)
- [python-style.md](python-style.md) · [typescript-style.md](typescript-style.md)
- [docs/pipeline](../pipeline/README.md) — 파이프라인 패키지 구성의 근거
- 담당 STEP: [step-00-dev-environment.md](../todo/step-00-dev-environment.md), [1A 어댑터 인터페이스](../todo/step-01a-connection-registry.md), [step-03-ai-context-builder.md](../todo/step-03-ai-context-builder.md), [2A 이기종 쿼리엔진](../todo/step-02a-federated-query-engine.md), [9B 커넥터](../todo/step-09b-connectors.md) · [9D 워커](../todo/step-09d-execution-engine.md)
