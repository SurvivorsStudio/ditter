---
description: 저장소를 처음 받은 사람의 로컬 개발 환경을 한 번에 세팅한다 — 런타임 확인 · 의존성 설치 · 스택 기동 · health 확인
---

이 저장소를 **처음 클론한 사람**이 개발을 시작할 수 있는 상태까지 한 번에 만든다. 절차와 배경은
[onboarding.md](../../onboarding.md)에 있고, 이 커맨드는 그 「첫 세팅」을 대신 수행한다.

이미 세팅이 끝난 저장소에서 그냥 스택만 띄우고 싶으면 이 커맨드가 아니라 [`/dev`](dev.md)를 쓴다.

## 원칙

- **이미 되어 있는 단계는 건너뛴다.** 이 커맨드는 몇 번 돌려도 같은 결과여야 한다.
- **파괴적인 일은 하지 않는다.** `docker compose down -v`, `.env` 덮어쓰기, `git clean`,
  lockfile 수정은 이 커맨드의 범위가 아니다.
- **`.env`를 읽지 않는다.** 존재 여부만 확인한다 (`docs/policy/credential-management.md`).
- 실패하면 같은 명령을 반복하지 말고 **어디서 왜 막혔는지**를 사용자에게 보고한다.

## 절차

### 1. 위치 확인

- `git rev-parse --show-toplevel` 로 저장소 루트를 확인하고, 이후 명령은 전부 그 경로에서 돈다.
- 루트에 `docker-compose.yml`·`package.json`이 있는지 확인한다. 없으면 다른 저장소다 — 멈추고 보고.

### 2. 준비물 확인 — 없는 것만 알려준다

한 번에 확인한다.

```bash
docker compose version; node -v; git --version; gh --version
```

- **docker 없음** → 이 커맨드로는 진행 불가. Docker Desktop·colima·리눅스 docker 중 하나를 깔라고
  안내하고 멈춘다.
- **node 없음/버전 낮음** → `package.json`의 `engines.node`(>=24)와 `.nvmrc`(26) 기준. 앱은 컨테이너로
  도니까 **치명적이지 않다.** 4단계(호스트 의존성 설치)만 건너뛰고 계속 진행하되, lint·typecheck·
  test가 호스트에서 돈다는 것과 `nvm use`로 맞추면 된다는 것을 보고에 남긴다.
- **gh 없음** → 지금 필요하진 않다. `/pr`·`/pr-merge`에 필요하다고만 보고에 적는다.

### 3. 컨테이너 런타임이 살아 있는지

- `docker compose ps` 로 확인한다.
- 소켓 연결 오류(`failed to connect to the docker API at unix:///…`)면 데몬이 꺼진 것이다.
  `docker context ls` 로 어떤 런타임인지 보고, 그에 맞게 띄운 뒤 다시 확인한다 — colima면
  `colima start`(첫 기동에 수십 초, 백그라운드로 돌리고 기다린다), Docker Desktop이면 앱 실행,
  리눅스면 `systemctl start docker`.

### 4. 호스트 의존성 설치

`node_modules/`가 없거나 비어 있으면 설치한다. 이미 있으면 건너뛴다.

```bash
npm ci --ignore-scripts
```

- **`npm install`을 쓰지 않는다.** lockfile 고정(S2)·설치 스크립트 차단(S5)이 보안 정책이다
  (`docs/policy/supply-chain-security.md`). 이건 앱을 돌리기 위한 게 아니라 에디터 타입 해석과
  호스트에서 도는 lint·typecheck·test를 위한 것이다.
- 실패하면 출력 그대로 보고하고 멈춘다. lockfile을 고치거나 플래그를 빼고 재시도하지 않는다.

### 5. `.env` — 필요할 때만 만든다

`.env`는 **없어도 스택이 그대로 돈다.** compose에 로컬 기본값이 있다. 아래에 해당할 때만 만든다.

