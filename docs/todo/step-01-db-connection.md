# STEP 1 · DB에 안전하게 접속하기

**시작 조건**: STEP 0

## 목표

"DB를 안전하게 읽는 능력"을 만든다. 화면에는 아직 아무것도 안 보이지만, **이 단계가 모든 것의 병목이다.** 여기서 만드는 스키마 조회 기능이 없으면 에디터 자동완성도, AI 컨텍스트도 만들 수 없다. **가장 먼저, 가장 확실하게 끝낸다.**

## 하는 일

- postgres.js 접속 풀, 접속 설정 CRUD (SQLite에 저장)
- 스키마·통계 읽어오는 API (`information_schema`, `pg_catalog`)
- 쿼리 실행 API — 실행 시간 제한(`statement_timeout`), 반환 행 수 제한, 커넥션 풀 상한 ([query-safety-limits.md](../policy/query-safety-limits.md))
- 접속 정보(비밀번호 등) 저장·보관 ([credential-management.md](../policy/credential-management.md))
- DB 접근 코드를 어댑터 인터페이스로 감싼다 (구현은 PostgreSQL 하나)
- **읽기 전용을 두 겹으로 강제한다** — DB 계정 권한(주방어) + AST 기반 문장 검증(보조). CTE 안에 숨은 DML(`WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t`) 같은 우회까지 막아야 한다. 방어 원리와 추가로 막아야 할 패턴(`pg_sleep`, `SECURITY DEFINER`, `FOR UPDATE` 등)은 [read-only-enforcement.md](../policy/read-only-enforcement.md) 참고

## 완료 조건

읽기 전용 계정으로 SELECT가 돌아간다. INSERT/UPDATE/DELETE가 **두 겹 모두에서** 차단된다. [read-only-enforcement.md](../policy/read-only-enforcement.md)의 CTE 우회 쿼리도 차단된다. 스키마 정보가 JSON으로 API에서 나온다.

## 리뷰 게이트

🔒 **이 단계 코드는 반드시 2명이 리뷰한다.** 읽기 전용 강제와 접속 정보 관리가 뚫리면 제품의 존재 이유가 사라진다.

## 관련 정책

- [read-only-enforcement.md](../policy/read-only-enforcement.md)
- [credential-management.md](../policy/credential-management.md)
- [query-safety-limits.md](../policy/query-safety-limits.md)
- [internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md)
