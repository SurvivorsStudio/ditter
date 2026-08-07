# STEP 8 · 감사 로그 + 인증 (`F6` 완성)

**시작 조건**: **STEP 0** (STEP 1과 병렬. 감사 로그를 실제 실행 경로에 연결하는 것만 [1C](step-01c-schema-catalog.md) 이후)

## 목표

기능이라기보다 **신뢰의 근거**다. "누가 언제 무슨 쿼리를 돌렸는지 다 남습니다"가 있어야 회사가 프로덕션에 붙이는 걸 허락한다. 우리 제품 스토리("회사가 AI에게 프로덕션 접근을 못 주는 이유를 해결한다")의 절반이 여기서 나온다.

## ⚡ 시작 조건을 STEP 2에서 STEP 0으로 당겼다

인증 백엔드(`users` 테이블 · 세션 · 라우트 가드)와 `audit_logs` 테이블은 **콘솔 화면과 아무 상관이
없다.** 기다릴 이유가 없었고, 기다리면 두 가지가 나빠진다.

- **프로덕션 자격증명을 쥔 웹앱이 개발 내내 무인증으로 뜬다** — 그 자체가 사고다
  ([P6](../policy/authentication-authorization.md)).
- STEP 1이 끝날 때까지 병렬로 굴릴 수 있는 일이 하나 줄어든다.

**감사 로그를 실제 실행 경로에 꽂는 작업만** [1C](step-01c-schema-catalog.md)의 쿼리 실행 API를
기다린다. 테이블·기록 함수·인증은 그전에 끝나 있을 수 있다.

여전히 **STEP 9와 STEP 12 전에는 반드시 완료**되어야 한다.

## 하는 일

- **감사 로그**: 누가·언제·무슨 쿼리를 SQLite에 append-only로 기록. 삭제 API는 만들지 않는다 ([audit-logging.md](../policy/audit-logging.md))
- **최소한의 로그인/인증**과 접속 대상별 권한 분리를 갖춘다 — 인증을 뒤로 미루면 안 되는 이유는 [authentication-authorization.md](../policy/authentication-authorization.md) 참고
- **`users.is_admin` 플래그**와 그것을 요구하는 라우트 가드 ([users](../schema/users.md)의 「관리자가 하는 일」). STEP 9의 타깃 커넥션 등록 제한이 이 플래그 위에 서므로 **여기서 만들지 않으면 STEP 9에서 P9 규칙 6이 구현될 수 없다.** 첫 계정은 `is_admin=1`로 만들고, 관리자가 0명이 되는 상태를 허용하지 않는다

## 완료 조건

인증 없이는 접근할 수 없다. 실행된 모든 쿼리가 감사 로그에 남고, 앱을 통해서는 지울 수 없다.
관리자 전용 라우트에 일반 사용자로 접근하면 거부된다.

## 관련 정책

- [audit-logging.md](../policy/audit-logging.md)
- [authentication-authorization.md](../policy/authentication-authorization.md)
