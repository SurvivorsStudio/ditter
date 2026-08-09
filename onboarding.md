# 온보딩

처음 ditter를 세팅하는 사람을 위한 문서. **로컬에 띄우는 법 → 자주 쓰는 명령 → 어떻게 개발하는지**
순서로 읽으면 된다. 제품이 무엇인지는 [README](README.md)에 있다.

> **한 줄 요약**: `docker compose up` 하나면 DB까지 다 뜬다. 호스트에 PostgreSQL이나 Node를
> 깔지 않아도 된다.

---

## 1. 준비물

| 필요한 것 | 왜 | 확인 |
|---|---|---|
| **Docker** (Docker Desktop · colima · 리눅스 docker 아무거나) | 앱과 DB가 전부 컨테이너로 돈다 | `docker compose version` |
| **Node 26** (`.nvmrc`) | 앱을 돌리는 데는 필요 없다. lint·typecheck·test를 **호스트에서** 돌릴 때 쓴다 (CI와 같은 경로) | `node -v` |
| **git** | — | `git --version` |
| **gh** (GitHub CLI) | PR을 만들고 머지할 때 (`/pr`, `/pr-merge`) | `gh auth status` |

Node는 `nvm use`(또는 `fnm use`)면 `.nvmrc`의 버전으로 맞춰진다.

---

## 2. 첫 세팅

### 가장 빠른 길 — Claude Code를 쓴다면

```
/init
```

이 커맨드 하나가 아래 절차(런타임 확인 → 의존성 설치 → 스택 기동 → health 확인)를 전부 대신하고,
막히면 어디서 막혔는지 알려준다. 자세한 절차는 [.claude/commands/init.md](.claude/commands/init.md).

### 손으로 하기

```bash
git clone https://github.com/SurvivorsStudio/ditter.git
cd ditter
docker compose up
```

이게 전부다. 세 개가 함께 뜬다.

| 주소 | 무엇 |
|---|---|
| http://127.0.0.1:5173 | 웹 콘솔 (React + Vite) |
| http://127.0.0.1:4000/api/health | 백엔드 API (Fastify) |
| `127.0.0.1:5432` | PostgreSQL — psql·GUI 클라이언트로 붙을 때 |

이어서 **호스트에도 의존성을 한 번 깔아둔다.** 앱을 돌리는 데는 필요 없지만, 에디터의 타입 해석과
`npm test`·`npm run lint` 같은 검사가 컨테이너 밖에서 돌기 때문이다.

```bash
npm ci --ignore-scripts
```

> `npm install`을 쓰지 않는다. lockfile 고정(S2)과 설치 스크립트 차단(S5)이 보안 정책이다 —
> [docs/policy/supply-chain-security.md](docs/policy/supply-chain-security.md). `.npmrc`에
> `ignore-scripts=true`가 박혀 있어서 플래그를 빼먹어도 로컬은 같은 조건으로 깔린다.

### `.env`는 필요할 때만

**없어도 그냥 돈다.** [docker-compose.yml](docker-compose.yml)에 로컬 기본값이 들어 있다.
아래 셋 중 하나일 때만 `cp .env.example .env` 한다.

1. 기본 포트(5173·4000·5432)나 DB 이름이 다른 것과 겹칠 때
2. Docker 없이 호스트에서 직접 돌릴 때 (아래 5-B)
3. **리눅스**에서 컨테이너가 bind mount에 쓰지 못할 때 → `DEV_UID=$(id -u)`, `DEV_GID=$(id -g)`

`.env`는 커밋하지 않는다 ([docs/policy/credential-management.md](docs/policy/credential-management.md)).

### 확인

```bash
curl -s http://127.0.0.1:4000/api/health   # 백엔드 직접
curl -s http://127.0.0.1:5173/api/health   # 프런트의 /api 프록시를 거쳐서 — 이게 돼야 브라우저에서 동작한다
```

두 번째까지 200이면 세팅 끝이다.

---

## 3. DB는 어떻게 되는가

세팅할 때 가장 많이 나오는 질문이라 따로 뺀다. **DB를 손으로 만들 일은 없다.**

### PostgreSQL 컨테이너 — 자동으로 만들어진다

