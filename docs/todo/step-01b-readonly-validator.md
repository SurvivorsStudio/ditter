# STEP 1B · 읽기 전용 AST 검증기

> **상위**: [STEP 1 · DB에 안전하게 접속하기](step-01-db-connection.md)
> **시작 조건**: **없음 — STEP 0만 있으면 된다**

## 목표

사용자·AI가 넣은 SQL이 읽기 전용인지 **구문 트리로** 판정하는 순수 함수를 만든다.

## ⚡ 이 문서는 DB도 백엔드도 기다리지 않는다

**입력이 문자열이고 출력이 판정인 순수 로직**이다. Fastify도 postgres.js도 import하지 않는다.
그래서 [1A](step-01a-connection-registry.md)와 **완전히 병렬**로, STEP 1 착수 첫날부터 다른 사람이
가져갈 수 있다. STEP 1이 "모든 것의 병목"인데도 사람을 하나 더 넣을 수 있는 **유일한 지점**이다.

그리고 여기서 만든 검증기는 [STEP 4](step-04-ai-query-assist.md)의 AI 생성 SQL과
[STEP 9C](step-09c-dag-spec.md)의 파이프라인 소스 `query`가 **그대로 재사용**한다. 세 곳이 각자
검사하게 두지 않는다.

## 하는 일

- `pgsql-parser` / `libpg-query`로 SQL을 파싱한다. **WASM이라 네이티브 빌드가 없어
  `npm ci --ignore-scripts`와 궁합이 좋다** ([S5](../policy/supply-chain-security.md))
- 다음을 차단한다 ([read-only-enforcement.md](../policy/read-only-enforcement.md)):
  - INSERT · UPDATE · DELETE 등 DML
  - **CTE 안에 숨은 DML** — `WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t`
  - `SELECT pg_sleep(...)` — 읽기지만 세션을 점유한다
  - `SECURITY DEFINER` 함수 호출
  - `SELECT ... FOR UPDATE` — 쓰기는 아니지만 행 잠금을 건다
- 차단 시 **사유를 구조화해서 반환**한다. `audit_logs.block_reason`에 그대로 들어간다
  ([audit-logs.md](../schema/audit-logs.md))
- **실패를 삼키지 않는다.** 파싱 자체가 실패하면 통과가 아니라 차단이다
  ([typescript-style.md](../conventions/typescript-style.md))

## 완료 조건

[testing.md](../conventions/testing.md)의 케이스가 전부 통과한다 — 일반 SELECT는 허용, 위 다섯
패턴은 전부 차단, 파싱 실패도 차단. **이 세트는 회귀 테스트로 고정한다.**

## 리뷰 게이트

🔒 **2인 리뷰 필수.** 뚫리면 제품의 존재 이유가 사라진다 ([P3](../policy/read-only-enforcement.md)).

## 관련 정책

- [read-only-enforcement.md](../policy/read-only-enforcement.md) (P3)
- [internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) (P2)
