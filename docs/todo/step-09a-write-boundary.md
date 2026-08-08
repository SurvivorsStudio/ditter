# STEP 9A · 쓰기 경계 긋기

> **상위**: [STEP 9 · 파이프라인 기반](step-09-pipeline-foundation.md)
> **시작 조건**: [STEP 1](step-01-db-connection.md) + [STEP 8](step-08-audit-log-auth.md)

## 목표

파이프라인 코드가 한 줄 생기기 **전에** 경계부터 긋는다. 이걸 나중으로 미루면 "일단 되게 만들고
나중에 막자"가 되고, 그러면 안 막힌다.

**STEP 9의 네 문서 중 이것이 가장 먼저다.** [9D](step-09d-execution-engine.md)는 이 문서가 끝난
뒤에만 시작한다 — 타깃에 실제로 쓰는 코드이기 때문이다. ([9B](step-09b-connectors.md)·
[9C](step-09c-dag-spec.md)는 타깃에 쓰지 않으므로 병렬로 가도 된다.)

## 하는 일

- `connections.role` (`source` | `target`), **겸직 불가** ([P9](../policy/pipeline-write-boundary.md) 규칙 1)
- **`connections`를 커넥터 종류 전체로 넓힌다** ([connections.md](../schema/connections.md)) —
  `config`(JSON) 컬럼 추가, `adapter_type` 값 확장(`postgres`·`s3`·`local_file`·`http_json`),
  `host`·`port`·`database_name`·`username`·`encrypted_password`의 NOT NULL 완화
- **완화한 NOT NULL을 대신하는 앱 레벨 필수값 검증**을 같이 넣는다. SQLite로는 "`postgres`일 때만
  필수"를 표현할 수 없어서 컬럼 제약이 사라진 자리다 — 이 검증이 빠지면 host 없는 PostgreSQL
  커넥션이 등록된다
- **쿼리 실행 API가 `role='target'`을 거부**하도록 **라우터 앞단 한 곳**에 차단을 넣는다. 핸들러마다
  검사하게 두면 새 엔드포인트에서 빠진다
- 접속 목록 API가 콘솔 용도로 호출될 때 **`role='source'` AND `adapter_type='postgres'`만** 응답에
  넣도록 분리 — **`role` 하나로는 부족하다** (P9 규칙 2의 표)
- 타깃 커넥션 등록·수정을 **관리자로 제한** — [users](../schema/users.md)`.is_admin`
  (STEP 8에서 만든다). 이미 `source`로 등록된 같은 host·port·database를 타깃으로 등록하면 화면에서
  한 번 더 확인받는다 (P9 규칙 6)
- 커넥터 시크릿 분리 암호화 — [P4](../policy/credential-management.md)의 기존 방식을 그대로 쓴다.
  **새 메커니즘을 만들지 않는다.** 1A가 만든 직렬화 계층에 키 목록만 추가한다

## 완료 조건

1. 콘솔의 쿼리 실행 API에 타깃 커넥션을 넣으면 **거부된다.**
2. 콘솔 접속 목록 API 응답에 타깃 커넥션도, `http_json` 소스 커넥션도 **없다.**
3. 일반 사용자로 타깃 커넥션을 등록하려 하면 **거부된다.**
4. `adapter_type='postgres'`인데 host가 빈 커넥션은 **등록되지 않는다.**
5. 커넥터 시크릿이 API 응답·로그·에러 메시지 어디에도 나오지 않는다.

**1·2·3은 회귀 테스트로 고정한다** ([testing.md](../conventions/testing.md)).

## 리뷰 게이트

🔒 **2인 리뷰 필수.** [STEP 1](step-01-db-connection.md)의 읽기 전용 강제와 **같은 등급**이다.
여기가 뚫리면 읽기 전용 콘솔이 쓰기 가능한 콘솔이 된다.

## 관련 문서

- [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) (P9) — **먼저 읽는다**
- [connections](../schema/connections.md)
- [credential-management.md](../policy/credential-management.md) (P4)
