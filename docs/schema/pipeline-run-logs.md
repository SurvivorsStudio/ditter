# pipeline_run_logs

파이프라인 실행 중 발생한 노드별 로그. 화면에서 "왜 실패했나"를 보기 위한 것이다.

**테이블을 만들고 쓰기 시작하는 것은 [STEP 9](../todo/step-09-pipeline-foundation.md)다** — 워커가
거기서 이미 돌기 때문이다. [STEP 10](../todo/step-10-pipeline-canvas.md)에서 실행 화면이 이걸
읽는다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `run_id` | INTEGER | NOT NULL, FK → `pipeline_runs.id` | |
| `node_id` | TEXT | NULL 허용 | DAG 정의 안의 노드 ID. 실행 전체에 대한 로그면 NULL |
| `level` | TEXT | NOT NULL, CHECK `IN ('debug','info','warn','error')` | |
| `message` | TEXT | NOT NULL | |
| `logged_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | |

## 인덱스

- `(run_id, logged_at)` — 화면이 항상 이 순서로 읽는다.

## 관계

- `run_id` → [pipeline_runs](pipeline-runs.md)`.id`

## 비고

- **이 테이블은 감사 로그가 아니다.** 용도가 다르고([audit_logs](audit-logs.md)는 신뢰의 근거,
  이건 디버깅 수단), 보존 정책도 다르다. append-only·삭제 불가 원칙을 대신하지 못한다
  ([audit-logging.md](../policy/audit-logging.md)).
- 감사 로그와 달리 **오래된 것은 지운다.** 실행마다 수천 줄이 쌓이면 SQLite가 커지고, 정작 필요한
  감사 로그 조회가 느려진다. 보존 기간을 정하고 넘긴 것은 run 단위로 삭제한다.
- **행 단위 데이터를 로그에 남기지 않는다.** 프로덕션 데이터가 로그 파일로 새는 가장 흔한 경로다.
  샘플 행이 필요하면 화면의 엣지 미리보기로 보여주고 저장하지 않는다.
- 자격증명·커넥터 config 원문을 남기지 않는다 ([credential-management.md](../policy/credential-management.md)).
- 로그 쓰기가 실행을 막지 않게 한다. 배치마다 동기 INSERT를 하면 SQLite 잠금 경합이 난다 —
  버퍼링해서 묶어 쓴다.
