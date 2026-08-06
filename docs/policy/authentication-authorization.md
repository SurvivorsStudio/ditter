# 인증/인가 (P6)

## 원칙

프로덕션 접속 정보를 쥔 웹앱이 무인증으로 떠 있으면 안 된다. **셀프호스팅 단일 조직 전제라도 필수다.**

- 최소한의 로그인/인증을 갖춘다.
- 접속 대상(DB 커넥션)별로 권한을 분리한다.

## 인증을 뒤로 미루지 마라

프로덕션 자격증명을 쥔 웹앱이 개발 내내 무인증으로 떠 있는 건 그 자체로 사고다. STEP 2 이후 아무 때나 병렬로 진행할 수 있지만, [STEP 9 파이프라인 기반](../todo/step-09-pipeline-foundation.md)의 시작 조건이고 [STEP 12 보안 전수 점검](../todo/step-12-security-review.md) 전에는 반드시 끝나 있어야 한다.

## 함께 요구되는 DB 권한 (참고)

인증/인가는 앱 레벨의 정책이지만, DB 계정 권한 설계와도 맞물린다. [운영 관찰(STEP 7)](../todo/step-07-operations-monitoring.md)에서 `pg_read_all_stats` 롤이 추가로 필요한 것처럼, "읽기 전용 계정만 주면 된다"는 홍보 문구는 실제 요구 권한에 맞춰 정확히 수정해야 한다.

## 관련

- 담당 STEP: [step-08-audit-log-auth.md](../todo/step-08-audit-log-auth.md)
- [audit-logging.md](audit-logging.md)
- [credential-management.md](credential-management.md)
