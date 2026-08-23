# WMS(MSSQL) → PostgreSQL 실시간 동기화 구축 가이드

> **문서 목적**: AI 에이전트에게 작업을 지시하기 위한 기술 사양서
> **작성 기준일**: 2026-08-18

---

## 0. 이 문서를 읽는 AI에게

이 문서는 **구현 지시서**입니다. 아래 원칙을 지켜주세요.

1. **1장의 미확정 항목을 먼저 확인**하세요. 확정 전에 코드를 작성하면 재작업이 발생합니다.
2. **9장의 검증 게이트를 통과하지 못하면 다음 단계로 진행하지 마세요.** 특히 부하 테스트는 필수입니다.
3. 원본 WMS DB는 **운영 중인 시스템**입니다. 모든 변경은 개발계에서 먼저 검증합니다.
4. 판단이 필요한 지점에서는 임의로 결정하지 말고 **사용자에게 질문**하세요.

---

## 1. 미확정 항목 (착수 전 반드시 확정)

| # | 항목 | 왜 중요한가 | 확인 대상 |
|---|---|---|---|
| 1 | **동기화 대상 테이블 목록/개수** | 5개와 200개는 설계가 다름. 트리거 수 = 원본 부하 | 현업/기획 |
| 2 | **원본 DB 트리거 생성 권한** | 불가 시 SymmetricDS 자체가 탈락 | DBA |
| 3 | **복제 데이터의 최종 용도** | 조회/분석 vs 업무 판단 근거 → 아키텍처가 갈림 | 현업 |
| 4 | **원본 SQL Server 버전/에디션** | 패치 수준에 따라 TLS 연결 가능 여부 결정 | DBA |
| 5 | **각 테이블의 PK 유무** | PK 없는 테이블은 별도 처리 필요 | 스키마 조회 |
| 6 | **일평균/피크 변경 건수** | 채널 설계, 배치 크기 산정 근거 | 모니터링 |

**3번이 특히 중요합니다.** 복제본을 보고 출고/재고 판단을 하는 구조라면 동기화가 아니라 원본 직접 조회나 API 연동이 맞습니다. 복제본은 아무리 빨라도 원본과 순간적으로 다를 수 있고, 이중 출고 같은 사고로 이어집니다.

### 버전 확인 쿼리

```sql
SELECT
    @@VERSION                          AS FullVersion,
    SERVERPROPERTY('Edition')          AS Edition,
    SERVERPROPERTY('ProductVersion')   AS ProductVersion,
    SERVERPROPERTY('ProductLevel')     AS ServicePack;
```

### PK 없는 테이블 탐지

```sql
SELECT s.name AS SchemaName, t.name AS TableName
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE NOT EXISTS (
    SELECT 1 FROM sys.indexes i
    WHERE i.object_id = t.object_id AND i.is_primary_key = 1
)
ORDER BY s.name, t.name;
```

---

## 2. 기술 선정 배경

### 제약 조건

- 원본: SQL Server 구버전 (CDC 미지원 — 버전 또는 에디션 사유)
- 요건: 실시간성 필수
- 타깃: PostgreSQL
- 범위: WMS 전체가 아닌 **필요 테이블만**

### 후보 비교

| 방식 | CDC 필요 | 삭제 감지 | 지연 | 원본 부하 | 채택 |
|---|---|---|---|---|---|
| **SymmetricDS** | 불필요 | O | ~1초 | 트리거 부하 | **채택** |
| Change Tracking 폴링 | 불필요 | O | 5초~1분 | 거의 없음 | 폴백 |
| rowversion 폴링 | 불필요 | **X** | 폴링 주기 | 매우 낮음 | 부적합 |
| Debezium | **필수** | O | ~1초 | 없음 | 불가 |
| Flink CDC / SeaTunnel | **필수** | O | ~1초 | 없음 | 불가 |
| Airbyte (cursor) | 불필요 | **X** | 분 단위 | 낮음 | 부적합 |
| 상용 로그리더 | 불필요 | O | ~1초 | 없음 | 비용 |

**선정 사유**: CDC 없이 실시간(1초 내외) + 삭제 감지 + 이기종(MSSQL→PostgreSQL)을 동시에 만족하는 오픈소스는 SymmetricDS가 사실상 유일합니다.

