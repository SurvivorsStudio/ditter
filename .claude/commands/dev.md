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

1. **기존 개발 서버 종료**
   - 먼저 앱 컨테이너를 내린다: `docker compose stop backend frontend`
     - `docker-compose.yml` 의 `backend`·`frontend` 는 `127.0.0.1:4000`·`127.0.0.1:5173` 을
       바인딩한다. 떠 있으면 3단계의 호스트 개발 서버와 같은 포트를 두고 다툰다.
     - docker 가 안 떠 있어 이 명령이 실패해도 무시하고 넘어간다 (2단계에서 처리한다).
   - 그다음 **호스트에서 직접 띄운 개발 서버만** 종료한다:
     - `lsof -ti :5173 -c node -a | xargs kill -9 2>/dev/null` (없으면 무시)
     - `lsof -ti :4000 -c node -a | xargs kill -9 2>/dev/null` (없으면 무시)
     - `-a` 를 빼면 lsof 가 두 조건을 **OR** 로 묶어 **모든 node 프로세스**를 반환한다 — 무관한
       프로세스까지 죽으므로 반드시 붙인다.
   - **포트만 보고 무조건 죽이지 않는다.** 컨테이너가 그 포트를 잡고 있을 때 리스너는 앱이 아니라
     컨테이너 런타임의 포트 포워딩 프로세스다. colima 라면 단일 `ssh … [mux]` 프로세스가 docker
     소켓과 DB 포워딩까지 함께 담당하므로, 이걸 죽이면 docker 연결 자체가 끊긴다.

2. **로컬 PostgreSQL 확인/기동**
   - `docker compose ps` 로 DB 서비스가 떠 있는지 확인.
   - 소켓 연결 오류(`failed to connect to the docker API at unix:///…`)가 나면 Docker 데몬이 꺼진
     것이다. 쓰는 런타임에 맞게 띄운 뒤 다시 확인한다 — colima 면 `colima start`, Docker Desktop
     이면 앱 실행, 리눅스면 `systemctl start docker`. 어느 쪽인지는 `docker context ls` 로 확인한다.
   - `docker compose up -d --wait --wait-timeout 120 db` 로 기동한다 (이미 떠 있으면 그대로
     통과하므로 무조건 실행해도 된다). `--wait` 가 healthy 가 될 때까지 대기하므로 별도 폴링이
     필요 없다. `--wait-timeout` 을 주지 않으면 상한 없이 기다리므로 반드시 붙인다.
     - **서비스 이름 `db` 를 반드시 붙인다.** 이름 없이 `docker compose up -d` 하면 `backend`·
       `frontend` 컨테이너까지 떠서 `4000`·`5173` 을 선점한다. 그러면 3단계에서 백엔드는
       EADDRINUSE 로 죽지만 프런트(Vite)는 `strictPort` 가 없어 조용히 `5174` 로 옮겨 뜬다 —
       루트 `dev` 스크립트에 `--kill-others` 도 없어서, 겉보기엔 `npm run dev` 가 살아있는 것처럼
       보인다. 4단계 확인도 컨테이너 응답으로 통과해 실패가 그대로 가려진다.
     - DB 는 백엔드가 접속할 대상이므로 앱보다 먼저 떠야 한다.
   - 대기가 실패하면 반복하지 말고 `docker compose logs db` 를 확인해 보고한다.

3. **개발 서버 기동** (백그라운드)
   - 저장소 루트에서 `npm run dev` 실행.
   - 루트의 `dev` 스크립트가 `concurrently` 로 백엔드·프런트를 함께 띄움.
   - 개별 기동이 필요하면 `npm run dev:backend` / `npm run dev:frontend`.

4. **확인**
   - 몇 초 대기 후 `:5173`·`:4000` 두 포트가 LISTEN 상태인지 확인. 이때 **리스너가 호스트 개발
     서버(node)인지** 함께 본다(`lsof -nP -iTCP:5173 -sTCP:LISTEN`) — 컨테이너가 잡고 있어도
     포트는 LISTEN 이라 그냥 보면 구분되지 않는다.
   - 백엔드의 DB 접속 상태 확인은 **STEP 1 이후**에 넣는다. 지금 백엔드에는 DB 접속 코드가 없고,
     `/api/health` 는 "앱이 떠 있다"만 답한다([health.ts](../../backend/src/routes/health.ts) 주석 참고) —
     헬스체크 200 을 DB 접속 근거로 삼지 않는다.
   - 결과 보고. **이때 접속 URL을 항상 함께 제공한다** — 아래 두 개는 매번 적는다.
     - 앱(프런트): http://127.0.0.1:5173
     - 백엔드 헬스체크: http://127.0.0.1:4000/api/health
   - 포트를 바꿔 띄웠거나 Vite 가 다른 포트를 잡았다면, 실제로 뜬 포트를 보고 URL 을 고쳐 적는다.
   - DB 접속 문자열은 보고에 적지 않는다 — 자격증명이 대화 기록에 남는다
     (`docs/policy/credential-management.md`). 값이 필요하면 **사용자가 직접** `.env` 를 열어
     확인한다. 에이전트는 `.env` 를 읽지 않는다.

## 비고

- 두 서버 모두 백그라운드로 실행.
- 테스트: 루트에서 `npm test` 면 전 워크스페이스, 영역만 돌리려면
  `npm test --workspace=backend` / `npm test --workspace=frontend`.
- 위 포트·워크스페이스 이름은 [STEP 0](../../docs/todo/step-00-dev-environment.md)에서 실제로
  그렇게 구성됐다(백엔드 `backend/` `:4000`, 프런트 `frontend/` `:5173`).
- 앱까지 컨테이너로 다 띄우려면 `docker compose up`. 단 이건 **위 절차와 배타적인 별개 모드**다 —
  이 경우 3단계 `npm run dev` 는 하지 않는다. 둘을 섞으면 위 2단계가 경고한 포트 선점 상황이 된다.
- 이 커맨드는 특정 컨테이너 런타임을 전제하지 않는다. colima·Docker Desktop·리눅스 docker 모두
  `docker compose` 명령은 동일하고, 데몬을 띄우는 방법만 2단계처럼 런타임별로 다르다.
