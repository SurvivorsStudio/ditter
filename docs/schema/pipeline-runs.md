# pipeline_runs

파이프라인 실행 한 번의 기록. [STEP 9](../todo/step-09-pipeline-foundation.md)에서 만들고,
[STEP 11](../todo/step-11-pipeline-operations.md)에서 재시작·모니터가 이 테이블을 쓴다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | 실행 식별자. S3·파일 타깃의 `run_id=` prefix에 그대로 쓰인다 |
| `pipeline_id` | INTEGER | NOT NULL, FK → `pipelines.id` | |
| `pipeline_version` | INTEGER | NOT NULL | **실행 시점의 정의 버전을 복사해 둔다.** 이게 없으면 "그때 그 실행이 지금 정의와 같은 것이었나"에 답할 수 없다 |
| `status` | TEXT | NOT NULL, CHECK `IN ('pending','running','success','failed','cancelled')` | |
| `trigger` | TEXT | NOT NULL, CHECK `IN ('schedule','manual','retry')` | 무엇이 이 실행을 시작시켰나 |
| `triggered_by` | INTEGER | NOT NULL, FK → `users.id` | `trigger` 값마다 출처가 정해져 있다 — `manual`은 실행한 사람, `schedule`은 [pipelines](pipelines.md)`.activated_by`를 복사, `retry`는 재시작을 누른 사람(**워커가 자동으로 재개한 경우에는 원래 run의 `triggered_by`를 그대로 승계**). **세 경로 모두 반드시 사람을 가리킨다** — [audit_logs](audit-logs.md)`.user_id`가 NOT NULL이라 여기가 비면 그 실행은 감사 로그를 남길 수 없다 |
| `full_refresh` | INTEGER (0/1) | NOT NULL, DEFAULT 0 | 1이면 워터마크를 무시하고 전량 읽는다 |
| `node_states` | TEXT (JSON) | NOT NULL, DEFAULT `'{}'` | 노드별 상태·처리 행수·에러. 부분 성공한 실행이 어디까지 갔는지 여기서 본다 |
| `records_read` | INTEGER | NOT NULL, DEFAULT 0 | |
| `records_written` | INTEGER | NOT NULL, DEFAULT 0 | |
| `error` | TEXT | NULL 허용 | 실패 요약. **자격증명이나 config 원문을 담지 않는다** ([credential-management.md](../policy/credential-management.md)) |
| `job_id` | TEXT | NULL 허용 | 큐(Celery) 태스크 ID. 취소·상태 조회에 쓴다 |
| `started_at` | TEXT (ISO8601) | NULL 허용 | 큐에서 꺼내진 시각. `pending` 동안은 NULL |
| `finished_at` | TEXT (ISO8601) | NULL 허용 | |
| `created_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | enqueue 시각 |

## 관계

- `pipeline_id` → [pipelines](pipelines.md)`.id`
- `triggered_by` → [users](users.md)`.id`
- `pipeline_run_logs.run_id` → `pipeline_runs.id`

## 비고

- **진행률은 이 테이블에 매번 쓰지 않는다.** 초당 여러 번 바뀌는 값은 Redis에 두고 WebSocket으로
  화면에 push하며, 여기에는 **노드 상태가 바뀔 때만** 기록한다. SQLite 잠금 경합을 피하기 위한
  조건이다 ([pipeline/README.md](../pipeline/README.md#️-메타-저장을-sqlite로-두는-것의-한계)).
- 이 테이블은 **감사 로그가 아니다.** 실행이 프로덕션 DB에 날린 쿼리와 타깃 쓰기는 별도로
  [audit_logs](audit-logs.md)에 남는다 ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 7).
- 같은 파이프라인의 실행은 **겹치지 않는다.** Redis 잠금으로 막으며, 잠겨 있으면 큐에 넣지 않고
  즉시 거절한다 — `pending` 상태로 쌓아두지 않는다 ([execution-engine.md](../pipeline/execution-engine.md)).
- 재시작은 이 레코드가 아니라 [pipeline_checkpoints](pipeline-checkpoints.md)의 워터마크를 기준으로
  한다. `trigger='retry'`인 새 run이 만들어진다.
- **`triggered_by`가 가리키는 계정은 지우지 않는다.** 이 값이 비면 그 실행의 감사 로그를 쓸 수
  없다(`audit_logs.user_id`는 NOT NULL). **MVP에는 계정 삭제 기능이 없으므로** 이 규칙은 지금
  비용이 들지 않는다 ([users](users.md)).
- 스케줄 실행의 책임자를 바꾸려면 파이프라인을 `paused`로 내렸다가 다른 사람이 다시 `active`로
  올린다 — 그러면 [pipelines](pipelines.md)`.activated_by`가 갱신되고 이후 실행부터 반영된다.
  **이미 남은 실행 기록은 바뀌지 않는다**(그때의 책임자가 맞다).
