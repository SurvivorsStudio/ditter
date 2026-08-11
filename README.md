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

**절대 안 하는 것**: 사람이 쓴 SQL로 데이터를 수정하지 않는다. 콘솔은 읽기만 한다. 이건 기능
제약이 아니라 위험 자체를 없애는 설계 결정이다 — 도입하는 회사 입장에서 "이 콘솔에는 **읽는
권한만** 주면 된다"가 된다. 운영 관찰(F5)까지 쓰려면 통계 조회 롤(`pg_read_all_stats`)이 하나 더
붙는데, 그것도 읽기 권한이다. 데이터를 바꿀 수 있는 권한은 어느 경우에도 필요 없다.
파이프라인(F7)의 타깃 적재는 자유형 SQL이 닿지 않는 별도 경로이며, 그 경계는
[아래](#파이프라인이-쓰는데도-읽기-전용인-이유)에 정리했다.

## 핵심 기능

| # | 기능 | 한 줄 설명 |
|---|---|---|
| F1 | 웹 SQL 콘솔 (읽기 전용) | 브라우저에서 쿼리 작성·실행, 결과 표시 |
| F2 | AI 쿼리 작성 보조 | 자연어 → SQL, 또는 작성 중인 SQL 개선 |
| F3 | 실행 전 위험 예측 | 실행하기 전에 "이 쿼리 위험합니다" 경고 — **킬러 기능** |
| F4 | EXPLAIN 해석 + 튜닝 제안 | 왜 느린지 설명하고 어떻게 고칠지 제안 |
| F5 | 운영 관찰 | 느린 쿼리 목록, 실행 중인 세션 보기 |
| F6 | 감사 로그 | 누가 언제 무슨 쿼리를 실행했는지 기록 |
| F7 | 데이터 파이프라인 | 드래그앤드롭으로 구성하는 배치 수집·적재 (증분 · 스케줄) |

대상 DB는 PostgreSQL 하나이며, DB 접근 코드는 어댑터 인터페이스로 감싸 멀티 DB 확장을 염두에
두고 있다.

## 데이터 파이프라인 (F7)

한 번 조회하고 끝나는 대신, **그 안전한 쿼리를 그대로 반복 적재로 만든다.** 브라우저 캔버스에서
소스 → 변환 → 타깃을 드래그앤드롭으로 잇고, cron으로 돌리고, 증분(watermark)으로 새 데이터만
가져온다.

F7은 별도 제품이 아니라 F1~F6이 만든 안전 장치(접속 풀, 읽기 전용 강제, 자격증명 암호화, 감사
로그)를 그대로 재사용하는 **실행 모드**다. 설계 전체는 [docs/pipeline](docs/pipeline/README.md)에
있다.

## 안전 설계

읽기 전용은 두 겹으로 강제한다 — **DB 계정 권한(주방어)** + **AST 기반 문장 검증(보조)**. `WITH t
AS (DELETE FROM users RETURNING *) SELECT * FROM t` 같은 CTE 우회도 문자열 검사가 아니라 구문
트리 파싱으로 잡아낸다. 자세한 내용은 [docs/policy](docs/policy/README.md) 참고.

### 파이프라인이 쓰는데도 "읽기 전용"인 이유

F7은 목적 저장소에 쓴다. 그래도 위 주장은 그대로다 — **사람에게 열어주는 SQL 실행 경로는 여전히
읽기 전용 하나뿐이기 때문이다.**

- 커넥션은 `source`(읽기 전용 계정) / `target`(쓰기 계정)으로 나뉘고 **겸할 수 없다.**
- 타깃 커넥션은 **콘솔에서 도달할 수 없다.** 쿼리 실행 API가 거부하고, 접속 목록에도 안 나온다.
- 타깃에 나가는 문장은 커넥터가 만드는 **세 가지(append · upsert · overwrite)뿐**이다. 사용자도
  AI도 자유형 SQL을 넣을 수 없다.
- 타깃 계정에는 지정 스키마의 지정 테이블 권한만 준다. `DROP`도 DDL도 주지 않는다.
- 모든 쓰기는 감사 로그에 남는다.

경계의 전문은 [pipeline-write-boundary.md](docs/policy/pipeline-write-boundary.md) 참고. 콘솔
계정에는 **여전히 읽는 권한만 주면 된다** (F5를 쓸 때 붙는 `pg_read_all_stats`까지 포함해서).

## 기술 스택

TypeScript 모노레포 — React + Vite(프런트엔드), Fastify(백엔드), PostgreSQL(대상 DB),
SQLite(로컬 저장). 파이프라인이 붙으면 여기에 Redis + BullMQ(큐·워커)와
React Flow(캔버스)가 더해진다. 자세한 구조는 [docs/conventions](docs/conventions/README.md) 참고.

```
backend/                  Fastify 백엔드 (:4000)
frontend/                 React + Vite 웹 콘솔 + 파이프라인 캔버스 (:5173)
worker/                   BullMQ 워커 — 파이프라인 실행 (STEP 9~)
packages/shared-types/    프런트·백엔드·워커가 공유하는 타입 (DAG 스펙 포함)
packages/pipeline-connectors/  커넥터 라이브러리 (백엔드·워커 공유)
docs/                     계획·정책·컨벤션·스키마·파이프라인 설계
```

## 시작하기

**앱은 Docker로 돌린다.** PostgreSQL까지 컨테이너 안에 있어서, 호스트에 Node나 PostgreSQL을
따로 깔지 않아도 된다. 처음 합류했다면 [onboarding.md](onboarding.md)에 세팅부터 개발 흐름까지
정리돼 있다.

```bash
docker compose up
```

이거 하나면 세 개가 함께 뜬다.

| 주소 | 무엇 |
|---|---|
| http://127.0.0.1:5173 | 웹 콘솔 (React + Vite) |
| http://127.0.0.1:4000 | 백엔드 API (Fastify) |
| `127.0.0.1:5432` | PostgreSQL — psql·GUI 클라이언트로 붙을 때 쓴다 |

**소스는 bind mount라 고치면 바로 반영된다.** 프런트는 HMR로, 백엔드는 프로세스 재시작으로
붙는다. 이미지를 다시 빌드해야 하는 건 **의존성이 바뀔 때뿐**이다 — 그때는
`docker compose up --build`.

Claude Code에서는 [`/dev`](.claude/commands/dev.md) 커맨드가 위 과정(런타임 확인 → 기동 →
health 확인)을 한 번에 처리한다.

```bash
docker compose logs -f backend   # 로그 보기
docker compose down              # 내리기 (DB 데이터는 남는다)
docker compose down -v           # DB 데이터까지 지우고 처음부터
```

`.env`는 없어도 위 명령이 그대로 돈다 — [docker-compose.yml](docker-compose.yml)에 로컬 기본값이
들어 있다. 포트나 DB 이름을 바꾸고 싶을 때만 `cp .env.example .env` 하면 된다.

**공개 범위**: 컨테이너 포트는 전부 `127.0.0.1`에만 묶여 있어 같은 네트워크의 다른 기기에서
닿지 않는다. compose에 적힌 DB 비밀번호가 저장소에 그대로 있는 고정값이고 인증은 STEP 8에야
붙기 때문이다. 이 구성은 **로컬 개발 전용이며 배포용이 아니다.**

### 호스트에서 직접 돌리기 (선택)

Docker 없이 돌려야 하면 이 경로도 남아 있다. 단 **위 `docker compose up`과 동시에 쓰지 않는다**
— 같은 포트를 두고 다툰다.

```bash
npm ci --ignore-scripts   # 설치 스크립트 차단이 기본이다 (docs/policy/supply-chain-security.md S5)
cp .env.example .env
docker compose up -d db   # DB만 컨테이너로
npm run dev               # 백엔드 :4000 + 프런트 :5173
```

이 경우에도 개발 서버는 기본적으로 내 컴퓨터에서만 접속을 받는다. 같은 네트워크의 다른 기기에서
붙어야 하면 `.env`의 `HOST`(백엔드)와 `VITE_DEV_HOST`(프런트)를 둘 다 열어야 한다 — 프런트만
열어도 `/api` 프록시를 타고 백엔드에 닿기 때문이다. 인증은 STEP 8에야 붙으니 열어둔 채 두지 않는다.

### 그 밖의 명령

아래는 컨테이너 밖에서 도는 검사·빌드다 (CI가 쓰는 것과 같다). `npm ci --ignore-scripts`가 먼저 필요하다.

| 명령 | 하는 일 |
|---|---|
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run typecheck` | 전 워크스페이스 타입 검사 |
| `npm test` | 전 워크스페이스 테스트 (Vitest) |
| `npm run build` | 공유 타입 + 프런트엔드 빌드 |

백엔드는 **빌드하지 않는다.** Node가 타입 표기를 지우며 `.ts`를 그대로 실행한다(Node 24+). 트랜스
파일러 의존성을 하나 줄이려는 선택이며, 그 대가로 백엔드 코드에서는 상대 경로 import에 `.ts`
확장자를 붙인다.

## 진행 상황

**STEP 0(개발 환경) 완료** — 모노레포·CI 보안 게이트가 서 있고, `docker compose up`으로 세
컨테이너가 뜨는 것과 `npm run dev` 양쪽 경로를 실제로 확인했다. 제품 기능은 아직 없다.

다음은 [STEP 1 DB 안전 접속](docs/todo/step-01-db-connection.md)이며 모든 것의 병목이다. 다만
STEP 1을 기다리지 않고 **동시에 시작할 수 있는 작업이 셋 더 있다** — 읽기 전용 AST 검증기,
감사 로그 + 인증, 커넥터 패키지 셋 다 순수 로직이라 DB도 백엔드도 필요 없다
([지금 당장 착수할 것](docs/todo/README.md#지금-당장-착수할-것)).

진행 단계와 완료 조건은 [docs/todo](docs/todo/README.md)에서 추적한다.

## 문서

- [docs/todo](docs/todo/README.md) — 개발 단계(STEP 0~13)와 완료 조건
- [docs/policy](docs/policy/README.md) — 보안·데이터 취급 정책
- [docs/conventions](docs/conventions/README.md) — 개발 언어·코드 컨벤션
- [docs/schema](docs/schema/README.md) — DITTER 로컬 SQLite 테이블 스키마
- [docs/pipeline](docs/pipeline/README.md) — 데이터 파이프라인(F7) 설계

## 라이선스

[MIT](LICENSE)
