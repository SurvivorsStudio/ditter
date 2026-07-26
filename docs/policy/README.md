# DITTER 정책

DITTER는 프로덕션 PostgreSQL에 붙는 도구다. 보안은 두 갈래로 나눠서 본다.

1. **npm 공급망** — Node/TypeScript 생태계 고유의 위험
2. **프로덕션 DB 접근** — 언어와 무관하고, 더 중요하다

## 먼저, 오해 하나를 정리한다

"TypeScript는 Node 기반이라 보안이 약하다"는 인식은 정확하지 않다. Node는 메모리 안전 언어라 버퍼 오버플로우류 취약점이 원천적으로 없다. "Node는 보안이 약하다"는 인식의 실체는 npm 의존성 생태계(공급망)다. 그리고 DITTER의 진짜 급소는 **DB 접근 정책**이며, 이는 Go나 Rust로 다시 짜도 똑같이 중요하다.

## 정책 목록

### 프로덕션 DB 접근 (언어와 무관, 더 중요)

| # | 문서 | 대응 항목 |
|---|---|---|
| P3 | [읽기 전용 강제](read-only-enforcement.md) | DB 계정 권한(주방어) + AST 검증(보조) |
| P1, P2 | [내부 쿼리 vs 사용자 쿼리](internal-vs-user-query-injection.md) | 인젝션 방어의 적용 범위 구분 |
| P5 | [쿼리 부하 방어](query-safety-limits.md) | timeout, 행수 제한, 풀 상한 |
| P4 | [자격증명 관리](credential-management.md) | 저장·암호화·키 관리 |
| P8 | [AI 컨텍스트와 안전](ai-context-and-safety.md) | 프롬프트 인젝션, 출력 검증, 데이터 외부 전송 |
| P6 | [인증/인가](authentication-authorization.md) | 최소 로그인, 권한 분리 |
| P7 | [감사 로그](audit-logging.md) | append-only, 삭제 불가 |

### 공급망 (npm + CI)

| # | 문서 |
|---|---|
| S1~S9 | [supply-chain-security.md](supply-chain-security.md) |

## 리뷰 게이트

- **읽기 전용 강제(P3)와 자격증명 처리(P4)는 2인 리뷰 필수** — [STEP 1](../todo/step-01-db-connection.md)
- [STEP 9](../todo/step-09-security-review.md)에서 위 체크리스트 전 항목을 실제 코드로 전수 점검
- 제출 전 SBOM + `npm audit` 클린 확보

## 핵심 원칙 요약

- **주방어는 항상 DB 계정 권한이다.** 앱 코드의 검증은 보조 수단이다.
- **"SELECT로 시작하면 안전"은 틀렸다.** CTE 안에 DML이 숨을 수 있다 — 문자열이 아니라 AST로 검사한다.
- **AI 출력은 절대 그대로 믿지 않는다.** 검증 실패 시 원본 반환, 실행 전 항상 사용자 확인, AST 검증 통과 필수.
- **감사 로그는 지울 수 없어야 진짜 감사 로그다.**
- **가장 강력한 공급망 방어는 의존성을 늘리지 않는 것이다.**

## 관련 문서

- [docs/todo](../todo/README.md) — 이 정책들이 어느 STEP에서 구현되는지
- [docs/conventions](../conventions/README.md) — 정책을 코드로 지키기 위한 컨벤션
