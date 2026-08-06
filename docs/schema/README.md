# DITTER 스키마

DITTER 앱 자체가 로컬 **SQLite**에 저장하는 테이블 문서다. **DITTER가 조회 대상으로 삼는
프로덕션 PostgreSQL의 스키마가 아니다** — 그건 사용자마다 다르며, [connections](connections.md)
설정으로 매번 연결해 [스키마 API](../todo/step-01-db-connection.md)로 읽어온다.

## 테이블 목록

### 콘솔 (F1~F6)

| 테이블 | 설명 | 담당 STEP |
|---|---|---|
| [users](users.md) | DITTER 로그인 계정 | [STEP 8](../todo/step-08-audit-log-auth.md) |
| [connections](connections.md) | 등록된 PostgreSQL 접속 설정(자격증명 포함). `role`로 소스/타깃을 나눈다 | [STEP 1](../todo/step-01-db-connection.md) |
| [connection_grants](connection-grants.md) | 사용자별 접속 대상 권한 분리 | [STEP 8](../todo/step-08-audit-log-auth.md) |
| [audit_logs](audit-logs.md) | 실행된 모든 쿼리의 append-only 기록 | [STEP 8](../todo/step-08-audit-log-auth.md) |

### 파이프라인 (F7)

| 테이블 | 설명 | 담당 STEP |
|---|---|---|
| [pipelines](pipelines.md) | 캔버스에서 구성한 DAG 정의 + 스케줄 | [STEP 9](../todo/step-09-pipeline-foundation.md) |
| [pipeline_runs](pipeline-runs.md) | 실행 한 번의 상태·진행·결과 | [STEP 9](../todo/step-09-pipeline-foundation.md) |
| [pipeline_run_logs](pipeline-run-logs.md) | 실행 중 노드별 로그 (감사 로그가 **아니다**) | [STEP 10](../todo/step-10-pipeline-canvas.md) |
| [pipeline_checkpoints](pipeline-checkpoints.md) | 증분 적재 워터마크 | [STEP 11](../todo/step-11-pipeline-operations.md) |

## 관계 (ERD 개요)

```
users ──1:N── connections               (created_by)
users ──N:M── connections               (connection_grants 경유)
users ──1:N── audit_logs                (user_id)
connections ──1:N── audit_logs          (connection_id)

users ──1:N── pipelines                 (created_by)
users ──1:N── pipeline_runs             (triggered_by)
pipelines ──1:N── pipeline_runs         (pipeline_id)
pipelines ──1:N── pipeline_checkpoints  (pipeline_id, node_id UNIQUE)
pipeline_runs ──1:N── pipeline_run_logs (run_id)

pipelines.definition(JSON) ─참조─▶ connections.id   ← FK 아님. 삭제 시 확인 필요
```

## 원칙

- append-only·자격증명 암호화 등 데이터 취급 원칙은 [docs/policy](../policy/README.md)를 따른다 — [audit_logs](audit-logs.md)와 [connections](connections.md)가 이 원칙이 실제로 적용되는 테이블이다.
- 이 스키마에 대한 앱의 내부 조회 쿼리는 파라미터 바인딩을 강제한다 ([internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) P1).
- 로컬 SQLite 파일 자체는 저장소에 커밋하지 않는다 ([.gitignore](../../.gitignore)).
- **파이프라인 테이블은 백엔드와 워커가 같은 SQLite 파일을 공유한다.** WAL 모드 + `busy_timeout`을 켜고, 상태 갱신은 짧은 트랜잭션으로 쪼갠다. 이 제약과 탈출 조건은 [pipeline/README.md](../pipeline/README.md#️-메타-저장을-sqlite로-두는-것의-한계)에 정리돼 있다.
- **실행 로그(`pipeline_run_logs`)와 감사 로그(`audit_logs`)를 섞지 않는다.** 전자는 디버깅용이고 오래된 것을 지운다. 후자는 신뢰의 근거이고 지울 수 없다.

## 관련 문서

- [docs/todo](../todo/README.md) — 이 테이블들이 어느 STEP에서 만들어지는지
- [docs/policy](../policy/README.md) — 자격증명·감사 로그·인증 정책
- [docs/pipeline](../pipeline/README.md) — 파이프라인 테이블들이 무엇을 지탱하는지
- [docs/conventions](../conventions/README.md) — 프로젝트 구조·컨벤션
