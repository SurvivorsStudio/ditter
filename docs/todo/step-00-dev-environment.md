# STEP 0 · 개발 환경 만들기

**시작 조건**: 없음. 여기서 시작한다.

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

## F7(파이프라인)이 나중에 요구하는 것

STEP 0은 위 완료 조건으로 **이미 끝났다.** 다시 열지 않는다. 다만 [F7 데이터 파이프라인](../pipeline/README.md)이
합류하면서 개발 환경 전제가 늘었고, 그 차이는 [STEP 9](step-09-pipeline-foundation.md)에서 세운다.
여기 적어 두는 이유는, 위 「이렇게 만들었다」 표를 STEP 0 당시의 기록으로 읽어야 하기 때문이다 —
**지금의 개발 환경 전체가 아니다.**

| STEP 0이 세운 것 | F7이 더 요구하는 것 | 세우는 곳 |
|---|---|---|
| 워크스페이스 `backend`·`frontend`·`packages/shared-types` | `worker/`(BullMQ 워커), `packages/pipeline-connectors` ([project-structure.md](../conventions/project-structure.md)) | STEP 9 |
| compose 서비스 `db`·`backend`·`frontend` | `redis`(잡 큐·진행률·실행 잠금), `worker` ([deployment.md](../pipeline/deployment.md)) | STEP 9 |
| 루트 `.env` 하나 | `REDIS_URL`·`WORKER_CONCURRENCY`·`PIPELINE_SPOOL_DIR`·`PIPELINE_FILE_ROOT` 등 추가 키 | STEP 9 |
| 테스트는 순수 모듈뿐 (DOM은 STEP 2에서 분리) | 워커·커넥터 워크스페이스가 늘면 Vitest 설정을 다시 쪼갠다 | STEP 9~11 |

스케줄러는 별도 프로세스로 만들지 않는다 — BullMQ repeatable job으로 큐 안에서 처리한다
([deployment.md](../pipeline/deployment.md#scheduler를-워커에-합칠-것인가)).

`npm audit --audit-level=high` 게이트는 여기에도 그대로 걸린다. BullMQ·Redis 클라이언트·S3 SDK가
들어올 때 우회하지 않는다.

## 왜 지금인가

나중에 보안 게이트를 넣으면 이미 설치된 수백 개 의존성을 되짚어야 한다. 처음에 심으면 공짜다.

## 관련 정책

- [supply-chain-security.md](../policy/supply-chain-security.md)
