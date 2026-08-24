# Phase 4 — CDC(실시간 변경 수집) GUI 실행 기획안

> 작성일 2026-07-31 · 대상 독자: 백엔드/프론트엔드 구현자 · 상위 문서: [CLAUDE.md](../CLAUDE.md) §6·§10, `docs/EAI_아키텍처_설계문서.docx`
> 목적: **웹 GUI에서 CDC 파이프라인을 구성·시작·정지·모니터링**할 수 있게 한다.

---

## 1. 배경 & 목표

### 하려는 것
사용자가 웹에서 이렇게 할 수 있게 한다.

1. 연결(Connection)에서 **CDC를 켜고** 전제조건(binlog/WAL 등)을 점검한다.
2. 캔버스에서 **CDC 소스 → (변환) → 타깃** 파이프라인을 드래그앤드롭으로 짠다.
3. 버튼으로 **스트림을 시작/일시정지/중지**한다.
4. Monitor에서 **초당 이벤트 수·랙(lag)·테이블별 건수·상태**를 실시간으로 본다.

### 지금 있는 것 (전부 "예약석"일 뿐, 동작 로직 0)
| 위치 | 내용 |
|---|---|
| `docker-compose.yml` | `kafka`(3.7), `debezium/connect`(2.7) 서비스 — `--profile cdc` 로만 기동 |
| `models/connection.py` | `cdc_enabled: bool` 플래그 (켜도 아무 동작 없음) |
| `models/run.py` | `RunTrigger.CDC`, `Checkpoint.state` 주석에 `cdc_offset` 언급 |
| `schemas/pipeline.py` | `RunRequest.trigger` 패턴에 `cdc` 허용 |
| web UI | 연결 목록에 `CDC` 뱃지 표시만 |

**없는 것**: `cdc/debezium/` 디렉터리, Sink Worker, Kafka 클라이언트 의존성, 커넥터 등록 UI, 실제 스트리밍 로직 전부.

---

## 2. 핵심 과제 — CDC는 현재 플랫폼의 3가지 전제를 깬다

배치(Phase 1~3)를 그대로 확장하는 게 **아니다.** CDC는 아래 세 전제와 정면으로 부딪히며, 각 충돌이 곧 설계 결정이다.

| # | 배치의 전제 (현재 코드) | CDC의 현실 | 결론 |
|---|---|---|---|
| **1. 실행은 끝난다** | `Run`: `pending→running→success/failed`, `started_at`/`finished_at`, `progress 0~100`. `execute()`는 타깃을 끝까지 돌리고 **반환**한다 (`engine.py`). | 스트림은 **끝나지 않는다.** "성공"도 "100%"도 없다. | Run 모델을 CDC에 재사용하면 안 된다. **새 수명주기(스트림)** 가 필요하다. |
| **2. 커넥터는 당긴다(pull)** | `BaseConnector.read()`는 제너레이터. 엔진이 타깃 주도로 배치를 **당겨온다** (`_run_target_chain`). | Debezium이 소스 변경을 **밀어낸다(push)** → Kafka. 소스 쪽엔 `read()`가 없다. | CDC 소스는 커넥터가 아니라 **Debezium 커넥터 설정**이다. 타깃(sink)만 기존 `write()`를 재사용한다. |
| **3. 엔진은 1회성 DAG 실행기** | Celery 태스크가 Run 하나를 돌리고 죽는다 (`tasks.execute_pipeline`). | 소비자는 **상시** 떠 있어야 한다. | Celery 태스크가 아니라 **장기 상주 프로세스**(스케줄러/beat와 같은 계열)가 필요하다 → **Sink Worker**. |

### 재사용할 수 있는 것 (바퀴를 다시 만들지 않는다)
- **GUI 전체 골격**: 캔버스·팔레트·ConfigPanel·Connections·Monitor를 그대로 확장한다.
- **타깃 `write()`**: sink는 기존 커넥터의 `write(batch, mode)`를 그대로 쓴다 (mysql/postgres/mssql/mongo/s3/local_file 전부 재사용).
- **격리 선례**: Debezium(Kafka Connect)은 **SAP 사이드카와 같은 패턴**이다 — 무겁고 특수한 런타임을 별도 컨테이너로 격리하고 HTTP(REST :8083)로만 대화한다. 이미 compose에 있다.
- **상주 프로세스 선례**: Sink Worker는 **`scheduler`/`beat`와 같은 계열**이다 — Celery 태스크가 아니라 `python -m ...` 로 도는 루프 (`scheduler.py`가 본보기).
- **이벤트 버스**: Redis Pub/Sub(`events.py`)를 그대로 써서 실시간 지표를 UI로 push한다.

