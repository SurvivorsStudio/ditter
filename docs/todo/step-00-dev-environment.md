# STEP 0 · 개발 환경 만들기

**시작 조건**: 없음. 여기서 시작한다.

> ⚠️ **스택 결정 변경 (백엔드 → Python)**: 아래 「이렇게 만들었다」는 **백엔드가 TypeScript/Fastify였던
> 시점의 기록**이다. 백엔드·워커를 Python(FastAPI/Celery)으로 바꾸기로 하면서, `backend/` 워크스페이스와
> 관련 CI 단계(빌드 없는 `.ts` 실행, `tsc` typecheck 등)는 **재작업이 필요하다.** 프런트엔드(React
> + Vite)·CI 보안 게이트(S1~S9 원칙)·컨테이너 구성 원칙 자체는 유효하며, 도구만 Python 툴체인
> ([python-style.md](../conventions/python-style.md))으로 바뀐다. 이 기록은 "무엇을 왜 그렇게
> 했는가"의 역사로 남겨 두고 지우지 않는다 — 같은 함정(bind mount와 파일 감시, 포트 바인딩 등)은
> 언어를 바꿔도 그대로 유효하기 때문이다.

## 목표

팀 전원이 같은 바닥 위에서 작업하게 만든다. 아직 제품 기능은 없다.

## 하는 일

- 저장소 세팅, TypeScript 모노레포, 공유 타입 패키지, lint/format
- CI 파이프라인: 빌드·테스트
- **CI에 보안 게이트를 지금 심는다.**
  - `npm ci --ignore-scripts` (악성 설치 스크립트 차단)
  - `npm audit --audit-level=high` (취약 패키지 검사)
  - Dependabot
  - GitHub Actions를 커밋 SHA로 고정 (S9 — 태그는 옮길 수 있어 위 npm 게이트를 우회한다)
- Docker + `docker compose`로 앱과 로컬 PostgreSQL이 함께 뜨게
- 오픈소스 라이선스 선택, 이슈·PR 템플릿

## 완료 조건

`docker compose up` 한 줄로 빈 앱이 뜬다. CI가 초록불이다.

## 이렇게 만들었다

STEP 0에서 실제로 정해진 것들이다. 뒤 STEP은 이 전제 위에서 진행한다.

| 항목 | 결정 | 이유 |
|---|---|---|
| 워크스페이스 | `backend/`, `frontend/`, `packages/shared-types/` | [project-structure.md](../conventions/project-structure.md)의 세 경계 그대로 |
| Node | 26 (`.nvmrc`), `engines: >=24` | 타입 표기 제거 실행이 정식 지원되는 하한이 24 |
| 백엔드 실행 | 빌드 없이 `node backend/src/index.ts` | 트랜스파일러 의존성을 없앤다 (S1). 대신 상대 import에 `.ts` 확장자를 붙인다 |
| 공유 타입 | `tsc`로 `dist` 빌드 후 소비 | Node는 `node_modules` 안의 `.ts`를 실행하지 않는다 |
| 테스트 | Vitest, 루트 설정 하나 | STEP 0 테스트는 순수 모듈뿐. DOM 테스트가 생기면(STEP 2) 워크스페이스별로 쪼갠다 |
| 포매터 | Prettier, `**/*.md` 제외 | 문서는 손으로 맞춘 표·줄바꿈이 많아 diff 소음이 크다 |
| 설치 스크립트 | `.npmrc`에 `ignore-scripts=true` | 로컬 설치를 CI와 같은 조건으로 맞춘다 (S5) |
| CI 액션 | 커밋 SHA로 고정, 버전은 주석 | 태그는 옮길 수 있어 npm 게이트를 우회한다 (S9) |
| 포트 | 백엔드 4000, 프런트 5173, `/api` 프록시 | |
| 개발 서버 바인딩 | 백엔드·프런트 모두 기본 `127.0.0.1` | 인증은 STEP 8에야 붙는다. 네트워크 노출은 기본값이 아니라 `HOST`·`VITE_DEV_HOST` 명시 설정으로만. 값을 비워둔 것(`HOST=`)은 "설정하지 않음"으로 보고 기본값으로 되돌린다 — 빈 문자열을 그대로 넘기면 전 인터페이스에 바인딩된다 |
| 환경변수 출처 | 저장소 루트 `.env` 하나 | 백엔드는 `--env-file-if-exists=../.env`, 프런트는 `vite.config.ts`의 `loadEnv(mode, repoRoot)`로 **같은 파일**을 읽는다. `process.env.VITE_*`로는 `.env` 값이 보이지 않는다(Vite가 넣어주지 않는다). 컨테이너는 compose의 `environment`가 우선 |
| 공유 타입 빌드 시점 | 루트 `dev`·`test`·`build`·`typecheck`가 각자 먼저 빌드 | `dist`는 커밋 대상이 아니고 `npm ci`도 만들지 않는다(`ignore-scripts=true`라 `prepare` 훅도 안 돈다). 새로 clone 한 사람이 순서를 몰라도 되게 스크립트에 넣는다 |
| 컨테이너 실행 계정 | 처음부터 `node` 계정으로 설치·실행 | non-root 실행(S7)을 만족하면서, 설치 후 `chown -R`로 넘길 때 생기는 의존성 레이어 중복(+170MB)을 피한다 |