**감수하는 것**: 원본 테이블에 트리거를 심으므로 쓰기 트랜잭션에 부하가 발생합니다. 9장 부하 테스트가 필수인 이유입니다.

---

## 3. 아키텍처

```
┌─────────────────┐                      ┌──────────────────┐
│  WMS (MSSQL)    │                      │  PostgreSQL      │
│                 │                      │                  │
│  INVENTORY ─┐   │                      │  inventory       │
│  ORDERS   ──┼─► │  트리거              │  orders          │
│  SHIPMENT ──┘   │                      │  shipment        │
│                 │                      │                  │
│  SYM_DATA       │                      │  SYM_* (타깃측)  │
└────────┬────────┘                      └────────▲─────────┘
         │                                        │
    ┌────▼─────┐         HTTP(S)          ┌───────┴──────┐
    │ 노드 A   │ ══════════════════════►  │   노드 B     │
    │ (source) │      push / pull         │  (target)    │
    └──────────┘                          └──────────────┘
```

### 동작 흐름

1. SymmetricDS가 대상 테이블에 트리거를 **자동 생성** (`sym_` 접두사)
2. 원본에서 INSERT/UPDATE/DELETE 발생 → 트리거가 `SYM_DATA`에 변경분 기록
3. 노드 A가 `SYM_DATA`를 읽어 배치로 묶음
4. HTTP(S)로 노드 B에 전송
5. 노드 B가 PostgreSQL에 반영
6. 전송 완료분은 purge 주기에 따라 정리

브로커(Kafka 등)가 필요 없습니다. 노드 간 HTTP 직접 통신입니다.

### 장애 내성

- 네트워크 단절 시 `SYM_DATA`에 축적 → 복구 시 자동 재전송
- 배치 단위 ACK, 실패 시 재시도
- **주의**: 단절이 길어지면 원본 DB 용량이 증가합니다. 모니터링 필요.

---

## 4. 설치 및 환경

### 요구사항

| 항목 | 사양 |
|---|---|
| Java | JDK 8/11/17 (배포판 문서에서 지원 범위 확인 후 결정) |
| 메모리 | 노드당 최소 2GB, 권장 4GB |
| 네트워크 | 노드 간 HTTP(S), 기본 31415 포트 |
| JDBC 드라이버 | mssql-jdbc, postgresql |

### 설치 위치 판단

- **노드 A**: WMS DB 서버에 직접 두는 것이 이상적이나, 운영 서버 정책상 불가하면 별도 서버 가능 (네트워크 지연 추가됨)
- **노드 B**: PostgreSQL 서버 또는 인접 서버

### 디렉터리 구조

```
symmetric-server/
├── conf/
│   └── symmetric-server.properties
├── engines/
│   ├── wms-source.properties
│   └── pg-target.properties
├── lib/
│   ├── mssql-jdbc-x.x.x.jar
│   └── postgresql-x.x.x.jar
└── logs/
```

---

## 5. 설정

### 5-1. 소스 노드 (`engines/wms-source.properties`)

```properties
engine.name=wms-source
group.id=source
external.id=001

db.driver=com.microsoft.sqlserver.jdbc.SQLServerDriver
db.url=jdbc:sqlserver://WMS_HOST:1433;databaseName=WMS;encrypt=true;trustServerCertificate=true
db.user=sym_user
db.password=***

sync.url=http://SOURCE_HOST:31415/sync/wms-source
registration.url=

# 트리거/데이터 저장 스키마 분리 (원본 오염 방지)
sync.table.prefix=SYM

# 전송 배치 크기 — 부하 테스트 결과에 따라 조정
routing.max.batch.size=10000
```

### 5-2. 타깃 노드 (`engines/pg-target.properties`)

```properties
engine.name=pg-target
group.id=target
external.id=002

db.driver=org.postgresql.Driver
db.url=jdbc:postgresql://PG_HOST:5432/wmsdb
db.user=sym_user
db.password=***

sync.url=http://TARGET_HOST:31415/sync/pg-target
registration.url=http://SOURCE_HOST:31415/sync/wms-source
```

### 5-3. 노드 그룹 및 링크

