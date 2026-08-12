# DITTER 개발 TODO

> 오픈소스 개발자 대회 출품작. **MVP 기능만** 다룬다.

## 이 문서를 읽는 법

**날짜는 없다.** "몇 주차"가 아니라 **"이게 되면 끝난 것"**이라는 완료 조건으로 진행한다. 각 STEP 조건을 만족하면 다음 STEP으로 가고, 못 만족하면 넘어가지 않는다.

각 STEP 문서는 **시작 조건 → 목표 → 하는 일 → 완료 조건** 순으로 쓴다.

## 데모 시나리오 — 모든 판단의 기준

> **"안전하게 조회하고, 느리면 AI와 같이 고치고, 그 쿼리를 그대로 반복 적재로 만든다."**

1. 사용자가 자연어나 SQL로 프로덕션 조회를 시도한다.
2. 실행 전에 도구가 실제 DB 상태를 읽고 **"이 쿼리는 위험합니다"**라고 경고하며 이유를 설명한다.
3. AI가 실제 실행 계획과 인덱스 정보를 근거로 **더 가벼운 대안 쿼리**를 제시한다.
4. 안전한 쿼리로 조회에 성공한다.
5. **그 쿼리를 파이프라인 소스로 얹어, 매일 도는 증분 적재로 만든다.**

무언가 할지 말지 고민될 때: **"이 작업이 없으면 위 데모가 무너지는가?"**

1~4가 여전히 중심이다. 5는 그 위에 얹히는 것이지, 1~4를 밀어내지 않는다. **5를 만들다 1~4가
흔들리면 5를 잘라낸다.**

## MVP 기능 일곱 가지

| # | 기능 | 한 줄 설명 | 담당 STEP |
|---|---|---|---|
| F1 | 웹 SQL 콘솔 (읽기 전용) | 브라우저에서 쿼리 작성·실행, 결과 표시 (+ [이기종 쿼리엔진](step-02a-federated-query-engine.md)) | [STEP 2](step-02-web-console.md), [2A](step-02a-federated-query-engine.md) |
| F2 | AI 쿼리 작성 보조 | 자연어 → SQL, 또는 작성 중인 SQL 개선 | [STEP 4](step-04-ai-query-assist.md) |
| F3 | 실행 전 위험 예측 | 실행하기 전에 "이 쿼리 위험합니다" 경고 — **킬러 기능** | [STEP 5](step-05-risk-prediction.md) |
| F4 | EXPLAIN 해석 + 튜닝 제안 | 왜 느린지 설명하고 어떻게 고칠지 제안 | [STEP 6](step-06-explain-tuning.md) |
| F5 | 운영 관찰 | 느린 쿼리 목록, 실행 중인 세션 보기 | [STEP 7](step-07-operations-monitoring.md) |
| F6 | 감사 로그 | 누가 언제 무슨 쿼리를 실행했는지 기록 | [STEP 8](step-08-audit-log-auth.md) |
| F7 | 데이터 파이프라인 | 드래그앤드롭으로 구성하는 배치 수집·적재 | [STEP 9](step-09-pipeline-foundation.md)~[11](step-11-pipeline-operations.md) |

콘솔이 다루는 DB는 **PostgreSQL과 MySQL 둘**이다 ([STEP 2A](step-02a-federated-query-engine.md)의
이기종 쿼리엔진에서 MySQL이 추가된다). 파이프라인(F7)의 소스·타깃은 여전히 PostgreSQL 하나로
좁혀 둔다. DB 접근 코드는 처음부터 어댑터 인터페이스로 감싼다 — MVP에서 이미 두 구현체(PostgreSQL·MySQL)가
생기므로 "멀티 DB 확장 설계"는 이제 이론이 아니라 실제로 검증된다.

### F7은 F1~F6이 만든 안전 장치 위에 선다

F7은 별도 제품이 아니다. 접속 풀·읽기 전용 강제·스키마 조회·자격증명 암호화·감사 로그를 **그대로
재사용**해서, 한 번 읽고 끝내는 조회를 **반복 가능하게** 만든 것이다. 설계 전체는
[docs/pipeline](../pipeline/README.md)에 있다.

**단, F7은 쓰기를 도입한다.** "읽기 전용이라 안전하다"는 제품의 핵심 주장과 정면으로 부딪히는
지점이므로, 경계를 [pipeline-write-boundary.md](../policy/pipeline-write-boundary.md)(P9)에 먼저
못 박고 시작한다. 요지: **사람에게 열리는 SQL 실행 경로는 여전히 읽기 전용 하나뿐이다.**

