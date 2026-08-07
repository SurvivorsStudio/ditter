# STEP 1A · 접속 등록과 커넥션 풀

> **상위**: [STEP 1 · DB에 안전하게 접속하기](step-01-db-connection.md)
> **시작 조건**: STEP 0

## 목표

프로덕션 PostgreSQL에 **실제로 붙는 능력**을 만든다. 이 문서가 끝나면 다른 코드가 "커넥션 id를
주면 쓸 수 있는 연결을 받는다"고 가정할 수 있다.

STEP 1의 세 갈래 중 **가장 먼저 끝나야 하는 것**이다. [1C](step-01c-schema-catalog.md)가 이걸
기다린다.

## 하는 일

- postgres.js 접속 풀. **커넥션 풀 상한**을 건다 ([query-safety-limits.md](../policy/query-safety-limits.md))
- 접속 설정 등록·수정·조회 API (SQLite에 저장) — **삭제는 만들지 않는다.** 감사 로그가 커넥션을
  참조하는데 그 행은 append-only라 지울 수 없다 ([audit-logs.md](../schema/audit-logs.md))
- [connections](../schema/connections.md) 테이블. **`role`·`adapter_type` 컬럼을 지금 넣는다** —
  값은 `source`·`postgres` 하나뿐이지만, 나중에 넣으면 이미 쌓인 행을 되짚어야 한다
  ([STEP 9A](step-09a-write-boundary.md)가 여기에 값을 늘린다)
- 접속 정보(비밀번호) 암호화 저장 ([credential-management.md](../policy/credential-management.md))
  — **암호화 키 관리 방침을 먼저 정한다.** [todo README](README.md)의 「팀이 먼저 결정해야 할 것」 2번
- **자격증명은 응답에 싣지 않는다.** 제외를 라우터마다 하지 말고 **직렬화 계층 한 곳에서 강제**한다.
  이 자리를 지금 만들어 두면 STEP 9의 커넥터 시크릿이 같은 곳을 그대로 쓴다
- DB 접근 코드를 **어댑터 인터페이스로 감싼다** (구현은 PostgreSQL 하나 —
  [project-structure.md](../conventions/project-structure.md))
- **첫 Fastify 라우트와 함께 요청 스키마 검증·prototype pollution 방어를 건다**
  ([backend-fastify.md](../conventions/backend-fastify.md), [S8](../policy/supply-chain-security.md))

## 완료 조건

1. 읽기 전용 계정으로 접속을 등록하고, 그 커넥션으로 연결을 얻어 쓸 수 있다.
2. 등록한 비밀번호가 **SQLite에 평문으로 없고**, 어떤 API 응답·로그·에러 메시지에도 나오지 않는다.
3. 풀 상한을 넘겨 요청하면 무한정 늘어나지 않고 대기하거나 거절된다.
4. 삭제 API가 **없다.**

## 리뷰 게이트

🔒 **자격증명 처리는 2인 리뷰 필수다** ([P4](../policy/credential-management.md)).

## 관련 정책

- [credential-management.md](../policy/credential-management.md) (P4)
- [query-safety-limits.md](../policy/query-safety-limits.md) (P5)
- [internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) (P1)