```sql
INSERT INTO SYM_NODE_GROUP (node_group_id, description)
VALUES ('source', 'WMS MSSQL'), ('target', 'PostgreSQL');

-- P = Push (소스가 타깃으로 밀어냄, 지연 최소)
INSERT INTO SYM_NODE_GROUP_LINK (source_node_group_id, target_node_group_id, data_event_action)
VALUES ('source', 'target', 'P');
```

> 실시간성이 요건이므로 **Push 방식**을 사용합니다. Pull은 폴링 주기만큼 지연이 추가됩니다.

### 5-4. 채널 설계

채널은 전송 단위이자 우선순위 단위입니다. **테이블 특성별로 분리**하세요.

```sql
INSERT INTO SYM_CHANNEL
    (channel_id, processing_order, max_batch_size, enabled, description)
VALUES
    ('realtime',  1, 1000,  1, '재고/출고 등 지연 민감 테이블'),
    ('standard',  5, 10000, 1, '일반 마스터 테이블'),
    ('bulk',     10, 50000, 1, '대량 배치 발생 테이블');
```

**설계 원칙**: 대량 배치가 발생하는 테이블을 `realtime` 채널에 넣지 마세요. 한 번의 대량 작업이 채널을 점유해 다른 테이블의 실시간성을 망칩니다.

### 5-5. 트리거 등록

```sql
INSERT INTO SYM_TRIGGER
    (trigger_id, source_table_name, channel_id, last_update_time, create_time)
VALUES
    ('t_inventory', 'INVENTORY', 'realtime', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('t_orders',    'ORDERS',    'realtime', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('t_itemmst',   'ITEM_MST',  'standard', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

### 5-6. 라우터 및 매핑

```sql
INSERT INTO SYM_ROUTER
    (router_id, source_node_group_id, target_node_group_id, router_type, create_time, last_update_time)
