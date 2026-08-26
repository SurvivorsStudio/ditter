# CLAUDE.md — ditter (자체 EAI 플랫폼) 구현 가이드

> 이 문서는 **Claude Code**가 이 프로젝트를 이해하고 구현하도록 돕는 최상위 컨텍스트 파일입니다.
> 저장소 루트에 `CLAUDE.md`로 두면 Claude Code가 자동으로 읽어 들입니다.
> 상세 아키텍처는 `docs/EAI_아키텍처_설계문서.docx`, UI 레퍼런스는 `docs/mockups/*.html`를 참고하세요.

---

## 1. 프로젝트 개요

이기종 저장소(RDB, NoSQL, SAP)의 데이터를 표준화된 방식으로 수집해 목적 저장소(DB, Amazon S3)로 적재하는 **자체 EAI(Enterprise Application Integration) 플랫폼**이다. 사용자는 웹에서 **드래그앤드롭(n8n 스타일)** 으로 파이프라인을 구성하고 배치/실시간으로 실행한다.

수집 방식은 세 가지다.

1. **배치 DB→DB / S3** — 증분(watermark)·전체 적재
2. **SAP RFC** — NW RFC SDK를 통한 BAPI / RFC_READ_TABLE 추출
3. **CDC** — Debezium(Kafka Connect) 기반 실시간 변경 수집

배포 타깃은 **AWS EC2 + Docker**이며, 초기에는 Docker Compose로 시작해 규모 확장 시 ECS/EKS로 이전한다.

### 핵심 원칙
- 커넥터는 **공통 인터페이스**를 구현하는 플러그인. 신규 소스는 구현체 추가만으로 확장.
- 오케스트레이션과 실행을 **큐(Redis)로 분리** → Worker 수평 확장.
- 모든 상태·오프셋·이력은 **메타데이터 DB(PostgreSQL)** 에 저장 → 재시작·감사 가능.
- 적재는 **멱등성**(upsert / 실행 단위 경로 분리)을 기본으로.

---

## 2. 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | React 18, TypeScript, Vite, React Flow, Zustand, React Hook Form, TanStack Query |
| 백엔드 | Python 3.12, FastMCP, FastAPI(REST/WS), SQLAlchemy 2.x, Pydantic v2 |
| 실행/큐 | Celery + Redis (잡 큐), 커스텀 DAG 오케스트레이터 |
| CDC | Debezium (Kafka Connect), Apache Kafka |
| 메타데이터 | PostgreSQL 16 |
| 커넥터 드라이버 | PyMySQL, psycopg3, pyodbc, PyMongo, NW RFC SDK, boto3 |
| 인프라 | Docker, Docker Compose, AWS EC2 / ALB / RDS / S3 / ECR / CloudWatch |
| 품질 | pytest, ruff, mypy (백엔드) · vitest, eslint, prettier (프론트) |

> **주의:** FastMCP는 빠르게 변한다. 안정 버전을 `pyproject.toml`에 **핀 고정**하고 CVE 패치를 주기적으로 반영한다.
> **주의:** PyRFC는 유지보수 중단됨. SAP 커넥터는 NW RFC SDK를 직접 바인딩하며 **전용 컨테이너**로 격리한다.

---

## 3. 저장소 구조 (모노레포)

```
eai-platform/
├── CLAUDE.md                      # 이 파일
├── docker-compose.yml             # 로컬/EC2 단일노드 실행
├── docs/
│   ├── EAI_아키텍처_설계문서.docx
│   └── mockups/                   # UI 레퍼런스 (HTML)
├── apps/
│   ├── api/                       # FastMCP + FastAPI 백엔드
│   │   ├── src/eai_api/
│   │   │   ├── main.py            # 앱 엔트리 (REST + WS + MCP 마운트)
│   │   │   ├── mcp_server.py      # FastMCP tools 정의
│   │   │   ├── models/            # SQLAlchemy 모델
│   │   │   ├── schemas/           # Pydantic 스키마
│   │   │   ├── routers/           # connections / pipelines / runs
│   │   │   ├── auth/              # OAuth2 / RBAC / 시크릿(KMS)
│   │   │   └── services/          # 도메인 로직
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   ├── worker/                    # Celery 워커 (수집·변환·적재 실행)
│   │   ├── src/eai_worker/
│   │   │   ├── engine.py          # DAG 실행 엔진
│   │   │   ├── tasks.py           # Celery task 정의
│   │   │   └── nodes/             # 노드 실행기 (extract/transform/load)
│   │   └── Dockerfile
│   ├── connectors/                # 공통 커넥터 라이브러리 (api·worker 공유)
│   │   └── src/eai_connectors/
│   │       ├── base.py            # BaseConnector 프로토콜
│   │       ├── mysql.py  postgres.py  mssql.py  mongo.py
│   │       ├── sap_rfc.py         # 전용 컨테이너에서 실행
│   │       └── s3.py
│   ├── sap-connector/             # SAP RFC 전용 컨테이너 (NW RFC SDK 포함)
│   └── web/                       # React + React Flow 프론트엔드
│       ├── src/
│       │   ├── pages/             # Home / Canvas / Monitor / Connections
│       │   ├── canvas/            # React Flow 노드·엣지·팔레트
│       │   ├── components/  api/  store/
│       │   └── main.tsx
│       ├── package.json
│       └── Dockerfile
├── cdc/
│   └── debezium/                  # Kafka Connect + 커넥터 설정(JSON)
└── infra/
    ├── ecs/                       # (확장 시) ECS task def
    └── terraform/                 # VPC/RDS/S3/ALB (선택)
```

---

## 4. 핵심 도메인 모델 (메타데이터 DB)

```
Connection      id, name, type(mysql|postgres|mssql|mongo|sap_rfc|s3),
                config(jsonb), secret_ref(KMS), pool_size, ssl, cdc_enabled,
                health_status, last_tested_at
Pipeline        id, name, definition(jsonb: nodes+edges), version, status, schedule(cron)
PipelineNode    id, pipeline_id, type, position, params(jsonb)  # (jsonb에 인라인 가능)
Run             id, pipeline_id, status(pending|running|success|failed),
                trigger(schedule|manual|cdc), started_at, finished_at, records
RunLog          id, run_id, node_id, level, message, ts
Checkpoint      id, pipeline_id, node_id, watermark / cdc_offset(jsonb)
```

- 시크릿 원문은 저장하지 않는다. `secret_ref`만 두고 실제 값은 KMS/시크릿 매니저에서 복호화.
- `definition`은 노드·엣지를 담은 DAG. 실행 시 **위상 정렬(topological sort)** 후 순서대로 처리.

---

## 5. 커넥터 인터페이스 (계약)

```python
# apps/connectors/src/eai_connectors/base.py
from typing import Protocol, Iterator

class BaseConnector(Protocol):
    def test_connection(self) -> HealthResult: ...
    def discover_schema(self) -> list[TableSchema]: ...
    def read(self, spec: ReadSpec) -> Iterator[RecordBatch]: ...      # 소스: 커서/청크 스트리밍
    def write(self, batch: RecordBatch, mode: WriteMode) -> WriteResult: ...  # 타깃: append|upsert|overwrite
```

구현 규칙:
- `read`는 **제너레이터**로 스트리밍 (대용량에서 메모리 상수 유지). 증분키/워터마크는 `ReadSpec`으로 전달.
- 커넥션 **풀**을 유지하고 재시도(지수 백오프)를 내장.
- SAP: `RFC_READ_TABLE`은 512자 행폭 제한 → 넓은 테이블은 컬럼 분할. 가능하면 BAPI 우선.

---

## 6. 파이프라인 실행 흐름

```
트리거(Cron/수동/이벤트)
  → API/오케스트레이터: DAG 파싱 → Run 생성(메타DB) → Redis에 enqueue
    → Celery Worker: 위상정렬 → 노드별 Extract→Transform→Load
      → 진행상황 메타DB 갱신 → WebSocket으로 UI push
        → 실패 시 노드 단위 재시도 + Checkpoint 기반 재시작
```

- 큐 모드는 **PostgreSQL + Redis 필수** (SQLite 불가).
- CDC 파이프라인은 상시 스트리밍: Debezium → Kafka 토픽 → Sink Worker → 타깃.

---

## 7. 백엔드 (FastMCP) 규칙

- 기능은 **MCP tool**로 노출: `test_connection`, `discover_schema`, `run_pipeline`, `get_run_status` 등. UI(REST/WS)와 LLM/에이전트가 동일 도구 재사용.
- 전송은 **Streamable HTTP**. 미들웨어로 인증/로깅/레이트리밋/감사 일괄 적용.
- REST 요약:

```
POST   /connections                # 등록
POST   /connections/{id}/test      # 연결 테스트
GET    /connections/{id}/schema    # 스키마 탐색
POST   /pipelines                  # 저장(버전)
POST   /pipelines/{id}/run         # 실행
GET    /runs?status=&range=        # 이력
WS     /runs/{id}/stream           # 실시간 로그/진행률
```

---

## 8. 프론트엔드 규칙

- 화면: **Home(대시보드) / Canvas(파이프라인 편집기) / Monitor(모니터링) / Connections(연결 관리)**.
- Canvas는 **React Flow**: 좌측 노드 팔레트 · 중앙 도트그리드 캔버스 · 우측 노드 설정 패널.
- 실시간 실행 상태는 WebSocket 구독으로 노드 뱃지/로그에 반영.
- 디자인 톤은 `docs/mockups/`의 목업을 기준(코랄 브랜드, 밝은 캔버스, 컬러코딩 노드)으로 한다.
- 노드 타입별 컬러: 소스=파랑, 변환=보라, 타깃=초록, 트리거=코랄, SAP=핑크.

---

## 9. 인프라 / 배포

- 모든 서비스 컨테이너화. 로컬·EC2 단일노드는 `docker-compose.yml`로 기동.
- 서비스: `web, api, worker(xN), debezium, kafka, redis` + 외부 `RDS(PostgreSQL), S3, ECR, CloudWatch`.
- `worker`/`debezium`은 상태를 외부(Redis/Kafka/RDS)에 두어 **무상태 → 수평 확장**.
- 온프레미스 소스(SAP·사내 DB)는 VPN/Direct Connect로 연결.
- 이미지는 ECR로 푸시 후 배포. 로그/메트릭은 CloudWatch, Worker 오토스케일 트리거.

---

## 10. 구현 로드맵 (Claude Code 작업 순서)

> 각 Phase를 순서대로 진행. Phase가 끝나면 테스트 통과 + 목업 대비 화면 확인.

- **Phase 0 — 스캐폴딩** ✅ **완료**: 모노레포·docker-compose·기본 CI·`Connection`/`Pipeline`/`Run` 모델·마이그레이션.
- **Phase 1 — MVP(배치 DB→S3)** ✅ **완료**: MySQL/PostgreSQL 커넥터, S3 타깃, 스케줄러, Canvas 기본 저작, Run 실행/이력.
  필터·필드매핑 노드는 Canvas 저작을 실증하기 위해 Phase 2 에서 앞당겨 함께 구현했다.
- **Phase 2 — 커넥터·변환 확장** ✅ **완료**: MSSQL/MongoDB 커넥터, RBAC 사용자 저장소·로그인, Monitor 고도화
  (실행 상세·재실행·로그 필터), 소스 팬아웃 스풀링. OAuth2 IdP 연동은 스키마(`users.external_id`)만 준비.
- **Phase 3 — SAP RFC** ✅ **완료**: 전용 사이드카 컨테이너, BAPI/RFC_READ_TABLE(512자 분할), 재시도.
  NW RFC SDK 는 라이선스 바이너리라 저장소에 없다 — 목 백엔드로 SDK 없이 개발·검증한다.
- **Phase 4 — CDC(Debezium)** ✅ **완료**: Kafka Connect 구성, 커넥터 등록 UI, Sink Worker, 실시간 적재.
  다중 테이블 매핑·MSSQL 소스까지 포함. 실 Kafka HA·exactly-once·DDL 전파는 Phase 5.
- **실시간 DB 동기화(SymmetricDS)** ✅ **구현 완료 · 실환경 미검증**: 원본이 CDC 를 못 쓸 때의
  다른 갈래다 (§20). 트리거 기반이라 **운영 적용 전 부하 테스트가 게이트**다.
- **Phase 5 — 운영 고도화**: 오토스케일, 관리형(MSK/RDS) 전환, HA/DR, 감사 로그.

---

## 11. 코딩 컨벤션

