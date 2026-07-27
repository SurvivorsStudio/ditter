---
description: 백엔드(Fastify) · 프런트(React + Vite) 로컬 개발 서버 + 로컬 PostgreSQL 재시작
---

이 모노레포의 백엔드(Fastify, `:4000`)와 프런트(React + Vite, `:5173`) 개발 서버, 그리고 로컬
PostgreSQL(docker compose)을 재시작합니다.

## 구성

- 모노레포 루트: 저장소 루트(`package.json`에 `dev`/`dev:backend`/`dev:frontend` 스크립트 정의).
- 백엔드: `backend/` — Fastify, `npm run dev --workspace=backend`, 포트 `4000`. 로컬 PostgreSQL에
  접속하므로 DB가 먼저 떠 있어야 정상 동작.
- 프런트: `frontend/` — React + Vite, `npm run dev --workspace=frontend`, 포트 `5173`.
  - 프런트는 `/api/**` 를 `http://localhost:4000` 으로 프록시하므로 백엔드가 떠 있어야 정상 동작.
- DB: 로컬 PostgreSQL은 `docker compose`로 기동한다 ([step-00-dev-environment.md](../../docs/todo/step-00-dev-environment.md) 참고).

## 절차

1. **기존 프로세스 종료**
   - `lsof -ti :5173 | xargs kill -9 2>/dev/null` (프로세스 없으면 무시)
   - `lsof -ti :4000 | xargs kill -9 2>/dev/null` (프로세스 없으면 무시)

2. **로컬 PostgreSQL 확인/기동**
   - `docker compose ps` 로 DB 서비스가 떠 있는지 확인.
   - 안 떠 있으면 `docker compose up -d` 로 기동 (백엔드가 접속할 대상이므로 앱보다 먼저 떠야 함).

3. **개발 서버 기동** (백그라운드)
   - 저장소 루트에서 `npm run dev` 실행.
   - 루트의 `dev` 스크립트가 `concurrently` 로 백엔드·프런트를 함께 띄움.
   - 개별 기동이 필요하면 `npm run dev:backend` / `npm run dev:frontend`.

4. **확인**
   - 몇 초 대기 후 `:5173`·`:4000` 두 포트가 LISTEN 상태인지, 백엔드가 로컬 PostgreSQL에 정상
     접속했는지 확인.
   - 결과 보고.

## 비고

- 두 서버 모두 백그라운드로 실행.
- 테스트: 루트에서 `npm test` 면 전 워크스페이스, 영역만 돌리려면
  `npm test --workspace=backend` / `npm test --workspace=frontend`.
- 위 포트·워크스페이스 이름은 [STEP 0](../../docs/todo/step-00-dev-environment.md)에서 실제로
  그렇게 구성됐다(백엔드 `backend/` `:4000`, 프런트 `frontend/` `:5173`).
- DB만 띄우려면 `docker compose up -d db`. 앱까지 컨테이너로 다 띄우려면 `docker compose up`.
