# users

DITTER 앱에 로그인하는 계정. [STEP 8 감사 로그 + 인증](../todo/step-08-audit-log-auth.md)의
"최소한의 로그인/인증"을 위한 테이블이다. 셀프호스팅 단일 조직을 전제로 하며, 프로덕션 접속 정보를
쥔 웹앱이 무인증으로 떠 있으면 안 된다는 원칙에서 나왔다 ([authentication-authorization.md](../policy/authentication-authorization.md)).

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `email` | TEXT | NOT NULL, UNIQUE | 로그인 식별자 |
| `password_hash` | TEXT | NOT NULL | bcrypt/argon2 등으로 해시. **평문 저장 금지** |
| `is_admin` | INTEGER (0/1) | NOT NULL, DEFAULT 0 | **관리자 여부.** 아래 「관리자가 하는 일」의 동작만 이 값으로 갈린다. 일반 사용자와의 차이는 그 목록이 전부다 |
| `created_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | 계정 생성 시각 |

## 관리자가 하는 일

`is_admin`이 없으면 아래 정책들이 **저장할 자리가 없어 구현 불가능하다.** 등급 체계를 만들자는
것이 아니라, 이미 확정된 규칙 셋을 담기 위한 플래그 하나다.

| 동작 | 근거 |
|---|---|
| 타깃 커넥션 등록·수정 | [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) 규칙 6 — 쓰기 커넥션을 아무나 만들면 P9 경계가 무의미해진다 |
| 워터마크 수동 되돌리기 | [pipeline-checkpoints](pipeline-checkpoints.md) — 적재 범위를 바꾸는 조작이라 감사 로그에 남는다 |
| 접속 권한 부여 (`connection_grants.granted_by`) | [connection_grants](connection-grants.md) — 권한을 주는 사람과 받는 사람이 같으면 분리가 성립하지 않는다 |

- **소스 커넥션 등록·수정은 관리자 전용이 아니다.** 읽기 전용 계정이고 콘솔에서 도달 가능한
  것이 정상이므로, 여기까지 잠그면 일상 사용이 막힌다.
- 첫 관리자는 **최초 계정 생성 시 `is_admin=1`로 만든다.** 관리자가 0명이 되는 상태를 만들지
  않는다 — 자기 자신의 `is_admin`을 내리는 것도 막는다.

## 관계

- `connections.created_by` → `users.id`
- `connection_grants.user_id` / `connection_grants.granted_by` → `users.id`
- `audit_logs.user_id` → `users.id`
- `pipelines.created_by` / `pipelines.activated_by` → `users.id`
- `pipeline_runs.triggered_by` → `users.id`

## 비고

- **일반적인 역할(role) 기반 권한 체계는 MVP 범위 밖이다.** `is_admin`은 그 체계의 축소판이 아니라 위 세 동작을 위한 불리언 하나이며, 등급을 늘리지 않는다. 접속 대상별 권한 분리는 [connection_grants](connection-grants.md)가 담당한다.
- **계정 삭제 기능은 없다.** [audit_logs](audit-logs.md)`.user_id`와 [pipeline_runs](pipeline-runs.md)`.triggered_by`가 이 테이블을 참조하는데 그 행은 append-only라 지우거나 비울 수 없다.
- 비밀번호는 서버에서 해시로만 다루고, 로그에 평문으로 남기지 않는다 ([credential-management.md](../policy/credential-management.md)의 원칙을 계정 비밀번호에도 동일하게 적용).
