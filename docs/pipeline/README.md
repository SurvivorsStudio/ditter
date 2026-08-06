# DITTER 데이터 파이프라인 (F7)

이기종 저장소의 데이터를 표준화된 방식으로 수집해 목적 저장소로 적재하는 **자체 EAI(Enterprise
Application Integration) 기능**. 사용자는 브라우저에서 **드래그앤드롭 캔버스**로 파이프라인을
구성하고 배치로 실행한다.

이 문서군은 별도 프로젝트로 설계됐던 EAI 플랫폼 청사진을 DITTER의 TypeScript 스택으로 번역한
것이다. 원본 청사진의 **설계 결정과 함정은 그대로 살리되**, 구현 스택은
[docs/conventions](../conventions/README.md)를 따른다.

## 왜 SQL 콘솔에 파이프라인이 붙는가

DITTER의 기존 여섯 기능(F1~F6)은 **"프로덕션 DB를 안전하게 읽는 능력"** 하나를 공유한다. 접속
풀, 읽기 전용 강제, 스키마·통계 조회, 자격증명 암호화, 감사 로그가 전부 그 능력의 부품이다.

파이프라인은 그 능력을 **한 번 읽고 끝내는 대신 반복 가능하게 만든 것**이다.

| 콘솔(F1~F6) | 파이프라인(F7) |
|---|---|
| 사람이 쿼리를 한 번 실행한다 | 정의된 추출을 스케줄로 반복 실행한다 |
| 결과를 화면 그리드로 본다 | 결과를 목적 저장소로 적재한다 |
| 실행 전에 위험을 예측한다 | 실행 전에 **같은 위험 판정기**로 소스 쿼리를 검사한다 |
| 감사 로그에 쿼리 한 건이 남는다 | 감사 로그에 실행(run) 단위로 남는다 |

즉 F7은 새 제품이 아니라 **F1~F6이 만든 안전 장치를 재사용하는 실행 모드**다. 소스에서 읽는
경로는 콘솔과 완전히 동일한 읽기 전용 어댑터와 AST 검증기를 탄다. 새로 생기는 것은 **쓰기**뿐이며,
그 쓰기가 어디까지 허용되는지는 [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md)에
못 박아 두었다.

> **데모에서의 위치**: "안전하게 조회하고, 느리면 AI와 같이 고친다"에 한 문장이 붙는다 —
> **"그리고 그 안전한 쿼리를 그대로 반복 적재로 만든다."**

## MVP 범위

| 들어가는 것 | 이유 |
|---|---|
| 배치 DB→DB / DB→파일(S3·로컬) 적재 | 파이프라인이 실제로 쓸모 있으려면 최소 이 조합 |
| 증분(watermark) · 전체(full refresh) 적재 | 증분이 없으면 매번 풀스캔 — 프로덕션에 못 붙인다 |
| React Flow 캔버스 (노드 구성·실행·모니터) | 눈에 보이는 차별점. 심사에서 보여줄 화면 |
| cron 스케줄 실행 + 수동 실행 | 배치의 최소 조건 |
| 커넥터 4종: `postgres` · `s3` · `local_file` · `http_json` | postgres는 소스·타깃 양쪽 |
| 실행 이력 · 진행률 · 로그 · 체크포인트 | 재시작과 감사의 근거 |

### 이번에 만들지 않는 것

원본 청사진에는 있으나 MVP에서는 **의도적으로 뺀다.** 확장 지점만 남긴다.