`npm audit --audit-level=high` 게이트를 통과시키려고 ESLint를 10.x로 올렸다. **이 게이트는 앞으로
의존성을 추가할 때마다 걸린다** — 취약점이 뜨면 우회하지 말고 버전을 올리거나 그 패키지를 안 쓴다.

### 완료 조건을 어떻게 확인했나

macOS + colima(Docker Desktop 대신 쓴 런타임)에서 실제로 돌려 확인했다.

- `docker compose up` → `db`(healthy) · `backend` · `frontend` 세 컨테이너가 뜨고,
  `127.0.0.1:5173`에서 화면이 뜨며 `/api/health`가 프런트 프록시를 거쳐 응답한다.
- 두 컨테이너 모두 `uid=1000(node)`로 실행된다 (S7).
- 공개 포트는 세 개 다 `127.0.0.1:`에 묶여 있어 같은 네트워크의 다른 기기에서는 닿지 않는다
  (LAN IP로 백엔드·프런트·DB 모두 접속 거부 확인).
- `npm run dev` 경로도 동일하게 확인했고, 이때도 두 서버가 루프백에만 바인딩된다.

확인 과정에서 실제로 잡은 것 두 가지 — 컨테이너에서 파일을 root로 설치한 뒤 `node` 계정으로
내려가면 Vite가 설정 번들 임시 파일(`vite.config.ts.timestamp-*.mjs`)을 못 써서 프런트 컨테이너가
기동하자마자 죽었다. 그리고 프런트 dev 서버가 모든 인터페이스에 열려 있어, 백엔드를 루프백으로
좁혀도 `/api` 프록시를 통해 그대로 우회됐다. 둘 다 이 PR에서 고쳤다.