- **Python**: ruff(포맷+린트), mypy(strict), 타입힌트 필수, 함수는 순수하게. 예외는 도메인 예외로 래핑.
- **TypeScript**: eslint+prettier, `any` 금지, API 응답은 zod로 검증, 컴포넌트 함수형.
- 커밋: Conventional Commits (`feat:`, `fix:`, `chore:` …).
- 시크릿·자격증명은 **절대 코드/로그에 남기지 않는다**. `.env`는 예시만(`.env.example`).
- 모든 신규 커넥터·노드는 단위 테스트 동반. CDC/배치 재시작은 통합 테스트로 검증.

---

## 12. 개발 명령어 (참고)

```bash
# 전체 로컬 기동
docker compose up -d

# 백엔드
cd apps/api && uv sync && uvicorn eai_api.main:app --reload
cd apps/api && pytest && ruff check . && mypy .

# 워커
cd apps/worker && celery -A eai_worker.tasks worker -l info

# 프론트엔드
cd apps/web && pnpm i && pnpm dev
cd apps/web && pnpm test && pnpm lint

# DB 마이그레이션
cd apps/api && alembic upgrade head
```

---

## 13. Claude Code에게 — 작업 시 유의사항

- 새 기능은 **Phase 순서**를 따르고, 한 번에 하나의 Phase/모듈에 집중한다.
- 커넥터를 추가할 때는 반드시 `BaseConnector` 계약을 구현하고 테스트를 함께 작성한다.
- UI를 만들 때는 `docs/mockups/`의 HTML을 시각적 기준으로 삼되, 실제 데이터는 API에 연결한다.
- 대용량/재시작/멱등성 관련 코드는 **엣지 케이스 테스트**를 우선한다.
- 외부 네트워크·시크릿이 필요한 부분은 목(mock)으로 우회 가능하게 설계한다.
- 불확실한 아키텍처 결정은 임의로 정하지 말고 설계 문서(`docs/`)를 근거로 하거나 확인을 요청한다.

---

## 14. 구현 현황 메모 (Phase 1 완료 시점)

> 코드를 읽기 전에 알면 시간을 아끼는 것들. 설계 문서와 실제 구현이 갈린 지점과 그 이유.

### 의존 방향

`api` 와 `worker` 는 **Redis 큐로만** 통신한다. API 는 워커 코드를 import 하지 않고
`send_task("eai_worker.tasks.execute_pipeline")` 으로 이름만 보낸다.
반대로 워커는 메타DB 를 직접 갱신해야 하므로 `eai-api` 패키지(모델·서비스·DAG 스펙)에 의존한다.
DAG 스펙(`eai_api.schemas.dag`)을 양쪽이 공유하는 이유가 이것이다 — 정의를 복제하면 반드시 어긋난다.

### 실행 모델

**타깃 주도 풀(pull) 스트리밍.** 타깃마다 상류를 거슬러 제너레이터 체인을 만들고, 타깃이 배치를
당겨오면서 흐름이 생긴다. 중간 결과가 메모리에 쌓이지 않는다.

의도된 한계 두 가지:
1. 한 소스가 여러 타깃에 연결되면 **소스를 타깃 수만큼 읽는다.** 제너레이터는 한 번만 소비할 수 있다.
   Phase 2 에서 스풀 파일 기반 팬아웃으로 개선한다.
2. 여러 상류가 한 노드로 모이면 **순차 concat(UNION ALL)** 이다. 조인은 Phase 2 범위.

### 순서가 중요한 것

- **워터마크는 모든 타깃이 성공한 뒤에만 전진한다.** 적재 전에 올리면 실패 구간이 영구 유실된다.
  체크포인트 저장 실패는 Run 을 실패로 만든다 — 조용히 넘어가면 다음 실행이 같은 구간을 건너뛴다.
- **DB overwrite 는 첫 배치에서만 테이블을 비운다.** 매 배치 비우면 마지막 배치만 남는다.
- **S3 overwrite 는 적재 전에 `run_id=` prefix 를 정리한다.** 재시도 시 이전 파트가 중복으로 남는다.

### 함정으로 이미 한 번 데인 것들

- `from __future__ import annotations` 가 있으면 FastAPI 가 `-> None` 을 문자열로 본다.
  204 응답 라우트에는 **`response_model=None` 을 명시**해야 한다.
- zod 스키마를 `z.ZodType<T>` 로 받으면 TS 가 **입력** 타입으로 추론해 `.default()` 필드가 전부
  optional 로 샌다. `<S extends z.ZodTypeAny>` + `z.infer<S>` 로 받을 것.
- **FastMCP 2.10.x 는 pydantic 2.13 과 깨진다.** 버전을 올릴 때 반드시 호환성부터 확인한다.
- 워터마크가 `datetime`/`Decimal` 이면 JSONB 에 그대로 들어가지 않는다.
  `engine._encode_watermark` 가 타입 태그를 붙여 저장한다 — 태그를 잃으면 다음 비교가 조용히 어긋난다.
- vitest 는 자체 vite 를 번들한다. **vite 메이저와 맞춰야** 타입 충돌이 없다 (vite 6 ↔ vitest 3).

### Phase 1 에서 일부러 하지 않은 것

- 사용자 저장소·OAuth2 IdP 연동 (`auth/` 는 JWT+RBAC 골격만. `EAI_AUTH_ENABLED=false` 로 로컬 우회)
- 소스로서의 S3 (타깃 전용), 파티션 컬럼 기반 S3 경로 분할
- Run 로그 보존 정책 / 아카이빙 (`run_logs` 는 현재 무한 증가)


---

## 15. Phase 2 메모

### 커넥터가 5종이 되었다

`mysql · postgres · mssql · mongo · s3`. MSSQL 은 `SqlConnector` 를 상속해 URL·MERGE 문만 다르고,
Mongo 는 스키마가 없어 `BaseConnector` 를 독립 구현한다.

Mongo 의 `ReadSpec` 매핑이 SQL 과 다르다 — **`query` 는 SQL 이 아니라 JSON 필터 문서**이고
`table` 은 컬렉션이다. 그래서 Mongo 는 필터와 증분키를 **함께** 쓸 수 있다 (SQL 소스는 배타적).
`_normalize` 가 ObjectId·Decimal128 을 변환하지 않으면 Parquet 직렬화와 RDB 적재가 모두 깨진다.

### 팬아웃은 스풀로 해결했다

한 노드가 여러 소비자를 가지면 첫 소비 때 JSONL 로 디스크에 적고 나머지는 되읽는다 (`spool.py`).
소스는 정확히 한 번만 읽힌다. 타깃을 병렬 실행하면 스풀이 완성되기 전에 두 번째 소비자가 붙으므로
**엔진은 타깃을 순차 실행해야 한다** — 이 전제를 깨면 `_replay` 가 RuntimeError 를 던진다.

### 인증

- 비밀번호는 Argon2id 해시만 저장. 없는 계정에도 더미 해시를 검증해 **응답 시간으로 계정 존재가 새지 않게** 한다.
- 초기 관리자는 `python -m eai_api.cli create-admin` 으로만 만든다. 무인증 부트스트랩 엔드포인트는 그 자체가 취약점이다.
- `EAI_JWT_SECRET` 은 32바이트 미만이면 **기동을 거부한다** (RFC 7518 §3.2).
- WebSocket 은 헤더를 못 붙여 토큰을 쿼리로 받는다. 토큰이 접속 로그에 남을 수 있으므로 수명을 짧게 두는 것이 전제다.
- 프론트 `auth.can()` 의 역할 계층은 **백엔드 `rbac.py` 의 `_IMPLIES` 와 반드시 같아야 한다.** 한쪽만 고치면 UI 와 권한이 어긋난다.

### 임포트 부작용을 조심할 것 (macOS 에서 워커가 죽었던 이유)

Celery prefork 워커가 fork() 할 때 macOS 의 ObjC 런타임이 초기화 중이면 자식이 SIGABRT 로 죽는다.
두 가지가 원인이었고 **둘 다 임포트 시점에 네이티브 작업을 하고 있었다**:

1. `eai_connectors/__init__` 이 pyodbc·pymongo·boto3 를 전부 임포트 → PEP 562 지연 로딩으로 전환
2. `auth/passwords.py` 가 임포트 시점에 Argon2 더미 해시를 계산 → 첫 사용 시로 미룸

교훈: **임포트는 싸야 한다.** 무거운 초기화를 모듈 최상위에 두면 fork 하는 순간 드러난다.
Linux 컨테이너에서는 증상이 다르게 나타날 뿐 문제 자체는 같다.

### Phase 2 에서도 하지 않은 것

- OAuth2/OIDC IdP 연동 (스키마만 준비: `users.external_id`, `external_provider`)
- 조인 노드 — 여러 상류는 여전히 순차 concat(UNION ALL)
- MSSQL·Mongo 실서버 통합 검증 (단위 테스트만. 접근 가능한 인스턴스가 없었다)


---

## 16. Phase 3 메모 (SAP RFC)

### 접속 정보는 연결에, SDK 는 사이드카에 (방안 A)

처음엔 SAP 접속 정보를 사이드카 `.env` 에 뒀는데, 그러면 SAP 시스템마다 컨테이너를
새로 띄워야 했다. **SDK 격리와 "접속 정보를 어디서 관리하나"는 별개 문제인데** 둘을 묶은 실수였다.

지금은 갈라놓았다:
- **접속 정보**(ashost·client·user·passwd·lang…)는 다른 커넥터처럼 **연결 설정에 암호화 저장**되고,
  워커가 호출할 때 **요청 body 의 `credentials`** 로 사이드카에 전달된다.
- **SDK + pyrfc** 는 여전히 사이드카에만 있다 — 격리는 그대로.

사이드카는 이제 **접속 정보별로 커넥션을 캐시하는 순수 게이트웨이**다. 사이드카 하나로
여러 SAP 시스템(PRD·QAS·DEV…)을 모두 처리한다. `.env` 의 `EAI_SAP_*` 는 요청에 접속 정보가
전혀 없을 때의 폴백으로만 남는다.

**사이드카 주소도 연결마다 입력하지 않는다 (방안 1).** API 설정 `EAI_SAP_DEFAULT_SIDECAR_URL` 에 기본 주소를 한 번 두면, 연결이 `sidecar_url` 을 비워둘 때 실행 시점에 채워진다. **연결에 저장하지 않으므로** 운영이 기본 주소를 바꾸면 기존 연결도 자동으로 따라간다. 드물게 사이드카가 여러 개일 때만 연결에 명시적으로 넣는다 — 그 값이 기본값을 이긴다.

`passwd` 는 `SECRET_KEYS` 에 있어 **평문으로 메타DB 에 남지 않는다** — DB 를 직접 봐도 흔적이 없다.

### 왜 사이드카인가

설계 문서 §2·§3 이 "전용 컨테이너로 격리"라고 한 데는 실질적인 이유가 있다.
**NW RFC SDK 는 SAP 라이선스가 있어야 받는 독점 바이너리**라 저장소에도 pip 에도 없다.
이걸 워커 이미지에 넣으면 SAP 를 안 쓰는 파이프라인까지 그 이미지에 묶인다.

그래서 구조를 이렇게 갈랐다.

```
worker ──HTTP──> sap-connector 사이드카 ──RFC──> SAP
 (SDK 없음)        (SDK + 자격증명 여기만)
```

`eai_connectors/sap_rfc.py` 는 SAP 라이브러리를 **한 줄도 임포트하지 않는다.**
`Connection.config` 에 담기는 것도 SAP 접속 정보가 아니라 사이드카 주소다.
SAP 자격증명은 사이드카 컨테이너의 환경변수에만 존재한다.

### 목 백엔드가 제약을 그대로 강제한다

설계 문서 §13 의 "외부 의존은 목으로 우회 가능하게"를 따르되, **제약을 눙치지 않았다.**
`backends/mock.py` 는 512자 행폭, 72자 OPTIONS 줄, ROWSKIPS/ROWCOUNT 를 SAP 과 똑같이 강제한다.
제약을 봐주는 목은 분할 로직을 검증하지 못하므로 있으나 마나다.

픽스처의 MARA 는 필드 54개·전체 폭 599자로 **일부러 512를 넘긴다.**

### RFC_READ_TABLE 의 두 가지 함정

