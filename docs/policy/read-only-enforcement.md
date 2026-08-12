# 읽기 전용 강제 (P3)

**대전제**: DITTER는 데이터를 수정하지 않는다. 읽기만 한다. 이건 기능 제약이 아니라 **위험 자체를 없애는 설계 결정**이다. 도입하는 회사 입장에서 "이 도구에는 **읽는 권한만** 주면 된다"가 된다.

읽기 전용은 **두 겹**으로 막는다. 어느 쪽이 주방어인지가 중요하다.

## 콘솔 계정에 정확히 무엇을 주는가

"읽기 전용 계정만 주면 된다"는 짧은 문장은 **한 군데서 부정확하다.** 운영 관찰(F5)은
`pg_stat_activity`에서 남의 세션 쿼리를 봐야 하는데, 순수 읽기 전용 계정에는 그 컬럼이 NULL로
마스킹된다 ([step-07-operations-monitoring.md](../todo/step-07-operations-monitoring.md)).

| 쓰는 기능 | 필요한 권한 |
|---|---|
| F1~F4 · F6 (콘솔·AI·감사) — PostgreSQL | 대상 스키마 `SELECT` + `default_transaction_read_only = on` |
| F5 (운영 관찰)까지 — PostgreSQL | 위 + `pg_read_all_stats` 롤 + `pg_stat_statements` 확장 |
| [이기종 쿼리엔진](heterogeneous-query-engine.md) — MySQL | 대상 스키마 `SELECT`만 부여한 계정 (`INSERT`·`UPDATE`·`DELETE` 권한 없음) — MySQL도 `SET SESSION transaction_read_only = ON`(세션 단위)·`SET GLOBAL transaction_read_only = ON`(서버 전역)은 있지만, PostgreSQL의 `ALTER ROLE ... SET default_transaction_read_only`처럼 **특정 계정에만 자동으로 바인딩되는 기본값**이 없다 — 접속 시마다 애플리케이션이 세션 변수를 직접 세팅해야 하므로 코드 누락에 기댈 수 없고, 그래서 **계정 권한 자체를 SELECT 전용으로 좁히는 것이 MySQL 쪽의 주방어**다 |

**`pg_read_all_stats`도 읽기 권한이다.** 통계 뷰의 마스킹을 푸는 것이지 데이터를 쓰게 하지
않는다. 그래서 "데이터를 바꿀 수 있는 권한은 어느 경우에도 필요 없다"는 주장은 그대로 유효하다 —
다만 **문서·발표에서는 위 표대로 정확히 말한다.** "읽기 전용 계정 하나면 끝"이라고 뭉뚱그렸다가
F5 시연에서 권한을 더 요구하면, 심사에서 이 주장 전체의 신뢰가 흔들린다.

## 1순위 (주방어): DB 계정 권한

접속 계정에 읽기 권한만 부여하고 `default_transaction_read_only = on`을 설정한다. 데이터베이스가 직접 막아주므로 **우리 코드에 버그가 있어도 뚫리지 않는다.**

## 2순위 (보조): AST 기반 문장 검증

**"SELECT로 시작하면 안전"이라는 단순 문자열 검사는 뚫린다.** 실제 사례:

```sql
WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t;
```

이 쿼리는 `WITH`/`SELECT`로 시작하지만 **실제로 DELETE가 실행된다.** 문자열 앞부분만 보는 검사는 절대 못 잡는다.

그래서 **문자열이 아니라 AST(구문 트리)로 파싱해서 검사한다.** `sqlglot`(순수 Python)을 쓴다 —
PostgreSQL과 MySQL을 **하나의 라이브러리로 파싱**할 수 있어, [이기종 쿼리엔진](heterogeneous-query-engine.md)(P10)이
붙었을 때 방언마다 다른 검증기를 따로 유지하지 않아도 된다.

### ⚠️ `sqlglot`은 각 DB의 공식 파서가 아니라 방언별로 재구현한 근사치다

`libpg-query`(이전 계획)는 PostgreSQL 소스에서 그대로 뽑아낸 파서라 실제 서버 동작과 항상
일치했다. `sqlglot`은 여러 방언을 각각 구현한 서드파티 파서라, 드문 문법·확장 구문에서 실제 DB
동작과 미세하게 어긋날 여지가 이론적으로 남는다. 이 검증기가 뚫리면 제품의 존재 이유가
사라지므로, 이 차이를 다음 두 가지로 못 박는다.