`docker compose up` 하면 `postgres:17-alpine` 엔트리포인트가 `db-data` 볼륨이 비어 있을 때
`initdb`를 돌려 **DB·유저·비밀번호를 그 자리에서 만든다** (`POSTGRES_DB`·`POSTGRES_USER`·
`POSTGRES_PASSWORD`, 기본값은 [docker-compose.yml](docker-compose.yml)에 있다). `createdb`를
치거나 스크립트를 돌릴 필요가 없다.

> **⚠️ 딱 한 번만 돈다.** 볼륨이 이미 있으면 `initdb`는 건너뛴다. 그래서 `.env`에서
> `POSTGRES_DB`·`POSTGRES_USER`·`POSTGRES_PASSWORD`를 **나중에 바꿔도 기존 볼륨에는 반영되지
> 않는다.** 더 나쁜 건 `pg_isready` 헬스체크가 "서버가 살아있나"만 보기 때문에 **그냥
> 통과한다는 것** — 실패는 한참 뒤 접속 단계에서 엉뚱한 모습으로 터진다. 값을 바꿨으면
> `docker compose down -v` 로 볼륨을 지우고 다시 띄운다.

### 이 DB는 "대상 DB" 자리다 — 비어 있는 게 정상이다

로컬 `db` 컨테이너는 DITTER가 **조회할 프로덕션 PostgreSQL을 흉내 내는 샌드박스**다. DITTER는
대상 DB의 스키마를 **만들지도 바꾸지도 않는다 — 읽기만 한다.** 그러니 테이블이 하나도 없는 게
정상이고, 조회해볼 데이터가 필요하면 각자 psql로 넣으면 된다.

```bash
docker compose exec db psql -U ditter -d ditter_dev
```

공용 시드 데이터는 **지금 넣지 않는다.** 데모용 시드는 [STEP 5](docs/todo/step-05-risk-prediction.md)에서
재현성 요건(생성 스크립트 · 사전 ANALYZE · 시드 고정)과 함께 들어온다
([testing.md 「시드 데이터 재현성」](docs/conventions/testing.md)) — 그때까지는 각자 필요한 만큼만
넣어 쓴다.

### DITTER 자체 테이블(SQLite)은 기동할 때 자동으로 맞춰진다

`users`·`connections`·`audit_logs`·`pipelines` 같은 **DITTER의 메타 테이블**
([docs/schema](docs/schema/README.md))은 로컬 SQLite 파일에 들어간다. 이걸 팀원끼리 맞추는 장치는
하나뿐이다 — **백엔드가 뜰 때 [backend/migrations/](backend/migrations/README.md)의 SQL을 번호
순서대로 적용한다.**

```
backend/migrations/001_create-connections.sql   ← 저장소에 커밋된다 (공유되는 것)
backend/data/ditter.sqlite                      ← 각자의 로컬 파일 (gitignore, 버려도 됨)
```

- **받아올 게 없다.** `git pull` 하면 끝이다. 스택을 띄워둔 채여도 개발 워처가 새 `.sql`을 보고
  백엔드를 다시 띄우면서 적용한다 — 재기동을 기억할 필요가 없다. 적용 기록은 같은 DB의
  `schema_migrations` 테이블에 남아 두 번 돌지 않는다.

  ```
  [dev-watch] 변경 감지 — 백엔드를 다시 띄운다
  [migrate] 1개 적용: 001_create-connections.sql
  ```

  이 두 줄이 `docker compose logs -f backend`에 보이면 내 DB가 최신이 된 것이다. **남의
  마이그레이션이 조용히 반영되는 일은 없다** — 적용될 때마다 로그가 남는다.
- **손으로 칠 DDL도 없다.** 스키마를 바꾸려면 `backend/migrations/`에 **새 번호로 파일을
  추가한다.** 이미 커밋된 파일은 고치지 않는다 — 남들은 이미 적용해서 다시 돌지 않는다.
- **어긋나면 기동이 멈춘다.** 번호가 겹치거나(각자 브랜치에서 같은 번호를 쓰고 머지한 경우),
  머지로 앞 번호가 끼어들었거나, 내 DB가 저장소보다 앞서 있으면(최신 브랜치에서 띄워본 뒤 예전
  브랜치로 돌아온 경우) 에러와 함께 멈춘다. 애매하게 굴러가는 것보다 낫다.

  이때 **컨테이너는 살아 있고 백엔드 프로세스만 죽는다.** `docker compose ps`가 한동안 `healthy`로
  보일 수 있으니(헬스체크가 실패로 넘어가는 데 시간이 걸린다), 판단 기준은 **로그**와 API가
  응답하지 않는다는 사실이다.

  ```
  Error: 로컬 DB 가 저장소보다 앞서 있습니다 (적용됐지만 파일이 없음: 001_....sql).
         브랜치를 확인하거나, 로컬 DB 파일을 지우고 다시 기동하세요.
  ```

