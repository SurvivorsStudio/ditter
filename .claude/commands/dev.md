---
description: 로컬 개발 스택(docker compose) 재시작 — postgres·redis·api(:8000)·worker·beat·web(:5173)
---

이 프로젝트는 **Docker Compose** 로 로컬 스택을 띄운다(새 CLAUDE.md §개발 참고). API(FastAPI,
`:8000`) · Web(React + Vite, `:5173`) · Worker/Beat(Celery) · SAP 커넥터 · PostgreSQL · Redis 를
`docker-compose.yml` 하나로 기동한다.

## 구성

- 오케스트레이션: 저장소 루트 `docker-compose.yml` (compose project name = `ditter`).
- 서비스: `postgres` · `redis` · `api`(:8000) · `worker` · `beat` · `web`(:5173) · `sap-connector`(:8100).
  - CDC 계열(`cdc-sink`·`kafka`·`debezium`)은 `--profile cdc`, 실시간 동기화(`symmetricds`)는
    `--profile sync` 로만 뜬다(기본 `up` 에서 제외).
- Web 컨테이너는 nginx 가 `/api` 를 `api:8000` 으로 프록시한다 → 프런트는 같은 오리진 `/api` 를 쓴다.
- API 는 부팅 시 `alembic upgrade head` 로 스키마를 맞춘 뒤 uvicorn 을 띄운다.
- 실행에 `.env` 가 필요하다(`EAI_JWT_SECRET` 등). 없으면 `docker compose config` 가 변수 보간
  오류를 낸다. **에이전트는 `.env` 를 읽지 않는다**(자격증명) — 값이 필요하면 사용자가 직접 연다
  (`docs/policy` 는 이관 전 것이라 없을 수 있음; 원본 `.env` 를 사용자가 직접 복사해 둔다).

## 절차

1. **Docker 데몬 확인**
   - `docker compose ps` 로 상태 확인. 소켓 오류(`failed to connect to the docker API …`)면 데몬이
     꺼진 것 — 런타임에 맞게 띄운다(colima `colima start` · Docker Desktop 앱 실행 · 리눅스
     `systemctl start docker`). 어느 쪽인지는 `docker context ls`.

2. **`.env` 확인**
   - `docker compose config -q` 로 필요한 변수가 채워졌는지 검증한다. `EAI_* is missing` 이 나면
     `.env` 가 없거나 비어 있는 것 — 사용자에게 `.env` 구성을 요청하고 멈춘다.

3. **포트 충돌 확인(선택)**
   - 이 머신에서 다른 프로젝트가 `5432`·`6379`·`8000`·`5173` 등을 이미 쓰면 컨테이너 기동이
     `bind: address already in use` 로 실패한다. 충돌 시 그 컨테이너를 내리거나, 로컬 전용
     `docker-compose.override.yml`(gitignore 대상)로 **호스트 포트만** 옮긴다(내부 포트·서비스명은
     그대로). 예: `services: { postgres: { ports: !override ["127.0.0.1:5433:5432"] } }`.

4. **스택 기동** (백그라운드)
   - DB·Redis 를 먼저 healthy 까지 띄운다:
     `docker compose up -d --wait --wait-timeout 120 postgres redis`
     (`--wait-timeout` 을 반드시 붙인다 — 없으면 상한 없이 대기.)
   - 나머지 앱을 올린다: `docker compose up -d --build`
     - CDC/sync 까지 필요하면: `docker compose --profile cdc --profile sync up -d --build`
   - 첫 기동은 이미지 빌드/pull 로 수 분 걸린다 — 백그라운드로 돌리고 완료를 기다린다.
   - 기동 레이스로 `beat`/`worker` 가 초기에 "relation … does not exist" 를 낼 수 있다(API 의
     마이그레이션 완료 전 조회). API 가 healthy 가 된 뒤 `docker compose restart beat worker` 로 해소.

5. **확인**
   - `docker compose ps` 로 서비스 상태 확인. `api`·`postgres`·`redis`·`worker`·`sap-connector` 가
     healthy 인지 본다.
   - `web`/`beat` 의 `unhealthy` 는 헬스체크 정의 quirk 일 수 있다(web 은 IPv6 localhost, beat 는
     워커 노드 ping) — 실제 동작은 아래 확인으로 판단한다.
   - 엔드포인트 확인:
     - `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health` → 200
     - `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/` → 200
   - 결과 보고. **접속 URL 을 항상 함께 적는다**:
     - 앱(웹): http://127.0.0.1:5173
     - API 헬스체크: http://127.0.0.1:8000/health
   - DB 접속 문자열·자격증명은 보고에 적지 않는다.

## 비고

- 재시작만 필요하면 `docker compose restart <서비스>`, 코드 반영 재빌드는
  `docker compose up -d --build <서비스>`.
- 로그: `docker compose logs -f <서비스> --tail 50`.
- 호스트에서 웹만 빠르게 돌리려면 `cd apps/web && npm run dev`(:5173) — 이때 `/api` 프록시 대상은
  `apps/web/vite.config` 설정을 따른다. Python 앱은 컨테이너로 두는 편이 의존성(ODBC·DuckDB
  확장 등)까지 갖춰져 간단하다.
- 종료: `docker compose down`(볼륨 유지) / `docker compose down -v`(DB 볼륨까지 삭제).