1. **행 폭 512자** — 반환 구조 `DATA-WA` 가 CHAR(512)다. 넘으면 `DATA_BUFFER_EXCEEDED`.
   필드를 그룹으로 쪼개 같은 조건으로 여러 번 부르고 **행 위치로 병합**한다.
   병합 전제는 "같은 조건이면 같은 순서"인데 SAP 은 ORDER BY 없이 순서를 보장하지 않는다 —
   그래서 그룹 간 행 수가 다르면 조용히 잇지 않고 `SPLIT_ROW_MISMATCH` 로 실패시킨다.
   근본 해법은 BAPI 이고, 분할이 일어나면 경고를 남긴다.
2. **OPTIONS 한 줄 72자** — WHERE 절을 72자로 자르되 **토큰 경계에서만** 잘라야 한다.
   리터럴 중간에서 끊으면 ABAP 이 거부한다. 따옴표 안 공백은 하나의 토큰으로 취급한다.

### BAPI 는 예외를 던지지 않는다

실패해도 호출은 성공하고 `RETURN` 테이블에 타입 `E`/`A` 메시지가 담긴다.
이걸 확인하지 않으면 **실패를 성공으로 착각한다.** `call_bapi` 는 행을 읽기 전에 먼저 본다.
결과 테이블 후보가 여럿이면 자동 판별하지 않고 `result_table` 을 요구한다 —
엉뚱한 테이블을 조용히 집는 것보다 물어보는 편이 낫다.

### 이번에 드러난 계약 결함

`ReadSpec` 이 "table 또는 query 중 하나"를 요구했는데 **BAPI 는 둘 다 아니다.**
워크어라운드 대신 계약을 고쳤다 — 소스 지정 방식은 이제 `table | query | function` 세 가지다.

그리고 `extract` 가 `query_params` 만 `ReadSpec.params` 로 넘기고 있어서
노드의 `mode`·`where`·`result_table` 이 커넥터에 닿지 않았다. 노드 파라미터를 통째로 넘기도록 고쳤다.
**커넥터별 옵션은 `ReadSpec.params` 를 통해서만 전달된다** — 새 커넥터를 만들 때 기억할 것.

### 연결과 테이블의 경계

**연결 = SAP 시스템 하나. 테이블은 노드 설정에서 정한다.**

처음에는 연결 설정에 `tables` 를 두었는데, 그러면 테이블 조합마다 연결을 새로 만들어야 한다.
연결은 "어디에 붙는가"이지 "무엇을 읽는가"가 아니다.

그래서 `BaseConnector.discover_schema()` 에 선택 인자 `table` 을 넣었다.
SAP 은 테이블이 수만 개라 열거가 불가능하므로 이 인자가 사실상 필수이고,
RDB·Mongo 는 지정 시 반영 비용을 아끼는 최적화가 된다.
``table`` 없이 부르면 SAP 은 빈 목록을 돌려주고, UI 가 테이블명을 받아 다시 부른다.

API: `GET /connections/{id}/schema?table=MARA`

### 실제 환경에서 확인된 것 (사용자 실측 코드 반영)

1. **PyRFC 는 Python 3 에서 그냥 import 되지 않는다.** Python 2 시절의 `long` 을 참조한다.
   `backends/nwrfc.py` 가 import 직전에 `builtins.long = int` 를 심는다. 유지보수가
   중단된 라이브러리라 이 패치가 없어질 일은 없다.
2. **RFC 전용 계정은 `DDIF_FIELDINFO_GET` 권한이 없을 수 있다.** 필드 메타를 못 읽으면
   512자 분할을 할 수 없으므로, `RFC_READ_TABLE` 이 응답에 실어주는 `FIELDS`(OFFSET/LENGTH)로
   직접 읽는 경로로 자동 폴백한다. 폭이 넘치면 조용히 실패하지 않고 "필드를 지정하거나
   BAPI 를 쓰라"고 알린다.
3. **라이브러리 경로가 OS 마다 다르다.** 컨테이너(Linux)는 `LD_LIBRARY_PATH`,
   macOS 로컬은 `DYLD_LIBRARY_PATH`.

### 실제 SAP 에 붙이려면

1. SAP Software Download Center 에서 NW RFC SDK 7.50 (Linux x86_64) 다운로드
2. `apps/sap-connector/vendor/nwrfcsdk/` 에 풀어 넣기
3. `SAP_WITH_NWRFC=1` 로 빌드, `EAI_SAP_BACKEND=nwrfc` 와 접속 정보 설정

목 백엔드로 만든 파이프라인은 그대로 돌아간다 — 백엔드만 바뀐다.

### Phase 3 에서 하지 않은 것

- SAP 을 **타깃으로** 쓰기 (BAPI 로 쓰기). EAI 는 SAP 에서 읽어오는 방향이라 범위 밖으로 두었다.
- SNC(보안 네트워크 통신) 실검증 — 설정 항목은 있으나 실제 SNC 환경에서 확인하지 못했다.
- 실제 SAP 시스템 통합 검증 — 목 백엔드로만 확인했다.

---

## 17. 노드 결과 참조 `${노드이름.컬럼}`

### 무엇인가

노드가 내놓은 **첫 행의 그 컬럼 값**을 다른 노드 설정에 꽂는다.
`WHERE dt > '${집계.max_dt}'` 처럼 쓰면 실행할 때마다 「집계」 노드를 먼저 돌려 그 시점의 값이 들어간다.

`$변수`(API 트리거)와 **같은 치환 경로**를 타지만 출처가 다르다 — 하나는 호출자가 보낸 값,
하나는 파이프라인이 스스로 만든 값이다. 문법 단일 출처는 여전히 `schemas/variables.py`
(프론트 `canvas/variables.ts` 가 복제, 양쪽 테스트에 같은 사례).

### 왜 중괄호가 필수인가

노드 이름은 사람이 캔버스에서 붙인 이름이라 **한글·공백**이 들어간다. 경계 없이 `$` 뒤에 두면
어디까지가 이름인지 알 수 없다. 이름과 컬럼은 **마지막 점**으로 갈린다 — 컬럼 쪽이 점을 못 쓰게
막아서 그렇게 된다. 둘 중 하나는 점을 포기해야 하는데, 사람이 짓는 이름 쪽에 제약이 없는 편이 낫다.

**이름이 키다.** 그래서 노드 이름 중복 금지(`canvasStore.uniqueLabel`)가 이 기능의 전제다.
이름 비교는 앞뒤 공백·대소문자를 무시하며, 프론트의 유일성 기준과 `dag.node_by_label` 이 같아야 한다.

### 여러 행은 `${이름.컬럼[]}`

낱값(`${주문.id}`)은 **첫 행**이고, 대괄호를 붙이면 **모든 행**을 쉼표로 이어 붙인다 —
`WHERE id IN (${주문.id[]})`. 낱값과 목록은 만드는 방법이 달라 **키가 갈린다**(`주문.id` ↔ `주문.id[]`).
한 파이프라인에서 둘 다 쓸 수 있어야 하기 때문이다.

**SQL 자리에서는 따옴표를 우리가 붙인다.** 낱값은 사용자가 `'$since'` 로 감싸지만 목록은
원소마다 감싸야 해서 손으로 쓸 방법이 없다. 순서가 중요하다 — **가드를 통과시킨 뒤에** 붙인다.
뒤집으면 우리가 붙인 따옴표가 그대로 주입 통로가 된다. 숫자는 감싸지 않는다(문자열 비교가 된다).

두 가지를 조용히 넘기지 않는다: **빈 목록**(`IN ()` 은 문법 오류, `IN (NULL)` 로 때우면 빈 결과가
지나간다)과 **상한 초과**(`NODE_REF_LIST_CAP` = 1000). 잘린 `IN (...)` 은 실행도 되고 결과만
빠지는, 이 저장소가 가장 싫어하는 종류의 사고다. 그만큼 크면 조인으로 다룰 일이다.

낱값만 참조하면 peek 은 여전히 **첫 행에서 멈춘다** — 목록이 끼어 있을 때만 상한까지 읽는다.

### Python 노드는 문맥이 다르다

`transform.python` 의 `code` 는 SQL 이 아니라 **Python** 으로 조립된다. 그래서 치환 문맥을
하나 더 두었다 (`PY_CONTEXT_KEYS = {"code"}`). JSON 표기를 그대로 꽂으면 깨진다 —
`true`·`null` 은 Python 에서 NameError 이고, 따옴표 없는 문자 목록(`[Kim, Lee]`)도 마찬가지다.

- 목록·참거짓·없음 → Python 리터럴 (`['Kim', 'Lee']`, `True`, `None`). 문자열은 `repr` 로
  감싸 따옴표·역슬래시를 이스케이프한다 — 직접 감싸면 `O'Brien` 에서 깨진다.
- **문자열 낱값만 원문 그대로.** 사용자가 `x = "${집계.dt}"` 처럼 감싸는 것이 기존 규칙이라
  여기서 또 감싸면 `"'2026-08-01'"` 이 된다. 낱값은 직접, 목록은 자동 — SQL 과 같은 규칙이다.
- 주입 가드는 걸지 않는다. 목록 원소는 `repr` 로 문자열을 벗어날 수 없고 코드는 격리
  샌드박스에서 돈다. 여기서 따옴표를 막으면 정상적인 이름을 못 쓴다.

**데이터(행)는 변수로 넘기는 것이 아니다** — 엣지로 들어가 `transform(row)` 가 행마다 불린다.
변수는 그 코드에 꽂을 **설정값**을 위한 것이다.

### 소스 앞에는 트리거만 (2026-08-14 추가)

`_stream_of` 는 소스를 만나면 상류를 조립하지 않고 곧장 `read()` 한다. 그래서 **소스로
들어오는 엣지는 무시된다** — 소스→소스로 이어 두면 화면에는 이어져 보이고 실행도
성공하는데 상류 데이터만 조용히 사라진다. 가장 찾기 어려운 종류라 양쪽에서 막았다:
캔버스 `onConnect` 가 연결 자체를 거절하고, 검증이 기존 정의를 에러로 잡는다.
트리거만 예외다 — 데이터를 주는 게 아니라 "언제 도는지"를 정해 준다.

타깃 뒤·트리거 앞 규칙과 같은 계열이다. **못 하는 일은 그릴 수 없게 한다.**

### 실행 순서 의존이 새로 생겼다

참조는 엣지가 없어도 "먼저 돌아야 하는 노드"를 만든다. 그래서 **엣지 순환이 없어도 순환일 수 있다**
(A 가 B 의 결과를, B 가 A 의 결과를 참조). `dag.node_ref_dependencies()` 가 그 의존을 엣지처럼
세우고, 검증·엔진 양쪽이 그것을 합쳐 위상 정렬한다.

엔진은 실행 첫 단계에서 `_resolve_node_refs` 로 참조된 노드를 **한 번 더** 읽는다(첫 행까지만).
본 실행의 스트림을 재사용하려면 실행 순서를 참조에 맞춰 뒤집어야 하는데, 그러면 타깃 주도 풀
스트리밍이라는 모델 자체가 무너진다 — 첫 행만 읽는 비용이 훨씬 싸다.

**peek 은 본 실행의 집계에 끼어들면 안 된다** (`_isolated_progress`). 특히 워터마크: 첫 배치만 보고
얻은 부분 최대값이 체크포인트로 승격되면 다음 실행이 읽지 않은 구간을 영영 건너뛴다.

### 값이 없으면 시끄럽게 실패한다

참조한 노드가 행을 하나도 내지 않거나 그런 컬럼이 없으면 실행을 세운다. 빈 값으로 때우면
`WHERE dt > ''` 가 되어 전체 재적재가 조용히 일어난다 — `$변수` 에 대해 지켜 온 규칙 그대로다.

주입 가드도 그대로 걸린다. 오히려 **더 중요하다** — 트리거 변수는 호출을 받는 시점에 한 번
걸러지지만, 노드 결과는 원격 데이터에서 와서 실행 도중에야 정체를 안다.

### 결과 서랍 (캔버스 하단)

`{노드이름: 출력결과}` 를 모아 보여준다. 아이콘+이름 칩을 누르면 그 노드의 결과가 펼쳐지고,
컬럼을 누르면 `${이름.컬럼}` 이 복사된다. SQL/코드 편집기 왼쪽 변수 패널에도 같은 목록이 뜬다
(클릭하면 커서에 삽입).

- 근거 데이터는 `store.nodeResults` — `runState` 와 같은 샘플이지만 **수명이 다르다.**
  실행 상태는 새 실행마다 지워지고(낡은 성공 뱃지가 거짓말을 하면 안 되므로) 결과는 남는다.
