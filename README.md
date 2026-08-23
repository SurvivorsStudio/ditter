# ditter

이기종 저장소(RDB, NoSQL, SAP)의 데이터를 표준화된 방식으로 수집해 목적 저장소(DB, Amazon S3)로
적재하는 자체 EAI 플랫폼. 웹에서 드래그앤드롭(n8n 스타일)으로 파이프라인을 구성하고 **배치·실시간(CDC)**
으로 실행한다.

상세 설계는 [docs/EAI_아키텍처_설계문서.pdf](docs/EAI_아키텍처_설계문서.pdf),
구현 가이드는 [CLAUDE.md](CLAUDE.md)를 참고.

---

## 현재 구현 범위

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 모노레포·docker-compose·메타DB 모델·마이그레이션 | ✅ 완료 |
| 1 | MVP — MySQL/PostgreSQL 커넥터, S3 타깃, 스케줄러, Canvas 저작, 실행/이력 | ✅ 완료 |
| 2 | MSSQL/MongoDB 커넥터, RBAC 로그인, Monitor 고도화, 팬아웃 스풀링 | ✅ 완료 |
| 3 | SAP RFC 전용 사이드카 (BAPI · RFC_READ_TABLE) | ✅ 완료 |
| 4 | CDC (Debezium) — MySQL/PostgreSQL/MSSQL 실시간 수집, Sink Worker | ✅ 완료 |
| 5 | 운영 고도화 (오토스케일·HA/DR·감사) | ⬜ 예정 |

> 그 밖에 **변환 노드**를 확장했다 — Python 전처리 노드(격리 서브프로세스·pandas·행/배치 모드),
> 스위치(조건 분기) 노드. 아래 참조.

**변환 노드 확장 (최근)**

- **Python 전처리 노드** — 사용자 Python 코드로 레코드를 변환. 임의 코드라 **격리 자식 프로세스**에서
  실행(시크릿·메타DB·네트워크 차단, rlimit·타임아웃). `pandas` 기본 제공. 두 모드: `transform(row)`
  행 단위 스트리밍 / `transform_batch(df)` 전체 행을 DataFrame 으로 한 번에.
- **스위치(조건 분기) 노드** — 각 행을 처음 맞는 case 의 출력으로, 아무 것도 안 맞으면 '그 외' 출력으로
  라우팅. 출력이 여러 개인 다중 출력 노드(엣지가 `source_handle` 로 어느 case 인지 가리킨다).
- 코드 편집기는 CodeMirror(문법 하이라이트·크게 편집 팝업).

**Phase 4 에서 추가된 것**

- **Debezium 기반 CDC** — MySQL · PostgreSQL · MSSQL 소스를 실시간 수집. Kafka 토픽을 구독하는
  **Sink Worker**(`cdc_sink`)가 타깃에 적재한다. 무상태라 수평 확장된다.
- CDC 소스 노드(파랑, 실시간 그룹)·CDC 스트림 트리거·스냅샷 모드(initial/never/when_needed)·삭제 처리.
- Kafka·Debezium·Sink 는 `docker compose --profile cdc up -d` 로만 기동한다(배치 파이프라인과 분리).

**Phase 3 에서 추가된 것**

- SAP RFC 전용 사이드카 — NW RFC SDK 와 SAP 자격증명을 그 컨테이너 안에만 가둔다
- BAPI 호출 (권장) · RFC_READ_TABLE (512자 행폭 자동 분할, 72자 WHERE 분할)
- 목 백엔드 — SDK 없이 개발·CI. **512자 제약을 실제와 동일하게 강제**한다
- SAP 노드(핑크), 필드 선택 시 512자 초과 여부를 미리 표시

**Phase 2 에서 추가된 것**

- MSSQL(pyodbc·MERGE upsert) · MongoDB(JSON 필터·문서 정규화) 커넥터
- 로그인 화면 + JWT + 역할별 UI 제어 (viewer / operator / editor / admin)
- 사용자 관리 API와 CLI (`python -m eai_api.cli create-admin`)
- 실행 상세 화면 — 노드별 분해, 재실행, 로그 레벨·노드 필터
- 팬아웃 스풀링 — 분기가 있어도 소스를 **한 번만** 읽는다

**Phase 1 에서 동작하는 것**

