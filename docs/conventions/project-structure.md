# 프로젝트 구조

## 모노레포

TypeScript 모노레포로 구성한다. 최소한 다음 패키지 경계를 둔다.

- 프런트엔드 앱 (React + Vite)
- 백엔드 앱 (Fastify)
- 공유 타입 패키지 — 스키마 조회 결과, EXPLAIN 트리, 컨텍스트 JSON 등 프런트/백엔드가 공유하는 타입

## DB 어댑터 인터페이스

DB 접근 코드는 **처음부터 어댑터 인터페이스로 감싼다.** MVP 구현은 PostgreSQL 하나뿐이지만, 어댑터 경계를 지금 그어두면:

- 실제 구현 비용은 거의 늘지 않는다.
- "멀티 DB 확장 설계가 되어 있다"고 정직하게 말할 수 있다 ([STEP 10](../todo/step-10-demo-submission.md)에서 이 인터페이스를 문서화한다).

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
- 담당 STEP: [step-00-dev-environment.md](../todo/step-00-dev-environment.md), [step-01-db-connection.md](../todo/step-01-db-connection.md), [step-03-ai-context-builder.md](../todo/step-03-ai-context-builder.md)
