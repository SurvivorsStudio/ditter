# 테스트 컨벤션

## 회귀 테스트 세트 (위험 판정)

[STEP 5 실행 전 위험 예측](../todo/step-05-risk-prediction.md)의 위험/안전 판정 규칙은 대표 쿼리를 고정한 회귀 테스트 세트로 검증한다.

- 판정 결과는 매번 동일하게 재현되어야 한다.
- 오탐(안전한데 위험하다고 판정)·미탐(위험한데 안전하다고 판정)은 합의된 허용선 안에 들어야 한다.
- 규칙을 추가/수정할 때마다 이 세트 전체를 돌린다. 규칙을 넓게 벌리면 오탐이 늘어 신뢰를 잃으므로, 소수의 명확한 규칙으로 좁게 시작한다.

## 읽기 전용 강제 테스트

[read-only-enforcement.md](../policy/read-only-enforcement.md)의 AST 검증기는 다음을 반드시 테스트 케이스로 포함한다.

- 일반 SELECT: 허용
- INSERT/UPDATE/DELETE: 두 겹(DB 권한 + AST) 모두에서 차단
- CTE 안에 숨은 DML (`WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t`): 차단
- `SELECT pg_sleep(...)`, `SECURITY DEFINER` 함수 호출, `SELECT ... FOR UPDATE`: 차단
- **파서가 파싱에 실패하거나 지원하지 않는 구문을 만나면 차단** (fail-closed) — "판단 불가"를
  "안전"으로 취급하지 않는다
- **[STEP 2A](../todo/step-02a-federated-query-engine.md)에서 MySQL 방언이 추가되면, 위 각 패턴의
  MySQL 대응판을 같은 세트에 추가한다** — CTE 안에 숨은 DML, 다중 문장(stacked queries), 방언별
  부작용 함수 호출 등. `sqlglot` 버전을 올릴 때마다 PostgreSQL·MySQL 세트 전체를 돌린다
  ([read-only-enforcement.md](../policy/read-only-enforcement.md#️-sqlglot은-각-db의-공식-파서가-아니라-방언별로-재구현한-근사치다))

## mock 기반 병렬 개발

[STEP 3 AI 컨텍스트 빌더](../todo/step-03-ai-context-builder.md)는 순수 서비스로 분리되어 있으므로, 실제 DB 연결 없이 가짜(mock) 스키마·EXPLAIN JSON으로 유닛 테스트/프롬프트 실험을 진행한다. 백엔드 완성을 기다리지 않는다.

## AI 출력 검증 테스트

[ai-context-and-safety.md](../policy/ai-context-and-safety.md)의 원칙에 따라, AI 응답 검증 로직은 다음을 테스트한다.

- 정상 구조화 출력: 통과
- 스키마에 없는 테이블/컬럼을 참조하는 SQL: 차단, 원본 쿼리 반환
- 포맷이 깨진 응답: 차단, 원본 쿼리 반환

## 시드 데이터 재현성

[STEP 5](../todo/step-05-risk-prediction.md)의 데모용 시드 데이터는 매번 같은 실행 계획, 같은 지연이 나오도록 생성 스크립트 + 사전 ANALYZE + 시드 고정을 갖춘다. 이 재현성 자체가 테스트 대상이다 — 시드를 다시 만들었을 때 회귀 테스트 세트의 판정 결과가 바뀌면 안 된다.

## 관련

- 담당 STEP: [step-05-risk-prediction.md](../todo/step-05-risk-prediction.md)