로컬 DB 파일은 **언제든 버려도 된다.** 꼬였다는 에러가 나면 대개 이게 정답이다.

```bash
rm -f backend/data/ditter.sqlite*
docker compose restart backend
```

> **지금은 마이그레이션 파일이 0개다.** 러너만 서 있고 실제 테이블은
> [STEP 1](docs/todo/step-01a-connection-registry.md)에서 `connections`부터 들어온다. 그래서
> 현재 팀원 간 테이블 상황은 전부 비어 있어 자동으로 일치한다.

외부 마이그레이션 도구를 쓰지 않고 Node 내장 `node:sqlite`로 직접 돌린다
([backend/src/db/migrate.ts](backend/src/db/migrate.ts)) — 백엔드를 빌드 없이 실행하는 것과 같은
이유로 의존성을 늘리지 않는다.

---

## 4. 자주 쓰는 명령

### 스택 다루기

```bash
docker compose up -d --wait    # 백그라운드로 띄우고 health 통과까지 대기
docker compose ps              # 세 서비스 상태
docker compose logs -f backend # 로그 (frontend · db 도 같은 식)
docker compose restart backend # 특정 서비스만 재시작
docker compose down            # 내리기 (DB 데이터는 남는다)
docker compose down -v         # DB 데이터까지 지우고 처음부터
docker compose up --build      # 의존성이 바뀌었을 때만
```

### 검사·빌드 (호스트에서, CI와 같은 것)

```bash
npm run lint          # ESLint
npm run format        # Prettier 적용 (CI는 format:check 로 검사만)
npm run typecheck     # 전 워크스페이스 타입 검사
npm test              # 전 워크스페이스 테스트 (Vitest)
npm run build         # 공유 타입 + 프런트엔드 빌드
```

영역만 돌리려면 `npm test --workspace=backend` / `--workspace=frontend`.

### Claude Code 커맨드

| 커맨드 | 하는 일 |
|---|---|
| [`/init`](.claude/commands/init.md) | **처음 한 번** — 런타임 확인 · 의존성 설치 · 스택 기동 · health 확인 |
| [`/dev`](.claude/commands/dev.md) | 개발 스택 기동·재시작 (포트 선점 정리까지) |
| [`/commit`](.claude/commands/commit.md) | 작업 트리 변경을 **영역별로 쪼개서** 커밋 (push·PR은 안 함) |
| [`/review`](.claude/commands/review.md) | 현재 diff를 reviewer 서브에이전트로 검토 |
| [`/pr`](.claude/commands/pr.md) | feature 브랜치 확보 → 커밋 → 테스트 → 리뷰 게이트 → push → PR |
| [`/pr-merge`](.claude/commands/pr-merge.md) | 게이트 통과 시 squash 머지 + 브랜치 정리 |
| [`/done`](.claude/commands/done.md) | 세션 작업 기록을 `.done/`에 남김 (로컬 전용) |

`/pr`의 push는 `.claude/hooks/pr-review-gate.sh`가 막고 있다 — **지금 push하려는 HEAD가 리뷰를
거쳤는지** 확인하고, 안 거쳤으면 push가 안 된다. 이건 우회하는 게 아니라 `/review`를 돌려서 푼다.

---

## 5. 어떻게 개발하는가

### A. 고치면 바로 반영된다

소스는 bind mount라 호스트에서 고치면 컨테이너에 그대로 들어간다.

- **프런트엔드** — Vite HMR. 저장하면 브라우저가 갱신된다.
- **백엔드** — 프로세스 재시작 (`backend/scripts/dev-watch.mjs`).
- **공유 타입(`packages/shared-types`)** — 여기만 예외다. `dist` 빌드가 **기동할 때 한 번만**
  돌기 때문에, 고쳤으면 `docker compose restart backend frontend`를 해야 한다.

**이미지를 다시 빌드해야 하는 건 의존성이 바뀔 때뿐이다** — `package.json`·`package-lock.json`·
`Dockerfile`. 소스만 고쳤으면 `--build`를 붙이지 않는다 (몇 분 날린다).

### B. Docker 없이 돌리기 (선택)

