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
| `created_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | 계정 생성 시각 |

## 관계

- `connections.created_by` → `users.id`
- `connection_grants.user_id` / `connection_grants.granted_by` → `users.id`
- `audit_logs.user_id` → `users.id`

## 비고

- 역할(role) 기반 권한 체계는 MVP 범위 밖이다. 접속 대상별 권한 분리는 [connection_grants](connection-grants.md)가 담당한다.
- 비밀번호는 서버에서 해시로만 다루고, 로그에 평문으로 남기지 않는다 ([credential-management.md](../policy/credential-management.md)의 원칙을 계정 비밀번호에도 동일하게 적용).
