# 실시간 DB 동기화 (SymmetricDS)

WMS(SQL Server) → PostgreSQL 을 CDC 없이 실시간(1초 내외)으로 복제한다.
기획안: `docs/SYMMETRICDS_실시간동기화_기획안.md`.

---

## 왜 이 방식인가

원본 SQL Server 가 구버전·에디션 사유로 **CDC 를 못 쓰는데 실시간성은 요건**일 때,
CDC 없이 실시간 + 삭제 감지 + 이기종(MSSQL→PostgreSQL)을 동시에 만족하는 오픈소스는
SymmetricDS 가 사실상 유일하다.

감수하는 것은 하나다 — **원본 테이블에 트리거가 생긴다.** 쓰기 트랜잭션이 느려진다.
그래서 운영 적용 전 부하 테스트가 필수다(아래 게이트).

> 원본이 SQL Server **2016 이상**이면 CDC 가 Standard 에서도 정식 지원된다.
> 그쪽이 트리거 부하가 없으므로, 업그레이드 여지가 있으면 캔버스의 **MSSQL (CDC)** 노드를
> 먼저 검토하는 편이 낫다. 착수 점검이 버전을 읽어 이 사실을 알려 준다.

---

## 구조

```
캔버스(동기화 트리거 → MSSQL 소스 → 동기화 타깃 DB)
   │  [동기화 시작]
   ▼
 api ──SQL──►  원본 SQL Server 의 SYM_TRIGGER · SYM_ROUTER · SYM_TRIGGER_ROUTER
     └─REST─►  symmetricds (synctriggers: "지금 반영하라")

 symmetricds 노드 A ──트리거──► 원본 테이블 → SYM_DATA
                    ══HTTP push══► 노드 B ──JDBC──► PostgreSQL
```

**Kafka 가 없다.** 노드끼리 HTTP 로 직접 주고받는다.

**데이터가 EAI 워커를 지나지 않는다.** 그래서 이 파이프라인에는 변환 노드를 둘 수 없고
(캔버스가 연결 자체를 거절한다), 컬럼 단위 가공이 필요하면 CDC 경로를 쓰거나 타깃에서
뷰로 처리해야 한다.

---

## 기동

```bash
docker compose --profile sync up -d symmetricds
```

**컨테이너는 포그라운드로 띄운다.** 이미지 기본 명령은 `sym_service start && tail -F …` 라
데몬으로 띄우고 로그만 본다 — PID 1 이 `tail` 이라 래퍼가 스스로를 "abandoned" 로 판단하면
컨테이너가 통째로 죽는다(`Stopping abandoned wrapper` 가 반복되다 exit 129). compose 는
`sym --server` 로 덮어써 둔다. PID 1 이 곧 SymmetricDS 라 죽으면 도커가 알고 되살린다.

**띄우기 전에 엔진 설정을 반드시 만든다.** 안 하면 컨테이너는 멀쩡히 뜨는데 엔진이 하나도
없고(`No engine *.properties files found`), 동기화를 켜도 아무 일이 일어나지 않는다.

`engines/*.properties.example` 를 `.properties` 로 복사해 채운다. `engine.name` 은 API
설정(`EAI_SYMMETRIC_SOURCE_ENGINE` / `..._TARGET_ENGINE`)과 같아야 한다 — 착수 점검이 두
엔진의 등록 여부를 확인해 막아 준다.

**소스 엔진에는 `auto.registration=true` 가 필요하다.** 없으면 타깃이 영영 붙지 못하고
로그에 `was not allowed to register` · `Registration is not open` 이 반복된다 —
설정은 다 들어갔는데 데이터만 한 건도 가지 않는 상태가 된다. 예시 파일에 넣어 두었다.

**JDBC 드라이버는 대개 손댈 것이 없다.** 공식 이미지의 `/opt/symmetric-ds/lib` 에
mssql-jdbc·postgresql·mysql·oracle·jtds 가 이미 들어 있다 (3.15.22 에서 확인).
그래도 특정 버전이 필요하면 `lib/` 에 넣고 다시 빌드한다 — 볼륨이 아니라 `Dockerfile` 의
`COPY` 로 넣는 이유는, 그 디렉터리에 이미 있는 jar 들을 호스트 디렉터리로 덮으면
서버가 뜨지 못하기 때문이다.