| 뺀 것 | 왜 뺐나 | 남겨두는 확장 지점 |
|---|---|---|
| SAP RFC 커넥터 | NW RFC SDK 라이선스·전용 사이드카가 필요하고, `pyrfc`는 유지보수가 끊겼다. 대회 출품 범위를 훨씬 넘는다 | `ReadSpec`에 `function` 지정 방식을 미리 둔다 |
| CDC (Debezium + Kafka) | Kafka Connect 운영이 통째로 딸려온다 | `checkpoints.state`에 `cdc_offset` 자리를 비워 둔다 |
| MySQL · MSSQL · MongoDB 커넥터 | DITTER의 대상 DB는 PostgreSQL 하나다 | 커넥터 레지스트리에 등록만 하면 붙는다 |
| 조인 노드 | 여러 상류가 모이면 순차 concat(UNION ALL)까지만 | — |
| Parquet 출력 | jsonl · csv로 충분하다. Parquet은 네이티브 의존성을 부른다 | 직렬화 모듈이 포맷별로 분리돼 있다 |
| 자동 스케일 · HA/DR | 단일 노드 전제 | — |

## 아키텍처

```
[웹 React Flow 캔버스]
   │  REST · WebSocket
   ▼
[Fastify 백엔드] ──enqueue──▶ [Redis  잡 큐 · WS pub/sub]
   │                              │ consume
   └──▶ [SQLite  메타 저장] ◀─상태갱신─ [Worker  BullMQ · DAG 엔진]
                                        │ build()
                                        ▼
                                  [커넥터 레지스트리]
                                    │            │
                                    ▼            ▼
                            [소스: PostgreSQL]  [타깃: PostgreSQL · S3 · 로컬파일]
                             읽기 전용 어댑터     쓰기 전용 커넥션
                             + AST 검증(콘솔과 동일)
```

### 의존 방향 (중요)

원본 청사진이 가장 강하게 경고하는 지점이며, 스택을 바꿔도 그대로 적용된다.

- **백엔드는 워커 코드를 import 하지 않는다.** 큐에 잡 이름(`pipeline.execute`)과 페이로드만 넣는다.
- 반대로 **워커는 메타 저장(SQLite)을 직접 갱신**하므로 백엔드의 모델·DAG 스펙에 의존한다.
- **DAG 스펙은 `packages/shared-types`에 한 벌만 둔다.** 백엔드·워커·프런트가 같은 zod 스키마를
  import 한다. 정의를 복제하면 **반드시** 어긋난다.
- 커넥터는 백엔드·워커가 공유하는 순수 라이브러리다. Fastify도 BullMQ도 모른다.

## 청사진 → DITTER 스택 대응

원본 청사진은 Python 기반이었다. DITTER는 TypeScript 모노레포이므로 다음과 같이 번역한다.
**설계는 그대로, 도구만 바꾼다.**

| 영역 | 청사진 (Python) | DITTER (TypeScript) | 비고 |
|---|---|---|---|
| 백엔드 | FastAPI | **Fastify** | 기존 백엔드에 라우터 추가 |
| 스키마 검증 | Pydantic v2 | **zod** | 이미 쓰는 검증기 |
| 큐/워커 | Celery + Redis | **BullMQ + Redis** | Node 생태계 표준 |
| 메타 저장 | PostgreSQL | **SQLite (WAL)** | 아래 "메타 저장" 주의 참고 |
| ORM | SQLAlchemy | 기존 SQLite 접근 계층 | 파라미터 바인딩 강제 (P1) |
| 마이그레이션 | alembic | 기존 마이그레이션 방식 | |
| 캔버스 | React Flow (`@xyflow/react`) | **동일** | 프런트가 이미 React |
| 캔버스 상태 | Zustand | **Zustand** | 캔버스 전용 스토어 신규 |
| DB 드라이버 | psycopg3 / PyMySQL | **postgres.js** | 기존 어댑터 재사용 |
| 오브젝트 스토리지 | boto3 | `@aws-sdk/client-s3` | |
| 시크릿 암호화 | Fernet / AWS KMS | 기존 자격증명 암호화 (P4) | 새 메커니즘을 만들지 않는다 |
| 인증·인가 | OAuth2/JWT + Argon2id | 기존 인증 (STEP 8) | 새 메커니즘을 만들지 않는다 |
| 에이전트 노출 | FastMCP | MCP TypeScript SDK | 선택 — MVP 필수 아님 |
| SAP | pyrfc + 사이드카 | **범위 밖** | |
| CDC | Debezium + Kafka | **범위 밖** | |