### 이번에 만들지 않는 것

- 쿼리 부하 히트맵 → 클릭 한 번에 튜닝
- 슬래시(`/`) 명령어, 자주 쓰는 쿼리 저장
- 에디터 안 인라인 AI 패널 ("적용하기" 버튼)
- 사용자가 직접 AI 프롬프트를 정의하는 기능
- MySQL·Oracle 등을 **AI 위험 예측·EXPLAIN 튜닝(F3·F4)의 대상으로 삼는 것** — 그쪽은 PostgreSQL
  하나에 집중한다. MySQL은 [이기종 쿼리엔진(STEP 2A)](step-02a-federated-query-engine.md)의 **조회
  대상으로만** 추가된다
- Oracle·MSSQL 등 PostgreSQL·MySQL 외 **세 번째 이상의 DB 엔진**
- AI 개선안(인덱스 생성 등)을 프로덕션에 자동 적용하는 기능 — **F7의 데이터 적재 파이프라인과는 다른 얘기다.** 스키마를 바꾸는 DDL은 어떤 경로로도 자동 실행하지 않는다
- 튜닝 가이드 커뮤니티 저장소

F7 범위에서 뺀 것 (확장 지점만 남긴다 — [pipeline/README.md](../pipeline/README.md#이번에-만들지-않는-것)):

- SAP RFC 커넥터, CDC(Debezium + Kafka)
- MySQL · MSSQL · MongoDB 커넥터
- 조인 노드, Parquet 출력
- AI가 파이프라인 정의를 생성하는 기능
- 자동 스케일 · HA/DR

## STEP 목록

STEP 1과 STEP 9는 다른 STEP의 서너 배 분량이라 하위 문서로 나눠 두었다. 상위 STEP 문서는
목표·완료 조건·리뷰 게이트를 모아 두는 허브다.

| STEP | 문서 | 시작 조건 | 비고 |
|---|---|---|---|
| 0 | [개발 환경 만들기](step-00-dev-environment.md) | 없음 | ⚠️ 스택 변경(백엔드 → Python)으로 재작업 필요 |
| **1** | **[DB에 안전하게 접속하기](step-01-db-connection.md)** | STEP 0 | **모든 것의 병목. 2인 리뷰 필수** |
| 1A | └ [접속 등록과 커넥션 풀](step-01a-connection-registry.md) | STEP 0 | 자격증명 2인 리뷰 |
| 1B | └ [읽기 전용 AST 검증기](step-01b-readonly-validator.md) | STEP 0 | **순수 로직 — DB 없이 착수** |
| 1C | └ [스키마 조회와 쿼리 실행 API](step-01c-schema-catalog.md) | 1A + 1B | 2인 리뷰 |
| 2 | [웹 SQL 콘솔](step-02-web-console.md) | 1C | |
| 2A | └ [이기종 데이터 쿼리엔진](step-02a-federated-query-engine.md) | 2 | **2인 리뷰 필수(P10)**. 3~8과 독립 |
| 3 | [AI에게 줄 "근거" 만들기](step-03-ai-context-builder.md) | 1C | mock으로 선행 가능 |
| 4 | [AI 쿼리 작성 보조](step-04-ai-query-assist.md) | 2 + 3 | |
| 5 | [🚩 실행 전 위험 예측](step-05-risk-prediction.md) | 4 | **하드 게이트** — 데모 관통 확인 |
| 6 | [EXPLAIN 해석 + 튜닝 제안](step-06-explain-tuning.md) | 5 | |
| 7 | [운영 관찰](step-07-operations-monitoring.md) | 1C | STEP 4~6과 병렬 |
| 8 | [감사 로그 + 인증](step-08-audit-log-auth.md) | **STEP 0** | STEP 1과 병렬. 9·12 전 필수 완료 |
| **9** | **[파이프라인 기반](step-09-pipeline-foundation.md)** | 1 + 8 | **쓰기 경계(P9). 2인 리뷰 필수** |
| 9A | └ [쓰기 경계 긋기](step-09a-write-boundary.md) | 1 + 8 | **9D보다 먼저.** 2인 리뷰 |
| 9B | └ [커넥터 패키지](step-09b-connectors.md) | 없음 | **순수 라이브러리 — mock 선행** |
| 9C | └ [DAG 스펙과 저장](step-09c-dag-spec.md) | 스펙 없음 / 검증 9A | **순수 타입 — mock 선행** |
| 9D | └ [실행 엔진과 워커](step-09d-execution-engine.md) | 9A+9B+9C | 2인 리뷰 |
| 10 | [파이프라인 캔버스](step-10-pipeline-canvas.md) | 9 (+ 2) | 심사에서 보여줄 화면 |
| 11 | [파이프라인 운영](step-11-pipeline-operations.md) | 10 | 스케줄·워터마크·재시작 |
| 12 | [🔒 보안 전수 점검](step-12-security-review.md) | 6+7+8+11+2A | |
| 13 | [🚩 데모 다듬고 제출](step-13-demo-submission.md) | 12 | |

## 순서 한눈에 보기

```
STEP 0  개발 환경  ⚠️ 스택 변경으로 재작업
   │
   ├──────────────┬──────────────┬──────────────┬──────────────┐
   ▼              ▼              ▼              ▼              │
 1A 접속·풀     1B AST검증기   STEP 8        9B 커넥터        │
   │              │          감사로그+인증   9C DAG스펙       │
   └──────┬───────┘            (F6)         (mock 선행)       │
          ▼                      │              │              │
      1C 스키마·실행 API ◀━━━━━━━┙(감사로그 연결) │              │
          │  ◀── 여기까지가 STEP 1. 병목.        │              │
   ┌──────┼──────────────┬───────────────┐      │              │
   ▼      ▼              ▼               │      │              │
STEP 2  STEP 3        STEP 7             │      │              │
웹 콘솔  AI 근거      운영 관찰           │      │              │
 (F1)    (F2 준비)      (F5)             │      │              │
   └──┬───┘                              │      │              │
      ▼                                  ▼      ▼              │
  STEP 4  AI 쿼리 보조 (F2)          9A 쓰기 경계 🔒            │
      │                                  └──┬───┘              │
      ▼                                     ▼                  │
  STEP 5 🚩 위험 예측 (F3)              9D 실행 엔진 · 워커 🔒  │
      │   + 데모 관통 확인                   │                  │
      ▼                                     ▼                  │
  STEP 6  해석 + 튜닝 (F4)            STEP 10 파이프라인 캔버스 │
      │                                     │                  │
      │                                     ▼                  │
      │                               STEP 11 🚩 운영          │
      │                                     │  워터마크 유실 없음│
      └────────────┬────────────────────────┴──────────────────┘
                   ▼
             STEP 12 🔒 보안 전수 점검
                   │
                   ▼
             STEP 13 🚩 데모 + 제출
```

**2A(이기종 쿼리엔진)는 위 다이어그램에 없다.** STEP 2 완료 후 STEP 3~8·9~11과 완전히 독립적으로
진행할 수 있고, STEP 12(보안 전수 점검) 전에만 끝나면 된다.

## 병렬로 돌릴 수 있는 것

- **[1B](step-01b-readonly-validator.md)는 STEP 0만 있으면 시작한다.** 순수 로직이라 DB도 백엔드도
  필요 없다. **병목인 STEP 1 안에서 유일하게 앞당길 수 있는 갈래**다.
- **[STEP 8](step-08-audit-log-auth.md)도 STEP 0부터** 시작한다. 인증 백엔드는 콘솔 화면과 무관하다.
  감사 로그를 실행 경로에 꽂는 것만 1C를 기다린다.
- **[9B](step-09b-connectors.md)·[9C](step-09c-dag-spec.md)는 순수 타입·순수 로직이라 mock으로
  선행**한다. STEP 3의 컨텍스트 빌더를 mock으로 먼저 짠 것과 같은 이유다. **이게 늦으면 STEP 9~11이
  통째로 밀린다.**
- **[STEP 3](step-03-ai-context-builder.md)의 AI 부분은 가짜 데이터로** 1C 완료 전에 시작할 수 있다.
- **[STEP 7](step-07-operations-monitoring.md)은 STEP 4~6과 완전히 독립**이다.
- **[STEP 5](step-05-risk-prediction.md)의 시드 데이터는 STEP 2~3 진행 중에 미리** 만들어 둔다.
- **STEP 9~11은 STEP 4~6과 독립이다.** 1 + 8만 서 있으면 시작할 수 있다.

## 지금 당장 착수할 것

STEP 0이 끝났으므로 아래는 **서로를 기다리지 않고** 동시에 시작할 수 있다.

| 문서 | 왜 지금인가 |
|---|---|
| [1A 접속 등록과 커넥션 풀](step-01a-connection-registry.md) | 다른 모든 작업의 병목이다 |
| [1B 읽기 전용 AST 검증기](step-01b-readonly-validator.md) | 순수 로직이라 1A를 기다릴 필요가 없다. STEP 4·9C도 이걸 쓴다 |
| [STEP 8 감사 로그 + 인증](step-08-audit-log-auth.md) | 인증 백엔드는 콘솔과 무관하다. 미루면 무인증 개발 기간이 길어진다 |
| [9B 커넥터 패키지](step-09b-connectors.md) · [9C DAG 스펙](step-09c-dag-spec.md) | 순수 타입·순수 라이브러리다. 늦으면 STEP 9~11이 통째로 밀린다 |

착수 **전에** 「[팀이 먼저 결정해야 할 것](#팀이-먼저-결정해야-할-것)」의 2번(자격증명 키 관리)을
정한다 — 1A가 그것 없이는 끝나지 않는다.

## 리스크와 대응

| 리스크 | 무슨 일이 벌어지나 | 어떻게 막나 |
|---|---|---|
| 위험 예측이 부정확해 "그럴듯한 경고"에 그침 | 차별점 붕괴. 사용자가 경고를 무시함 | 규칙을 소수로 좁히고 회귀 테스트 고정 (STEP 5) |
| 시드 데이터가 부실해 위험·튜닝이 재현 안 됨 | **데모 실패** | STEP 5 필수 항목. STEP 2~3에 미리 준비 |
| AI 응답 불안정 (환각, 포맷 깨짐) | 신뢰 하락 | 구조화 출력 검증, 실패 시 원본 반환 (STEP 4, 6) |
| 읽기 전용이 뚫림 (CTE 우회 등) | **제품의 존재 이유 소멸** | DB 권한 주방어 + AST 검증 + 2인 리뷰 (STEP 1) |
| **파이프라인 쓰기가 콘솔로 새어나옴** | **위와 동일 — 읽기 전용 주장 붕괴** | 커넥션 `role` 분리 + 라우터 앞단 차단 + 2인 리뷰 ([P9](../policy/pipeline-write-boundary.md), STEP 9) |
| **워터마크를 미리 전진시켜 데이터 유실** | 사용자가 한참 뒤에 발견. 재실행해도 복구 불가 | 모든 타깃 성공 후에만 전진 + 회귀 테스트 (STEP 11 하드 게이트) |
| **이기종 조인이 인메모리 엔진에서 OOM** | 백엔드 프로세스가 죽고 다른 요청까지 영향 | 조인 전 소스별 행 수 상한 + 전체 시간 상한 ([P10](../policy/heterogeneous-query-engine.md) 규칙 4, STEP 2A) |
| MySQL 방언 AST 검증 누락 (Postgres 규칙만 이식) | 이기종 쿼리엔진 경로로 DML이 새어나감 | `sqlglot` 멀티 방언 검증 + 방언별 회귀 테스트 세트 (STEP 2A) |
| npm·PyPI 패키지 공급망 침해 | 서버에서 악성코드 실행 | STEP 0에 보안 게이트 선탑재 |
| STEP 3~5가 길어져 뒤가 밀림 | 전체 지연 | AI 파트를 mock으로 선행, STEP 7·8을 병렬 흡수 |
| **F7이 커져 F1~F6이 흔들림** | **데모의 중심이 흐려짐** | 데모 시나리오 1~4가 우선. 흔들리면 F7 범위를 자른다 |
| 데모 중 AI API 장애 | 발표 실패 | 캐싱 + 녹화 폴백 (STEP 13) |
| "pganalyze와 뭐가 다르냐"에 답 못함 | 심사에서 차별점 무너짐 | [STEP 13](step-13-demo-submission.md) 경쟁 지형 참고 |
| "읽기 전용이라며 왜 쓰냐"에 답 못함 | 2번 차별점 붕괴 | [P9](../policy/pipeline-write-boundary.md)의 준비된 답 + 데모에서 실물로 보여주기 |

## 팀이 먼저 결정해야 할 것

개발 착수 전에 합의가 필요한 사항들이다.

> **타깃 환경(프레임워크)은 이미 정했다**: React/Vite(프런트엔드, TypeScript) +
> FastAPI(백엔드, Python) + Celery/Redis(워커) ([docs/conventions/README.md](../conventions/README.md) 참고).

### 결정 완료 (2026-08-12)

1. **AI 모델 기본값**: Anthropic(Claude)을 기본으로 고정한다. 로컬 모델 교체는 인터페이스만
   열어두고 MVP에서 실제 구현하지 않는다.
2. **자격증명 암호화 키 관리** ([credential-management.md](../policy/credential-management.md)):
   MVP는 별도 서버를 두지 않고 로컬에서만 실행하므로, 마스터 키는 외부 시크릿 매니저 대신 각자
   로컬 `.env`(git 비버전관리)에 평문으로 둔다. SQLite에 저장되는 자격증명 자체는 이 키로
   여전히 암호화한다.
3. **HypoPG**: MVP에 넣지 않는다. F4는 AI가 "이 인덱스를 만들면 빨라질 겁니다"라고 **말하는**
   원안 그대로 간다.

   (참고: HypoPG는 PostgreSQL 확장으로, 인덱스를 실제로 만들지 않고 "만들었다고 가정"한 채
   EXPLAIN을 돌려볼 수 있게 해준다. 세션 안에서만 유효하므로 프로덕션에 아무 영향이 없다 —
   다만 별도 설치가 필요한 확장이라 전제가 하나 늘어나는 것이 단점이라 이번엔 넣지 않는다.)

4. **프로덕션 데이터가 외부 AI로 나가는 문제** ([ai-context-and-safety.md](../policy/ai-context-and-safety.md)):
   로컬 모델 fallback을 실제로 구현하지 않는다. AI 연동은 인터페이스 뒤에 추상화해 두고,
   "언제든 다른 provider·로컬 모델로 교체 가능하다"는 논리로 대회 발표에서 방어한다.
5. **파이프라인 메타 저장 SQLite**: [pipeline/README.md](../pipeline/README.md#️-메타-저장을-sqlite로-두는-것의-한계)의
   전제(단일 노드·워커 소수)와 지키는 조건(WAL 모드, 워커 동시성 2, 짧은 트랜잭션, 진행률은
   Redis로 분리) · 탈출 조건(멀티 노드로 늘려야 하는 순간 PostgreSQL로 전환)을 그대로 확정한다.
6. **F7 데모 범위**: 라이브 데모 시연은 **캔버스 구성 + 1회 실행(STEP 10)까지만** 보여준다.
   STEP 11(스케줄·증분·재시작)은 데모 시연 항목에서 뺀다 — 단, STEP 12·13의 시작 조건에는
   여전히 걸려 있으므로 **제출 전에는 완료해야 한다.** 데모 준비와 STEP 11 완성은 별도 트랙으로
   병렬 진행한다.

### 미정 — 문서 검토만으로 결정 금지

7. **이기종 쿼리엔진(STEP 2A)의 조인 엔진을 DuckDB로 할지 Polars로 할지 정한다.** DuckDB는
   `postgres_scanner`/`mysql_scanner`로 각 소스에 직접 attach해 표준 SQL 한 줄로 조인하지만
   커넥션 통제 지점을 그 확장에 맞춰 새로 만들어야 한다. Polars는 각 소스에서 추출한 결과를
   DataFrame으로 합치므로 커넥션 통제는 단순하지만 조인 표현이 SQL이 아닌 API가 된다. 트레이드오프
   전문은 [heterogeneous-query-engine.md](../policy/heterogeneous-query-engine.md#엔진-선택--duckdb-vs-polars-팀-결정-필요)에 있다.
   **이 결정은 문서 검토만으로 내리지 않는다** — 어느 쪽이든 "검증한 문장 = 실제로 각 소스에
   도달하는 문장"을 실측(PoC)으로 확인한 뒤에만 채택한다. 확인 체크리스트는
   [P10](../policy/heterogeneous-query-engine.md#️-엔진-채택-전에-실측으로-확인해야-하는-것--규칙-2의-pushdown-구멍)에,
   확인 시점은 STEP 2A 완료 조건 4에 걸려 있다.

## 관련 문서

- [docs/policy](../policy/README.md) — 보안·데이터 취급 정책
- [docs/conventions](../conventions/README.md) — 개발 컨벤션
- [docs/pipeline](../pipeline/README.md) — F7(데이터 파이프라인) 설계 문서군