---

## 3. 목표 아키텍처

```
┌──────────── 웹 GUI ────────────┐
│ Connections: CDC 켜기·전제점검  │
│ Canvas:  [CDC 소스]→[변환]→[타깃]│
│ Monitor: 라이브(랙·eps·상태)     │
└───────┬───────────────▲────────┘
        │ REST/WS       │ WS(지표 push)
┌───────▼───────────────┴────────┐
│  api (FastAPI/FastMCP)          │
│  - CDC 파이프라인 CRUD          │
│  - 스트림 시작/정지 → 아래 2개 │
│    ① Kafka Connect REST 호출    │
│    ② stream 상태 DB 기록         │
└───┬──────────────────────┬──────┘
    │ HTTP(:8083)          │ (상태·오프셋)
┌───▼────────┐        ┌────▼─────────────────────┐
│ debezium   │  소스   │ metadata DB (PostgreSQL) │
│ (Kafka      │◀──CDC──│  cdc_streams, checkpoints │
│  Connect)   │  MySQL │                          │
└───┬────────┘  PG…    └──────────────────────────┘
    │ produce                     ▲ 상태·오프셋 기록
┌───▼────────┐        ┌───────────┴──────────────┐
│  Kafka     │◀───────│  Sink Worker (신규·상주)   │
│  토픽       │ consume│  Kafka 구독 → write() 적재 │
└────────────┘        │  지표 → Redis Pub/Sub      │
                      └──────────────────────────┘
```

### 신규 구성요소
| 이름 | 성격 | 하는 일 | 선례 |
|---|---|---|---|
| **Sink Worker** | 신규 상주 프로세스 (`apps/worker` 내 `cdc_sink.py`) | Kafka 토픽 구독 → Debezium 이벤트를 `RecordBatch`로 변환 → 타깃 `write()` 로 적재 → 오프셋 커밋 → 지표 발행 | `scheduler.py`, `beat` |
| **Kafka Connect 연동** | api 서비스 로직 (`services/cdc_connect.py`) | 스트림 시작 시 Debezium REST(:8083)에 커넥터 JSON을 등록/삭제/일시정지 | `sap_rfc.py`의 사이드카 HTTP 호출 |
| **CDC 소스 노드** | 캔버스 노드 종류 | `trigger.cdc` + `source.cdc.*` (아래 §5) | `source.mysql` 등 |
| **`cdc_streams` 테이블** | 메타DB 모델 | 스트림 수명주기·상태·지표 스냅샷 | `Run` |

---

## 4. 데이터 모델 변경

### 4.1 신규 모델 `CdcStream` (Run과 별개 — 전제 #1)
```
CdcStream
  id
  pipeline_id            FK → pipelines           # 캔버스 정의는 Pipeline 재사용
  status                 provisioning|running|paused|failed|stopped
  debezium_connector     Kafka Connect에 등록된 커넥터 이름 (eai.<stream_id>)
  source_connection_id   FK → connections         # CDC 켜진 연결
  topics                 jsonb  [토픽명…]
  last_event_at          timestamptz
  metrics                jsonb  {events_total, eps, lag_ms, per_table:{…}}
  error                  text
  created_at / updated_at
```
- 상태 전이가 **순환**(running↔paused, →stopped)이라는 점이 `Run`(단방향 종료)과 근본적으로 다르다.
- 실시간 지표는 `metrics` jsonb에 주기적으로 스냅샷. **진실의 원천은 Kafka Connect/컨슈머 오프셋**이고 이건 UI 편의용 캐시다 (`events.py`의 "부가 채널" 철학 그대로).

### 4.2 기존 모델 확장
- **`Connection`**: `cdc_enabled` 재활용. `config`에 CDC 전용 키 추가 (예: PostgreSQL `replication_slot`, `publication`, MySQL `server_id`). → `registry.py`의 `_ALLOWED_KEYS`, 프론트 `connectorFields.ts` **양쪽** 갱신 (짝 규칙).
- **`Checkpoint`**: CDC 오프셋 저장에 재활용 — `state`에 `{"cdc_offset": {...}}`. 단, Debezium이 오프셋을 자체 토픽(`_eai_connect_offsets`)에 관리하므로, **1차 구현은 Debezium에 위임**하고 Checkpoint는 sink 컨슈머 그룹 오프셋 표시용으로만 쓴다.
- **`RunLog`/이벤트 채널**: CDC 로그도 같은 구조로 남기되 채널 키를 `stream_id`로 (`events.py`의 `channel_for` 확장).

