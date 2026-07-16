# connection_grants

어떤 사용자가 어떤 접속 설정에 접근할 수 있는지를 담는 매핑 테이블. [STEP 8](../todo/step-08-audit-log-auth.md)의
"접속 대상별 권한 분리"와 [authentication-authorization.md](../policy/authentication-authorization.md)의
인가 원칙을 구현한다.

## 컬럼

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | |
| `user_id` | INTEGER | NOT NULL, FK → `users.id` | 접근 권한을 받는 사용자 |
| `connection_id` | INTEGER | NOT NULL, FK → `connections.id` | 대상 접속 설정 |
| `granted_by` | INTEGER | NOT NULL, FK → `users.id` | 권한을 부여한 사용자 |
| `granted_at` | TEXT (ISO8601) | NOT NULL, DEFAULT now | |

## 제약

- `UNIQUE(user_id, connection_id)` — 같은 사용자·접속 조합은 한 번만 존재한다.

## 관계

- `user_id`, `granted_by` → [users](users.md)`.id`
- `connection_id` → [connections](connections.md)`.id`

## 비고

- 이 테이블은 "누가 이 접속 설정을 쿼리 콘솔에서 선택할 수 있는가"만 결정한다. 실제 DB 내에서 무엇을 읽을 수 있는지는 `connections.username`이 가리키는 PostgreSQL 계정의 권한이 결정한다 ([read-only-enforcement.md](../policy/read-only-enforcement.md)).
- 등급(read-only/admin 등) 구분 없이 "접근 가능/불가능"의 단일 레벨만 다룬다. 더 세분화된 권한 모델은 MVP 범위 밖이다.