- 연결 등록·테스트·스키마 탐색 (MySQL / PostgreSQL / S3)
- 시크릿 분리 저장 (Fernet 또는 AWS KMS) — 원문은 메타DB에 남지 않음
- 드래그앤드롭 파이프라인 편집기 (React Flow), 버전 스냅샷
- DAG 실행: 위상 정렬 → Extract → Transform(필터·필드매핑·Python·스위치) → Load
- 증분 적재(watermark) + 체크포인트, `full_refresh` 전체 재적재
- 멱등 적재: DB는 upsert/overwrite, S3는 실행 단위 경로 분리
- Cron 스케줄러 (중복 실행 방지), 수동 실행, 실행 취소
- WebSocket 실시간 진행률·로그, 실행 이력·대시보드 통계
- MCP 도구 12종 — UI와 동일한 서비스 계층을 LLM/에이전트가 재사용

---

## 빠른 시작

### 1. 환경 변수

```bash
cp .env.example .env
```

`.env`의 빈 값을 채운다.

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

```bash
openssl rand -hex 32
```

앞의 값을 `EAI_LOCAL_SECRET_KEY`, 뒤의 값을 `EAI_JWT_SECRET`에 넣는다.

### 2. 전체 기동 (Docker)

```bash
docker compose up -d --build
```

- 웹 http://localhost:5173
- API 문서 http://localhost:8000/docs
- MCP 엔드포인트 http://localhost:8000/mcp-server/mcp

### 3. 로컬 개발 (인프라만 컨테이너로)

```bash
docker compose up -d postgres redis
```

```bash
uv venv --python 3.12 && uv pip install -e apps/connectors -e apps/api -e apps/worker
```

```bash
cd apps/api && alembic upgrade head && uvicorn eai_api.main:app --reload
```

```bash
celery -A eai_worker.celery_app:app worker -l info -Q eai.default
```

```bash
python -m eai_worker.scheduler
```

```bash
cd apps/web && npm install && npm run dev
```

### 4. 첫 관리자 계정

인증이 켜져 있으면 로그인해야 하므로, 서버에서 먼저 관리자를 만든다.

```bash
cd apps/api && python -m eai_api.cli create-admin admin@company.com
```

비밀번호는 대화형으로 입력받는다 — 인자로 주면 셸 히스토리에 남는다.
로컬 개발 중 인증을 끄려면 `EAI_AUTH_ENABLED=false`.

---

## 테스트 · 품질

```bash
cd apps/connectors && pytest && ruff check . && mypy .
```

```bash
cd apps/api && pytest && ruff check . && mypy .
```

```bash
cd apps/worker && pytest && ruff check . && mypy .
```

```bash
cd apps/sap-connector && pytest && ruff check . && mypy .
```

```bash
cd apps/web && npm test && npm run lint && npm run build
```

현재: Python 435개 · 프론트 98개 테스트 통과. ruff · mypy(strict) · eslint · tsc 모두 클린.

---

## 구조

```
apps/
  connectors/   BaseConnector 계약 + MySQL·PostgreSQL·MSSQL·MongoDB·SAP·S3·로컬파일 (지연 로딩)
  api/          FastAPI(REST/WS) + FastMCP, 모델·Alembic, 인증(JWT/RBAC), 서비스 계층, 운영 CLI
  worker/       Celery 워커 — DAG 엔진, 노드 실행기(Python 격리 샌드박스 포함), 팬아웃 스풀,
                Cron 스케줄러, CDC Sink Worker
  sap-connector/ SAP RFC 전용 사이드카 — NW RFC SDK 격리, 목 백엔드 포함
  web/          React + React Flow — Login / Home / Canvas / Monitor / Connections
cdc/debezium/   Debezium(Kafka Connect) 커넥터 설정 — MySQL·PostgreSQL·MSSQL 예시
infra/          ECS task def, Terraform (예정)
docs/           설계 문서, UI 목업, 아키텍처 다이어그램
```

의존 방향: `web → api → worker`는 없다. API와 Worker는 **Redis 큐로만** 통신하고
(`send_task` 이름 호출), 모델·DAG 스펙·커넥터만 코드로 공유한다.

---

## 알아둘 설계 결정

- **큐 모드는 PostgreSQL + Redis 필수.** SQLite는 설정 단계에서 거부한다.
- **워터마크는 적재가 끝난 뒤에만 전진한다.** 적재 전에 올리면 실패 구간이 영구 유실된다.
- **한 노드가 여러 소비자를 가지면 스풀을 거친다.** 첫 소비 때 JSONL 로 디스크에 적고 나머지는
  되읽어, 분기가 있어도 소스는 정확히 한 번만 읽힌다. 그래서 **타깃은 순차 실행해야 한다** —
  병렬로 돌리면 스풀이 완성되기 전에 두 번째 소비자가 붙는다.
