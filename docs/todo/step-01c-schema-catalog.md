# STEP 1C · 스키마 조회와 쿼리 실행 API

> **상위**: [STEP 1 · DB에 안전하게 접속하기](step-01-db-connection.md)
> **시작 조건**: [1A](step-01a-connection-registry.md) + [1B](step-01b-readonly-validator.md)

## 목표

1A의 커넥션과 1B의 검증기를 **하나의 API 표면으로 합친다.** 이 문서가 끝나면 STEP 1이 끝난다.

여기서 나오는 스키마 JSON이 **에디터 자동완성(STEP 2)과 AI 컨텍스트(STEP 3)의 입력**이다. 그래서
출력 형태를 **백엔드 Pydantic 응답 모델로 먼저 못 박고 시작한다** — STEP 2의 프런트는 여기서 나온
OpenAPI 스펙으로 타입을 생성해 mock을 만들고([project-structure.md](../conventions/project-structure.md#프런트엔드-백엔드-타입-공유)),
STEP 3은 같은 모델을 Python에서 바로 import한다.

## 하는 일

- **스키마·통계 조회 API** — `information_schema` · `pg_catalog`에서 테이블·컬럼·인덱스·행 수 추정
- **마지막 ANALYZE 시각을 함께 반환한다.** 통계가 낡으면 STEP 5의 위험 판정이 크게 틀리는데,
  사용자가 그걸 알 방법이 이 값뿐이다 ([query-safety-limits.md](../policy/query-safety-limits.md))
- **쿼리 실행 API** — 1B의 검증기를 **먼저** 통과시킨 뒤에만 실행한다
- 실행 제한을 건다 ([query-safety-limits.md](../policy/query-safety-limits.md)):
  - `statement_timeout` — **롤 레벨로 DB가 강제**하게 하고, 앱 레벨은 보조로 둔다
  - 반환 행 수 제한(`max_rows`) — **콘솔 응답 한 번의 상한이다.** 파이프라인 스트리밍에는 걸지
    않는다 ([connections](../schema/connections.md))
- 내부 카탈로그 쿼리는 **파라미터 바인딩을 강제**하고 문자열 연결로 조립하지 않는다
  ([P1](../policy/internal-vs-user-query-injection.md))
- 스키마 조회 결과를 Pydantic 응답 모델로 정의한다 (프런트 타입은 여기서 생성된다)

## 완료 조건

1. 읽기 전용 계정으로 SELECT가 돌아가고 결과·실행 시간이 반환된다.
2. INSERT/UPDATE/DELETE가 **두 겹 모두에서** 차단된다 — DB 계정 권한(주방어) + AST 검증(보조).
3. [read-only-enforcement.md](../policy/read-only-enforcement.md)의 CTE 우회 쿼리가 차단된다.
4. 스키마 정보가 JSON으로 API에서 나오고, **마지막 ANALYZE 시각이 함께** 나온다.
5. `statement_timeout`을 넘기는 쿼리가 서버 쪽에서 끊긴다.

> **완료 조건 2·3은 STEP 1 전체의 완료 조건이기도 하다.** 여기가 통과해야 STEP 2 이후가 열린다.

## 리뷰 게이트

🔒 **2인 리뷰 필수** — 검증기를 실제로 **호출하는 지점**이 여기다. 1B가 아무리 정확해도 실행
경로가 그걸 안 거치면 소용없다.

## 관련 정책

- [read-only-enforcement.md](../policy/read-only-enforcement.md) (P3)
- [query-safety-limits.md](../policy/query-safety-limits.md) (P5)
- [internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) (P1)
