# STEP 2A · 이기종 데이터 쿼리엔진 (`F1` 확장)

> **시작 조건**: [STEP 2](step-02-web-console.md) (F1 완성) — STEP 3~8과 **독립적으로** 진행할 수 있다

## 목표

서로 다른 엔진(PostgreSQL + MySQL)에 등록된 **읽기 전용 소스 커넥션 여러 개를 한 쿼리로 조인**해
콘솔 화면에 결과를 보여준다. "대상 DB는 PostgreSQL 하나"라는 기존 전제에 처음으로 예외를 만드는
지점이며, 그 예외가 어디까지인지는 [heterogeneous-query-engine.md](../policy/heterogeneous-query-engine.md)(P10)에
먼저 못 박아 두었다.

## 이 STEP이 여는 것과 열지 않는 것

| 여는 것 | 열지 않는 것 |
|---|---|
| MySQL을 **두 번째 소스 어댑터**로 구현 — [1A](step-01a-connection-registry.md)의 DB 어댑터 인터페이스의 실제 두 번째 구현체가 된다 | MySQL을 **파이프라인(F7) 타깃**으로 쓰는 것 — [pipeline/README.md](../pipeline/README.md#mvp-범위)의 범위 밖 결정은 그대로다 |
| PostgreSQL + MySQL을 섞어 조인하는 실행 경로 | Oracle 등 **세 번째 이상의 엔진** |
| 콘솔 결과 그리드에 조인 결과 표시 | 조인 결과를 **저장·내보내는 새 경로** — [P10 규칙 3](../policy/heterogeneous-query-engine.md#규칙-3--결과는-트랜지언트다-새-쓰기-경로를-만들지-않는다) |

## 하는 일

- DB 어댑터 인터페이스에 **MySQL 구현체**를 추가한다 (드라이버는 팀이 정한다 — PyMySQL 또는
  asyncmy). Postgres 어댑터와 **같은 인터페이스**로 스키마·통계 조회, 쿼리 실행, EXPLAIN 파싱을
  노출한다 ([project-structure.md](../conventions/project-structure.md#db-어댑터-인터페이스))
- `connections.adapter_type`에 `mysql`을 추가한다 ([connections.md](../schema/connections.md))
- **`sqlglot` 기반 AST 검증기를 MySQL 방언에도 적용**한다 — [1B](step-01b-readonly-validator.md)
  검증기를 재사용하되, 방언별 분기만 추가한다
- 콘솔에 **커넥션 다중 선택 UI**를 추가한다 — `role='source'`인 접속을 2~3개까지 고르고, 하나의
  쿼리를 입력한다
- **엔진(DuckDB 또는 Polars) 확정 후** 조인 실행 경로를 구현한다 — 결정 전까지는 조인 결과의
  응답 스키마만 먼저 못 박고 mock으로 프런트를 선행할 수 있다
  ([heterogeneous-query-engine.md의 엔진 선택](../policy/heterogeneous-query-engine.md#엔진-선택--duckdb-vs-polars-팀-결정-필요))
- **P10 규칙 1~5**를 구현한다: `role`·`adapter_type` 검사(라우터 앞단), 각 소스별 AST 검증, 리소스
  상한(조인 전 소스별 행 수, 전체 시간, 동시 소스 개수), 감사 로그(`federated_query_id`로 관련
  기록을 묶는다)

## 완료 조건

1. PostgreSQL 소스 하나 + MySQL 소스 하나를 등록하고, 두 테이블을 조인한 쿼리 결과가 화면에
   표로 나온다.
2. `role='target'` 커넥션은 이 기능의 소스 선택 목록에 **한 번도 나타나지 않는다.**
3. 각 소스에 실제로 나가는 문장이 그 엔진의 AST 검증을 통과해야 한다 — DML이 섞인 쿼리는 어느
   소스 쪽이든 **차단된다** (회귀 테스트로 고정).
4. 소스 중 하나에서 가져오는 행 수가 상한을 넘으면 **잘리는 게 아니라 명확히 경고한다** — 조용히
   일부만 조인하고 성공으로 끝내지 않는다.
5. 실행마다 관련된 소스 커넥션 각각에 감사 로그가 한 건씩 남고, 같은 `federated_query_id`로
   묶여 있다.

**2·3은 회귀 테스트로 고정한다.**

## 리뷰 게이트

🔒 **2인 리뷰 필수** — 여러 프로덕션 DB에 동시에 닿는 새 경로다 ([P10](../policy/heterogeneous-query-engine.md)).

## 관련 정책

- [heterogeneous-query-engine.md](../policy/heterogeneous-query-engine.md) (P10)
- [read-only-enforcement.md](../policy/read-only-enforcement.md) (P3)
- [query-safety-limits.md](../policy/query-safety-limits.md) (P5)

## 관련 컨벤션

- [project-structure.md](../conventions/project-structure.md) — DB 어댑터 인터페이스
