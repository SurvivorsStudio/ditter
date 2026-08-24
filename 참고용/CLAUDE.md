# CLAUDE.md — 자체 EAI 플랫폼 구현 가이드

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

- **Phase 0 — 스캐폴딩**: 모노레포·docker-compose·기본 CI·`Connection`/`Pipeline`/`Run` 모델·마이그레이션.
- **Phase 1 — MVP(배치 DB→S3)**: MySQL/PostgreSQL 커넥터, S3 타깃, 스케줄러, Canvas 기본 저작, Run 실행/이력.
- **Phase 2 — 커넥터·변환 확장**: MSSQL/MongoDB, 필터·필드매핑 노드, RBAC, Monitor 고도화.
- **Phase 3 — SAP RFC**: 전용 컨테이너 + NW RFC SDK, BAPI/RFC_READ_TABLE, 재시도.
- **Phase 4 — CDC(Debezium)**: Kafka Connect 구성, 커넥터 등록 UI, Sink Worker, 실시간 적재.
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