---

## 5. 캔버스(파이프라인 저작) 설계

DAG 스펙(`dag.py`)과 팔레트(`nodeCatalog.tsx`)에 CDC 노드를 추가한다.

### 5.1 신규 NodeKind
```
trigger.cdc            # "상시 스트리밍" 트리거 (코랄, §8 트리거 색)
source.cdc.mysql       # binlog 기반
source.cdc.postgres    # logical replication(WAL) 기반
```
> **왜 기존 `source.mysql`을 안 쓰나**: 기존 소스는 `read()`로 당기는 배치 소스다. CDC 소스는 `read()`가 없고(전제 #2) Debezium 커넥터 설정으로 표현된다. 노드 종류를 분리해 검증·실행 경로를 완전히 가른다. 팔레트에서는 `소스 > 실시간(CDC)` 하위 그룹으로 묶는다.

### 5.2 노드 파라미터 (ConfigPanel 폼)
- **CDC 소스**: `connection_id`, 캡처할 테이블 목록(체크박스, `discover_schema`로 채움), 스냅샷 모드(`initial|never|when_needed`), 컬럼 화이트리스트.
- **타깃**: **기존 타깃 노드 그대로 재사용.** 단 CDC 의미상 `mode`는 `upsert` 권장(변경/삭제 반영). 삭제 이벤트(`__op=d`) 처리 정책 필드 추가 — `물리삭제 | soft-delete(__deleted 플래그) | 무시`.
- **변환**: 기존 `transform.filter`/`transform.map` 재사용 가능(이벤트 단위 적용).

### 5.3 검증 규칙 (`validate_definition` 확장)
- CDC 소스에는 반드시 `trigger.cdc`가 붙어야 하고, `trigger.schedule`/`manual`과 **혼용 금지**.
- CDC 소스 + 배치 소스를 한 파이프라인에 섞지 못하게 막는다(실행 모델이 다름).
- object 타깃(S3/local_file)은 CDC에서 append-only만 허용(현재도 upsert 불가) → 마이크로배치로 적재(§6.3).

---

## 6. 백엔드 설계

### 6.1 REST/MCP 엔드포인트 (기존 라우터 패턴 그대로)
```
POST   /connections/{id}/cdc/preflight   # binlog/WAL/권한 전제조건 점검 → 체크리스트 반환
POST   /pipelines/{id}/cdc/start         # CdcStream 생성 → Debezium 커넥터 등록 → running
POST   /streams/{id}/pause               # Debezium 커넥터 pause
POST   /streams/{id}/resume
POST   /streams/{id}/stop                # 커넥터 삭제 + Sink 컨슈머 정리
GET    /streams?status=                  # 목록
GET    /streams/{id}                     # 상태·지표 스냅샷
WS     /streams/{id}/stream              # 실시간 지표/로그 (기존 useRunStream 재사용)
```
MCP tool로도 노출(`start_cdc_stream`, `get_stream_status` 등) — CLAUDE.md §7 원칙.

### 6.2 Kafka Connect 연동 (`services/cdc_connect.py`)
- 스트림 시작 = Debezium REST에 커넥터 config(JSON) POST. 소스 종류별 템플릿을 `cdc/debezium/*.json`으로 둔다(설계 문서가 지정한 위치).
- 접속 정보는 **연결 설정에서 꺼내 복호화 후 커넥터 config로 전달** — SAP 사이드카에서 `credentials`를 body로 넘긴 것과 동일한 방식. 평문을 저장소/로그에 남기지 않는다.
- 커넥터 이름 = `eai.<stream_id>`로 고정 → 재시작·중복 방지.

### 6.3 Sink Worker (`apps/worker/src/eai_worker/cdc_sink.py`)
- `scheduler.py`처럼 `python -m eai_worker.cdc_sink`로 도는 상주 루프. compose에 `cdc-sink` 서비스 추가(profile cdc).
- 루프: Kafka consume → Debezium envelope 파싱(`before/after/op`) → `RecordBatch` 조립 → 타깃 `write()` → **오프셋 커밋은 write 성공 후**(멱등성·재시작 안전, §14 "워터마크는 적재 뒤에" 원칙과 동일).
- **마이크로배치**: 이벤트를 N건/T초 단위로 모아 `write()` — 건당 적재는 타깃을 죽인다.
- 삭제 이벤트 정책 적용(§5.2). 지표(eps·lag·건수)를 주기적으로 Redis publish + `cdc_streams.metrics` 갱신.
- 무상태: 상태는 Kafka 오프셋·메타DB에만. → 수평 확장(파티션 분배).

---

## 7. 프론트엔드 설계

| 화면 | 변경 |
|---|---|
| **Connections** | 연결 편집에 "CDC 사용" 토글 + `preflight` 실행 버튼 → 전제조건 체크리스트(초록/빨강)와 조치 안내. CDC 전용 필드(replication_slot 등) 노출. |
| **Canvas** | 팔레트에 `실시간(CDC)` 소스 그룹 + `trigger.cdc`. 검증 경고를 인라인 표시. **활성화 버튼**이 배치의 "실행"과 달리 "스트림 시작"이 되도록 분기. |
| **Monitor(신규 모드)** | Run 리스트와 별도로 **Streams 탭**: 스트림 카드(상태 뱃지·eps·lag·가동시간), 시작/일시정지/중지 컨트롤, 라이브 로그. 노드 뱃지가 "성공/실패"가 아니라 "흐르는 중/랙" 을 표시. |

- `useRunStream.ts`의 WebSocket 훅을 `useStreamMetrics`로 일반화해 재사용.
- 프론트 검증(`auth.can`/역할처럼) 백엔드 규칙과 **짝을 맞춘다** — CDC 검증 규칙을 한쪽만 고치면 어긋난다(§14 교훈).

---

## 8. 단계별 구현 계획 (하위 Phase)

각 단계는 독립적으로 검증 가능하도록 자른다. **목(mock)으로 Kafka/Debezium 없이 먼저 검증** — CLAUDE.md §13 원칙.

- **4a. 데이터 모델·계약** — `CdcStream` 모델+마이그레이션, `NodeKind` 추가, `dag.py` 검증 규칙, 스키마. (Kafka 불필요, 단위 테스트)
- **4b. Kafka Connect 연동** — `cdc_connect.py`, Debezium 커넥터 템플릿(`cdc/debezium/`), start/stop/pause API. Kafka Connect REST를 목으로 두고 계약 검증.
- **4c. Sink Worker** — `cdc_sink.py`, Debezium envelope 파서, 마이크로배치 적재, 오프셋-after-write. **가짜 Kafka 스트림(인메모리)** 으로 삭제/업서트/재시작 엣지 케이스 통합 테스트.
- **4d. 프론트엔드** — Connections CDC 토글+preflight, 캔버스 CDC 노드, Monitor Streams 탭.
- **4e. 실환경 결선** — `--profile cdc`로 실제 kafka+debezium 기동, MySQL binlog / PostgreSQL logical 소스로 E2E. compose에 `cdc-sink` 추가.

> 배치와 마찬가지로 **재시작·멱등성·삭제 처리의 엣지 케이스 테스트를 우선**한다 (CLAUDE.md §13).

---

## 9. 리스크 & 확인 필요한 결정사항

> ✅ 표시는 2026-07-31 확정된 결정.

| 주제 | 쟁점 | 결정 |
|---|---|---|
| **소스 범위** | 첫 구현에 MySQL·PostgreSQL만? MSSQL/Mongo CDC는? | ✅ **MySQL·PostgreSQL 먼저** (Debezium 성숙도·사내 수요). MSSQL(CT/CDC)·Mongo는 이후 단계로 미룸 |
| **오프셋 관리** | Debezium 자체 오프셋 토픽 vs 우리 `Checkpoint` | **1차는 Debezium에 위임**. Checkpoint는 표시용 |
| **삭제 이벤트** | 물리삭제 위험 | ✅ **기본 soft-delete(`__deleted` 플래그)**, 노드에서 물리삭제/무시로 변경 가능 |
| **object 타깃(S3)** | 스트림→S3는 append-only | **마이크로배치 파일**(시간 파티션). upsert 불가는 검증에서 차단 |
| **Kafka 운영** | 단일 브로커(현 compose) HA 없음 | 개발/PoC는 그대로. 운영은 Phase 5에서 MSK 전환(설계 문서 §9) |
| **정확성 보장** | at-least-once (오프셋-after-write) | upsert 타깃이면 사실상 effectively-once. append 타깃은 중복 가능 명시 |

---

## 10. 범위 밖 (이번에 하지 않는 것)
- SAP CDC(SLT 등) — SAP는 읽기 배치로 유지(Phase 3 범위 그대로).
- exactly-once 정확성 보장, 스키마 변경(DDL) 자동 전파.
- Kafka/MSK HA·오토스케일·DR (Phase 5).
- CDC → 조인/윈도우 등 스트림 처리(현재 변환은 이벤트 단위 stateless만).
```
