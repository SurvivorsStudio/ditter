# STEP 1 · DB에 안전하게 접속하기

**시작 조건**: STEP 0

## 목표

"DB를 안전하게 읽는 능력"을 만든다. 화면에는 아직 아무것도 안 보이지만, **이 단계가 모든 것의 병목이다.** 여기서 만드는 스키마 조회 기능이 없으면 에디터 자동완성도, AI 컨텍스트도 만들 수 없다. **가장 먼저, 가장 확실하게 끝낸다.**

## 작업 분할 — 세 문서로 나눈다

병목 STEP의 분량을 쪼갠 것이다. **1B는 순수 로직이라 1A와 완전히 병렬**로 굴릴 수 있다 —
STEP 1 안에서 앞당길 수 있는 유일한 갈래이므로 놀리지 않는다.

| 문서 | 내용 | 시작 조건 |
|---|---|---|
| [1A 접속 등록과 커넥션 풀](step-01a-connection-registry.md) | 풀 · 커넥션 CRUD · 자격증명 암호화 · 어댑터 인터페이스 | STEP 0 |
| [1B 읽기 전용 AST 검증기](step-01b-readonly-validator.md) | `pgsql-parser` 기반 판정. **DB 없이 착수 가능** | STEP 0 |
| [1C 스키마 조회와 쿼리 실행 API](step-01c-schema-catalog.md) | 카탈로그 조회 · 실행 API · 실행 제한 | 1A + 1B |

```
STEP 0 ──┬──▶ 1A 접속·풀·자격증명 ──┐
         │                          ├──▶ 1C 스키마·실행 API ──▶ STEP 2 · 3 · 7
         └──▶ 1B AST 검증기 ────────┘
```

1B가 만든 검증기는 [STEP 4](step-04-ai-query-assist.md)의 AI 생성 SQL과
[STEP 9C](step-09c-dag-spec.md)의 파이프라인 소스 쿼리도 그대로 탄다. **검증기는 하나뿐이다.**

## 완료 조건

읽기 전용 계정으로 SELECT가 돌아간다. INSERT/UPDATE/DELETE가 **두 겹 모두에서** 차단된다. [read-only-enforcement.md](../policy/read-only-enforcement.md)의 CTE 우회 쿼리도 차단된다. 스키마 정보가 JSON으로 API에서 나온다.

세 문서의 완료 조건을 **전부** 만족해야 STEP 1이 끝난 것이다.

## 리뷰 게이트

🔒 **이 단계 코드는 반드시 2명이 리뷰한다.** 읽기 전용 강제와 접속 정보 관리가 뚫리면 제품의 존재 이유가 사라진다.

세 문서 모두 리뷰 대상이다. 특히 **1B(검증기)와 1C(검증기를 호출하는 지점)는 따로 본다** — 판정이
정확해도 실행 경로가 그걸 안 거치면 아무 의미가 없기 때문이다.

## 관련 정책

- [read-only-enforcement.md](../policy/read-only-enforcement.md)
- [credential-management.md](../policy/credential-management.md)
- [query-safety-limits.md](../policy/query-safety-limits.md)
- [internal-vs-user-query-injection.md](../policy/internal-vs-user-query-injection.md)