### ⚠️ 메타 저장을 SQLite로 두는 것의 한계

원본 청사진은 **"메타DB에 SQLite는 불가"**라고 못 박았다. 큐 모드에서 여러 워커 프로세스가 같은
파일에 동시에 쓰면 잠금 경합이 나기 때문이다. 그럼에도 DITTER가 SQLite를 유지하는 이유는
[docs/schema](../schema/README.md) 전체가 SQLite 전제이고, MVP는 **단일 노드 · 워커 소수**이기
때문이다.

지키는 조건과, 넘어설 때의 탈출구를 미리 정해 둔다.

- SQLite는 **WAL 모드 + `busy_timeout`** 을 반드시 켠다.
- 워커 동시성은 **낮게 유지한다**(기본 2). 이건 취향이 아니라 잠금 경합 회피 조건이다.
- 상태 갱신은 **짧은 트랜잭션**으로 쪼갠다. 배치를 읽는 동안 트랜잭션을 열어두지 않는다.
- 진행률처럼 초당 여러 번 바뀌는 값은 **Redis에 두고 화면에 push**하고, SQLite에는 노드 상태가
  바뀔 때만 기록한다.
- **탈출 조건**: 워커를 여러 노드로 늘려야 하는 순간 메타 저장을 PostgreSQL로 옮긴다. 그래서
  메타 저장 접근은 처음부터 인터페이스 뒤에 둔다 — 이건 DB 어댑터 인터페이스를 둔 것과 같은
  이유다 ([project-structure.md](../conventions/project-structure.md)).

## 핵심 설계 원칙

원본 청사진에서 그대로 가져온다. 스택과 무관하게 유효하다.

1. **커넥터는 공통 인터페이스를 구현하는 플러그인.** 신규 소스는 구현체 추가만으로 확장한다.
2. **오케스트레이션과 실행을 큐로 분리한다.** 워커를 수평 확장할 수 있게.
3. **모든 상태·오프셋·이력은 메타 저장에 남긴다.** 재시작과 감사가 가능해야 한다.
4. **적재는 멱등성을 기본으로 한다.** upsert, 또는 실행 단위 경로 분리.
5. **워커는 무상태다.** 상태는 Redis와 메타 저장에 둔다.

여기에 DITTER 고유의 원칙 하나를 더한다.

6. **소스 읽기는 콘솔과 같은 안전 장치를 탄다.** 파이프라인이라고 읽기 전용 강제를 우회하지
   않는다 ([read-only-enforcement.md](../policy/read-only-enforcement.md)).

## 문서 목록

| 문서 | 다루는 내용 |
|---|---|
| [connector-contract.md](connector-contract.md) | `Connector` 인터페이스, `ReadSpec`, 지연 로딩, 신규 커넥터 추가 절차 |
| [dag-and-nodes.md](dag-and-nodes.md) | DAG 스펙 공유 원칙, 노드 종류, 주석 노드 |
| [execution-engine.md](execution-engine.md) | 타깃 주도 pull 스트리밍, 워터마크, 팬아웃 스풀, 재시도 |
| [canvas-ux.md](canvas-ux.md) | React Flow 구성, 되돌리기 히스토리, 알려진 함정 |
| [deployment.md](deployment.md) | 컨테이너 구성, 환경변수, 워커 운영 권고 |

## 관련 문서

- [docs/policy/pipeline-write-boundary.md](../policy/pipeline-write-boundary.md) — 읽기 전용 콘솔과 쓰기 파이프라인의 경계 (P9)
- [docs/schema](../schema/README.md) — `pipelines` · `pipeline_runs` · `pipeline_run_logs` · `pipeline_checkpoints`
- [docs/todo](../todo/README.md) — STEP 9~11이 이 기능을 구현한다
- [docs/conventions](../conventions/README.md) — 이 기능도 동일한 컨벤션을 따른다
