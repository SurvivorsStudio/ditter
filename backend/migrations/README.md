# 마이그레이션

DITTER 로컬 메타 저장소(SQLite)의 스키마를 만드는 SQL 파일들. 백엔드가 기동할 때
[`runMigrations`](../src/db/migrate.ts)가 번호 순서대로 한 번씩 적용하고, 적용 기록은 같은 DB의
`schema_migrations` 테이블에 남는다.

**여기에 파일을 추가하면 팀원들의 로컬 DB는 알아서 따라온다.** 개발 워처가 이 디렉터리도
감시하므로([scripts/dev-watch.mjs](../scripts/dev-watch.mjs)), 스택을 띄워둔 채 `git pull` 한
사람도 재기동을 기억할 필요 없이 그 자리에서 적용된다 — 적용될 때마다 `[migrate] N개 적용: …`
로그가 남는다. 이 감시는 편의가 아니라 정확성 장치다: 없으면 **옛 스키마 위에서 그대로
개발하게 된다.**

> **대상 PostgreSQL 의 스키마가 아니다.** DITTER 는 대상 DB 를 읽기만 하고 스키마를 만들거나
> 바꾸지 않는다 ([docs/policy/read-only-enforcement.md](../../docs/policy/read-only-enforcement.md)).
> 여기 들어가는 테이블은 [docs/schema](../../docs/schema/README.md) 에 설계된 것들뿐이다.

## 파일 이름

```
NNN_설명.sql        예: 001_create-connections.sql
```

- `NNN` — 세 자리 이상의 번호. 적용 순서를 정한다.
- 설명 — 소문자·숫자·하이픈만.

규칙에 맞지 않는 이름이 있으면 기동이 실패한다. 오타를 조용히 건너뛰면 사람마다 다른 스키마가
되기 때문이다.

## 규칙

1. **이미 커밋된 파일은 고치지 않는다.** 남들은 이미 적용했고 기록이 남아 다시 돌지 않는다.
   바꿔야 하면 새 번호로 파일을 추가한다.
2. **번호를 겹치지 않게 한다.** 겹치면 기동할 때 잡아낸다 — 각자 브랜치에서 같은 번호를 쓰고
   머지한 경우이니, 나중에 만든 쪽의 번호를 뒤로 민다.
3. **한 파일은 한 목적.** 파일 전체가 하나의 트랜잭션으로 적용되거나 통째로 취소된다.
4. `BEGIN`·`COMMIT` 을 파일 안에 쓰지 않는다. 적용하는 쪽이 감싼다.

## 어긋났을 때

로컬 SQLite 파일은 **커밋되지 않고 언제든 버려도 되는 파일이다**(`.gitignore`). 순서가 꼬였다는
에러가 나면 대개 지우고 다시 기동하는 게 정답이다.

```bash
rm -f backend/data/ditter.sqlite*
docker compose restart backend
```

## 현재 상태

**아직 마이그레이션 파일이 없다.** 실행 장치(러너)만 서 있고, 실제 테이블은
[STEP 1](../../docs/todo/step-01a-connection-registry.md)에서 `connections` 부터 들어온다.
