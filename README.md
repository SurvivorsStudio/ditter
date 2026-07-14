# ditter

운영 중인 PostgreSQL에 붙어서, 위험한 쿼리를 **실행하기 전에** 잡아내고 AI와 함께 고칠 수 있게
해주는 **읽기 전용 웹 SQL 콘솔**.

> **안전하게 조회하고, 느리면 AI와 같이 고친다.**

## 왜 필요한가

개발자는 프로덕션 데이터를 봐야 할 때가 있다. 그런데 무거운 쿼리 하나가 서비스를 느리게 만들 수
있어서 무섭다. ChatGPT에 물어봐도, ChatGPT는 우리 DB에 데이터가 얼마나 있는지, 인덱스가 어떻게
걸려 있는지 모른 채 "그럴듯한 SQL"만 준다.

ditter는 **실제 DB를 읽는다.** 스키마, 데이터 규모, 인덱스, EXPLAIN 실행 계획을 읽어서 AI에게
넘긴다. 그래서 AI가 추측이 아니라 근거를 갖고 답하고, 쿼리를 실행하기 전에 "이건 위험합니다"라고
붙잡는다.

**절대 안 하는 것**: 데이터를 수정하지 않는다. 읽기만 한다. 이건 기능 제약이 아니라 위험 자체를
없애는 설계 결정이다 — 도입하는 회사 입장에서 "이 도구에는 읽기 전용 계정만 주면 된다"가 된다.

## 핵심 기능

| # | 기능 | 한 줄 설명 |
|---|---|---|
| F1 | 웹 SQL 콘솔 (읽기 전용) | 브라우저에서 쿼리 작성·실행, 결과 표시 |
| F2 | AI 쿼리 작성 보조 | 자연어 → SQL, 또는 작성 중인 SQL 개선 |
| F3 | 실행 전 위험 예측 | 실행하기 전에 "이 쿼리 위험합니다" 경고 — **킬러 기능** |
| F4 | EXPLAIN 해석 + 튜닝 제안 | 왜 느린지 설명하고 어떻게 고칠지 제안 |
| F5 | 운영 관찰 | 느린 쿼리 목록, 실행 중인 세션 보기 |
| F6 | 감사 로그 | 누가 언제 무슨 쿼리를 실행했는지 기록 |

대상 DB는 PostgreSQL 하나이며, DB 접근 코드는 어댑터 인터페이스로 감싸 멀티 DB 확장을 염두에
두고 있다.

## 안전 설계

읽기 전용은 두 겹으로 강제한다 — **DB 계정 권한(주방어)** + **AST 기반 문장 검증(보조)**. `WITH t
AS (DELETE FROM users RETURNING *) SELECT * FROM t` 같은 CTE 우회도 문자열 검사가 아니라 구문
트리 파싱으로 잡아낸다. 자세한 내용은 [docs/policy](docs/policy/README.md) 참고.

## 기술 스택

TypeScript 모노레포 — React + Vite(프런트엔드), Fastify(백엔드), PostgreSQL(대상 DB),
SQLite(로컬 저장). 자세한 구조는 [docs/conventions](docs/conventions/README.md) 참고.

## 진행 상황

현재 개발 계획·정책·컨벤션·스키마를 정리하는 단계다(`STEP 0` 착수 전). 실행 가능한 앱은 아직
없다. 진행 단계와 완료 조건은 [docs/todo](docs/todo/README.md)에서 추적한다.

## 문서

- [docs/todo](docs/todo/README.md) — 개발 단계(STEP 0~10)와 완료 조건
- [docs/policy](docs/policy/README.md) — 보안·데이터 취급 정책
- [docs/conventions](docs/conventions/README.md) — 개발 언어·코드 컨벤션
- [docs/schema](docs/schema/README.md) — DITTER 로컬 SQLite 테이블 스키마

## 라이선스

[MIT](LICENSE)