- 그래서 엔진이 **전체 실행에서도** 노드마다 샘플을 남긴다 (`_sampled`, 노드당 10행).
  단일 노드 실행의 50행보다 짠 것은 노드 수만큼 곱해져 `node_states` jsonb 와 WS 페이로드를 불리기 때문.
- 타깃은 출력이 없으므로 **들어온 입력**을 샘플로 남긴다. 참조 대상으로는 쓸 수 없다(검증에서 거절).
- 트리거는 행이 아니라 **값**을 내보낸다. `runState.handed` 를 한 행짜리 결과로 바꿔 같은 서랍에
  올리되(`handedAsSample`), 쓰는 표기는 `${이름.컬럼}` 이 아니라 **`$이름`** 이다 — 노드 결과가
  아니라 트리거 변수이기 때문이고, `${웹훅.since}` 는 검증이 거절한다. 편집기 변수 패널에서는
  선언된 변수 목록과 겹치므로 트리거 항목을 뺀다.
- `handed` 는 **실제로 쓰인 값만** 담는다(엔진 `_apply_variables`). 값을 보냈는데 아무 노드도
  쓰지 않으면 서랍에 뜨지 않는다 — 호출 본문 덤프를 만들지 않으려는 기존 규칙 그대로다.

### 여기서 하지 않은 것

- 행 번호로 가리키기(`${주문[1].id}`). SQL 은 `ORDER BY` 없이 순서를 보장하지 않아
  다음 실행에도 같은 행이라는 보장이 없다. 첫 행과 전체(`[]`) 둘로 충분하다.
- 결과 집합을 **구조 그대로** 넘기기 (조인·룩업). 그건 노드로 다룰 일이다.
- 집계 함수(`${집계.max(dt)}`) — 필요하면 상류에 집계 쿼리를 두는 편이 명시적이다.
- CDC 소스 참조 — 상시 스트림이라 "첫 행"이 정해지지 않는다 (검증에서 거절).

---

## 18. 이기종 연합 조회 (DuckDB + polars)

### 무엇인가

SQL 편집기의 **「연합 조회」 탭**. 서로 다른 연결의 테이블을 한 SELECT 로 조인한다.

```sql
SELECT a.code, b.name, c.email
FROM   mysql_wms.wms.aaa a
JOIN   postgre_mes.mes.k123.bbb b ON b.id = a.id
JOIN   sqlsrv.shop.dbo.customers c ON c.id = a.id
```

`/connections/{id}/query` 는 한 연결 안에서만 돈다 — WMS 의 MySQL 과 MES 의 PostgreSQL 을
한 번에 보는 일은 그 경로로는 표현할 수 없다. 그래서 DuckDB 를 가운데 두고 각 연결을
카탈로그로 붙인 뒤(ATTACH) 한 문장으로 조인한다. 결과를 파이썬으로 꺼내는 구간은
polars 가 맡는다 (Arrow → 행, DECIMAL·DATE·LIST·STRUCT 를 정확히 푼다).

- 백엔드: `services/duck_service.py` · `routers/duck.py` (`POST /duckdb/query`, `/duckdb/export`)
- 프론트: `canvas/duckRefs.ts`(표기) · `SqlWorkbench mode='duck'` · SQL 편집기 페이지의 연합 탭

### DuckDB 를 사용자에게 보이지 않는다

ATTACH·DSN·카탈로그 별칭은 전부 서버가 만든다. **사용자가 아는 것은 「연결 관리」에
저장해 둔 이름뿐**이다. 그래서 문법이 `연결이름.…` 으로 시작한다.

### 단계 수가 타입마다 다르다 (우리가 정한 게 아니다)

```
MySQL             연결이름.데이터베이스.테이블
PostgreSQL·MSSQL  연결이름[.데이터베이스].스키마.테이블   ← 데이터베이스 생략 가능
```

규칙은 하나다 — **연결 이름 + 그 엔진의 정식 이름.** MySQL 의 정식 이름은
`데이터베이스.테이블`, PostgreSQL·SQL Server 는 `데이터베이스.스키마.테이블` 이라
단계 수가 갈린다. 뒤의 둘은 연결이 이미 데이터베이스를 알고 있으므로 그 자리를
생략할 수 있고, 그때는 연결 설정의 데이터베이스를 쓴다.

생략형이 헷갈리지 않는 이유는 그 엔진의 테이블이 **반드시 스키마 안에** 있기 때문이다.
3단계는 `스키마.테이블`, 4단계는 `데이터베이스.스키마.테이블` — 달리 읽힐 여지가 없다.
MySQL 에는 생략형을 두지 않는다. `연결.테이블` 2단계는 `별칭.컬럼` 과 구별할 수 없고
그쪽이 훨씬 흔하다.

DuckDB 는 붙인 커넥션 하나를 카탈로그 하나로 본다. **MySQL 은 커넥션 하나로 서버의 모든
데이터베이스가 보이고** DuckDB 가 그것을 스키마로 펼치므로 연결당 한 번만 붙이면 된다.
**PostgreSQL·SQL Server 는 커넥션이 데이터베이스 하나에 묶여** 다른 DB 를 보려면 따로 붙어야
하므로 (연결, 데이터베이스)마다 카탈로그를 만들고, 사용자가 쓴 데이터베이스 자리는
재작성에서 사라진다.

그리고 **DuckDB 자체 문법이 아니다.** DuckDB 는 3단계까지만 안다 — PostgreSQL 의 4단계를
그대로 넘기면 파싱되지 않는다. 실행 전에 참조를 찾아 카탈로그 이름으로 **바꿔 쓴다**(`rewrite`).

### 재작성이 손대는 것과 안 손대는 것

머리가 저장된 연결 이름과 일치하는 사슬만 바꾼다. CTE·서브쿼리 별칭까지 건드리면 멀쩡한
쿼리가 깨진다. 규칙 셋:

- **2단계는 일치해도 넘어간다** (`t.col`). 연결 이름과 같은 별칭을 쓰는 쪽이 훨씬 흔하다.
- **3단계 이상인데 단계 수가 안 맞으면 에러로 세운다.** 그 모양은 별칭일 수 없고, 조용히
  넘기면 DuckDB 가 "카탈로그가 없다"고만 말해 원인을 못 찾는다.
- 문자열 리터럴·주석 안은 건드리지 않는다. `mask_noise` 가 **길이를 보존하며** 덮는 이유가
  이것이다 — 원문의 그 자리를 바꿔야 해서 위치가 어긋나면 안 된다. 큰따옴표는 덮지 않는다
  (SQL 에서 그것은 문자열이 아니라 식별자이고 `"운영 MySQL".wms.aaa` 처럼 참조의 일부다).

### 이름에 하이픈이 있으면 큰따옴표가 필수다

`pg-target.warehouse.public.t` 는 SQL 에서 `pg` **빼기** `target.warehouse.public.t` 로 읽힌다 —
참조가 아예 성립하지 않는다. 연결 이름은 사람이 짓는 것이라 하이픈이 흔하므로
`"pg-target".warehouse.public.t` 처럼 감싸야 한다.

그래서 **안내에 이름을 실을 때는 필요하면 인용해서 보여 준다**(`display_name`). 목록을
그대로 복사했는데 안 되는 것만큼 나쁜 안내가 없다. 참조를 하나도 못 찾았을 때는 그냥
"못 찾았다"로 끝내지 않고 두 흔한 원인을 짚는다(`no_reference_error`) — 인용을 빠뜨린 경우와
MongoDB 처럼 붙일 수 없는 연결을 가리킨 경우. 그 연결은 목록에 아예 없어서 오타만 의심하게 된다.

트리 클릭·자동완성·새 탭 예시는 전부 `quotePart` 를 거치므로 처음부터 인용된 이름이 들어간다.

### 반대 방향 — 연합 표기를 일반 탭에 넣었을 때

같은 표기를 일반 쿼리 탭에 붙여 넣으면 SQL 이 그대로 그 연결로 나가고 엔진은
`Invalid object name` 이라고만 답한다. **표기가 틀린 게 아니라 탭을 잘못 고른 것**인데
그걸 알 방법이 없다. 그래서 일반 조회가 실패했을 때 SQL 에 저장된 연결 이름이 보이면
안내를 덧붙인다(`connection_service._federation_hint` → `duck_service.federation_reference_hint`).

**이미 실패한 쿼리에만** 붙는다. 미리 막지 않는 이유는 오탐이다 — 연결 이름과 같은 이름의
데이터베이스가 실제로 있을 수 있고, 그때 멀쩡한 쿼리를 세우는 편이 훨씬 나쁘다.

### 붙이는 순서가 곧 안전장치다

1. 확장(postgres·mysql)을 올린다 → 2. 필요한 카탈로그를 **READ_ONLY** 로 붙인다 →
3. `disabled_filesystems` 로 로컬 파일 접근을 끊는다 → 4. 그제서야 사용자 SQL 을 돌린다.

거꾸로 할 수 없다. `ATTACH ... (TYPE MYSQL)` 도 파일 시스템 계층을 거치므로 **먼저 잠그면
붙는 것 자체가 막히고**, 이 설정은 되돌릴 수도 없다(DuckDB 가 재활성화를 거부한다).
그래서 카탈로그가 늘어날 때마다 허브를 새로 만들어 "붙인다 → 잠근다"를 다시 한다.
한 번 쓴 조합이 대부분 다시 쓰이므로 재구축은 처음 몇 번뿐이다.

예전 허브는 **닫지 않고 참조만 놓는다** — 다른 스레드가 그 커서로 아직 조회 중일 수 있다.

### 자격증명은 연결 문자열이 아니라 DuckDB 시크릿으로

`CREATE SECRET` 을 만들고 `ATTACH '' … (SECRET …)` 으로 붙인다. ATTACH 에 연결 문자열을
직접 넘기지 않는 이유가 셋이다.

1. **파싱 규칙이 확장마다 다르다.** MySQL 확장은 값의 따옴표를 벗기지 않고(`host='h'` →
   호스트 이름이 `'h'` 가 된다) 포트는 정수로 곧장 읽는다(`port='3306'` → `invalid stoi
   argument`). 감싸도, 안 감싸도 어느 한쪽이 깨진다.
2. 그래서 **공백·따옴표가 든 비밀번호를 안전하게 실을 방법이 없다.** 시크릿 옵션은 평범한
   SQL 문자열 리터럴이라 `''` 이스케이프 하나로 끝난다.
3. **실패 메시지에 자격증명이 안 실린다.** ATTACH 는 실패하면 연결 문자열을 그대로 에러에
   담는다. 시크릿을 쓰면 그 자리가 빈 문자열이고 `duckdb_secrets()` 에도 `redacted` 로만 보인다.

### polars 가 필요한 지점

`pl.from_arrow(...).to_dicts()` 하나다. 폴백이 있는 이유는 polars 가 아직 Arrow 의
INTERVAL(month_day_nano)을 못 읽어서다 — 그때는 Arrow 에서 직접 꺼내고 JSON 이 모르는
값만 문자열로 눕힌다. 컬럼 하나 때문에 조회 전체가 실패하는 편이 훨씬 나쁘다.

(`write_ndjson` 은 쓰지 않는다. BLOB 컬럼에서 **러스트 패닉**이 난다.)

### 화면

- **탭 종류를 나누지 않는다.** 연결 선택 드롭다운의 맨 위 항목 「연합 조회」를 고르면
  그 탭이 연합 조회가 된다. 사용자가 "이 탭이 무엇을 조회하는가"를 한 곳에서만 정하게
  하려는 것이다 — 별도 탭 버튼을 두면 같은 결정을 두 군데서 하게 된다.
  세션은 `connId === DUCK_CONN` 으로 그 상태를 담는다(예전 `kind: 'duck'` 은 이관한다).
- 고르면 툴바에 Python 버튼과 표기 안내가 붙고, 다른 연결로 되돌리면 사라진다.
  **SQL 은 어느 쪽으로 바꿔도 보존한다.**
- 연합으로 바꿀 때 편집기가 **손대지 않은 기본값일 때만** 저장된 연결 이름으로 채운
  예시를 넣는다(`duckStarter`). 쓰던 SQL 을 덮어쓰는 것이 더 나쁘다.
- 왼쪽 「연결」 트리에서 테이블을 누르면 **데이터베이스까지 적은 전체 이름**이 들어간다.
  생략형은 손으로 칠 때의 편의고, 넣어 주는 이름은 어느 데이터베이스인지 보이는 편이 낫다.
  MySQL·PostgreSQL 이 아니면 넣지 않고 안내를 띄운다.
