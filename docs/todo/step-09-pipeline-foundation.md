# STEP 9 · 파이프라인 기반

**시작 조건**: STEP 1 + STEP 8

STEP 1의 DB 어댑터·커넥션 관리를 물려받고, STEP 8의 인증·감사 로그가 서 있어야 한다. **쓰기가
생기는 첫 STEP이므로 인증 없이 진행하지 않는다.**

## 목표

**화면 없이** 파이프라인 한 개를 정의하고 실행할 수 있게 만든다. 커넥터 계약, DAG 스펙, 실행
엔진, 워커까지 — 캔버스는 [STEP 10](step-10-pipeline-canvas.md)에서 얹는다.

STEP 1이 "DB를 안전하게 읽는 능력"이었다면, 이 STEP은 **"그 읽기를 반복 가능하게 만드는
능력"**이다. 그리고 STEP 1과 마찬가지로 **뒤따르는 모든 것의 병목**이다.

## 하는 일

### 쓰기 경계부터 긋는다 (다른 것보다 먼저)

- `connections`에 `role` 컬럼 추가 (`source` | `target`), 겸직 불가
- **`connections`를 커넥터 종류 전체로 넓힌다** ([connections.md](../schema/connections.md)) —
  `config`(JSON) 컬럼 추가, `adapter_type` 값 확장(`postgres`·`s3`·`local_file`·`http_json`),
  `host`·`port`·`database_name`·`username`·`encrypted_password`의 NOT NULL 완화
- **완화한 NOT NULL을 대신하는 앱 레벨 필수값 검증**을 같이 넣는다. SQLite로는 "`postgres`일 때만
  필수"를 표현할 수 없어서 컬럼 제약이 사라진 자리다 — 이 검증이 빠지면 host 없는 PostgreSQL
  커넥션이 등록된다
- **쿼리 실행 API가 `role='target'`을 거부**하도록 라우터 앞단에 차단 추가
- 접속 목록 API가 콘솔 용도로 호출될 때 **`role='source'` + `adapter_type='postgres'`만** 응답에
  넣도록 분리 (P9 규칙 2의 표 참고 — `role` 하나로는 부족하다)
- 타깃 커넥션 등록·수정을 관리자로 제한
- 근거와 전체 규칙: [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) (P9)

이걸 나중으로 미루면 "일단 되게 만들고 나중에 막자"가 되고, 그러면 안 막힌다.

### 커넥터

- `packages/pipeline-connectors` 패키지 + `Connector` 인터페이스
  ([connector-contract.md](../pipeline/connector-contract.md))
- 레지스트리 + **동적 `import()` 지연 로딩**
- 커넥터 4종: `postgres`(소스·타깃) · `s3` · `local_file` · `http_json`
- **소스 커넥터는 STEP 1의 DB 어댑터를 경유한다.** 자체 접속을 열지 않는다
- 시크릿 키 분리 암호화 — 기존 [P4](../policy/credential-management.md) 방식 재사용

### DAG 스펙과 저장

- `packages/shared-types`에 zod DAG 스키마 **한 벌** ([dag-and-nodes.md](../pipeline/dag-and-nodes.md))
- `pipelines` · `pipeline_runs` 테이블 ([schema](../schema/README.md))
- 저장 시 검증 + **실행 직전 재검증**

### 실행 엔진과 워커

- Redis + BullMQ 배선. **백엔드는 워커 코드를 import 하지 않는다** — 잡 이름과 페이로드만 넣는다
- 타깃 주도 pull 스트리밍 엔진 ([execution-engine.md](../pipeline/execution-engine.md))
- 노드 구현: extract · transform(filter/map) · load
- `overwrite` 규칙 — DB는 첫 배치만 truncate, S3·파일은 `run_id=` prefix 선정리
- **같은 파이프라인 동시 실행 잠금** (Redis) — 수동·스케줄·재시도 **모든 경로**가 통과
- 파이프라인 실행의 소스 읽기·타깃 쓰기를 **감사 로그에 기록** — `audit_logs`의 `pipeline_*` ·
  `write_*` 컬럼을 채운다 ([audit-logs.md](../schema/audit-logs.md))

## 완료 조건

CLI나 API 호출만으로 다음이 된다.

1. `role='source'` 커넥션에서 테이블 하나를 읽어 `role='target'` 커넥션에 `upsert`로 적재한다.
2. 같은 실행을 두 번 돌려도 타깃 결과가 같다 (멱등).
3. 같은 파이프라인을 동시에 두 번 트리거하면 **두 번째가 거절된다.**
4. 콘솔의 쿼리 실행 API에 타깃 커넥션을 넣으면 **거부된다.**
5. 소스 `query`에 `WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t`를 넣으면
   **저장 단계에서 거부된다.**
6. 실행 결과가 `pipeline_runs`에 남고, 소스 읽기·타깃 쓰기가 감사 로그에 남는다.

## 리뷰 게이트

🔒 **쓰기 경계(P9) 구현은 2인 리뷰 필수다.** [STEP 1](step-01-db-connection.md)의 읽기 전용
강제·자격증명 처리와 같은 등급으로 취급한다. 여기가 뚫리면 읽기 전용 콘솔이 쓰기 가능한 콘솔이
된다.

위 완료 조건 3·4·5는 **회귀 테스트로 고정한다** ([testing.md](../conventions/testing.md)).

## 관련 문서

- [docs/pipeline](../pipeline/README.md) — 기능 전체 설계
- [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) (P9)
- [read-only-enforcement.md](../policy/read-only-enforcement.md) (P3)
- [credential-management.md](../policy/credential-management.md) (P4)
