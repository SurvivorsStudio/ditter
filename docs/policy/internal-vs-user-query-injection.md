# 내부 쿼리 vs 사용자 쿼리 (P1, P2)

이 둘을 헷갈리면 안 된다.

## P1 — 내부 쿼리 인젝션 방어

DITTER 자체가 짜는 카탈로그 조회 쿼리(`information_schema`, `pg_catalog` 조회 등)에 대한 정책이다.

- 파라미터 바인딩을 강제한다.
- 문자열 연결로 쿼리를 조립하는 것을 금지한다.

이건 일반적인 SQL 인젝션 방어와 동일하다.

## P2 — 사용자 쿼리 방어

DITTER는 사용자가 임의의 SQL을 **직접 타이핑하는** 콘솔이다. "파라미터 바인딩으로 인젝션을 막는다"는 말은 **DITTER가 내부적으로 짜는 쿼리에만** 해당하며, 사용자가 친 SQL에는 적용할 수 없다 — 바인딩이 적용될 여지가 없다.

사용자 쿼리의 통제는 다음 세 가지가 담당한다.

1. DB 계정 읽기 전용 권한 ([read-only-enforcement.md](read-only-enforcement.md))
2. AST 기반 검증 ([read-only-enforcement.md](read-only-enforcement.md))
3. `statement_timeout` 등 부하 제한 ([query-safety-limits.md](query-safety-limits.md))

## 왜 구분이 중요한가

"우리는 파라미터 바인딩을 쓰니까 인젝션에 안전하다"는 설명은 P1에만 해당하는 반쪽 진실이다. 콘솔 제품의 핵심 위협은 사용자가 직접 입력하는 임의 SQL(P2)이며, 이건 바인딩으로 막을 수 있는 종류의 문제가 아니다. 문서·발표에서 이 둘을 섞어 설명하지 않는다.

## 관련

- 담당 STEP: [step-01-db-connection.md](../todo/step-01-db-connection.md), [step-04-ai-query-assist.md](../todo/step-04-ai-query-assist.md), [step-06-explain-tuning.md](../todo/step-06-explain-tuning.md)
