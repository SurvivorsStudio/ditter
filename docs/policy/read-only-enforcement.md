# 읽기 전용 강제 (P3)

**대전제**: DITTER는 데이터를 수정하지 않는다. 읽기만 한다. 이건 기능 제약이 아니라 **위험 자체를 없애는 설계 결정**이다. 도입하는 회사 입장에서 "이 도구에는 읽기 전용 계정만 주면 된다"가 된다.

읽기 전용은 **두 겹**으로 막는다. 어느 쪽이 주방어인지가 중요하다.

## 1순위 (주방어): DB 계정 권한

접속 계정에 읽기 권한만 부여하고 `default_transaction_read_only = on`을 설정한다. 데이터베이스가 직접 막아주므로 **우리 코드에 버그가 있어도 뚫리지 않는다.**

## 2순위 (보조): AST 기반 문장 검증

**"SELECT로 시작하면 안전"이라는 단순 문자열 검사는 뚫린다.** 실제 사례:

```sql
WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t;
```

이 쿼리는 `WITH`/`SELECT`로 시작하지만 **실제로 DELETE가 실행된다.** 문자열 앞부분만 보는 검사는 절대 못 잡는다.

그래서 **문자열이 아니라 AST(구문 트리)로 파싱해서 검사한다.** `pgsql-parser` / `libpg-query`가 PostgreSQL 공식 파서를 WASM으로 컴파일한 것이라 정확하다. WASM이라 네이티브 빌드가 필요 없어서 `npm ci --ignore-scripts`와도 궁합이 좋다.

CTE 안에 숨은 DML은 **반드시 차단**해야 한다.

### 추가로 막아야 할 것들

- `SELECT pg_sleep(3600)` — 읽기지만 세션을 점유한다
- 부작용을 일으키는 함수 호출, 특히 `SECURITY DEFINER` 함수 (읽기 전용 계정도 우회 가능)
- `SELECT ... FOR UPDATE` — 쓰기는 아니지만 행 잠금을 건다

## 적용 대상

이 정책은 사용자가 직접 입력한 쿼리와 AI가 생성한 쿼리 **모두**에 동일하게 적용된다. AI가 만든 SQL도 신뢰하지 않는다 — AST 검증기를 통과한 뒤에만 실행 가능하다.

## 리뷰 게이트

🔒 **읽기 전용 강제 구현은 반드시 2명이 리뷰한다.** 뚫리면 제품의 존재 이유가 사라진다.

## 관련

- 담당 STEP: [step-01-db-connection.md](../todo/step-01-db-connection.md)
- [query-safety-limits.md](query-safety-limits.md)
- [internal-vs-user-query-injection.md](internal-vs-user-query-injection.md)