- **여러 상류가 한 노드로 모이면 순차 concat(UNION ALL).** 조인은 별도 노드로 다룰 일이다.
- **S3는 upsert 불가.** 실행 단위 경로(`run_id=<id>/`) 분리로 멱등성을 얻는다.
- **FastMCP 버전은 핀 고정.** 2.10.x는 pydantic 2.13과 호환되지 않는다 — 올릴 때 반드시 확인.
- **SAP 은 사이드카로 격리한다.** NW RFC SDK 는 라이선스 바이너리라 저장소에 없다.
  워커는 SDK 없이 HTTP 로만 이야기하고, SAP 자격증명은 사이드카 컨테이너 안에만 있다.
- **RFC_READ_TABLE 은 행폭 512자·OPTIONS 줄 72자 제약이 있다.** 사이드카가 컬럼 분할과
  WHERE 분할을 처리하지만, 분할 병합은 "같은 조건이면 같은 순서"를 전제한다 — 넓은 테이블은 BAPI 를 쓰는 편이 안전하다.
- **BAPI 는 실패해도 예외를 던지지 않는다.** `RETURN` 테이블의 E/A 메시지를 확인해야 한다.
- **커넥터별 옵션은 `ReadSpec.params` 로만 전달된다.** 새 커넥터를 만들 때 여기서 읽어야 한다.
- **연결은 시스템을, 노드는 테이블을 가리킨다.** 연결에 테이블을 박으면 테이블마다 연결을
  만들어야 한다. 스키마는 `GET /connections/{id}/schema?table=...` 로 그때그때 조회한다.
- **임포트는 싸야 한다.** 커넥터 드라이버는 지연 로딩하고, Argon2 더미 해시도 첫 사용 때 만든다.
  모듈 최상위에서 네이티브 초기화를 하면 Celery prefork 워커가 fork 할 때 터진다.
- **역할 계층이 두 곳에 있다.** 백엔드 `auth/rbac.py` 의 `_IMPLIES` 와 프론트 `api/auth.ts` 의
  `IMPLIES` 는 항상 같아야 한다.
- **Python 노드는 격리 자식 프로세스에서 돈다.** 임의 사용자 코드라 워커 프로세스와 분리한다 —
  시크릿 없는 스크럽 환경, 파일쓰기·네트워크 차단, CPU·메모리·시간 제한. `pandas`·`numpy` 만
  기본 제공하고 나머지 import 는 화이트리스트로 막는다. 값은 JSON 경계라 datetime→ISO·Decimal→숫자로
  정규화된다.
- **스위치는 실행기가 아니라 엔진이 분배한다.** 실행기(`_switch`)는 각 행에 어느 출력으로 갈지
  라우팅 태그만 붙여 단일 스트림을 낸다. 엔진(`_build_stream`)이 소비 엣지의 `source_handle` 로
  걸러내고 태그를 지운다 — 덕분에 스풀·실행기 계약(단일 출력)을 그대로 둔 채 다중 출력을 얻는다.

---

## SAP 사이드카

기본은 **목 백엔드**로 뜬다 — NW RFC SDK 없이 파이프라인 저작과 512자 분할 검증이 가능하다.

```bash
docker compose up -d sap-connector
```

실제 SAP 에 붙이려면 [apps/sap-connector/vendor/README.md](apps/sap-connector/vendor/README.md)
대로 SDK 를 넣고 다시 빌드한다.

```bash
docker compose build --build-arg WITH_NWRFC=1 sap-connector
```

그리고 `.env` 에 `EAI_SAP_BACKEND=nwrfc` 와 접속 정보를 넣는다.
목으로 만든 파이프라인은 그대로 돌아간다 — 백엔드만 바뀐다.

---

## macOS 로컬 개발 참고

Celery prefork 풀은 macOS 에서 fork 안전성 문제에 민감하다. 위 지연 로딩으로 해결했지만,
서드파티 패키지를 추가한 뒤 워커가 `SIGABRT` 로 죽는다면 그 패키지가 임포트 시점에 무거운
네이티브 초기화를 하고 있을 가능성이 높다. 임시 회피는 다음과 같다.

```bash
OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES celery -A eai_worker.celery_app:app worker -l info
```

배포 대상인 Linux 컨테이너에서는 이 증상이 나타나지 않는다.