- 자동완성은 일반 SQL 과 별도 소스다(`makeDuckCompletion`) — 같은 이름의 테이블이 연결마다
  있을 수 있어 어느 연결인지를 항목에 함께 보여 줘야 고를 수 있다.
- 저장된 쿼리는 `mode: 'duck'` 으로 갈무리된다. 일반 탭에 열면 연결이 없어 실행이 막힌다.

### 지원 범위와 그 이유

**MySQL · PostgreSQL · SQL Server.** 기준은 "공식이냐"가 아니라 **`ATTACH` 를 등록하는
확장이 있느냐**다.

- `postgres`·`mysql` — 코어 확장
- `mssql` — **커뮤니티 확장**이라 `INSTALL mssql FROM community` 로 받아야 한다.
  코어와 달리 배포 플랫폼에 빌드가 없을 수 있어, 이미지 굽기는 **선택**으로 두고
  (`scripts/bake_duckdb_extensions.py`) 허브도 **이번 쿼리가 쓰는 타입만** 필수로 올린다.
  MSSQL 확장이 없는 환경에서 MySQL·PostgreSQL 조회까지 막히면 안 되기 때문이다.

MongoDB 는 낄 수 없다. `odbc_scanner` 도 마찬가지인데 이유가 다르다 — **설치·로드는 되지만
`ATTACH … (TYPE ODBC)` 를 등록하지 않는다**(`Unrecognized storage type`). 제공하는 것이
`odbc_query(...)` 같은 함수뿐이라 카탈로그가 없고, 카탈로그가 없으면 `연결이름.…` 을
재작성할 대상도 조인·자동완성도 성립하지 않는다.

`DUCK_TYPES` 는 `duck_service.py` 와 `duckRefs.ts` 양쪽에 있다. **한쪽만 늘리면 화면에는
보이는데 실행이 거부된다.**

확장 이름 주의: `duckdb_extensions()` 가 보고하는 이름은 INSTALL 이름과 다르다
(`mysql` → `mysql_scanner`). 올라간 확장을 그 뷰로 되묻지 말 것 — `_new_hub` 가 직접 세어
돌려준다. 한 번 어긋나면 **모든 카탈로그가 조용히 건너뛰어진다.**

### 배포

확장은 이미지에 구워 둔다(`apps/api/Dockerfile` → `EAI_DUCKDB_EXTENSION_DIR`). 폐쇄망에서도
돌고 첫 조회가 네트워크를 기다리지 않는다. `mssql` 은 커뮤니티 빌드가 없을 수 있어
**실패해도 빌드를 세우지 않는다** — 그 타입 연결을 실제로 쓸 때만 런타임이 분명한 오류를 낸다. DuckDB 는 api 프로세스 안에서 돌므로 조인이
커지면 그 메모리를 api 가 그대로 쓴다 — `EAI_DUCKDB_MEMORY_LIMIT`(기본 1GB)로 막는다.

### 파이썬 코드로 내보내기

연합 탭 툴바의 **Python** 버튼. 지금 쓴 쿼리를 **붙여 넣고 바로 돌아가는 스크립트**로
바꿔 준다 (`POST /duckdb/script` → `services/duck_script.py`).

편집기에서 쿼리를 맞춰 놓고 나면 다음에 하는 일은 대개 정해져 있다 — 노트북에 붙이거나,
배치로 돌리거나, 동료에게 보내는 것. 그때마다 ATTACH·시크릿 조립을 손으로 다시 쓰는 것은
이 기능이 애초에 없애려던 수고다.

지키는 것 셋:

- **비밀번호는 넣지 않는다.** 코드는 복사되고 커밋된다 — 한 번 새면 되돌릴 수 없다.
  자리는 환경변수(`EAI_PW_<별칭>`)로 두고 무엇을 채워야 하는지 머리말과 팝업 상단에 적는다.
  접속 정보(host·port·user)는 넣는다 — 그것까지 빼면 붙여 넣어도 못 돌린다.
- **SQL 도 바꿔 넣는다.** 편집기 문법(`연결이름.데이터베이스.테이블`)은 EAI 안에서만 통한다.
- **별칭은 읽을 수 있게.** 실행 경로의 해시(`eai_37e8…`)가 늘어서 있으면 어느 연결인지
  알 수 없다. 연결 이름을 식별자로 다듬고 겹치면 데이터베이스·번호를 붙인다
  (`script_alias_factory`). 원래 이름은 주석으로 남긴다.

생성 코드에는 파일 잠금(`disabled_filesystems`)을 **넣지 않는다.** 그건 남의 SQL 을 받는
서버의 사정이고, 자기 스크립트를 자기가 돌리는 자리에서는 디스크 스필만 막아 손해다.

### 여기서 하지 않은 것

- **쓰기.** 단일 SELECT/WITH 만 통과하고 ATTACH 는 전부 READ_ONLY 다.
- 파이프라인 노드로서의 연합 조회 — 지금은 SQL 편집기 전용이다. 노드로 만들려면
  워커에도 DuckDB 를 넣어야 하고, 스트리밍(타깃 주도 풀) 모델과 어떻게 맞출지가 먼저다.
- 연결에 적힌 것 말고 **다른 데이터베이스 목록 탐색** — 트리는 연결 설정의 `database`
  하나만 보여 준다. SQL 에 직접 쓰면 다른 DB 도 붙는다(MySQL 은 같은 카탈로그,
  PostgreSQL 은 카탈로그를 하나 더 만든다).

---

## 19. 저장됨 트리 — 쿼리와 파이프라인을 한 트리에서

### 무엇인가

SQL 편집기 왼쪽 **「저장됨」 탭**이 쿼리뿐 아니라 **파이프라인까지 담는다.** 폴더의 `+` 를
누르면 [폴더] · [쿼리] 옆에 [파이프라인] 이 있고, 누르면 서버에 파이프라인을 만들어
그 폴더에 놓은 뒤 **탭으로 연다.** 그 탭에는 SQL 편집기 대신 **캔버스(React Flow)** 가 뜬다.

- 저장소: `api/savedStore.ts` (`SavedFolder.pipelines: SavedPipeline[]`)
- 트리: `components/SavedQueries.tsx` · 실행 이력 `components/RunHistory.tsx`
- 탭: `pages/SqlEditor.tsx` (`Session.pipelineId`) → `pages/Canvas.tsx` (`embedded`)

**백엔드는 손대지 않았다.** 필요한 것이 이미 다 있다 —
`POST/GET /pipelines`, `GET /runs?pipeline_id=`, `PATCH /pipelines/{id}`, `WS /runs/{id}/stream`.

### 왜 트리를 나누지 않았나

처음엔 「파이프라인」 특수 탭을 따로 만들었다가 물렸다. 같은 업무를 쿼리로도 파이프라인으로도
다루는 일이 흔한데, 트리가 둘이면 **"어디에 넣었더라"를 두 군데서 찾게 된다.**

대신 담기는 것이 다르다는 사실은 숨기지 않는다.

| | 쿼리 | 파이프라인 |
|---|---|---|
| 트리에 있는 것 | **본문 그 자체** | 서버 항목을 가리키는 **참조**(`pipelineId`) |
| × 의 뜻 | 쿼리를 지운다 | **트리에서 빼기만** 한다 (파이프라인은 남는다) |
| 폴더 삭제 | 안의 쿼리도 사라진다 | 안의 파이프라인은 「미분류」로 돌아간다 |

이름·상태를 트리에 복제하지 않는다 — 복제하면 서버에서 바꿨을 때 트리만 옛 이름을 들고
있게 된다. 화면은 `GET /pipelines` 목록과 맞춰 그리고, **어느 폴더에도 없는 것은 「미분류」로
항상 보인다.** 캔버스에서 만든 것이 트리에서 조용히 사라지면 "왜 안 보이지"부터 시작해야 한다.

목록에 없는 id(서버에서 지워진 것)는 **감추기만 하고 트리에서 지우지 않는다.** 목록을 아직
못 받은 순간에 트리를 고쳐 쓰면 남은 배치까지 날아간다.

### 끄는 것이 네 가지다

`query` · `folder` · `pipeline`(폴더에 담긴 항목) · `loose`(미분류 파이프라인). 뒤의 둘을 한
종류로 묶을 수 없다 — **빼는 것과 담는 것은 하는 일이 반대**이고, 가리키는 id 도 다르다
(트리 항목 id ↔ 파이프라인 id). 폴더 밖(root)으로 끌 수 있는 것은 폴더(최상위로)와
폴더에 담긴 파이프라인(미분류로 빼기)뿐이다.

### 새 탭은 본문이 모인 도크로

트리에서 쿼리·파이프라인을 열면 **본문 탭이 가장 많은 도크**에 붙는다(`contentDock`).
포커스한 도크에 넣으면 방금 트리를 눌렀다는 이유로 그 트리 옆에 편집기가 생긴다 —
패널(연결·저장됨·즐겨찾기)은 좁게 두고 쓰는 칸이라 본문이 끼어들면 둘 다 못 쓴다.
같은 수가 여럿이면 포커스한 도크를 고른다. 도크의 `+` 버튼은 예외다 — 그건 "여기에"라는
뜻이라 그 도크에 그대로 넣는다.

### 불러오기는 덮어쓰지 않는다

저장된 쿼리를 클릭하면 **새 탭**으로 연다. 전에는 포커스한 탭에 덮어썼는데 쓰던 쿼리가
소리 없이 사라졌다. 트리를 누르는 것은 "이것도 열어 보자"이지 "지금 것을 버리자"가 아니다.

이미 그 항목을 연 탭이 있으면 새로 만들지 않고 그 탭을 앞으로 가져온다(`savedId` 로 찾는다)
— 같은 저장 쿼리가 두 탭에 있으면 어느 쪽 편집이 저장되는지 알 수 없다. 파이프라인도 같다.

내비게이터에서 **테이블**을 누르는 것은 여전히 지금 탭에 꽂는다. 그건 "이 쿼리에 넣어라"라서
성격이 다르다.

### 캔버스는 한 번에 하나만 산다

`useCanvasStore` 는 **모듈 전역 싱글턴**이다. 파이프라인 탭을 둘 띄우면 나중에 뜬 쪽이 앞의
그래프를 덮어써 **보고 있는 것과 저장되는 것이 달라진다.** 그래서 소유하지 않은 탭은
캔버스를 **아예 마운트하지 않고** [여기서 편집] 만 보여 준다.

- 넘겨받을 때 앞 탭에 **저장하지 않은 변경이 있으면 먼저 묻는다.** 조용히 빼앗으면 그린 것이
  사라지고, 사라졌다는 사실조차 알 수 없다.
- 저장할 것이 없으면 탭을 고르는 것만으로 **조용히 넘어간다.** 잃을 게 없는데 한 번 더 누르게
  하면 탭 전환마다 손이 간다.
- 소유 탭이 닫히거나 새로고침으로 비면 앞에 나와 있는 파이프라인 탭이 이어받는다.

제대로 여러 개를 동시에 편집하려면 스토어를 팩토리+Context 로 바꿔야 한다. 그때는
이 스토어를 쓰는 10개 파일(ConfigPanel·Palette·EaiNode·ResultDrawer…)을 함께 손봐야 한다.

### 캔버스를 탭에 넣기

`Canvas` 가 `pipelineId` 를 **prop 으로도** 받는다. 라우트(`/canvas/:id`)에서는 경로 파라미터,
탭에서는 prop 이다 — `propId ?? params.pipelineId`. `embedded` 는 페이지 여백을 걷어내는
클래스 하나(`.view.canvas-embed`)만 바꾼다.

숨은 탭에서도 **마운트는 유지한다**(`display:none`). 언마운트하면 저장 안 한 편집이
탭을 옮길 때마다 사라진다.

### 실행 이력

파이프라인 줄의 화살표를 누르면 그 자리에서 최근 20건이 펼쳐진다. **펼쳤을 때만
마운트되므로 접혀 있으면 조회하지 않는다** — 트리에 파이프라인이 많은데 전부 이력을
끌어오면 패널을 여는 것만으로 느려진다.

한 건을 누르면 **실행 상세 팝업**(모니터와 같은 `RunDetail`)이 열린다. 탭은 캔버스라 이력을
담을 자리가 없고, 이미 있는 화면을 또 만들 이유도 없다.

### 잠깐 있었던 「파이프라인」 특수 탭 (-3)

