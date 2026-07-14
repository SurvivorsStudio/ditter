# audit_logs

누가·언제·무슨 쿼리를 실행했는지 남기는 **append-only** 기록. [STEP 8](../todo/step-08-audit-log-auth.md)
`F6`과 [audit-logging.md](../policy/audit-logging.md) 정책을 구현하는 테이블이다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `user_id` | INTEGER | NOT NULL, FK → `users.id` | 쿼리를 실행한 사용자 |
| `connection_id` | INTEGER | NOT NULL, FK → `connections.id` | 대상 접속 |
| `query_text` | TEXT | NOT NULL | 실행(시도)된 쿼리 원문 |
| `query_source` | TEXT | NOT NULL, CHECK (`'user'`, `'ai_generated'`) | 사용자가 직접 입력했는지 AI가 생성했는지 ([internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md), [ai-context-and-safety.md](../policy/ai-context-and-safety.md)) |
| `risk_verdict` | TEXT | NULL 허용, CHECK (`'safe'`, `'warned'`) | [STEP 5 위험 예측](../todo/step-05-risk-prediction.md) 판정 결과. 위험 경고 후에도 사용자가 실행을 강행했다면 `'warned'`로 남는다 |
| `status` | TEXT | NOT NULL, CHECK (`'success'`, `'blocked'`, `'error'`) | `blocked`는 [읽기 전용 강제](../policy/read-only-enforcement.md)의 AST 검증 등에서 실행 자체가 막힌 경우 |
| `block_reason` | TEXT | NULL 허용 | `status = 'blocked'`일 때 사유(예: DML 시도, CTE 우회 시도, `pg_sleep` 등) |
| `row_count` | INTEGER | NULL 허용 | 반환된 행 수 (`status = 'success'`일 때) |
| `duration_ms` | INTEGER | NULL 허용 | 실행 시간 |
| `executed_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | 실행(시도) 시각 |

## 관계

- `user_id` → [users](users.md)`.id`
- `connection_id` → [connections](connections.md)`.id`

## append-only 원칙 — 반드시 지킨다

- **앱에는 이 테이블에 대한 UPDATE/DELETE API를 만들지 않는다.** INSERT만 허용한다. 지울 수 있으면 감사 로그가 아니다 ([audit-logging.md](../policy/audit-logging.md)).
- 스키마 마이그레이션 등 운영상 불가피한 경우를 제외하면, 애플리케이션 코드 경로에서 이 테이블에 접근하는 방법은 INSERT뿐이어야 한다.

## 비고

- `query_source`·`risk_verdict`는 STEP 4~6(AI 보조·위험 예측·튜닝)이 완성되기 전까지는 항상 기본값(`'user'`, `NULL`)일 수 있다 — 해당 STEP이 끝나야 실제로 채워진다.
