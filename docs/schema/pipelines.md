# pipelines

캔버스에서 구성한 파이프라인 정의. [STEP 9 파이프라인 기반](../todo/step-09-pipeline-foundation.md)에서
만든다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `name` | TEXT | NOT NULL, UNIQUE | 화면에 노출되는 파이프라인 이름 |
| `definition` | TEXT (JSON) | NOT NULL | DAG 정의 — `{ nodes, edges }`. 스키마는 `packages/shared-types`의 zod 정의 하나뿐이다 ([dag-and-nodes.md](../pipeline/dag-and-nodes.md)) |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | `definition`이 바뀔 때마다 올린다. 실행 레코드가 이 값을 복사해 간다 |
| `status` | TEXT | NOT NULL, DEFAULT `'draft'`, CHECK `IN ('draft','active','paused')` | `active`만 스케줄 실행 대상이다 |
| `schedule` | TEXT | NULL 허용 | cron 식. NULL이면 수동 실행 전용 |
| `timezone` | TEXT | NOT NULL, DEFAULT `'UTC'` | cron 해석 기준 시간대. **적지 않으면 서머타임에 실행이 밀리거나 겹친다** |
| `activated_by` | INTEGER | NULL 허용, FK → `users.id`, CHECK `status <> 'active' OR activated_by IS NOT NULL` | **`status`를 `'active'`로 올린 사람.** 스케줄 실행의 책임자가 이 사람이며, 그 실행의 [pipeline_runs](pipeline-runs.md)`.triggered_by`와 [audit_logs](audit-logs.md)`.user_id`에 그대로 들어간다. `draft`·`paused`에서만 NULL일 수 있다 — **CHECK로 강제한다**(문장으로만 두면 `active`인데 비어 있는 행이 만들어지고, 그 실패는 cron이 처음 도는 새벽에 드러난다) |
| `activated_at` | TEXT (ISO8601) | NULL 허용, CHECK `status <> 'active' OR activated_at IS NOT NULL` | 마지막으로 `active`가 된 시각 |
| `created_by` | INTEGER | NOT NULL, FK → `users.id` | 처음 만든 사람. **`activated_by`와 다를 수 있다** — 만든 사람과 켠 사람을 구분하기 위해 컬럼을 나눴다 |
| `created_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | |
| `updated_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | |

## 관계

- `created_by` → [users](users.md)`.id`
- `pipeline_runs.pipeline_id` → `pipelines.id`
- `pipeline_checkpoints.pipeline_id` → `pipelines.id`
- `definition` 안의 소스·타깃 노드가 [connections](connections.md)`.id`를 참조한다 (JSON 내부 참조이므로 FK로 강제되지 않는다 — 아래 비고)

## 비고

- **`definition` 안의 커넥션 참조는 FK가 아니다.** 그래서 참조가 가리키는 커넥션이 사라지면 정의는
  조용히 깨진 채 남는다. **MVP에는 커넥션 삭제 기능이 없으므로**([audit-logs.md](audit-logs.md)의
  append-only 절) 이 상황은 생기지 않는다 — 쓰지 않게 된 커넥션은 정의에서 **교체**한다. 커넥션
  교체 시 그 커넥션을 쓰는 파이프라인 목록을 보여준다.
- **파이프라인도 삭제하지 않는다.** [audit_logs](audit-logs.md)`.pipeline_id`가 이 테이블을
  참조하는데 그 행은 append-only라 지우거나 비울 수 없다. 그만 돌리려면 `status='paused'`로
  내린다.
- 저장 시점에 DAG를 검증한다. **검증 규칙의 유일한 목록은
  [dag-and-nodes.md](../pipeline/dag-and-nodes.md)의 표다** — 여기에 다시 열거하지 않는다(목록이 두
  벌이 되면 한쪽이 낡는다). **실행 직전에 같은 검증을 다시 한다** — 저장 이후 커넥션의 역할이나
  종류가 바뀌었을 수 있다.
- `definition`은 앱의 내부 조회 대상이므로 파라미터 바인딩을 강제한다
  ([internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) P1).
- 스케줄을 바꾸면 큐에 등록된 반복 잡을 **제거한 뒤 다시 등록한다.** 안 하면 옛 스케줄이 남아
  같은 파이프라인이 두 스케줄로 돈다 ([deployment.md](../pipeline/deployment.md)).