별도 탭으로 만들었다가 이 구조로 옮겼다. 이미 배치에 박힌 브라우저가 있어
`stripDeadPipeTab` 이 저장된 워크스페이스에서 조용히 빼낸다. `validWorkspace` 에서
걸러 내지 **않는** 이유는, 거기서 걸러 내면 워크스페이스를 통째로 버려 배치가 날아가기
때문이다. 그 탭이 활성이었으면 활성도 옮긴다 — 없는 탭이 활성이면 본문이 빈다.

### 여기서 하지 않은 것

- **트리에서 파이프라인 삭제(서버).** 실행 이력·체크포인트가 함께 사라지는 일이라
  왼쪽 목록의 × 가 할 일이 아니다. 트리에서 빼기만 한다.
- **트리에서 파이프라인 이름 바꾸기.** 이름은 서버가 진실이고 고치는 자리는 캔버스다.
- **폴더 배치의 서버 저장.** 쿼리와 같은 전제 — 기기·브라우저 로컬(`eai_saved_queries_v1`).
- 파이프라인 탭 여러 개 동시 편집 (위 싱글턴 항목).


---

## 20. 실시간 DB 동기화 (SymmetricDS)

기획안: `docs/SYMMETRICDS_실시간동기화_기획안.md`. 운영 안내: `sync/symmetricds/README.md`.

### 무엇인가

캔버스 노드 셋 — **동기화 트리거 → MSSQL(실시간 동기화) → 동기화 타깃 DB**.
원본 SQL Server 가 CDC 를 못 쓰는데(구버전·에디션) 실시간성이 요건일 때 쓴다.
SymmetricDS 가 원본 테이블에 트리거를 심어 변경을 잡고, 노드끼리 **HTTP 로 직송**한다.
Kafka 가 없다.

### 이 기능만 다른 점 하나 — 데이터가 워커를 지나지 않는다

배치도 CDC 도 결국 우리 프로세스를 통과한다. 동기화는 아니다. SymmetricDS 가 원본에서
타깃 DB 로 **직접** 옮긴다. 그래서 변환·컬럼 매핑·다중 타깃이 전부 성립하지 않는다.

이걸 그릴 수 있게 두면 화면에는 이어져 보이는데 아무 일도 안 일어난다 — §17 의 「소스 앞
엣지」와 같은 계열이라 같은 방식으로 막았다. **양쪽에서** 막는다:
캔버스 `onConnect` 가 소스→(동기화 타깃 아님) 과 (동기화 소스 아님)→타깃 을 거절하고,
`_sync_pipeline_issues` 가 저장된 정의에서 변환 노드 존재 자체를 에러로 잡는다.

컬럼 단위 가공이 필요하면 CDC 경로를 쓰거나 타깃에서 뷰로 처리한다.

### 스트림 모델은 CDC 와 공유한다

`CdcStream` 에 `engine`(debezium | symmetricds)을 더해 갈랐다. 새 테이블을 만들지 않은
이유는 **수명주기·상태 enum·모니터 화면이 완전히 같기** 때문이다 — 다른 것은 "무엇이
변경을 잡아 어디로 보내는가" 뿐이다. 마이그레이션 0007 은 `engine` 에 서버 기본값
`debezium` 을 둔다(기존 행이 전부 그것이라 없으면 NOT NULL 추가가 실패한다).

분기는 **라우터에** 둔다(`routers/streams.py._engine_of`). 서비스 안에 두면 `cdc_service` 와
`sync_service` 가 서로를 임포트한다. 라우터는 원래 둘 다 알아도 되는 자리다.

### 공식 이미지에 REST API 가 없다 (실측)

`jumpmind/symmetricds:3.15`(3.15.22)에는 REST 모듈이 **아예 들어 있지 않다** —
`find / -iname '*rest*'` 가 한 건도 없고 `rest.api.enable=true` 를 켜도 `/api/*` 는 404 다.
그래서 사이드카 확인은 REST 가 아니라 **동기화 서블릿**을 두드린다. 응답 코드도 실측했다:

두드리는 곳은 **`/sync/{engine}/pull`** 이다. 하위 경로 없이 `/sync/{engine}` 만 부르면
엔진이 살아 있는데도 602 가 나온다 — 엔진 개수에 따라 답이 달라져 믿을 수 없다.
`pull` 은 읽기 전용이고 노드 id 를 요구해 존재 여부만 깔끔히 갈린다
(`registration` 은 실제 등록을 시도하므로 쓰면 안 된다).

| 코드 | 본문 | 뜻 |
|---|---|---|
| 659 | `Missing node ID or security token` | 엔진이 **있다** |
| 602 | `No engine here with that name` | 그 이름의 엔진이 **없다** |
| 603 | `No matching URI handler` | (구성에 따라) 이름이 없을 때 |

`ENGINE_MISSING_CODES` 가 602·603 을 함께 담는다. 한쪽만 담으면 이름이 틀린 경우를
'있음'으로 읽어, **켜도 데이터가 안 오는데 점검은 통과**한다.

### 소스 엔진에 auto.registration 이 필요하다

없으면 타깃이 영영 붙지 못한다 — `was not allowed to register` · `Registration is not open`
이 반복되고, 설정은 다 들어갔는데 데이터만 한 건도 가지 않는다. 기획안에 없던 항목이라
실환경에서 처음 드러났다. 노드 둘을 우리가 관리하는 구성이라 자동 등록으로 둔다.

### 컨테이너는 포그라운드로 띄워야 산다

공식 이미지의 기본 명령이 `sym_service start && tail -F …` 다 — **데몬으로 띄우고 로그만
본다.** PID 1 이 `tail` 이라 자바 서비스 래퍼가 스스로를 "abandoned" 로 판단하는 순간
컨테이너가 통째로 죽는다(`Stopping abandoned wrapper` 반복 후 exit 129). 몇 분 멀쩡히
돌다 조용히 사라지므로 원인을 엉뚱한 데서 찾게 된다 — 실제로 WSL 탓으로 오해했다.

compose 에서 `sym --server` 로 덮어쓴다. PID 1 이 곧 SymmetricDS 라 죽으면 도커가 알고,
`restart: unless-stopped` 가 되살린다.

### 컨테이너 경로도 실측해야 했다

설치 경로는 `/opt/symmetric-server` 가 **아니라 `/opt/symmetric-ds`** 다. 처음에 틀린 데
마운트해서 컨테이너는 멀쩡히 뜨는데 `No engine *.properties files found` 로 엔진이 하나도
없었다 — 화면상 정상, 동기화만 안 되는 상태였다.

JDBC 드라이버는 **공식 이미지에 이미 있다** — `/opt/symmetric-ds/lib` 에 mssql-jdbc·
postgresql·mysql·oracle·jtds. (처음에 `ls | head` 로 앞 10개만 보고 "h2 뿐"이라 단정했다가
틀렸다. 목록을 자를 때는 그것으로 없음을 결론짓지 말 것.) 버전을 바꿔야 할 때만
`sync/symmetricds/Dockerfile` 의 `COPY` 로 넣는다 — 그 디렉터리를 호스트 디렉터리로 덮으면
이미 있는 jar 들이 가려져 서버가 뜨지 못한다.

### 설정은 REST 가 아니라 SQL 이다

SymmetricDS 의 설정은 **설정 파일이 아니라 원본 DB 안의 테이블**이다
(`SYM_TRIGGER`·`SYM_ROUTER`·`SYM_TRIGGER_ROUTER`·`SYM_CHANNEL`). 그래서 우리가 소스 연결로
직접 써 넣는다. REST(`symmetric_client`)는 딱 하나를 위해 쓴다 — "방금 넣은 설정을 지금
반영하라"(`synctriggers`).

이 의존이 얕은 것이 설계의 핵심이다. **REST 가 죽어도 동기화는 산다** — 안 부르면
sync-triggers 잡이 다음 주기에 반영하므로 늦을 뿐 틀리지 않는다. 그래서
`SymmetricUnavailableError` 는 `DependencyError` 가 아니고, 호출부가 잡아 경고로 낮춘다.

지표도 REST 가 아니라 SQL 이다(§7·§11 의 모니터링 쿼리). 사이드카가 죽어도 "무엇이 밀려
있는지"는 보여야 하고, 그 진실은 원본 DB 안에 있다.

### 값은 전부 바인드 파라미터다

`symmetric_config` 는 `(sql, params)` 쌍을 만든다. SYM_* 에서는 **테이블 이름조차 식별자가
아니라 데이터**라(`source_table_name` 은 그냥 VARCHAR) 문자열을 조립할 자리가 없다.
식별자로 들어가는 것은 테이블 접두어 하나뿐이고 `SyncPlan.__post_init__` 이 형식을 강제한다 —
그 검사가 `plan.table()` 의 전제다.

행 필터(`row_filter`)만은 성격이 다르다. SymmetricDS 가 subselect 라우터의 WHERE 조각으로
**실행하는** 임의 SQL 이라, 이 값을 넣는 것은 소스 DB 에 SQL 을 쓰는 것과 같은 권한이다.
그래서 OPERATOR 역할로 제한된다.

### 라우터를 테이블마다 만든다 (문서와 다른 점)

기획안 5-6 은 라우터 하나에 트리거 여럿을 붙였다. 우리는 테이블마다 만든다 —
타깃 테이블명과 행 필터가 라우터에 붙어 있어서, 공유하면 테이블 하나에 필터를 걸 때
나머지가 함께 걸린다.

### 지연은 라우팅 주기가 정한다 (푸시가 아니다)

지연을 만드는 것이 **둘**이고, 실측 16초는 그 둘이 겹친 값이었다.

1. `job.routing.period.time.ms` 가 기본 **10초**다. 트리거는 즉시 잡지만 배치가 그때까지
   안 만들어져, 푸시를 1초로 낮춰도 소용이 없다.
2. **푸시로 돌지 않고 있었다.** SymmetricDS 가 노드 등록 중 `SYM_NODE_GROUP_LINK` 를
   기본값 `W`(풀 대기)로 먼저 만드는데, `build_group_statements` 가 "이미 있으면 건너뛴다"
   여서 우리가 넣으려던 `P` 가 한 번도 적용되지 않았다. 타깃이 10초마다 당겨가고 있었다.

②가 이 저장소가 싫어하는 종류다 — 설정은 다 들어갔고 오류도 없는데 동작만 다르다.
그래서 지금은 **넣기만 하지 않고 `P` 로 강제**한다(있으면 UPDATE). 테스트가 이를 못박는다.

대가는 소스 DB 조회가 잦아지는 것이다. **부하 테스트는 운영에 쓸 주기 그대로 재야 한다** —
10초로 재고 1초로 운영하면 그 측정은 아무것도 보장하지 않는다.

### 일시정지는 채널을 끄지 않는다

채널은 스트림끼리 **공유**한다. 끄면 남의 동기화까지 멈춘다.
`SYM_TRIGGER_ROUTER.enabled` 를 내리면 트리거는 그대로 남아 변경이 `SYM_DATA` 에 계속
쌓이고, 재개하면 밀린 것이 이어서 흘러간다 — 이게 '일시정지'의 뜻에 맞다.
대신 길어지면 **원본 DB 용량이 늘어난다.** 지표의 `pending_rows` 가 그것을 드러낸다.

같은 이유로 정지는 우리가 심은 트리거·라우터만 지우고 채널·노드 그룹은 남긴다.

### 정지·재개는 등록 당시 목록으로 한다

`stream.config.tables` 에 무엇을 심었는지 남겨 두고 거기서 읽는다. DAG 를 다시 읽으면
그 사이 파이프라인이 수정됐을 때 **지우지 못한 트리거가 원본에 남는다** — 아무도 모르는
채로 계속 도는 트리거가 이 기능에서 가장 나쁜 결과다.

### 착수 게이트를 코드로 만들었다

기획안 §1 이 "확정 전에 코드를 작성하면 재작업"이라 못 박은 항목을 사람이 아니라 코드가
확인한다(`sync_service.preflight`). 원본을 **읽기만** 하므로 몇 번 눌러도 안전하다.

등급이 곧 "막느냐"다:
- `error` — 테이블 존재·**기본키**·트리거 권한·SYM_* 생성 권한·접속. 통과해야 시작된다.
- `warning` — **복제본 용도**와 **부하 테스트.** 코드가 판정할 수 없다.
- `info` — 서버 버전·에디션.