- **리눅스인데 `.env`가 없으면** (`uname -s` 가 `Linux`): bind mount uid 불일치로 프런트가 기동조차
  못 할 수 있다. `.env.example`을 복사하고 `DEV_UID`·`DEV_GID`를 `id -u`·`id -g` 값으로 채운 뒤
  주석을 푼다. 무엇을 왜 했는지 보고한다.
- **macOS·Windows**: 만들지 않는다. 포트 충돌이나 호스트 직접 실행이 필요해질 때 사용자가
  `cp .env.example .env` 하면 된다고만 알린다.
- **`.env`가 이미 있으면**: 손대지 않는다. 내용도 읽지 않는다. "이미 있음"만 보고.

### 6. 포트 선점 정리

호스트에서 `npm run dev`로 띄운 서버가 살아 있으면 `:4000`·`:5173`을 두고 컨테이너와 다툰다
(백엔드는 EADDRINUSE, Vite는 조용히 `5174`로 옮겨 뜬다). 있으면 정리한다.

```bash
lsof -ti :5173 -c node -a -sTCP:LISTEN | xargs kill -9 2>/dev/null
lsof -ti :4000 -c node -a -sTCP:LISTEN | xargs kill -9 2>/dev/null
```

- `-a`(AND)와 `-sTCP:LISTEN`을 **반드시** 붙인다. 빼면 무관한 node 프로세스까지 죽는다 — 이유는
  [dev.md](dev.md) 2단계 참고.
- 5432는 건드리지 않는다. 호스트에 다른 PostgreSQL이 떠 있어 충돌하면 죽이지 말고, `.env`의
  `POSTGRES_PORT`를 바꾸라고 안내한다 — 남의 DB일 수 있다.
- 포트만 보고 무조건 죽이지 않는다. 컨테이너가 잡고 있을 때 리스너는 런타임의 포트 포워딩
  프로세스다(colima의 `ssh … [mux]` — 죽이면 docker 연결이 끊긴다). 위 명령은 `-c node`로 겨냥하므로
  안전하다.

### 7. 스택 기동

```bash
docker compose up -d --wait --wait-timeout 300
```

- 첫 기동은 이미지 빌드 때문에 몇 분 걸린다. `--wait-timeout`을 주지 않으면 상한 없이 기다리므로
  반드시 붙인다.
- 이미 떠 있으면 그대로 통과한다.
- 실패하면 반복하지 말고 `docker compose logs <서비스>`를 확인해 원인을 보고한다.

### 8. 확인

- `docker compose ps` — `db`·`backend`·`frontend` 셋 다 `Up`.
- `curl -s http://127.0.0.1:4000/api/health` — 백엔드 직접.
- `curl -s http://127.0.0.1:5173/api/health` — 프런트의 `/api` 프록시를 거쳐 같은 응답. **이게
  되어야 브라우저에서 실제로 동작한다.**
- 헬스체크 200을 **DB 접속 근거로 삼지 않는다.** 지금 백엔드에 DB 접속 코드가 없고
  `/api/health`는 "앱이 떠 있다"만 답한다 (`backend/src/routes/health.ts` 주석).

### 9. DB 확인 — 만들지는 않는다

**DB를 생성하는 단계는 없다.** `postgres` 이미지 엔트리포인트가 `db-data` 볼륨이 비어 있을 때
`initdb`로 DB·유저를 만든다. 7단계가 성공했으면 이미 끝난 일이다.

