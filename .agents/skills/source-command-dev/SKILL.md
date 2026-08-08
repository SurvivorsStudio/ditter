---
name: "source-command-dev"
description: "로컬 개발 스택(PostgreSQL + 백엔드 + 프런트) 을 docker compose 로 기동·재시작"
---

# source-command-dev

Use this skill when the user asks to run the migrated source command `dev`.

## Command Template

이 모노레포의 로컬 개발 스택을 컨테이너로 띄웁니다 — PostgreSQL, 백엔드(Fastify `:4000`),
프런트(React + Vite `:5173`).

## 구성

- **앱은 Docker 로 돈다.** [docker-compose.yml](../../../docker-compose.yml) 의 `db`·`backend`·
  `frontend` 세 서비스이며, 공개 포트는 전부 `127.0.0.1` 에만 묶인다.
- 소스는 bind mount 다. 호스트에서 고치면 컨테이너에 그대로 반영된다 — 프런트는 HMR,
  백엔드는 프로세스 재시작(`backend/scripts/dev-watch.mjs`).
- **이미지 재빌드가 필요한 경우는 의존성이 바뀔 때뿐이다** (`package.json`·`package-lock.json`·
  `Dockerfile`). 소스만 고쳤으면 재빌드하지 않는다.

## 절차

1. **컨테이너 런타임 확인**
   - `docker compose ps` 로 확인한다.
   - 소켓 연결 오류(`failed to connect to the docker API at unix:///…`)가 나면 데몬이 꺼진
     것이다. 쓰는 런타임에 맞게 띄운 뒤 다시 확인한다 — colima 면 `colima start`, Docker Desktop
     이면 앱 실행, 리눅스면 `systemctl start docker`. 어느 쪽인지는 `docker context ls` 로 확인한다.
   - `colima start` 는 첫 기동에 수십 초가 걸린다. 백그라운드로 돌리고 기다린다.

2. **호스트 개발 서버가 떠 있으면 먼저 내린다**
   - 호스트에서 `npm run dev` 로 띄운 서버가 살아 있으면 `:4000`·`:5173` 을 두고 컨테이너와
     다툰다. 그러면 백엔드는 EADDRINUSE 를 내고 프런트(Vite)는 조용히 `5174` 로 옮겨 뜬다.
   - `lsof -ti :5173 -c node -a -sTCP:LISTEN | xargs kill -9 2>/dev/null` (없으면 무시)
   - `lsof -ti :4000 -c node -a -sTCP:LISTEN | xargs kill -9 2>/dev/null` (없으면 무시)
     - `-a` 를 빼면 lsof 가 두 조건을 **OR** 로 묶어 **모든 node 프로세스**를 반환한다 — 무관한
       프로세스까지 죽으므로 반드시 붙인다.
     - `-sTCP:LISTEN` 도 반드시 붙인다. `-i :PORT` 는 그 포트로 **접속만 한** 소켓까지 매칭하므로,
       이게 없으면 그 포트에 연결된 무관한 node 프로세스도 함께 죽는다.
   - **포트만 보고 무조건 죽이지 않는다.** 컨테이너가 그 포트를 잡고 있을 때 리스너는 앱이 아니라
     컨테이너 런타임의 포트 포워딩 프로세스다. colima 라면 단일 `ssh … [mux]` 프로세스가 docker
     소켓과 포트 포워딩까지 함께 담당하므로, 이걸 죽이면 docker 연결 자체가 끊긴다. 위 두 명령은
     `-c node` 로 node 프로세스만 겨냥하므로 안전하다.

3. **스택 기동**
   ```bash
   docker compose up -d --wait --wait-timeout 180
   ```
   - 이미 떠 있으면 그대로 통과하므로 무조건 실행해도 된다.
   - `--wait` 가 healthcheck 통과까지 기다리므로 별도 폴링이 필요 없다. `--wait-timeout` 을 주지
     않으면 상한 없이 기다리므로 반드시 붙인다.
   - **의존성이 바뀌었으면** `--build` 를 붙인다 (`package.json`·`package-lock.json`·`Dockerfile`
     변경). 소스만 고쳤으면 붙이지 않는다 — 빌드가 몇 분 걸리는데 얻는 게 없다.
   - 실패하면 반복하지 말고 `docker compose logs <서비스>` 를 확인해 보고한다.

4. **재시작만 필요한 경우**
   - 코드 변경은 자동 반영되므로 재시작할 일이 거의 없다. 그래도 필요하면
     `docker compose restart backend` 처럼 서비스를 지정한다.
   - 공유 타입(`packages/shared-types`)을 고쳤으면 **컨테이너를 재시작**한다. `dist` 빌드는
     기동할 때 한 번만 돈다.

5. **확인**
   - `docker compose ps` 로 세 서비스가 다 `Up` 인지 본다.
   - `curl -s http://127.0.0.1:4000/api/health` — 백엔드 직접.
   - `curl -s http://127.0.0.1:5173/api/health` — 프런트의 `/api` 프록시를 거쳐 같은 응답이 와야
     한다. 이게 되어야 브라우저에서 실제로 동작한다.
   - 백엔드의 DB 접속 상태 확인은 **STEP 1 이후**에 넣는다. 지금 백엔드에는 DB 접속 코드가 없고,
     `/api/health` 는 "앱이 떠 있다"만 답한다([health.ts](../../../backend/src/routes/health.ts) 주석 참고) —
     헬스체크 200 을 DB 접속 근거로 삼지 않는다.
   - 결과 보고. **이때 접속 URL을 항상 함께 제공한다** — 아래 두 개는 매번 적는다.
     - 앱(프런트): http://127.0.0.1:5173
     - 백엔드 헬스체크: http://127.0.0.1:4000/api/health
   - DB 접속 문자열은 보고에 적지 않는다 — 자격증명이 대화 기록에 남는다
     (`docs/policy/credential-management.md`). 값이 필요하면 **사용자가 직접** `.env` 나
     `docker-compose.yml` 을 열어 확인한다. 에이전트는 `.env` 를 읽지 않는다.

## 비고

- 내릴 때는 `docker compose down`. DB 데이터까지 지우려면 `-v` 를 붙인다(볼륨 `db-data`).
- 로그는 `docker compose logs -f <서비스>`.
- 테스트·lint·typecheck 는 컨테이너 밖 호스트에서 돈다(CI 와 같은 경로). 루트에서 `npm test` 면
  전 워크스페이스, 영역만 돌리려면 `npm test --workspace=backend` / `--workspace=frontend`.
  이때는 `npm ci --ignore-scripts` 가 먼저 필요하다.
- Docker 없이 호스트에서 직접 돌리는 경로도 남아 있다(README 「호스트에서 직접 돌리기」). 단
  **컨테이너 스택과 배타적**이다 — 섞으면 2단계가 경고한 포트 선점 상황이 된다.
- 이 커맨드는 특정 컨테이너 런타임을 전제하지 않는다. colima·Docker Desktop·리눅스 docker 모두
  `docker compose` 명령은 동일하고, 데몬을 띄우는 방법만 1단계처럼 런타임별로 다르다.