이 경로도 살아 있다. 단 **컨테이너 스택과 동시에 쓰지 않는다** — 같은 포트를 두고 다툰다.

```bash
npm ci --ignore-scripts
cp .env.example .env
docker compose up -d db    # DB만 컨테이너로
npm run dev                # 백엔드 :4000 + 프런트 :5173
```

### C. 백엔드는 빌드하지 않는다

Node가 타입 표기를 지우며 `.ts`를 그대로 실행한다(Node 24+). 트랜스파일러 의존성을 하나 줄이려는
선택이고, 그 대가로 **백엔드 코드에서는 상대 경로 import에 `.ts` 확장자를 붙인다.**

```ts
import { buildContext } from './context/builder.ts'; //  백엔드
```

### D. 브랜치 · 커밋 · PR

전문은 [docs/conventions/commit-convention.md](docs/conventions/commit-convention.md).

- **main에 직접 push하지 않는다.** 브랜치는 항상 prefix를 붙인다 — `feature/`·`bug/`·`fix/`만
  쓰고, prefix 없는 맨 이름은 만들지 않는다.
- **커밋 1차 분할(필수)**: 한 커밋에 `frontend/` · `backend/` · `worker/` · `packages/` · `docs/`
  **중 하나의 영역만** 담는다. 경로가 둘 이상에 걸치면 **커밋을 나눈다.** 공유 타입을 고치면서
  소비 측도 고쳤다면 **타입 커밋(`packages/`)이 먼저** 간다.
- **커밋 메시지**: `<타입>: <제목>` + 빈 줄 + `-` 글머리 본문. 타입은 `fix` `feat` `docs` `build`
  `refactor` `test` `chore`. 제목은 한글 50자 이내, 현재형.
- **머지는 squash 고정.** main 히스토리엔 PR당 한 커밋만 남는다. 그래도 브랜치 안에서는 의미
  단위로 쪼갠다 — 리뷰어가 따라갈 수 있어야 하니까.
- 머지 후 브랜치는 원격·로컬 모두 삭제한다.

`/commit`과 `/pr`이 이 규칙대로 처리하므로, 헷갈리면 그냥 그 커맨드를 쓰면 된다.

### E. 문서를 같이 고친다

이 저장소는 **문서가 결정을 담는다.** 대화나 코드에서 정책·설계가 바뀌면 그 자리에서 결정만 내리고
넘어가지 않고, 관련 문서(`docs/policy`, 필요하면 `docs/todo`·`docs/conventions`·`docs/schema`·
`docs/pipeline`)를 그 결정에 맞게 갱신한다. 문서와 대화가 다르면 **문서 쪽을 최신 결정에 맞게
고친다.**

### F. 절대 흐리면 안 되는 경계

**DITTER는 읽기 전용이다.** 파이프라인(F7)이 타깃에 쓰기 때문에 이 경계가 흐려지기 쉬운데,
흐려지는 순간 제품의 존재 이유가 사라진다.

- 사람에게 열리는 SQL 실행 경로는 **읽기 전용 하나뿐**이다.
- 커넥션은 `source`/`target`으로 역할이 나뉘고 **겸할 수 없다.** 타깃은 콘솔에서 도달 불가.
- 타깃에 나가는 문장은 커넥터가 만드는 **세 가지(append/upsert/overwrite)뿐**이다. 사용자도 AI도
  자유형 SQL을 넣을 수 없다.

파이프라인 관련 코드·문서를 건드리기 전에
[docs/policy/pipeline-write-boundary.md](docs/policy/pipeline-write-boundary.md)를 먼저 읽는다.

### G. 자격증명은 저장소에 넣지 않는다

`.env`는 커밋 대상이 아니고, DB 접속 문자열을 이슈·PR·대화 기록에 붙여넣지 않는다. compose에 적힌
비밀번호는 **로컬 전용 고정값**이라 그렇게 두는 것이고, 그래서 컨테이너 포트가 전부 `127.0.0.1`에만
묶여 있다. 이 구성은 배포용이 아니다.

---

## 6. 처음 읽을 문서 순서

1. [README](README.md) — 제품이 무엇이고 왜 필요한가
2. [docs/todo/README.md](docs/todo/README.md) — 개발 단계(STEP 0~13), 데모 시나리오, **지금 뭘
   해야 하는지**