문제는 **볼륨이 이미 있으면 `initdb`가 건너뛴다**는 것이다. `.env`에서 `POSTGRES_DB`·
`POSTGRES_USER`를 나중에 바꿔도 반영되지 않고, `pg_isready` 헬스체크는 "서버가 살아있나"만 보므로
**그냥 통과한다.** 그래서 설정된 DB가 실제로 있는지 따로 본다.

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -lqt 2>/dev/null | cut -d"|" -f1 | grep -qw "$POSTGRES_DB" && echo OK || echo MISSING'
```

- **컨테이너 안에서 자기 환경변수로** 확인하고 `OK`/`MISSING`만 출력한다. 값을 호스트로 꺼내지
  않는 이유는 자격증명이 대화 기록에 남기 때문이다 (`docs/policy/credential-management.md`).
  같은 이유로 `docker compose config`(비밀번호가 그대로 찍힌다)를 쓰지 않는다.
- `MISSING`이면 **자동으로 고치지 않는다.** 볼륨과 설정이 어긋났다는 사실과, 해결하려면
  `docker compose down -v` 로 **DB 데이터를 지우고** 다시 띄워야 한다는 것을 알리고 사용자
  판단을 받는다. 데이터 삭제는 이 커맨드가 임의로 할 일이 아니다.

### 10. 테이블 — 손으로 맞추지 않는다

- **대상 PostgreSQL**(로컬 `db` 컨테이너)은 DITTER가 조회할 프로덕션 DB의 샌드박스다. DITTER는
  대상 스키마를 **만들지도 바꾸지도 않는다.** 비어 있는 게 정상이므로 시드·DDL을 넣지 않는다.
  데모용 시드는 STEP 5에서 재현성 요건과 함께 들어온다 (`docs/conventions/testing.md`).
- **DITTER 자체 메타 테이블**(SQLite)은 **백엔드가 뜰 때 자동으로 적용된다** —
  `backend/migrations/`의 SQL을 번호 순서대로 돌리고 `schema_migrations`에 기록한다
  (`backend/src/db/migrate.ts`). 7단계가 성공했으면 이미 끝난 일이므로 **여기서 따로 할 일이 없다.**
- 마이그레이션이 어긋나면 **백엔드 컨테이너가 뜨지 못하고**, 7단계의 `--wait`가 실패한다. 그때는
  `docker compose logs backend`에 원인이 그대로 찍힌다. 대개 로컬 DB 파일이 저장소와 어긋난
  것이므로, 사용자에게 아래를 **제안하고 확인받은 뒤** 실행한다 (로컬 데이터를 지우는 일이다).

  ```bash
  rm -f backend/data/ditter.sqlite*
  docker compose restart backend
  ```

- 현재 마이그레이션 파일은 **0개**다. 러너만 서 있고 실제 테이블은 STEP 1에서 들어온다
  (`docs/todo/step-01a-connection-registry.md`).

### 11. 보고

아래를 순서대로 적는다.

1. **각 단계 결과** — 한 줄씩. 건너뛴 단계는 왜 건너뛰었는지(예: "node_modules 이미 있음").
2. **접속 URL** — 매번 적는다.
   - 앱(프런트): http://127.0.0.1:5173
   - 백엔드 헬스체크: http://127.0.0.1:4000/api/health
3. **아직 남은 것** — 2단계에서 빠진 준비물(node 버전, gh 로그인 등).
4. **다음에 할 일**
   - 읽을 것: [onboarding.md](../../onboarding.md) → `docs/todo/README.md` →
     `docs/conventions/README.md` → `docs/policy/README.md`
   - 쓸 커맨드: 스택 다루기는 [`/dev`](dev.md), 커밋은 [`/commit`](commit.md), 리뷰는
     [`/review`](review.md), PR은 [`/pr`](pr.md)
   - main에 직접 push하지 않는다. 브랜치 prefix는 `feature/`·`bug/`·`fix/`만.

**DB 접속 문자열은 보고에 적지 않는다** — 자격증명이 대화 기록에 남는다
(`docs/policy/credential-management.md`). 값이 필요하면 사용자가 직접 `.env`나
`docker-compose.yml`을 열어 확인한다.

## 비고

- Claude Code에는 같은 이름의 기본 `/init`(CLAUDE.md 생성)이 있고, 이 파일이 그것을 가린다. 이
  저장소엔 `CLAUDE.md`가 이미 있어서 기본 동작이 필요 없다.
- Docker 없이 호스트에서 직접 돌리는 경로(README 「호스트에서 직접 돌리기」)는 이 커맨드가 다루지
  않는다. 컨테이너 스택과 **배타적**이라 섞으면 6단계가 경고한 포트 선점 상황이 된다.
