# DITTER 스키마

DITTER 앱 자체가 로컬 **SQLite**에 저장하는 테이블 문서다. **DITTER가 조회 대상으로 삼는
프로덕션 PostgreSQL의 스키마가 아니다** — 그건 사용자마다 다르며, [connections](connections.md)
설정으로 매번 연결해 [스키마 API](../todo/step-01-db-connection.md)로 읽어온다.

## 테이블 목록

### 콘솔 (F1~F6)

| 테이블 | 설명 | 담당 STEP |
|---|---|---|
| [users](users.md) | DITTER 로그인 계정. `is_admin`이 타깃 커넥션 등록·워터마크 되돌리기·권한 부여를 가른다 | [STEP 8](../todo/step-08-audit-log-auth.md) |
| [connections](connections.md) | 등록된 접속 설정(자격증명 포함). `role`로 소스/타깃을, `adapter_type`으로 커넥터 종류를 나눈다 | [STEP 1](../todo/step-01-db-connection.md) ~ [9](../todo/step-09-pipeline-foundation.md) |
| [connection_grants](connection-grants.md) | 사용자별 접속 대상 권한 분리 | [STEP 8](../todo/step-08-audit-log-auth.md) |
| [audit_logs](audit-logs.md) | 실행된 모든 쿼리의 append-only 기록. **파이프라인 소스 읽기·타깃 쓰기도 여기에 남는다** | [STEP 8](../todo/step-08-audit-log-auth.md) ~ [11](../todo/step-11-pipeline-operations.md) (컬럼은 8·9, `preview`는 10, `watermark_reset`은 11에서 채워지기 시작) |

### 파이프라인 (F7)

| 테이블 | 설명 | 담당 STEP |
|---|---|---|
| [pipelines](pipelines.md) | 캔버스에서 구성한 DAG 정의 + 스케줄 | [STEP 9](../todo/step-09-pipeline-foundation.md) |
| [pipeline_runs](pipeline-runs.md) | 실행 한 번의 상태·진행·결과 | [STEP 9](../todo/step-09-pipeline-foundation.md) |
| [pipeline_run_logs](pipeline-run-logs.md) | 실행 중 노드별 로그 (감사 로그가 **아니다**) | [STEP 9](../todo/step-09-pipeline-foundation.md)에서 만들고 쓰기 시작, [STEP 10](../todo/step-10-pipeline-canvas.md)에서 화면이 읽는다 |
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
pipelines ──1:N── audit_logs            (pipeline_id, 파이프라인 실행 기록만)

pipelines.definition(JSON) ─참조─▶ connections.id   ← FK 아님. 교체만 가능(삭제 기능 없음)
```

> **MVP에는 사용자·커넥션·파이프라인 삭제 기능이 없다.** `audit_logs`가 셋 다 참조하는데 그 행은
> append-only라 CASCADE도 SET NULL도 걸 수 없기 때문이다 ([audit_logs](audit-logs.md)). 정리가
> 필요하면 파이프라인은 `paused`로 내리고, 커넥션은 정의에서 교체한다.

## 이 테이블들은 어떻게 만들어지는가

**백엔드가 기동할 때 마이그레이션을 적용한다.** [backend/migrations/](../../backend/migrations/README.md)의
`NNN_설명.sql` 파일을 번호 순서대로 한 번씩 돌리고, 적용 기록을 같은 DB의 `schema_migrations`
테이블에 남긴다 ([backend/src/db/migrate.ts](../../backend/src/db/migrate.ts)).

- **외부 마이그레이션 도구를 쓰지 않는다.** Node 내장 `node:sqlite`로 직접 돌린다. 백엔드를 빌드
  없이 실행하는 것과 같은 판단이며([supply-chain-security.md](../policy/supply-chain-security.md)),
  드라이버가 반환하는 행이 null-prototype이라 `__proto__` 오염 경로가 하나 줄어드는 것도 이 선택에
  맞는다.
- **이미 커밋된 마이그레이션은 고치지 않는다.** 남들은 이미 적용해 다시 돌지 않는다. 변경은 항상
  새 번호로 추가한다.
- **어긋난 상태에서는 기동을 멈춘다** — 번호 중복, 머지로 끼어든 앞 번호, 저장소보다 앞선 로컬 DB.
  로컬 SQLite 파일은 커밋되지 않는 버릴 수 있는 파일이라, 애매하게 굴러가는 것보다 멈추고 다시
  만드는 편이 싸다.
- **개발 워처가 `backend/migrations/` 도 감시한다** ([dev-watch.mjs](../../backend/scripts/dev-watch.mjs),
  호스트에서는 `--watch-path`). 적용은 기동 시점에만 일어나므로, 이게 없으면 스택을 띄워둔 채
  `git pull` 한 사람이 **옛 스키마 위에서 계속 개발한다.** 스키마 변경이 팀에 퍼지는 경로가 이것이다.
- 이 장치가 다루는 것은 **DITTER 자체 스키마뿐이다.** 대상 PostgreSQL의 스키마는 DITTER가 만들지도
  바꾸지도 않는다 ([read-only-enforcement.md](../policy/read-only-enforcement.md)).

> 위 테이블 목록은 **설계**이고, 실제 마이그레이션 파일은 각 STEP에서 하나씩 추가된다. 현재는
> 러너만 서 있고 파일은 0개다 — 첫 파일은 [STEP 1](../todo/step-01a-connection-registry.md)의
> `connections`다.

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
