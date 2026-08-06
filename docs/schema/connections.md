# connections

사용자가 등록한 접속 설정. [STEP 1 DB에 안전하게 접속하기](../todo/step-01-db-connection.md)의
"접속 설정 CRUD (SQLite에 저장)"에 해당한다.

**파이프라인 커넥터의 접속도 이 테이블 하나에 담는다.** PostgreSQL뿐 아니라 S3·로컬 파일·HTTP
JSON 커넥터도 여기에 등록한다. 별도 테이블을 만들지 않는 이유는 [P9](../policy/pipeline-write-boundary.md)
규칙 1·2의 `role` 검증과 규칙 6의 관리자 제한이 **모든 타깃 종류에 같은 코드로 적용되게** 하기
위해서다. 종류마다 테이블이 갈리면 그 검증도 갈라지고, 갈라진 쪽이 빠진다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `name` | TEXT | NOT NULL, UNIQUE | 화면에 노출되는 접속 이름. **비밀번호는 여기 없다** — 접속 선택 UI는 이 이름만 보여준다 ([frontend-react.md](../conventions/frontend-react.md)) |
| `role` | TEXT | NOT NULL, DEFAULT `'source'`, CHECK `IN ('source','target')` | **이 접속을 어디에 쓸 수 있는지.** `source`는 콘솔 조회·파이프라인 소스(읽기 전용 계정), `target`은 파이프라인 타깃 전용(쓰기 허용 계정). **겸할 수 없다** — 근거와 강제 방식은 [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 참고 |
| `adapter_type` | TEXT | NOT NULL, DEFAULT `'postgres'` | **이 접속이 어떤 커넥터로 열리는지** — `postgres` · `s3` · `local_file` · `http_json` ([connector-contract.md](../pipeline/connector-contract.md)). `postgres`는 DB 어댑터 인터페이스 식별자를 겸하며, 멀티 DB 확장 시 여기에 값이 늘어난다 ([project-structure.md](../conventions/project-structure.md)). **아래 컬럼 중 무엇이 필수인지를 이 값이 결정한다** |
| `host` | TEXT | NULL 허용 | `adapter_type='postgres'`에서 **필수**. `http_json`은 `config`의 base URL을 쓰고, `s3`·`local_file`은 쓰지 않는다 |
| `port` | INTEGER | NULL 허용 | `adapter_type='postgres'`에서 **필수** |
| `database_name` | TEXT | NULL 허용 | `adapter_type='postgres'`에서 **필수** |
| `username` | TEXT | NULL 허용 | `adapter_type='postgres'`에서 **필수**. `role='source'`이면 **읽기 전용 DB 계정**(+ 운영 관찰을 쓰려면 `pg_read_all_stats` 롤도 필요 — [step-07-operations-monitoring.md](../todo/step-07-operations-monitoring.md)). `role='target'`이면 지정 스키마에만 권한이 있는 쓰기 계정. 나머지 커넥터의 접근 주체는 `config`의 시크릿 키가 나타낸다 |
| `encrypted_password` | TEXT | NULL 허용 | 암호화된 비밀번호. `adapter_type='postgres'`에서 **필수**. **브라우저로 절대 내려가지 않는다.** 암호화 키 관리 방침은 [credential-management.md](../policy/credential-management.md) 참고 |
| `config` | TEXT (JSON) | NOT NULL, DEFAULT `'{}'` | 커넥터별 추가 설정 — S3 버킷·리전·엔드포인트, 로컬 파일 하위 경로, HTTP base URL·헤더 등. **허용 키는 커넥터 종류마다 백엔드 화이트리스트로 고정**하고([connector-contract.md](../pipeline/connector-contract.md) 신규 커넥터 추가 절차), 그중 시크릿 키(`secretAccessKey` 등)는 `encrypted_password`와 **같은 방식으로 분리 암호화**해 API 응답·로그에 싣지 않는다 ([credential-management.md](../policy/credential-management.md)) |
| `statement_timeout_ms` | INTEGER | NULL 허용, 기본값은 앱에서 정의 | 앱이 요청하는 실행 시간 제한. **주방어는 DB 롤 레벨 `statement_timeout`**이며 이 값은 보조 수단이다 ([query-safety-limits.md](../policy/query-safety-limits.md)). `adapter_type='postgres'`에만 의미가 있다 |
| `max_rows` | INTEGER | NULL 허용, 기본값은 앱에서 정의 | **콘솔 응답 한 번에 담기는 행 수 상한.** 파이프라인 소스 읽기에는 걸지 않는다 — 스트리밍이라 "응답"이라는 단위가 없고, 여기에 걸면 대량 적재가 조용히 잘린 채 성공으로 끝난다. 파이프라인 쪽에서 이 상한을 대신하는 것은 **한 배치의 크기 상한 + `statement_timeout`**이며, **파이프라인 전용 최대 행수는 두지 않는다** ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 8) |
| `created_by` | INTEGER | NOT NULL, FK → `users.id` | |
| `created_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | |
| `updated_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | |

## 관계

- `created_by` → [users](users.md)`.id`
- `connection_grants.connection_id` → `connections.id`
- `audit_logs.connection_id` → `connections.id`
- `pipelines.definition` 안의 노드가 `connections.id`를 참조한다 ([pipelines](pipelines.md))

## 비고

- 이 테이블은 **앱이 참고하는 설정값**일 뿐, 읽기 전용 강제의 주방어는 아니다 — 방어 메커니즘은 [read-only-enforcement.md](../policy/read-only-enforcement.md) 참고.
- `encrypted_password`의 실제 방어 강도는 암호화 키 관리 방식에 달려 있다 — 방침은 [credential-management.md](../policy/credential-management.md) 참고.
- **`role` 역시 주방어가 아니다.** 타깃 계정이 쓸 수 있는 범위를 실제로 정하는 것은 DB 계정 권한이다. `role`은 "콘솔에서 이 접속에 도달할 수 없게" 만드는 앱 레벨 차단이며, 그 차단은 라우터 앞단 한 곳에서 강제한다 ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 2).
- **필수 컬럼이 `adapter_type`에 따라 달라지므로 검증은 앱에서 한다.** SQLite의 NOT NULL로는 "postgres일 때만 필수"를 표현할 수 없다. 커넥터 종류별 필수 필드는 [connector-contract.md](../pipeline/connector-contract.md)의 백엔드 허용 키 목록과 **같은 한 곳에서 파생시킨다** — 두 벌로 두면 어긋난다.
- **`role` 검증은 `adapter_type`과 무관하게 모든 접속에 적용된다.** S3·로컬 파일 타깃도 `role='target'`으로 등록되며, 따라서 콘솔에서 도달할 수 없고 타깃 노드의 커넥션 선택 목록에만 나타난다 ([pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 2·6, [dag-and-nodes.md](../pipeline/dag-and-nodes.md) 검증 규칙).
- **콘솔이 쓰는 접속 목록·쿼리 실행 API는 `role='source'`와 `adapter_type='postgres'`를 함께 검사한다.** `role` 하나로는 부족하다 — `http_json`은 파이프라인 소스이므로 `role='source'`이지만 SQL을 실행할 수 없고, 그걸 콘솔 목록에 노출하면 host·username이 빈 접속을 골라 실행이 깨진다. 이 검사도 P9 규칙 2와 **같은 라우터 앞단 한 곳**에서 건다. 즉 콘솔이 보는 집합은 `role='source' AND adapter_type='postgres'`이고, 파이프라인 소스가 보는 집합은 `role='source'` 전체다.