1. **파서가 이해하지 못하는 구문은 무조건 차단(fail-closed)한다.** 파싱 실패·미지원 구문·부분
   파싱을 "안전하니 통과"로 취급하지 않는다 — 판단이 안 서면 차단이 기본값이다.
2. **PostgreSQL·MySQL 각각의 위험 우회 패턴(CTE 안 DML, 다중 문장, 방언별 부작용 함수 등)을
   모은 회귀 테스트 세트를 [testing.md](../conventions/testing.md)에 방언별로 고정한다.** `sqlglot`
   도입이나 버전 갱신마다 이 세트 전체를 돌린다 — 담당 STEP은
   [1B](../todo/step-01b-readonly-validator.md)(PostgreSQL)와
   [2A](../todo/step-02a-federated-query-engine.md)(MySQL 방언 추가)다.

CTE 안에 숨은 DML은 **반드시 차단**해야 한다.

### 추가로 막아야 할 것들

- `SELECT pg_sleep(3600)` — 읽기지만 세션을 점유한다
- 부작용을 일으키는 함수 호출, 특히 `SECURITY DEFINER` 함수 (읽기 전용 계정도 우회 가능)
- `SELECT ... FOR UPDATE` — 쓰기는 아니지만 행 잠금을 건다

## 적용 대상

이 정책은 사용자가 직접 입력한 쿼리와 AI가 생성한 쿼리 **모두**에 동일하게 적용된다. AI가 만든 SQL도 신뢰하지 않는다 — AST 검증기를 통과한 뒤에만 실행 가능하다.

[파이프라인(F7)](../pipeline/README.md)의 소스 읽기도 예외가 아니다. `ReadSpec`의 `query`는 콘솔과 **같은 AST 검증기**를 통과해야 하고, 소스 커넥터는 자체 접속을 열지 않고 이 정책이 붙어 있는 STEP 1의 DB 어댑터를 경유한다.

[이기종 쿼리엔진](heterogeneous-query-engine.md)(P10)도 예외가 아니다. 조인에 참여하는 각 소스에
실제로 도달하는 문장은 **엔진(PostgreSQL/MySQL)에 맞는 AST 검증**을 거쳐야 한다. 소스가
여러 개로 늘었을 뿐 "AI도 사람도 검증되지 않은 문장을 DB로 보낼 수 없다"는 원칙은 그대로다.

## 파이프라인이 생겨도 이 정책은 완화되지 않는다

파이프라인 타깃에는 쓰기가 일어난다. 그래서 "읽기 전용이라며?"라는 질문이 자연스럽게 따라오는데, 답은 **이 정책을 건드리지 않는 것**이다 — 쓰기는 사람도 AI도 자유형 SQL을 넣을 수 없는 완전히 분리된 경로에서만 일어나며, 그 커넥션은 콘솔에서 도달할 수 없다. 경계의 정의는 [pipeline-write-boundary.md](pipeline-write-boundary.md) (P9)에 있다.

같은 질문이 이기종 쿼리엔진에도 따라온다 — 답은 같다. **이 기능이 다루는 커넥션은 `role='source'`뿐이고, `role='target'`에는 어떤 경로로도 닿지 않는다.** 경계의 정의는 [heterogeneous-query-engine.md](heterogeneous-query-engine.md) (P10)에 있다.

## 리뷰 게이트

🔒 **읽기 전용 강제 구현은 반드시 2명이 리뷰한다.** 뚫리면 제품의 존재 이유가 사라진다.

## 관련

- 담당 STEP: [1B 읽기 전용 AST 검증기](../todo/step-01b-readonly-validator.md)(판정), [1C 스키마 조회와 쿼리 실행 API](../todo/step-01c-schema-catalog.md)(호출 지점)
- [query-safety-limits.md](query-safety-limits.md)
- [internal-vs-user-query-injection.md](internal-vs-user-query-injection.md)
- [pipeline-write-boundary.md](pipeline-write-boundary.md) (P9)
- [heterogeneous-query-engine.md](heterogeneous-query-engine.md) (P10)
