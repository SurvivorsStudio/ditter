# audit_logs

누가·언제·무슨 쿼리를 실행했는지 남기는 **append-only** 기록. [STEP 8](../todo/step-08-audit-log-auth.md)
`F6`과 [audit-logging.md](../policy/audit-logging.md) 정책을 구현하는 테이블이다.

**파이프라인(F7)의 소스 읽기·타깃 쓰기도 이 테이블에 남는다.** 콘솔에서 실행하지 않았다는 이유로
빠지면 감사 로그의 완결성이 깨진다 ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md)
규칙 7). 아래 컬럼 표의 `pipeline_*` · `write_*` 컬럼이 그 요구를 담는 자리다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `user_id` | INTEGER | NOT NULL, FK → `users.id` | 쿼리를 실행한 사용자. **파이프라인 실행도 반드시 사람을 가리킨다** — 수동 실행이면 실행한 사람, 스케줄 실행이면 파이프라인을 `active`로 만든 사람 ([pipeline_runs](pipeline-runs.md)`.triggered_by`와 같은 규칙) |
| `connection_id` | INTEGER | NOT NULL, FK → `connections.id` | 대상 접속. S3·로컬 파일 타깃도 [connections](connections.md)에 등록되므로 여기서 빠지는 파이프라인 쓰기는 없다 |
| `query_text` | TEXT | NOT NULL | 실행(시도)된 쿼리 원문. 파이프라인 타깃 쓰기 중 SQL이 아닌 것(S3·로컬 파일)은 커넥터가 수행한 동작을 같은 자리에 한 줄로 남긴다(예: `PUT s3://bucket/exports/orders/run_id=1042/`) |
| `query_source` | TEXT | NOT NULL, CHECK (`'user'`, `'ai_generated'`, `'pipeline'`) | 사용자가 직접 입력했는지, AI가 생성했는지, **파이프라인이 생성했는지** ([internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md), [ai-context-and-safety.md](../policy/ai-context-and-safety.md)). `'pipeline'`은 사람도 AI도 문장을 넣지 않은 경로라는 뜻이다 ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 3) |
| `risk_verdict` | TEXT | NULL 허용, CHECK (`'safe'`, `'warned'`) | [STEP 5 위험 예측](../todo/step-05-risk-prediction.md) 판정 결과. 위험 경고 후에도 사용자가 실행을 강행했다면 `'warned'`로 남는다 |
| `status` | TEXT | NOT NULL, CHECK (`'success'`, `'blocked'`, `'error'`) | `blocked`는 [읽기 전용 강제](../policy/read-only-enforcement.md)의 AST 검증 등에서 실행 자체가 막힌 경우 |
| `block_reason` | TEXT | NULL 허용 | `status = 'blocked'`일 때 사유(예: DML 시도, CTE 우회 시도, `pg_sleep` 등) |
| `row_count` | INTEGER | NULL 허용 | 읽은 행 수. **파이프라인 타깃 쓰기 기록에서는 쓰인 행 수**를 담는다 (`status = 'success'`일 때) |
| `duration_ms` | INTEGER | NULL 허용 | 실행 시간 |
| `pipeline_id` | INTEGER | NULL 허용, FK → `pipelines.id` | 파이프라인 실행으로 발생한 기록일 때 채운다. 콘솔 실행이면 NULL |
| `pipeline_version` | INTEGER | NULL 허용 | **실행 시점의 정의 버전.** 정의는 그 뒤 바뀔 수 있으므로 `pipeline_id`만으로는 "그때 그 실행이 무엇이었나"에 답할 수 없다 ([pipelines](pipelines.md)`.version`) |
| `pipeline_trigger` | TEXT | NULL 허용, CHECK (`'schedule'`, `'manual'`, `'retry'`) | 무엇이 그 실행을 시작시켰나. `user_id`가 "누가"라면 이 컬럼이 "어떻게"다 ([pipeline_runs](pipeline-runs.md)`.trigger`와 같은 값 집합) |
| `write_target` | TEXT | NULL 허용 | 쓰기 대상 — DB 타깃은 `스키마.테이블`, S3·파일 타깃은 경로/prefix. 읽기 기록이면 NULL |
| `write_mode` | TEXT | NULL 허용, CHECK (`'append'`, `'upsert'`, `'overwrite'`) | 적재 모드. **`overwrite`는 파괴적이므로 사후 추적의 핵심 값이다.** 타깃에 나갈 수 있는 문장이 이 셋뿐이라는 것이 P9 규칙 3이다 |
| `executed_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | 실행(시도) 시각 |

## 관계

- `user_id` → [users](users.md)`.id`
- `connection_id` → [connections](connections.md)`.id`
- `pipeline_id` → [pipelines](pipelines.md)`.id`

## 파이프라인 실행이 남기는 것

[P9 규칙 7](../policy/pipeline-write-boundary.md)의 요구를 이 테이블의 컬럼으로 옮긴 것이다.

| 남기는 것 | 컬럼 |
|---|---|
| 누가 트리거했나 | `user_id` |
| 수동인가 스케줄인가 | `pipeline_trigger` |
| 어느 타깃 커넥션에 | `connection_id` |
| 어느 테이블·경로에 | `write_target` |
| 어떤 모드로 | `write_mode` |
| 몇 행이 쓰였나 | `row_count` |
| 어느 파이프라인의 어느 버전 | `pipeline_id` · `pipeline_version` |

- **소스 읽기는 실행(run) 단위로 한 건**만 남긴다. 배치마다 남기면 감사 로그가 파이프라인 로그에
  파묻힌다 ([audit-logging.md](../policy/audit-logging.md)).
- **타깃 쓰기는 타깃마다 한 건** 남긴다. 쓰기는 콘솔에서 불가능한 동작이므로 읽기보다 자세히 남긴다.
- 실행 상세 로그([pipeline_run_logs](pipeline-run-logs.md))는 **감사 로그가 아니다.** 그쪽은 오래된
  것을 지우고, 이 테이블은 지우지 않는다.

## append-only 원칙 — 반드시 지킨다

- **앱에는 이 테이블에 대한 UPDATE/DELETE API를 만들지 않는다.** INSERT만 허용한다. 지울 수 있으면 감사 로그가 아니다 ([audit-logging.md](../policy/audit-logging.md)).
- 스키마 마이그레이션 등 운영상 불가피한 경우를 제외하면, 애플리케이션 코드 경로에서 이 테이블에 접근하는 방법은 INSERT뿐이어야 한다.

## 비고

- `query_source`·`risk_verdict`는 STEP 4~6(AI 보조·위험 예측·튜닝)이 완성되기 전까지는 항상 기본값(`'user'`, `NULL`)일 수 있다 — 해당 STEP이 끝나야 실제로 채워진다.
- `pipeline_*`·`write_*` 컬럼은 [STEP 9](../todo/step-09-pipeline-foundation.md)에서 채워지기 시작한다. 그전까지는 항상 NULL이다.
- **`risk_verdict`는 파이프라인 타깃 쓰기 기록에서 항상 NULL이다.** 위험 판정은 사람이 넣은 쿼리를 대상으로 하는 것이고, 타깃에 나가는 문장은 커넥터가 만든 세 가지뿐이라 판정 대상이 아니다. 소스 읽기 기록에는 콘솔과 동일하게 채운다.