뒤의 둘을 `error` 로 두지 않은 이유가 중요하다. 막으면 문서 §8 이 요구한 **파일럿 구축
(부하 테스트를 하기 위한 전제)** 자체가 불가능해진다. 게이트는 운영 전환 앞에 있지
파일럿 앞에 있지 않다.

2016 이상이면 CDC 가 Standard 에서도 되므로 경고로 알린다 — 그쪽이 트리거 부하가 없다.

### 한글은 캡처 단계에서 죽는다 (실환경에서 드러남)

SymmetricDS 는 변경분을 `SYM_DATA.row_data` 에 문자열로 담는다. 그 컬럼이 `varchar` 인데
소스 DB 콜레이션이 유니코드가 아니면(`SQL_Latin1_General_CP1_CI_AS` 등) 트리거가 `nvarchar`
한글을 담는 순간 글자마다 `?` 가 된다. **원본 DB 안에서 이미 손실**되므로 타깃을 UTF-8 로
만들어도 소용없다 — 복제는 성공하고 글자만 깨지는, 가장 늦게 발견되는 종류다.

소스 엔진의 `mssql.use.ntypes.for.sync=true` 가 답인데 **SYM_* 를 처음 만들 때만 반영된다.**
그래서 preflight 에 `unicode_capture` 를 두어 시작을 막는다 — 대상 테이블에 n-타입 컬럼이
있는데 `SYM_DATA.row_data` 가 varchar 면 에러다. SYM_* 가 아직 없으면 판정할 수 없으므로
경고로 미리 알린다(그때 켜야 고칠 수 있다).

### 타깃 테이블명은 시작할 때 확정한다

PostgreSQL 은 인용하지 않은 식별자를 소문자로 접는다(`INVENTORY` → `inventory`).
매핑이 없으면 `extract_sync_spec` 이 **소문자로 내려 확정**하고, 무엇으로 등록했는지를
`stream.config.tables` 에 남긴다. 조용히 바꾸지 않으려는 것이다 — 저장 시점에도 경고가 뜬다.

### SYM_* 를 전용 DB 로 뺄 수 있다

SymmetricDS 는 테이블 45개를 만든다 — 대상이 1개든 200개든 고정이다. 운영 DB 의 `dbo` 가
더러워지는 것이 부담이면 소스 노드의 `sync_database` 로 전용 DB 를 지정한다.

`SYM_TRIGGER.source_catalog_name` 에 업무 DB 이름이 들어가고, 트리거는 업무 테이블에 붙되
캡처는 전용 DB 로 간다. 실환경에서 확인했다 — **`DB_CHAINING` 은 필요 없고**(OFF 로도 됨)
전용 DB 접근 권한만 있으면 된다. 두 DB 는 같은 인스턴스여야 한다(트리거가 같은 트랜잭션에서 쓴다).

우리 쪽 구현에서 갈린 것은 **접속 두 갈래**다. 업무 테이블 메타(존재·PK·권한)는 소스
연결로 보고, SYM_* 는 `_config_connector` 로 본다 — 소스 연결의 접속 정보에서 `database`
만 갈아 끼운 것이다. 연결을 두 개 만들게 하지 않는 이유는, 두 값이 어긋나면 설정은 A 에
들어가고 복제는 B 에서 일어나기 때문이다. 이 커넥터는 **캐시하지 않으므로 반드시 닫는다**
(`_release`) — 캐시 키가 연결 id 라 DB 만 다른 커넥터끼리 서로를 덮어쓴다.

정지·지표는 노드 설정이 아니라 `stream.config.sync_database`(등록 당시 값)로 붙는다.
그 사이 설정이 바뀌었으면 엉뚱한 DB 를 건드리게 된다 — `tables` 를 남기는 이유와 같다.

**격리는 되지 않는다.** 트리거는 업무 테이블에 그대로 붙고, 전용 DB 가 꽉 차면 업무 쓰기가
실패한다. 눈에서 치우는 것이지 위험을 나누는 것이 아니다.

### 접속 정보가 두 군데 있다 (없앨 수 없다)

EAI 연결(암호화 저장)과 `sync/symmetricds/engines/*.properties` 양쪽에 있다.
SymmetricDS 는 **기동 시점에 파일에서 읽는 Java 프로세스**라 우리 연결 저장소를 볼 수 없다.
§16 에서 SAP 접속 정보를 연결로 옮긴 것과 상황이 다르다 — 거기는 사이드카가 우리가 만든
FastAPI 라 요청 body 로 받을 수 있었다.

둘이 **다른 DB 를 가리키면** 설정은 A 에 들어가고 복제는 B 에서 일어난다.
착수 점검이 잡아내지 못하는 종류라 README 에 못을 박아 두었다.

### 지원 범위

**소스 MSSQL · 타깃 PostgreSQL.** 기준은 기획안의 방향이자 사이드카에 넣어 둔 JDBC 드라이버다.
`SYNC_SOURCE_TYPES`(sync_service) 와 `SYNC_TARGET_TYPES`(dag.py) 가 그것을 정한다.
늘리려면 드라이버부터 넣어야 한다.

`SYNC_CHANNELS`·`SYNC_PURPOSES` 는 `dag.py` 와 `web/src/api/types.ts` **양쪽에** 있다.
한쪽만 늘리면 화면에는 보이는데 저장이 거부된다 (`DUCK_TYPES` 와 같은 주의).

### 여기서 하지 않은 것

- **변환·컬럼 매핑.** 위 구조상 불가능하다. 필요하면 CDC 경로나 타깃 뷰.
- **소스를 여럿, 타깃을 여럿.** 노드 그룹 링크가 소스↔타깃 한 쌍이다.
- **엔진 properties 자동 생성.** SymmetricDS 가 기동 시점에 읽어서, 만들어도 재시작이 필요하다.
- **실제 SQL Server·SymmetricDS E2E.** 단위 테스트로만 검증했다. REST 경로는 릴리스마다
  달라질 수 있어(기획안 §13) 실환경에서 대조 확인이 필요하다 — 다만 실패해도 설정은
  들어가고 반영만 늦어진다.

---

## 21. 허용 명령 — 연결마다 켜는 SQL 명령

### 무엇인가

「연결 관리」의 **허용 명령 체크박스**(SELECT·INSERT·UPDATE·DELETE·MERGE·CREATE·ALTER·DROP·TRUNCATE).
체크한 것만 SQL 편집기에서 실행된다. SQL 편집기 툴바의 연결 이름 옆에 **태그**로 그대로 뜬다 —
실행하기 전에 이 연결로 무엇을 할 수 있는지 보인다.

- 저장 위치: `Connection.config.allowed_statements` (문자열 배열). **컬럼을 늘리지 않았다** —
  타입마다 다른 정책이라 `config` 가 제자리고, 마이그레이션도 필요 없다.
- 가드: `connection_service.ensure_statement_allowed` (단일 출처).
- 프론트: `api/statements.ts`(목록·위험도·파싱·잠시 끄기) · 폼 `pages/Connections.tsx` ·
  태그 `pages/SqlEditor.tsx`(`StatementTags`) · 실행 차단 `canvas/SqlEditor.tsx`·`components/Notebook.tsx`.

`SQL_STATEMENTS` 는 `connection_service.py` 와 `api/statements.ts` **양쪽에** 있다.
한쪽만 늘리면 화면에는 체크박스가 보이는데 저장이 거부된다 (`DUCK_TYPES`·`SYNC_CHANNELS` 와 같은 주의).

### 설정이 없으면 읽기 전용이다

이 기능 이전에 만든 연결에는 `allowed_statements` 가 없다. 없으면 `("select",)` 로 본다 —
**넓히는 방향으로 실패하지 않는다.** 저장된 값이 깨져 있어도 같은 쪽으로 떨어진다.
프론트 `statementsOf` 도 같은 기본값을 쓴다. 다르면 태그가 거짓말을 한다.

체크를 다 끄면 저장이 거부된다. 조용히 SELECT 로 되돌리면 사용자는 껐다고 믿는데 실제로는
켜져 있게 된다 — 편집 중에는 빈 상태를 그대로 두고(`parseStatements` 는 기본값을 채우지 않는다)
저장할 때 묻는다.

### 선두 명령만 보면 놓친다

`WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d` 는 선두가 `WITH` 라 읽기로 보이지만
쓰기다. 그래서 선두 명령을 허용 목록에 대조한 **뒤에**, 문장 안에 남은 쓰기 키워드도 전부
목록 안인지 본다. 검사 전에 문자열 리터럴·주석을 지우는 이유는 예전 그대로다(오탐 방지).

`GRANT`/`REVOKE` 는 체크박스에 없고, 전부 켜도 거부한다. 권한 변경은 이 편집기가 할 일이 아니다.
다중문(`;`)도 허용 여부와 무관하게 계속 막는다.

### 태그를 눌러 잠시 끄기 (실수 방지)

툴바 태그는 보여주기만 하는 것이 아니라 **누르면 꺼진다.** 연결에 INSERT 가 열려 있어도
지금은 쓸 일이 없다면 태그를 눌러 꺼 두고, 필요할 때 다시 누른다. 꺼 둔 명령으로 실행하면
편집기가 요청을 **보내지 않고** 이유를 말한다.

허용 명령과 층이 다르다.

| | 허용 명령 (연결) | 잠시 끄기 (태그) |
|---|---|---|
| 뜻 | 이 연결에서 **무엇이 가능한가** | 지금 **내가 실수하지 않겠다** |
| 정하는 사람 | 연결을 편집할 수 있는 사람(editor) | 쓰는 사람 자신 |
| 사는 곳 | 메타DB (`config.allowed_statements`) | 브라우저 로컬 (`eai_muted_statements_v1`) |
| 막는 곳 | 서버 (`ensure_statement_allowed`) | 화면 (`mutedRunMessage`) |

**보안 경계가 아니다.** 서버에 두지 않는 이유는 뜻이 달라지기 때문이다 — 서버에 두면 남이 켠
것을 내가 끄는 셈이 되는데, 이건 남이 아니라 내 손을 막는 장치다. 진짜 경계는 연결의 허용
명령이고 그쪽은 그대로 서버가 지킨다.

- **SELECT 는 끌 수 없다.** 실수로 조회하는 일은 없고, 끄면 편집기가 아무 일도 못 한다.
  그래서 SELECT 태그만 버튼이 아니다.
- **회색은 꺼진 것의 색이다.** 켜진 명령에는 쓰지 않는다 — 조회가 회색이면 켜져 있는데도
  꺼진 것처럼 보인다(파랑=읽기, 앰버=쓰기, 빨강=DDL, 회색+취소선=꺼 둠).
- 판정은 **변수 치환을 마친 뒤** 한다. `$변수` 가 문장을 바꿀 수 있어 실제로 나갈 SQL 을 봐야 한다.
- 노트북 셀에서도 같은 검사를 한다. 편집기만 막으면 셀로 실행하는 길이 그대로 열려 있다.
- 판정하지 못하는 문장(`EXEC …`)은 막지 않고 서버로 보낸다 — 화면이 통과시킨 것을 서버가
  거절할 뿐, 반대 방향으로는 새지 않는다.
- 캔버스 노드의 SQL 팝업에는 걸지 않는다. 파이프라인 소스는 읽기 전용이라 끌 것이 없다.

### 허용 목록과 역할은 다른 질문이다

허용 목록은 "이 연결에서 **무엇이** 가능한가", 역할은 "**누가** 할 수 있는가"다.
연결을 한 번 열어 두면 그 연결을 볼 수 있는 모든 사람이 쓰기를 하게 되므로 둘을 겹쳐 둔다.

- DML(insert·update·delete·merge) → `operator`
- DDL(create·alter·drop·truncate) → `editor`
- 허용 명령 자체를 바꾸는 것 → 연결 편집이므로 `editor`

거부는 400 이 아니라 **403**(`PermissionDeniedError`)이다 — 문장이 틀린 게 아니라 권한이 없는 것이다.

### 쓰기는 `read()` 로 태우면 안 된다

`SqlConnector.read` 는 스트리밍 커서를 열고 **커밋하지 않는다.** UPDATE 를 그 경로로 보내면
문장은 실행되는데 커밋이 없어 **그대로 사라진다**(드라이버에 따라 "행을 돌려주지 않는다"는
오류가 나기도 하고 조용히 지나가기도 한다 — 어느 쪽이든 남지 않는다). 그래서
`SqlConnector.execute` 를 따로 두고 `engine.begin()` 으로 감싼다. `RETURNING`/`OUTPUT` 로 행이
오면 상한까지 읽어 함께 돌려준다.

