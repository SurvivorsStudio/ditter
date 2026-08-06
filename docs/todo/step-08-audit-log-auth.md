# STEP 8 · 감사 로그 + 인증 (`F6` 완성)

**시작 조건**: STEP 2 (**앞 STEP들과 병렬 가능**, 다만 STEP 9와 STEP 12 전에는 반드시 완료)

## 목표

기능이라기보다 **신뢰의 근거**다. "누가 언제 무슨 쿼리를 돌렸는지 다 남습니다"가 있어야 회사가 프로덕션에 붙이는 걸 허락한다. 우리 제품 스토리("회사가 AI에게 프로덕션 접근을 못 주는 이유를 해결한다")의 절반이 여기서 나온다.

## 하는 일

- **감사 로그**: 누가·언제·무슨 쿼리를 SQLite에 append-only로 기록. 삭제 API는 만들지 않는다 ([audit-logging.md](../policy/audit-logging.md))
- **최소한의 로그인/인증**과 접속 대상별 권한 분리를 갖춘다 — 인증을 뒤로 미루면 안 되는 이유는 [authentication-authorization.md](../policy/authentication-authorization.md) 참고

## 완료 조건

인증 없이는 접근할 수 없다. 실행된 모든 쿼리가 감사 로그에 남고, 앱을 통해서는 지울 수 없다.

## 관련 정책

- [audit-logging.md](../policy/audit-logging.md)
- [authentication-authorization.md](../policy/authentication-authorization.md)
