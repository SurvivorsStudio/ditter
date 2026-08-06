# connections

사용자가 등록한 PostgreSQL 접속 설정. [STEP 1 DB에 안전하게 접속하기](../todo/step-01-db-connection.md)의
"접속 설정 CRUD (SQLite에 저장)"에 해당한다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `name` | TEXT | NOT NULL, UNIQUE | 화면에 노출되는 접속 이름. **비밀번호는 여기 없다** — 접속 선택 UI는 이 이름만 보여준다 ([frontend-react.md](../conventions/frontend-react.md)) |
| `role` | TEXT | NOT NULL, DEFAULT `'source'`, CHECK `IN ('source','target')` | **이 접속을 어디에 쓸 수 있는지.** `source`는 콘솔 조회·파이프라인 소스(읽기 전용 계정), `target`은 파이프라인 타깃 전용(쓰기 허용 계정). **겸할 수 없다** — 근거와 강제 방식은 [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 참고 |
| `adapter_type` | TEXT | NOT NULL, DEFAULT `'postgresql'` | DB 어댑터 인터페이스 식별자. 구현은 PostgreSQL 하나뿐이지만 멀티 DB 확장을 염두에 둔 컬럼 ([project-structure.md](../conventions/project-structure.md)) |
| `host` | TEXT | NOT NULL | |
| `port` | INTEGER | NOT NULL | |
| `database_name` | TEXT | NOT NULL | |
| `username` | TEXT | NOT NULL | `role='source'`이면 **읽기 전용 DB 계정**(+ 운영 관찰을 쓰려면 `pg_read_all_stats` 롤도 필요 — [step-07-operations-monitoring.md](../todo/step-07-operations-monitoring.md)). `role='target'`이면 지정 스키마에만 권한이 있는 쓰기 계정 |
| `encrypted_password` | TEXT | NOT NULL | 암호화된 비밀번호. **브라우저로 절대 내려가지 않는다.** 암호화 키 관리 방침은 [credential-management.md](../policy/credential-management.md) 참고 |
| `statement_timeout_ms` | INTEGER | NULL 허용, 기본값은 앱에서 정의 | 앱이 요청하는 실행 시간 제한. **주방어는 DB 롤 레벨 `statement_timeout`**이며 이 값은 보조 수단이다 ([query-safety-limits.md](../policy/query-safety-limits.md)) |
| `max_rows` | INTEGER | NULL 허용, 기본값은 앱에서 정의 | 반환 행 수 제한. **`role='source'`의 콘솔 조회에만 적용된다** — 파이프라인 소스 읽기는 스트리밍이라 전량을 반환하지 않으므로 이 상한의 대상이 아니다 |
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
- 파이프라인 커넥터가 쓰는 추가 설정(S3 버킷, 파일 경로 등)은 별도 JSON 컬럼에 두고, 그중 시크릿 키는 `encrypted_password`와 같은 방식으로 분리 암호화한다.