쓰기 결과는 페이지를 이어 받지 않는다(`has_more=False`) — 다음 페이지를 부르는 것이 곧
**다시 실행하는 것**이 된다. 화면도 빈 그리드 대신 "N행이 적용되었습니다"로 답한다.

### 읽기 전용으로 남는 경로

내보내기(`export_rows`)·소스 프리뷰(`preview_rows`)·연합 조회(`duck_service`)는 허용 명령과
무관하게 `ensure_select_only` 그대로다. 앞의 둘은 결과를 다시 읽는 경로이고, 연합 조회는
카탈로그를 READ_ONLY 로 붙여 애초에 쓰기가 성립하지 않는다. 그래서 연합 탭에는 태그를 띄우지 않는다.

### 여기서 하지 않은 것

- **트랜잭션 제어**(BEGIN/COMMIT/ROLLBACK) — 여기서는 한 문장이 곧 한 트랜잭션이었다.
  뒤에 수동 커밋으로 열었다 (§22). SQL 로 직접 `BEGIN` 을 쓰는 것은 여전히 막는다.
- **실행 전 확인 대화상자**(WHERE 없는 DELETE 경고 등). 허용 목록이 이미 관문이고,
  누르는 창을 하나 더 두면 그것부터 습관적으로 넘긴다.
- **감사 로그 테이블.** 지금은 서버 로그에 `connection·statement·affected` 만 남긴다.
- **저장된 쿼리·파이프라인 노드에 대한 적용.** 파이프라인의 SQL 은 노드 계약(`ReadSpec`)이
  따로 있고 소스는 여전히 읽기 전용이다. 이 설정은 **쿼리 편집기 실행 경로 전용**이다.

---

## 22. 자동 커밋 / 수동 커밋 (쿼리 편집기)

### 무엇인가

편집기 툴바의 **「자동 커밋」/「수동 커밋」 토글**. 자동이면 문장 하나가 곧 하나의
트랜잭션이고(§21 까지의 동작), 수동이면 쓰기가 **커밋을 기다린다** — 결과를 확인한 뒤
[커밋] 또는 [롤백] 을 누른다. 잘못 돌린 UPDATE 를 되돌릴 수 있는 유일한 자리다.

- 연결 기본값: `Connection.config.auto_commit` (기본 `true`). 「연결 관리」 체크박스, editor 권한.
- 이 브라우저의 덮어쓰기: `eai_commit_mode_v1` (연결별). 툴바 토글이 여기에 쓴다.
- 백엔드: `connection_service` 의 `_OPEN_TX` 레지스트리 · `POST /connections/{id}/tx/{commit|rollback}`.
- 커넥터: `SqlConnector.begin_transaction()` · `execute(..., connection=…)`.

허용 명령 ↔ 잠시 끄기 와 같은 두 층이다 — "이 연결은 원래 무엇인가"(서버)와
"지금 나는 어떻게 쓸 것인가"(브라우저)는 다른 질문이다.

### 트랜잭션은 프로세스 메모리에 산다 (옮길 수 없다)

열린 트랜잭션은 **커넥션 하나를 붙잡은 채** 여러 HTTP 요청에 걸쳐 살아야 한다.
상태를 Redis 나 메타DB 로 옮겨도 **커넥션 자체는 옮길 수 없다.** 그래서 api 프로세스를
여럿으로 늘리면 커밋 요청이 다른 프로세스로 갈 수 있고, 그때는 "트랜잭션을 찾을 수 없다"로
**분명히 실패한다** — 조용히 새 트랜잭션을 열지 않는다. 지금 배포는 uvicorn 단일
프로세스라 성립한다(`docker-compose.yml`). 늘릴 때는 스티키 세션이 전제다.

### 잊힌 트랜잭션은 롤백한다 (커밋이 아니다)

탭을 닫거나 자리를 비우면 락이 남는다. `EAI_SQL_TX_IDLE_TIMEOUT`(기본 300초) 동안
아무 문장도 실행되지 않으면 회수 스레드가 **롤백**한다. 커밋이 아닌 이유는, 사람이 누르지
않은 확정을 서버가 대신 하면 되돌릴 방법이 없기 때문이다.

회수는 요청이 올 때만 훑지 않고 **30초 주기 데몬 스레드**가 돈다 — 사용자가 그냥 떠나면
아무도 훑지 않아 락이 계속 남는다. 하나가 정리에 실패해도 나머지는 계속 회수하고,
롤백이 실패해도 커넥션은 반드시 반납한다.

동시에 열 수 있는 수는 `EAI_SQL_TX_MAX_OPEN`(기본 20)으로 막는다 — 하나가 커넥션 하나다.

### 트랜잭션이 열려 있으면 조회도 그 안에서 돈다

가장 중요한 규칙이다. 커밋 전 변경은 그 트랜잭션 안에서만 보이므로, 조회를 풀 커넥션으로
돌리면 **방금 UPDATE 한 행이 예전 값으로 보인다.** 사용자는 UPDATE 가 안 먹었다고 판단하고
한 번 더 돌린다. 그래서 `tx_id` 가 있으면 SELECT 도 `_run_select_in_tx` 로 간다.

그 경로는 스트리밍(`read`)이 아니라 한 번에 읽는다 — 커넥션이 하나뿐이라 커서를 열어 둔 채
다음 문장을 보낼 수 없다. 상한(`query_row_limit`)이 작아 문제되지 않는다.

같은 이유로 **내보내기는 트랜잭션이 열려 있으면 막는다.** 내보내기는 새 커넥션으로 다시
읽어서 커밋 전 변경을 보지 못한다 — 화면과 파일이 다른데 그 사실이 어디에도 안 보인다.

### 화면에서 막는 것들

- **모드 토글**: 트랜잭션이 열려 있으면 잠긴다. 두고 바꾸면 그 변경이 어디로 가는지 알 수 없다.
- **연결 선택**: 같은 이유로 잠긴다. 트랜잭션은 그 연결에 매여 있어 바꾸면 커밋할 곳을 잃는다.
- **창 닫기**: `beforeunload` 로 알린다. 새로고침하면 화면의 트랜잭션 정보가 사라지고,
  서버 쪽은 유휴 시간 뒤 롤백된다 — 되살리려 애쓰지 않는다.
- **노트북 셀**: 같은 탭·같은 연결이므로 **같은 트랜잭션에 속한다.** 편집기만 트랜잭션을
  쓰면 셀 실행이 딴 커넥션으로 새어 나간다.
- 트랜잭션이 사라진 뒤(유휴 롤백·재시작) 실행하면 409 가 오고, 화면은 커밋 버튼을 지운다.
  남겨 두면 누를 수 있는데 아무 일도 일어나지 않는다.

### 문장 하나가 실패해도 트랜잭션은 열어 둔다

앞의 성공한 문장까지 함께 버리는 것은 사용자가 정할 일이다 — 롤백 버튼이 그 자리에 있다.

### 여기서 하지 않은 것

- **SAVEPOINT**(부분 롤백). 문장 단위로 되돌리려면 화면에 문장 이력이 필요하고, 그건 편집기가
  아니라 마이그레이션 도구가 할 일이다.
- **`BEGIN`/`COMMIT` 을 SQL 로 직접 쓰기.** 여전히 막힌다(허용 명령 밖). 트랜잭션 경계는
  토글과 버튼이 정한다 — 두 경로가 같은 상태를 다투면 어느 쪽이 진짜인지 알 수 없다.
- **여러 탭이 한 트랜잭션 공유.** 탭마다 따로 열린다. 같은 연결을 두 탭에서 수동 커밋으로
  쓰면 서로의 락을 기다릴 수 있다 — 원본 DB 에서 두 세션이 부딪히는 것과 같다.
- **Mongo·연합 조회.** 앞은 이 경로에 트랜잭션이 없고, 뒤는 READ_ONLY 로 붙어 쓰기가 없다.
- **실 DB(MySQL·PostgreSQL·MSSQL) 통합 검증.** 트랜잭션 의미는 SQLite 로 확인했다
  (`test_sql_execute_tx.py` — 커밋·롤백·read-your-writes). 방언별 락 동작은 확인하지 못했다.

---

## 23. AI 모델은 커넥터다 — 로컬 오픈웨이트 경로 (Ollama)

### 왜 만들었나

오픈소스 개발자대회 운영규정 제9조·[별표 2]는 **"외부 상용 API 호출로만 작동하는"** 출품작을
제한한다. 기준은 "상용 API 를 부르는가"가 아니라 **"그것 없이도 도는가"**다 — 오픈웨이트 모델을
직접 구동하는 경로를 함께 갖추면 제한 대상이 아니되, **그 경로가 실제로 동작한다는 점을
소스코드와 실행 방법으로 보여야 한다.**

그래서 `eai_connectors/ollama.py` 와 `docker compose --profile ai` 가 짝으로 있다.
둘 중 하나만 있으면 "보여 주었다"가 성립하지 않는다.

### 계약은 이미 갈라져 있었다

`ai_service.chat()` 은 `.generate()` 를 가진 커넥터면 무엇이든 받는다 — 벤더를 모른다.
그래서 커넥터 하나를 더하는 것으로 끝났고, 서비스·라우터·프론트 로직은 손대지 않았다.
UI 는 `specFor(type).category === 'ai'` 로 AI 연결을 고르므로 `CONNECTOR_SPECS` 등록이 곧 노출이다.

`GenerateResult` 는 `gemini.py` 와 `ollama.py` 에 **각각** 있다(같은 모양). 공용 모듈로 빼지
않은 것은 커넥터가 서로를 임포트하지 않는다는 기존 규칙 때문이다 — 지연 로딩의 전제가 그것이다.

### Ollama 라서 다른 것 셋

1. **자격증명이 없다.** `_OLLAMA_KEYS = {endpoint, model}` 뿐이라 `SECRET_KEYS` 에 걸릴 것도 없다.
2. **`test_connection` 이 모델 보유까지 본다.** 서버만 확인하고 넘어가면 생성 시점에 404 로
   늦게 터지고, 그때는 "AI 가 안 된다"로만 보인다. `ollama pull <모델>` 을 알려 준다.
   태그 생략(`qwen3` ↔ `qwen3:latest`)으로는 막지 않는다.
3. **사고(thinking)를 끈다.** 사고 과정은 화면에 쓸모가 없는데 **시간을 몇 배로 늘린다** —
   로컬 CPU 에서는 이것 하나로 타임아웃이 갈렸다 (qwen3:0.6b 실측: 180초 초과 → 37초).
   그래서 `think: false` 를 항상 보내고, 오류에 `think` 가 보이면 **그때만** 빼고 한 번 더
   부른다. Ollama 0.33 은 사고를 못 하는 모델에도 이 필드를 200 으로 무시하지만(qwen2.5 로
   확인) 그렇지 않은 빌드가 있다. 모델 목록을 들고 다니며 분기하지 않는다 — 그 목록은
   반드시 낡는다. 본문에 `<think>` 를 섞어 내는 모델을 위해 응답에서도 한 번 더 걷어낸다.

`system` 은 별도 필드가 아니라 `messages` 의 첫 항목이고(Gemini 는 `system_instruction`),
`stream=False` 로 고정한다(켜면 줄 단위 JSON 이라 파싱 경로가 갈린다). 토큰 사용량 키는
Gemini 의 `usageMetadata` 모양에 맞춘다 — 화면이 한 가지 모양만 알면 된다.

### 기본 모델과 타임아웃

기본값 `qwen3:8b` — 오픈웨이트 중 **Apache-2.0** 이라 라이선스 제약이 가장 적다.
타임아웃 기본이 180초로 Gemini(60초)보다 길다. 로컬 CPU 추론은 상용 API 보다 훨씬 느리다.

맥에서는 컨테이너가 GPU 를 못 쓴다 — 호스트에 ollama 를 설치하고 엔드포인트를
`http://host.docker.internal:11434` 로 두는 편이 실용적이다.

### 여기서 하지 않은 것

- **OpenAI 호환 엔드포인트**(vLLM·llama.cpp server·LM Studio). 스키마가 달라 커넥터가 따로다.
- **모델 자동 pull.** 첫 연결 테스트에서 수 GB 를 받게 되고, 그 사이 화면은 멈춘 것처럼 보인다.
- **임베딩·RAG.** 이 저장소에는 임베딩이 없다. 스키마 문맥은 `_schema_context` 가 메타DB 에서
  직접 읽어 조립한다 — 검색이 아니라 조회다.