CI 초록불도 확인했다 — 첫 PR([#2](https://github.com/SurvivorsStudio/ditter/pull/2))에서
`build-test` 잡이 38초에 통과했다. Install(`--ignore-scripts`) → Audit(`found 0 vulnerabilities`)
→ Format → Lint → Typecheck → Build → Test → Compose 설정 검증까지 전 단계 성공이다.

## 그 뒤에 바뀐 것 — 로컬 실행은 Docker 하나로 모았다

STEP 0 당시에는 실행 경로가 둘이었다 — `docker compose up`(전체 컨테이너)과 `npm run dev`(DB만
컨테이너, 앱은 호스트). 둘 다 같은 포트를 쓰는데 배타적이라, 섞어 쓰면 백엔드는 EADDRINUSE 로
멈추고 Vite 는 조용히 다른 포트로 옮겨 떠서 **실패가 성공처럼 보였다.**

그래서 **`docker compose up` 하나를 정규 경로로 삼았다.** 위 표의 결정들은 그대로 유효하고,
달라진 것은 다음 셋이다.

| 항목 | 결정 | 이유 |
|---|---|---|
| 소스 반영 | `backend`·`frontend`·`packages` 를 bind mount | 컨테이너 안에서 개발하려면 재빌드 없이 코드가 반영돼야 한다. 이미지 재빌드는 의존성이 바뀔 때만 |
| `node_modules`·`dist` | 익명 볼륨으로 덮어 bind mount 를 가린다 | 호스트의 `node_modules` 는 macOS 바이너리라 리눅스 컨테이너에서 못 쓴다. `dist` 는 호스트에 없거나 낡은 것이 컨테이너 빌드 결과를 가린다 |
| 파일 감시 | 프런트는 Vite `usePolling`, 백엔드는 `backend/scripts/dev-watch.mjs` | **bind mount 는 inotify 이벤트를 컨테이너로 전달하지 않는다.** 파일 내용은 보이는데 이벤트만 안 와서, 저장해도 옛 코드가 계속 돈다. `node --watch` 에는 폴링 옵션이 없어(`--watch-path`·`--watch-kill-signal` 뿐) `fs.watchFile`(stat 폴링) 기반 워처를 직접 뒀다 — 패키지를 늘리지 않으려는 선택이다 ([S1](../policy/supply-chain-security.md)) |

호스트에서 직접 돌리는 경로(`npm run dev`)는 **남겨 두되 선택지로 내렸다.** CI 는 여전히 컨테이너
밖에서 lint·typecheck·test·build 를 돌리므로 그 스크립트들은 그대로 필요하다.

## F7(파이프라인)이 나중에 요구하는 것

STEP 0은 위 완료 조건으로 **이미 끝났다.** 다시 열지 않는다. 다만 [F7 데이터 파이프라인](../pipeline/README.md)이
합류하면서 개발 환경 전제가 늘었고, 그 차이는 [STEP 9](step-09-pipeline-foundation.md)~[11](step-11-pipeline-operations.md)에서 세운다.
여기 적어 두는 이유는, 위 「이렇게 만들었다」 표를 STEP 0 당시의 기록으로 읽어야 하기 때문이다 —
**지금의 개발 환경 전체가 아니다.**

| STEP 0이 세운 것(재작업 대상) | F7이 더 요구하는 것 | 세우는 곳 |
|---|---|---|
| 워크스페이스 `backend`·`frontend`·`packages/` | `worker/`(Celery 워커), `packages/pipeline-connectors` ([구조 트리](../../README.md#기술-스택), [connector-contract.md](../pipeline/connector-contract.md)) | STEP 9 |
| compose 서비스 `db`·`backend`·`frontend` | `redis`(큐·진행률·실행 잠금), `worker` ([deployment.md](../pipeline/deployment.md)) | STEP 11 |
| 루트 `.env` 하나 | `REDIS_URL` | STEP 9 |
| 루트 `.env` 하나 (이어서) | `WORKER_CONCURRENCY`·`PIPELINE_SPOOL_DIR`·`PIPELINE_FILE_ROOT` 등 추가 키 | STEP 11 |
| 테스트는 순수 모듈뿐 (DOM은 STEP 2에서 분리) | 워커·커넥터 앱이 늘면 pytest 설정을 다시 쪼갠다 | STEP 9~11 |

경계는 **배선은 STEP 9, 컨테이너화·운영 하드닝은 STEP 11**이다 — compose 서비스와
`WORKER_CONCURRENCY`·`PIPELINE_SPOOL_DIR`·`PIPELINE_FILE_ROOT`는
[STEP 11](step-11-pipeline-operations.md)의 「운영 배선」이 소유한다. 다만 **Redis 자체는 STEP 9
완료 조건 3(같은 파이프라인을 동시에 두 번 트리거하면 두 번째가 거절된다)을 확인하는 데
필요하므로, 컨테이너로 묶기 전에도 로컬에서 띄울 수 있어야 한다.**

스케줄러는 별도 프로세스로 만들지 않는다 — **`celery worker -B`(beat 내장)로 워커 프로세스
안에서 처리한다** ([deployment.md](../pipeline/deployment.md#scheduler를-워커에-합칠-것인가)).

`pip-audit`(또는 동급) 게이트는 여기에도 그대로 걸린다. Celery·Redis 클라이언트·boto3가
들어올 때 우회하지 않는다.

## 왜 지금인가

나중에 보안 게이트를 넣으면 이미 설치된 수백 개 의존성을 되짚어야 한다. 처음에 심으면 공짜다.

## 관련 정책

- [supply-chain-security.md](../policy/supply-chain-security.md)