### 접속 정보가 두 군데 있는 이유

EAI 연결 관리(암호화 저장)와 이 `engines/*.properties` 양쪽에 원본·타깃 접속 정보가 있다.
중복이지만 없앨 방법이 없다 — **SymmetricDS 는 기동 시점에 파일에서 읽는 Java 프로세스**라
우리 연결 저장소를 볼 수 없다. 각자 다른 일을 한다.

| | 쓰는 곳 | 하는 일 |
|---|---|---|
| EAI 연결 | api | SYM_* 에 설정을 쓰고, 착수 점검·지표를 조회한다 |
| engines/*.properties | symmetricds | 트리거를 심고 데이터를 실제로 옮긴다 |

둘이 **다른 DB 를 가리키면** 설정은 A 에 들어가고 복제는 B 에서 일어난다. 착수 점검이
잡아내지 못하는 종류이므로, 값을 바꿀 때는 반드시 양쪽을 함께 고친다.

---

## SYM_* 를 전용 DB 로 빼기 (선택)

SymmetricDS 는 자기 테이블 **45개**를 만든다. 동기화 대상이 1개든 200개든 45개 고정이지만,
운영 WMS 의 `dbo` 에 그것들이 섞이는 게 부담이면 전용 DB 로 뺄 수 있다.

1. 전용 DB 를 만들고 접속 계정에 권한을 준다 (`db_owner` 면 충분)
2. 소스 엔진의 `db.url` 을 **그 DB** 로 바꾼다
3. 캔버스 소스 노드의 **[SymmetricDS 설정 DB]** 에 같은 이름을 적는다

그러면 이렇게 갈린다.

```
WMS       업무 DB    트리거만 (테이블당 3개)
WMS_SYNC  전용 DB    SYM_ 45개 전부
```

`SYM_TRIGGER.source_catalog_name` 에 업무 DB 이름이 들어가 크로스 DB 로 캡처한다.
실환경에서 확인한 것들:

- **`DB_CHAINING` 은 필요 없다.** OFF 로도 정상 동작한다. 필요한 건 전용 DB 접근 권한뿐이다.
- 두 DB 는 **같은 인스턴스**여야 한다 — 트리거가 같은 트랜잭션에서 그쪽 `SYM_DATA` 에 쓴다.
- 엔진 `db.url` 과 노드의 [설정 DB] 가 **어긋나면 안 된다.** 착수 점검이 설정 DB 접근을
  확인하지만, 엔진이 다른 DB 를 보고 있는 것까지는 잡지 못한다.

**격리가 되는 것은 아니다.** 트리거는 여전히 업무 테이블에 붙고, 전용 DB 가 꽉 차거나
잠기면 트리거가 실패해 **업무 쓰기가 실패한다.** 눈에서 치우는 것이지 위험을 나누는 것이 아니다.

---

## 착수 전 확인 (기획안 §1)

캔버스의 **[동기화 시작]** 이 점검 창을 먼저 띄운다. 원본을 **읽기만** 하므로 몇 번을
눌러도 안전하다.

코드가 확인하는 것:

- SQL Server 버전·에디션 (2016 이상이면 CDC 검토 안내)
- 대상 테이블 존재와 **기본키 유무** — PK 가 없으면 갱신·삭제를 어느 행에 적용할지 정할 수
  없어 동기화가 성립하지 않는다
- 원본 트리거 생성 권한(대상 테이블 ALTER) · SYM_* 생성 권한(DB CREATE TABLE)
- 소스·타깃 접속(TLS·드라이버) · 사이드카 도달과 엔진 이름 대조

코드가 확인할 수 없어 **경고로만 남기는 것** 둘:

- **복제 데이터의 최종 용도.** 복제본으로 출고·재고를 판단하는 구조라면 동기화가 아니라
  원본 직접 조회나 API 연동이 맞다. 복제본은 아무리 빨라도 원본과 순간적으로 다를 수 있고,
  이중 출고 같은 사고로 이어진다.
- **부하 테스트.** 아래.

---

## 부하 테스트 (운영 적용 게이트)

> **이 테스트를 통과하지 못하면 운영 적용 불가다.**

WMS 는 현장 작업자가 스캐너로 실시간 처리하는 시스템이다. 트리거로 인한 응답 지연은
파이프라인 지연보다 훨씬 민감하다.

1. 운영과 유사한 볼륨을 확보한다
2. 가장 무거운 작업 3종을 고른다 (대량 입고 · 일일 마감 · 재고 실사)
3. 트리거 없이 5회 실행해 소요시간을 기록한다
4. 동기화를 켜고 같은 작업을 5회 실행한다
5. 증가율을 낸다

판단 기준:

- **현장 스캔 응답은 절대 시간으로 본다** (증가율이 아니다). 0.3초 이상 느려지면 재검토
- 배치 작업은 배치 윈도우 안에 끝나는지
- `SYM_DATA` 증가량이 디스크 여유 대비 감당되는지

실패하면: 특정 테이블만 과하면 그 테이블을 빼고 나머지만 동기화(하이브리드),
전반적으로 과하면 방식 자체를 재검토한다.

점검을 통과했으면 소스 노드 설정의 **[부하 테스트를 마쳤습니다]** 를 켠다.
이 체크는 시작을 막지 않는다 — 문서가 요구하는 파일럿(부하 테스트를 하기 위한 구축)
자체가 불가능해지기 때문이다. 대신 안 켜져 있으면 점검 결과에 계속 경고로 남는다.

---

## 얼마나 걸리나 — 라우팅 주기가 병목이다

경로는 이렇다.

```
원본 INSERT/UPDATE/DELETE
  → 트리거가 SYM_DATA 에 기록      ← 즉시 (같은 트랜잭션)
  → 라우팅 잡이 배치로 묶음         ← job.routing.period.time.ms   ★ 병목
  → 푸시 잡이 타깃으로 전송         ← job.push.period.time.ms
  → 타깃 적재
```

**푸시만 낮추면 소용이 없다.** 보낼 배치가 라우팅 주기마다 한 번씩만 만들어지기 때문이다.

그리고 **푸시로 도는지부터 확인해야 한다.** SymmetricDS 는 노드 등록 과정에서
`SYM_NODE_GROUP_LINK` 를 기본값 `W`(풀 대기)로 먼저 만든다. 그 상태면 소스가 밀지 않고
타깃이 `job.pull.period.time.ms`(기본 10초)마다 당겨간다 — 푸시 주기를 아무리 낮춰도
소용이 없다. 우리 코드가 시작할 때 `P` 로 강제한다.

```sql
-- [설정 DB] source→target 이 P 여야 한다
SELECT source_node_group_id, target_node_group_id, data_event_action
FROM   SYM_NODE_GROUP_LINK;
```

실측(3.15.22, 로컬 컨테이너):

| 설정 | 원본 변경 → 타깃 도착 |
|---|---|
| routing 10000 (기본값) · push 1000 | **약 16초** |
| routing 1000 · push 1000 | 수 초 |

그래서 예시 파일은 둘 다 1초로 둔다.

```properties
job.routing.period.time.ms=1000
job.push.period.time.ms=1000
```

**대가는 소스 DB 조회가 잦아지는 것이다.** 라우팅 잡이 그 주기마다 `SYM_DATA` 를 훑는다.
부하 테스트는 반드시 **운영에 쓸 주기 그대로** 재야 한다 — 10초로 재고 1초로 운영하면
측정이 무의미하다.

---

## 채널 설계

채널은 전송 단위이자 우선순위 단위다. 테이블마다 고른다.

| 채널 | 순서 | 배치 크기 | 쓰는 곳 |
|---|---|---|---|
| `realtime` | 1 | 1,000 | 재고·출고 등 지연 민감 |
| `standard` | 5 | 10,000 | 일반 마스터 |
| `bulk` | 10 | 50,000 | 대량 배치가 몰리는 테이블 |

**대량 배치가 발생하는 테이블을 `realtime` 에 넣지 말 것.** 한 번의 대량 작업이 채널을
점유해 다른 테이블의 실시간성을 통째로 망친다.

채널은 스트림끼리 공유한다. 그래서 동기화를 정지해도 채널은 지우지 않고, 운영이
`max_batch_size` 를 부하 테스트 결과로 조정했으면 다시 시작해도 그 값을 덮어쓰지 않는다.

---

## 한글이 `?` 로 깨질 때 — 시작 전에 켜야 하는 것

**SQL Server 소스에서 가장 조용한 사고다.** 복제는 성공하고 글자만 깨진다.

SymmetricDS 는 변경분을 `SYM_DATA.row_data` 에 **문자열로** 담는다. 그 컬럼이 `varchar` 인데
DB 콜레이션이 유니코드가 아니면(예: `SQL_Latin1_General_CP1_CI_AS`), 트리거가 `nvarchar`
한글을 담는 순간 글자마다 `?` 로 치환된다. **원본 DB 안에서 이미 손실되므로** 타깃을 UTF-8 로
만들어도 되돌릴 수 없다.

소스 엔진 properties 에 이것이 필요하다.

```properties
mssql.use.ntypes.for.sync=true
```

**시작 전에 켜야 한다.** 이 값은 SymmetricDS 가 `SYM_*` 를 **처음 만들 때** 반영된다.
이미 만든 뒤에 켜면 테이블이 그대로 `varchar` 로 남으므로, `SYM_*` 를 지우고 다시 만들어야
한다. 착수 점검의 **유니코드(한글) 캡처** 항목이 이 상태를 잡아 시작을 막는다.

확인:

```sql
-- [원본] 캡처 컬럼이 nvarchar 여야 한다
SELECT c.name, t.name AS type_name
FROM   sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE  c.object_id = OBJECT_ID('SYM_DATA') AND c.name IN ('row_data','pk_data','old_data');

-- [원본] 캡처된 내용에 '?' 가 있으면 이미 손실된 것이다
SELECT TOP 5 data_id, table_name, row_data FROM SYM_DATA ORDER BY data_id DESC;
```

이미 깨진 행은 원본에서 다시 UPDATE 하거나 초기 적재를 다시 걸어야 복구된다.

---

## 타입 매핑에서 반드시 검증할 것

| SQL Server | PostgreSQL | 주의 |
|---|---|---|
| `datetime` | `timestamp` | 약 3.33ms 단위 반올림 |
| `datetimeoffset` | `timestamptz` | 타임존 처리 확인 |
| `uniqueidentifier` | `uuid` | 대소문자 표기 상이 |
| `money` | `numeric(19,4)` | 반올림 검증 |
| `decimal(p,s)` | `numeric(p,s)` | **정밀도 필수 검증** |
| `varbinary(max)` | `bytea` | 대용량 성능 확인 |

**수량·중량·금액의 `decimal` 정밀도가 가장 위험하다.** WMS 는 재고 수량이 소수점으로
관리되는 경우가 많고, 여기서 어긋나면 나중에 원인 추적이 매우 어렵다. 초기 적재 직후:

```sql
-- 원본
SELECT COUNT(*), SUM(QTY) FROM INVENTORY;
-- 타깃
SELECT COUNT(*), SUM(qty) FROM inventory;
```

**식별자 대소문자**: PostgreSQL 은 인용하지 않은 식별자를 소문자로 접는다
(`INVENTORY` → `inventory`). 타깃 노드의 [테이블명 매핑]에 적어 두면 무엇으로 들어갔는지
보인다. 비워 두면 서버가 소문자로 확정한다.

---

## 모니터링

모니터 → 스트림 탭. 동기화 스트림은 CDC 와 다른 지표를 본다.

| 지표 | 뜻 | 경보 |
|---|---|---|
| 미전송 | 라우팅되지 않은 `SYM_DATA` 행수 | 지속 증가 |
| 오류 배치 | `SYM_OUTGOING_BATCH.status = 'ER'` | 1건 이상 |
| 랙(lag) | 마지막으로 잡힌 변경 이후 경과 | 5분 초과 |

**미전송이 계속 늘면 원본 DB 용량과 트랜잭션 로그가 함께 늘어난다.** 이것이 이 방식에서
가장 먼저 봐야 할 지표다. 네트워크가 오래 끊기거나 동기화를 오래 일시정지해도 같은 일이 생긴다.

직접 볼 때:

```sql
-- 배치 상태 요약
SELECT status, COUNT(*) AS cnt, MIN(create_time) AS oldest
FROM SYM_OUTGOING_BATCH GROUP BY status;

-- 미전송 적재량
SELECT COUNT(*) AS pending_rows, MIN(create_time) AS oldest
FROM SYM_DATA d
WHERE NOT EXISTS (SELECT 1 FROM SYM_DATA_EVENT e WHERE e.data_id = d.data_id);
```

정합성 검증(원본/타깃 count·sum 비교)은 **자동화할 것.** 조용히 어긋나는 것이 가장 위험하다.

---

## 정지하면 무엇이 사라지나

[중지]는 이 스트림이 만든 **트리거·라우터·연결만** 지운다. 채널·노드 그룹은 다른 스트림이
쓰므로 남긴다. 설정이 지워지면 sync-triggers 가 원본 테이블의 실제 트리거를 정리한다.

정지가 실패하면 스트림이 `failed` 로 남는다 — 상태만 내려가고 **원본에 트리거가 남아 있을
수 있어서**다. 그때는 원본에서 `SYM_TRIGGER` 를 직접 확인한다.

---

## 이 이미지에는 REST API 가 없다

`jumpmind/symmetricds:3.15`(3.15.22)를 뒤져 확인했다 — `find / -iname '*rest*'` 가 한 건도
없고, `rest.api.enable=true` 를 켜도 `/api/*` 는 계속 404 다. 그래서 `conf/` 설정을 두지 않는다.

없어도 동작에 지장이 없도록 만들어 두었다.

| 하려던 일 | REST 가 있을 때 | 없을 때 |
|---|---|---|
| 엔진 살아있는지 확인 | — | 동기화 서블릿 `/sync/{engine}` 을 두드린다 (착수 점검) |
| 설정 즉시 반영 | `synctriggers` | 엔진의 `job.synctriggers.period.time.ms` 주기(예시는 60초)에 반영 |
| 지표 조회 | — | 원본 DB 의 `SYM_*` 를 SQL 로 읽는다 |
| 초기 적재 | — | `SYM_NODE_SECURITY.initial_load_enabled` 를 SQL 로 세운다 |

즉 **REST 실패는 "늦어짐"이지 "안 됨"이 아니다.** 동기화를 시작할 때 반영 알림이 실패하면
그 사실을 알림 문구로 남긴다.

엔진 존재 확인은 **`/sync/{engine}/pull`** 을 두드린다. 하위 경로 없이 `/sync/{engine}` 만
부르면 엔진이 살아 있는데도 602 가 나온다 — 엔진 개수에 따라 답이 달라져서 믿을 수 없다.
`pull` 은 읽기 전용이고 노드 id 를 요구하므로 존재 여부만 깔끔하게 갈린다.
(`registration` 은 쓰면 안 된다 — 실제 등록을 시도한다.)

| 코드 | 본문 | 뜻 |
|---|---|---|
| 659 | `Missing node ID or security token` | 엔진이 **있다** |
| 602 | `No engine here with that name` | 그 이름의 엔진이 **없다** |

---

## 라이선스

SymmetricDS 는 **GPLv3** 다. 사내 배포 형태에 따라 검토가 필요하다.
이 저장소는 SymmetricDS 를 **별도 컨테이너로 실행만** 하고 코드를 링크하지 않는다 —
API 는 원본 DB 에 SQL 을 쓰고 HTTP 를 부를 뿐이다.

---

## 알려진 미검증 항목

- **실제 SQL Server·SymmetricDS E2E.** 현재 구현은 단위 테스트로만 검증했다.
- **초기 적재·행 필터의 실제 동작.** 코드는 문서대로 만들었으나 실제 데이터로 확인하지 못했다.
