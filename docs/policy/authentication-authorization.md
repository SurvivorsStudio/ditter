# 인증/인가 (P6)

## 원칙

프로덕션 접속 정보를 쥔 웹앱이 무인증으로 떠 있으면 안 된다. **셀프호스팅 단일 조직 전제라도 필수다.**

- 최소한의 로그인/인증을 갖춘다.
- 접속 대상(DB 커넥션)별로 권한을 분리한다.
- **관리자 플래그 하나를 둔다** ([users](../schema/users.md)`.is_admin`). 등급 체계를 만드는 것이
  아니라, 타깃 커넥션 등록·워터마크 되돌리기·권한 부여 세 동작이 저장할 자리를 갖게 하는 것이다.
  이 셋은 [P9 규칙 6](pipeline-write-boundary.md)에서 이미 "관리자만"으로 확정돼 있다.

## 인증을 뒤로 미루지 마라

프로덕션 자격증명을 쥔 웹앱이 개발 내내 무인증으로 떠 있는 건 그 자체로 사고다. STEP 2 이후 아무 때나 병렬로 진행할 수 있지만, [STEP 9 파이프라인 기반](../todo/step-09-pipeline-foundation.md)의 시작 조건이고 [STEP 12 보안 전수 점검](../todo/step-12-security-review.md) 전에는 반드시 끝나 있어야 한다.

## 함께 요구되는 DB 권한 (참고)

인증/인가는 앱 레벨의 정책이지만, DB 계정 권한 설계와도 맞물린다. [운영 관찰(STEP 7)](../todo/step-07-operations-monitoring.md)은 `pg_read_all_stats` 롤을 추가로 요구한다 — 기능별로 정확히 무엇이 필요한지는 [read-only-enforcement.md의 권한 표](read-only-enforcement.md#콘솔-계정에-정확히-무엇을-주는가)에 있고, 문서·발표는 그 표대로 말한다.

## 관련

- 담당 STEP: [step-08-audit-log-auth.md](../todo/step-08-audit-log-auth.md)
- [audit-logging.md](audit-logging.md)
- [credential-management.md](credential-management.md)