3. [docs/conventions/README.md](docs/conventions/README.md) — 코드 컨벤션 (특히
   [typescript-style](docs/conventions/typescript-style.md) ·
   [project-structure](docs/conventions/project-structure.md) ·
   [testing](docs/conventions/testing.md))
4. [docs/policy/README.md](docs/policy/README.md) — 보안·데이터 취급 정책. **컨벤션과 정책이
   충돌하면 정책이 이긴다.**
5. 파이프라인을 만질 거라면 [docs/pipeline/README.md](docs/pipeline/README.md)

**현재 위치**: STEP 0(개발 환경)까지 끝났고 제품 기능은 아직 없다. 다음은
[STEP 1 DB 안전 접속](docs/todo/step-01-db-connection.md)인데, 이걸 기다리지 않고 **동시에 시작할 수
있는 작업이 셋** 더 있다 (읽기 전용 AST 검증기 · 감사 로그 + 인증 · 커넥터 패키지 — 전부 순수
로직이라 DB도 백엔드도 필요 없다). 목록은
[지금 당장 착수할 것](docs/todo/README.md#지금-당장-착수할-것).

---

## 7. 막혔을 때

| 증상 | 원인과 해결 |
|---|---|
| `failed to connect to the docker API at unix:///…` | 도커 데몬이 꺼져 있다. colima면 `colima start`(첫 기동 수십 초), Docker Desktop이면 앱 실행, 리눅스면 `systemctl start docker`. 어느 쪽인지는 `docker context ls`. |
| 프런트가 `5173`이 아니라 **`5174`**에 떴다 | 호스트에서 `npm run dev`로 띄운 서버가 포트를 잡고 있다. 컨테이너와 호스트 경로를 **동시에 쓰지 않는다.** 하나를 내린다. |
| 백엔드가 `EADDRINUSE` | 같은 이유. `lsof -ti :4000 -c node -a -sTCP:LISTEN \| xargs kill -9` (플래그를 빼먹으면 무관한 node 프로세스까지 죽는다 — [`/dev`](.claude/commands/dev.md) 2단계 참고). |
| **리눅스**에서 프런트·백엔드 컨테이너가 기동조차 못 함 | bind mount uid 불일치. 프런트는 Vite가 설정 임시 파일을 쓰고, 백엔드는 로컬 SQLite를 담을 `backend/data/`를 직접 만든다 — 둘 다 bind mount 안이라 쓰기가 막히면 기동 자체가 안 된다. `DEV_UID=$(id -u) DEV_GID=$(id -g) docker compose up` 또는 `.env`에 박아둔다. macOS·Windows는 보통 필요 없다. |
| 타입을 고쳤는데 반영이 안 됨 | `packages/shared-types`의 `dist` 빌드는 기동 시 1회만 돈다. `docker compose restart backend frontend`. |
| 소스를 고쳤는데 서버가 옛 코드를 돌린다 | 컨테이너는 폴링 워처를 쓴다(`dev:poll`). 그래도 안 붙으면 해당 서비스만 restart. |
| `.env`에서 `POSTGRES_DB`·`POSTGRES_USER`를 바꿨는데 안 먹는다 | `initdb`는 볼륨이 빌 때 한 번만 돈다. 헬스체크는 통과하니 더 헷갈린다. `docker compose down -v` 후 재기동 (3절 참고). |
| `psql`로 붙었는데 테이블이 없다 | 정상이다. 로컬 `db`는 **대상 DB 샌드박스**이고 DITTER는 대상 스키마를 만들지 않는다. DITTER 자체 메타 테이블(SQLite)은 STEP 1부터 생긴다. |
| DB를 처음부터 다시 | `docker compose down -v` (볼륨 `db-data`까지 삭제). |
| `npm ci`가 이상하게 오래 걸리거나 실패 | `npm install`을 쓰지 않았는지 확인. lockfile은 `npm ci`로만 다룬다. |
| CI만 빨간불 | CI가 도는 순서를 그대로 로컬에서: `npm ci --ignore-scripts` → `npm audit --audit-level=high` → `npm run format:check` → `npm run lint` → `npm run typecheck` → `npm run build` → `npm test` → `docker compose config -q`. |

`/api/health`가 200이라고 **DB에 붙었다는 뜻은 아니다.** 지금 백엔드에는 DB 접속 코드가 없고,
헬스체크는 "앱이 떠 있다"만 답한다 ([backend/src/routes/health.ts](backend/src/routes/health.ts)).
DB 연결 확인은 STEP 1 이후에 생긴다.
