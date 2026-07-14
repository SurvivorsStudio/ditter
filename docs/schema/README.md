# DITTER 스키마

DITTER 앱 자체가 로컬 **SQLite**에 저장하는 테이블 문서다. **DITTER가 조회 대상으로 삼는
프로덕션 PostgreSQL의 스키마가 아니다** — 그건 사용자마다 다르며, [connections](connections.md)
설정으로 매번 연결해 [스키마 API](../todo/step-01-db-connection.md)로 읽어온다.

## 테이블 목록

| 테이블 | 설명 | 담당 STEP |
|---|---|---|
| [users](users.md) | DITTER 로그인 계정 | [STEP 8](../todo/step-08-audit-log-auth.md) |
| [connections](connections.md) | 등록된 PostgreSQL 접속 설정(자격증명 포함) | [STEP 1](../todo/step-01-db-connection.md) |
| [connection_grants](connection-grants.md) | 사용자별 접속 대상 권한 분리 | [STEP 8](../todo/step-08-audit-log-auth.md) |
| [audit_logs](audit-logs.md) | 실행된 모든 쿼리의 append-only 기록 | [STEP 8](../todo/step-08-audit-log-auth.md) |

## 관계 (ERD 개요)

```
users ──1:N── connections           (created_by)
users ──N:M── connections           (connection_grants 경유)
users ──1:N── audit_logs            (user_id)
connections ──1:N── audit_logs      (connection_id)
```

## 원칙

- append-only·자격증명 암호화 등 데이터 취급 원칙은 [docs/policy](../policy/README.md)를 따른다 — [audit_logs](audit-logs.md)와 [connections](connections.md)가 이 원칙이 실제로 적용되는 테이블이다.
- 이 스키마에 대한 앱의 내부 조회 쿼리는 파라미터 바인딩을 강제한다 ([internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md) P1).
- 로컬 SQLite 파일 자체는 저장소에 커밋하지 않는다 ([.gitignore](../../.gitignore)).

## 관련 문서

- [docs/todo](../todo/README.md) — 이 테이블들이 어느 STEP에서 만들어지는지
- [docs/policy](../policy/README.md) — 자격증명·감사 로그·인증 정책
- [docs/conventions](../conventions/README.md) — 프로젝트 구조·컨벤션