VALUES
    ('source_to_target', 'source', 'target', 'default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO SYM_TRIGGER_ROUTER
    (trigger_id, router_id, initial_load_order, last_update_time, create_time)
VALUES
    ('t_inventory', 'source_to_target', 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('t_orders',    'source_to_target', 200, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('t_itemmst',   'source_to_target',  10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

> `initial_load_order`는 초기 적재 순서입니다. **FK 의존 관계를 고려해 마스터 테이블을 먼저** 배치하세요.

### 5-7. 행 단위 필터링 (필요 시)

"필요한 부분만" 요건이 행 단위라면 라우터에 조건을 겁니다.

```sql
-- 특정 창고만, 최근 데이터만
UPDATE SYM_ROUTER
SET router_type = 'subselect',
    router_expression = 'c.WAREHOUSE_CD = ''WH01'''
WHERE router_id = 'source_to_target';
```

---

## 6. 타입 매핑 (MSSQL → PostgreSQL)

| SQL Server | PostgreSQL | 주의사항 |
|---|---|---|
| `datetime` | `timestamp` | 정밀도 차이 (약 3.33ms 단위 반올림) |
| `datetime2` | `timestamp` | 무난 |
| `datetimeoffset` | `timestamptz` | 타임존 처리 확인 |
| `uniqueidentifier` | `uuid` | 대소문자 표기 상이 |
| `bit` | `boolean` | 무난 |
| `money` | `numeric(19,4)` | 반올림 검증 |
| `decimal(p,s)` | `numeric(p,s)` | **정밀도 필수 검증** |
| `nvarchar` | `varchar` / `text` | 인코딩 확인 |
| `varbinary(max)` | `bytea` | 대용량 시 성능 확인 |
| `image` / `text` | `bytea` / `text` | 레거시 타입, 사전 확인 |

### 반드시 검증할 것

**수량·중량·금액 컬럼의 `decimal` 정밀도.** WMS는 재고 수량이 소수점으로 관리되는 경우가 많고, 여기서 어긋나면 나중에 원인 추적이 매우 어렵습니다. 초기 적재 직후 다음을 확인하세요.

```sql
-- 원본
SELECT COUNT(*), SUM(QTY), CHECKSUM_AGG(CHECKSUM(*)) FROM INVENTORY;
-- 타깃
SELECT COUNT(*), SUM(qty) FROM inventory;
```

### PostgreSQL 측 주의

- **대소문자**: PostgreSQL은 미인용 식별자를 소문자로 접습니다. `INVENTORY` → `inventory`. 매핑을 명시하세요.
- **콜레이션**: 한글 정렬 순서가 다릅니다. `ORDER BY` 결과가 원본과 다를 수 있습니다.
- **예약어 충돌**: `user`, `order` 등 컬럼명 확인.

---

## 7. 운영 파라미터

| 항목 | 권장값 | 사유 |
|---|---|---|
| `purge.retention.minutes` | 1440 (1일) | `SYM_DATA` 무한 증식 방지 |
| `job.purge.period.time.ms` | 600000 (10분) | 정리 주기 |
| `job.push.period.time.ms` | 1000~5000 | 실시간성 확보 |
| `routing.max.batch.size` | 10000 | 부하 테스트로 조정 |
| `http.timeout.ms` | 30000 | 대량 전송 대비 |

### `SYM_DATA` 관리가 핵심입니다

이 테이블은 **원본 DB 안에 생성**됩니다. 방치하면 원본 용량과 트랜잭션 로그가 계속 증가합니다.

```sql
-- 적재량 모니터링 (정기 실행 권장)
SELECT COUNT(*) AS pending_rows,
       MIN(create_time) AS oldest
FROM SYM_DATA d
WHERE NOT EXISTS (
    SELECT 1 FROM SYM_DATA_EVENT e WHERE e.data_id = d.data_id
);
```

이 수치가 지속 증가하면 전송이 밀리고 있다는 신호입니다.

---

## 8. 구축 절차

### Phase 1 — 사전 검증 (착수 조건)

1. 1장 미확정 항목 확정
2. TLS/드라이버 연결 테스트 (아래 별도 절 참조)
3. DBA로부터 트리거 생성 권한 승인

### Phase 2 — 개발계 구축

4. 개발계에 SymmetricDS 노드 A/B 설치
5. 대상 테이블 1~2개로 파일럿 구성
6. 초기 적재 → 데이터 정합성 검증
7. **부하 테스트 (9장) — 게이트**

### Phase 3 — 확장

8. 전체 대상 테이블 등록
9. 채널 분리 및 우선순위 조정
10. 장애 시나리오 테스트 (네트워크 단절, 노드 재시작)

### Phase 4 — 운영 전환

11. 운영계 초기 적재 (업무 저부하 시간대)
12. 모니터링 구성
13. 병행 운영 후 전환

### TLS/드라이버 연결 테스트 (Phase 1의 핵심)

구버전 SQL Server 연동에서 가장 흔한 실패 지점입니다. **다른 무엇보다 먼저 확인하세요.**

- SQL Server 2008 R2는 SP3, 2012는 SP2 이상 + TLS 1.2 지원 패치가 있어야 TLS 1.2 사용 가능
- Java 17+ 는 TLS 1.0/1.1이 기본 비활성화
- 최신 JDBC 드라이버는 암호화가 기본값 → `encrypt` / `trustServerCertificate` 명시 필요
- 컨테이너 배포 시 OpenSSL 3.x가 구형 암호 스위트를 거부하는 사례 있음

```bash
# 최소 연결 확인
java -cp mssql-jdbc-x.x.x.jar \
  -Djavax.net.debug=ssl:handshake \
  ConnectionTest "jdbc:sqlserver://HOST:1433;databaseName=WMS;encrypt=true;trustServerCertificate=true"
```

여기서 막히고 서버 패치 권한이 없다면 **아키텍처를 재검토**해야 합니다.

---

## 9. 부하 테스트 (필수 게이트)

> **이 테스트를 통과하지 못하면 운영 적용 불가입니다.**

WMS는 현장 작업자가 스캐너로 실시간 처리하는 시스템입니다. 트리거로 인한 응답 지연은 데이터 파이프라인 지연보다 훨씬 민감한 문제입니다.

### 측정 대상

| 시나리오 | 예상 부하 |
|---|---|
| 단건 INSERT/UPDATE (스캔 처리) | +10~30% |
| 1,000행 배치 UPDATE (파렛트 이동) | +30~100% |
| 10만행 대량 작업 (마감/실사) | +100~200% |

### 절차

```
1. 운영과 유사한 데이터 볼륨 확보
2. WMS에서 가장 무거운 작업 3종 선정
   - 대량 입고 처리
   - 일일 마감 배치
   - 재고 실사 반영
3. 트리거 미적용 상태로 실행 → 소요시간 기록 (5회 평균)
4. SymmetricDS 트리거 적용
5. 동일 작업 실행 → 소요시간 기록 (5회 평균)
6. 증가율 산출 및 허용 여부 판단
```

### 판단 기준

- 현장 스캔 응답: **절대 시간 기준**으로 판단 (증가율이 아님). 0.3초 이상 느려지면 재검토
- 배치 작업: 배치 윈도우 내에 완료되는지 확인
- `SYM_DATA` 증가량: 디스크 여유 대비 확인

### 실패 시 대안

| 상황 | 대안 |
|---|---|
| 특정 테이블만 부하 과다 | 해당 테이블만 CT 폴링, 나머지는 SymmetricDS **(하이브리드)** |
| 전반적 부하 과다 | 전체 CT 폴링 전환 (지연 5초~1분 감수) |
| 트리거 자체 불가 | 상용 로그리더 검토 (Qlik Replicate 등) — 오픈소스 대안 없음 |

---

## 10. 폴백 설계 — Change Tracking 폴링

부하 테스트 실패 시 이 방식으로 전환합니다. 원본 부하가 거의 없는 대신 지연이 초 단위입니다.

### 활성화

```sql
ALTER DATABASE WMS SET CHANGE_TRACKING = ON
  (CHANGE_RETENTION = 3 DAYS, AUTO_CLEANUP = ON);

ALTER TABLE dbo.INVENTORY ENABLE CHANGE_TRACKING
  WITH (TRACK_COLUMNS_UPDATED = ON);
```

> CDC와 달리 CT는 **SQL Server 2008부터 모든 에디션**에서 사용 가능합니다.

### 워터마크 테이블

```sql
CREATE TABLE dbo.SyncWatermark (
    TableName   SYSNAME   NOT NULL PRIMARY KEY,
    LastVersion BIGINT    NOT NULL,
    UpdatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
```

### 초기 적재 (순서 중요)

```sql
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
BEGIN TRAN;
    DECLARE @v BIGINT = CHANGE_TRACKING_CURRENT_VERSION();
    SELECT * FROM dbo.INVENTORY;   -- 전량 덤프
    -- @v 를 워터마크로 저장
COMMIT;
```

스냅샷 트랜잭션 안에서 버전과 데이터를 **함께** 확보해야 합니다. 분리하면 그 사이 변경이 유실됩니다. SNAPSHOT 격리 불가 시 버전을 덤프 **이전에** 읽으세요 (일부 중복 처리되나 MERGE가 멱등이므로 안전).

### 증분 폴링

```sql
DECLARE @last BIGINT = (SELECT LastVersion FROM dbo.SyncWatermark WHERE TableName='INVENTORY');
DECLARE @cur  BIGINT = CHANGE_TRACKING_CURRENT_VERSION();

-- 변경 없으면 즉시 종료
IF @cur = @last RETURN;

-- 보존기간 초과로 이력이 잘렸는지 확인
IF @last < CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID('dbo.INVENTORY'))
    THROW 50001, 'CT 이력 유실 - 전체 재적재 필요', 1;

SELECT CT.ITEM_CD,
       CT.SYS_CHANGE_OPERATION,   -- I / U / D
       S.*
FROM CHANGETABLE(CHANGES dbo.INVENTORY, @last) AS CT
LEFT JOIN dbo.INVENTORY AS S ON S.ITEM_CD = CT.ITEM_CD
ORDER BY CT.SYS_CHANGE_VERSION;
```

처리 후 워터마크를 `@cur`로 갱신합니다. 나중에 다시 읽지 말고 조회 시점 값을 사용하세요.

### 필수 방어 로직

1. **`MIN_VALID_VERSION` 체크** — 배치가 장기 중단되면 이력이 정리되어 조용히 데이터가 어긋납니다
2. **중복 실행 방지** — `sp_getapplock` 등으로 이전 회차 미완료 시 스킵
3. **멱등 반영** — PostgreSQL 측은 `INSERT ... ON CONFLICT DO UPDATE`
4. **`NOLOCK` 금지** — 커밋 안 된 행을 읽으면 롤백 데이터가 타깃에 남습니다

### 적응형 폴링 주기

```
변경 있음 → 즉시 다음 폴링
변경 없음 → 대기시간 2배 (최대 30초)
```

바쁠 때 초 단위로 따라붙고, 한가할 때 부하를 주지 않습니다.

### CT의 한계

- **변경 전 값 없음** — 감사 이력 용도로는 부적합
- **중간 변경 이력 없음** — "최종 상태"만 확보됨
- 삭제는 PK가 남으므로 정상 처리됨

---

## 11. 모니터링 항목

| 지표 | 확인 방법 | 경보 조건 |
|---|---|---|
| 미전송 배치 | `SYM_OUTGOING_BATCH` where status != 'OK' | 지속 증가 |
| 전송 지연 | 최신 `SYM_DATA.create_time` vs 현재 | 5분 초과 |
| `SYM_DATA` 행수 | `SELECT COUNT(*) FROM SYM_DATA` | 임계치 초과 |
| 오류 배치 | status = 'ER' | 1건 이상 |
| 원본 DB 용량 | 파일 크기 추이 | 급증 |
| 타깃 정합성 | 주기적 count/sum 비교 | 불일치 |

```sql
-- 배치 상태 요약
SELECT status, COUNT(*) AS cnt, MIN(create_time) AS oldest
FROM SYM_OUTGOING_BATCH
GROUP BY status;
```

정합성 검증은 **자동화하세요.** 조용히 어긋나는 것이 가장 위험합니다.

---

## 12. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| 트리거로 인한 현장 응답 지연 | 작업자 불만, 업무 차질 | 9장 부하 테스트, 하이브리드 전환 |
| `SYM_DATA` 증식 | 원본 DB 용량/로그 압박 | purge 주기 단축, 모니터링 |
| 대량 배치가 채널 점유 | 실시간 테이블 지연 | 채널 분리 (5-4) |
| TLS 협상 실패 | 연결 불가 | Phase 1에서 선행 검증 |
| 타입 정밀도 손실 | 재고 수량 불일치 | 6장 검증, 초기 정합성 확인 |
| 원본 DDL 변경 | 트리거 불일치 | 스키마 변경 프로세스에 재동기화 포함 |
| PK 없는 테이블 | 동기화 불가 | 사전 탐지, PK 추가 또는 제외 |
| 네트워크 장기 단절 | 원본 용량 증가 | 임계치 경보, 수동 개입 절차 |

---

## 13. 참고

- SymmetricDS 라이선스: **GPLv3** — 사내 배포 형태에 따라 라이선스 검토 필요
- 원본 SQL Server가 2008 R2(2019-07) / 2012(2022-07) 계열이면 **확장 지원 종료** 상태입니다. 2016 SP1 이상으로 업그레이드가 가능하다면 CDC가 Standard에서도 정식 지원되어 이 문서의 상당 부분이 불필요해집니다. 우회 구현 착수 전 업그레이드 여지를 한 번 더 확인할 가치가 있습니다.
- 설정 파라미터명과 지원 버전은 SymmetricDS 릴리스마다 달라질 수 있습니다. **사용할 버전의 공식 문서로 대조 확인하세요.**

---

## 14. 작업 체크리스트

```
[ ] 대상 테이블 목록 확정
[ ] 원본 버전/에디션 확인
[ ] PK 없는 테이블 탐지 및 처리 방침 결정
[ ] DBA 트리거 생성 권한 승인
[ ] 복제 데이터 용도 확정 (조회용 / 업무 판단용)
[ ] TLS/JDBC 연결 테스트 통과
[ ] 개발계 노드 A/B 설치
[ ] 파일럿 테이블 초기 적재 및 정합성 검증
[ ] ★ 부하 테스트 통과 (게이트)
[ ] 채널 설계 및 전체 테이블 등록
[ ] 타입 매핑 검증 (특히 decimal)
[ ] 장애 시나리오 테스트
[ ] 모니터링 구성
[ ] 운영계 초기 적재
[ ] 병행 운영 및 전환
```
