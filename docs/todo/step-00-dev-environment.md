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
| 포트 | 백엔드 4000, 프런트 5173, `/api` 프록시 | |

`npm audit --audit-level=high` 게이트를 통과시키려고 ESLint를 10.x로 올렸다. **이 게이트는 앞으로
의존성을 추가할 때마다 걸린다** — 취약점이 뜨면 우회하지 말고 버전을 올리거나 그 패키지를 안 쓴다.

### 아직 확인 못 한 것

`docker compose up`은 작성만 하고 **실행 검증을 못 했다**(작업 환경에 Docker 미설치). Docker가 있는
팀원이 한 번 돌려보고, 안 뜨면 그 자리에서 고친다. `npm run dev` 경로(백엔드 `:4000` + 프런트
`:5173` + `/api` 프록시 + `/api/health` 응답)는 실제로 확인했다.

## 왜 지금인가

나중에 보안 게이트를 넣으면 이미 설치된 수백 개 의존성을 되짚어야 한다. 처음에 심으면 공짜다.

## 관련 정책

- [supply-chain-security.md](../policy/supply-chain-security.md)
