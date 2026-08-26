# demo — 시연용 가상 데이터베이스 (쇼핑몰 · WMS · 고객센터)

한 회사의 세 시스템이 서로 다른 DB 에 흩어져 있는 상황을 로컬에 재현한다.
ditter 본체 스택과 **별도 도커 프로젝트**라 `down -v` 한 번이면 흔적 없이 사라진다
(네트워크만 본체 것을 함께 쓴다 — 아래 참고).

| 컨테이너 | DB | 역할 (가상) | 호스트 포트 |
|---|---|---|---|
| `mysql-shop` | MySQL 8.0 · `shop` | 온라인 쇼핑몰 — 주문·고객·상품·결제 | `3307` |
| `mssql-wms` | SQL Server 2022 · `wms` | 사내 온프레미스 창고관리 — 재고·로케이션·입출고 | `1433` |
| `postgres-crm` | PostgreSQL 16 · `crm` / `dw` | 고객센터 클레임 / **적재 타깃(비어 있음)** | `5433` |

**이야기 한 줄** — *주문은 MySQL, 재고는 사내 MSSQL, 클레임은 PostgreSQL 에 흩어져 있다.
지연 주문의 원인을 보려면 지금은 세 팀에 각각 물어봐야 한다.*

---

## 빠른 시작

```bash
bash demo/scripts/up.sh     # 컨테이너 기동 + 스키마
bash demo/scripts/seed.sh   # 목데이터 적재 (수 분)
```

**본체(ditter) 스택을 먼저 띄워야 한다.** 데모 DB 는 본체가 만든 네트워크(`ditter_default`)에
올라타므로, api·worker 가 `mysql-shop:3306` 처럼 **컨테이너 이름**으로 찾아간다.

반대 방향(본체를 데모 네트워크에 붙이기)은 쓰지 않는다. `docker compose up -d --build` 가
컨테이너를 재생성할 때마다 연결이 풀려서, 촬영 도중에 "이름을 찾을 수 없다"로 터진다.
데모 쪽이 올라타면 본체는 손댈 것이 없고 재생성에도 영향받지 않는다.

촬영 NG 후에는 `bash demo/scripts/reset.sh` — 볼륨까지 지우고 처음부터 다시 만든다.
난수 시드가 고정이라 **리셋해도 화면의 숫자가 그대로다.**

## 연결 정보

계정을 역할별로 나눠 두었다. 화면(허용 명령)만이 아니라 **DB 권한으로도** 읽기 전용이
기본이라는 것을 보여주는 자리다.

| 계정 | 권한 |
|---|---|
| `eai_ro` | 조회만 (+ 실행 계획 조회) |
| `eai_rw` | DML (INSERT/UPDATE/DELETE) |
| `eai_ddl` | DDL 포함 — 시더가 쓰는 계정 |
| `debezium` | CDC 복제 (MySQL·PostgreSQL) |
| `sym` | SymmetricDS 노드 (MSSQL·PostgreSQL) |

비밀번호는 `demo/.env` (없으면 `.env.example` 에서 자동 생성). 컨테이너끼리는 아래 이름으로 붙는다.

```
mysql-shop:3306/shop     mssql-wms:1433/wms     postgres-crm:5432/{crm,dw}
```

호스트에서 직접 붙을 때는 `127.0.0.1:3307 / 1433 / 5433`.

---

## 데이터 설계

규모는 `demo/.env` 의 `DEMO_SCALE` — `small` · `standard`(기본) · `large`.

| | standard |
|---|---|
| 고객 / 상품 / 창고·로케이션 | 2,000 / 500 / 3 · 300 |
| 주문 / 주문상세 / 결제 (최근 90일) | 50,001 / 105,772 / 49,798 |
| 재고 / 재고이동 / 출고지시 | 1,500 / 200,000 / 47,349 |
| 상담원 / 클레임 | 20 / 3,000 |

### 지키는 것 네 가지

1. **DB 를 넘는 키가 실제로 맞는다.** `orders.order_no` ↔ `outbound_orders.order_no` ↔ `claims.order_no`,
   `products.sku` ↔ `items.item_code` ↔ `claims.sku`, `customers.customer_no` ↔ `claims.customer_no`.
   그래서 시더는 DB 별 SQL 파일이 아니라 **세 DB 를 함께 채우는 스크립트 하나**다
   (`seed/generate.py`). 나누면 반드시 어긋나고, 그러면 연합 조회가 0행을 뱉는다.
2. **날짜는 실행 시점 기준 상대값.** 오늘로부터 -90일 ~ 오늘. 촬영이 밀려도 늘 최신이다.
3. **난수 시드 고정**(`SEED = 20260826`). 리셋해도 같은 데이터.
4. **조인해야 보이는 것을 심는다.** 발견이 없으면 조인 데모는 심심하다:
   - WMS 재고가 마이너스인 **문제 SKU 12종** (실물 없이 팔린 상품)
   - 그 SKU 가 실린 **미출고 지연 주문 ~340건** (결제됨 · 8일 이상 미출고 · 출고지시는 `HOLD`)
   - **3일에 몰린 클레임 급증**(전체의 35% · 하루 330~400건) — 전부 그 주문·SKU
   - → 세 DB 를 한 SELECT 로 조인하면 "이 SKU 들이 원인"이 한 화면에 나온다.
5. 모든 트랜잭션 테이블에 `updated_at` — 배치 파이프라인의 증분(watermark) 기준.

### 식별자가 될 수 있는 값은 실존할 수 없게 만든다

시연 영상에 그대로 박제되기 때문이다. 우연히 실존 번호·주소와 겹치면 되돌릴 방법이 없다.

| 값 | 어떻게 | 왜 안전한가 |
|---|---|---|
| 고객·상담원·작업자 **이름** | 성 20개 × 이름 30개 **조합 생성** | 실존 인물에서 오지 않았다. 겹쳐도 동명이인이다 |
| **전화번호** | `010-0XXX-XXXX` — 가운데 자리가 0 으로 시작 | 국내 010 은 그 대역을 개통하지 않아 **연결되는 번호가 나올 수 없다** |
| **이메일** | `userNNNNNN@example.com` | RFC 2606 이 문서·예시용으로 예약한 도메인 — 실존할 수 없다 |
| 창고 **주소** | 도로명이 지어낸 것 (가상물류로·가상센터로·가상항만로) | 실재 사업장과 겹치지 않는다 |

이름을 `고객0001` 식으로 두지 않은 것은 의도다 — 화면이 테스트 데이터처럼 보이면
"실제 업무에서 쓸 만하다"를 보여주려는 시연의 목적과 정면으로 어긋난다.
한국에는 미국의 555 같은 공식 가상 번호 대역이 없어 위 방식을 택했다.

---

## 여기서 정하지 않으면 나중에 못 고치는 것

**1) MSSQL 콜레이션 + N-타입.** `wms` 를 `Korean_Wansung_CI_AS` 로 만들고 문자 컬럼을 전부
`NVARCHAR` 로 두었다. SymmetricDS 는 변경분을 `SYM_DATA.row_data` 에 담는데, 그 컬럼이
`varchar` 이고 DB 콜레이션이 유니코드가 아니면 **한글이 글자마다 `?` 로 죽는다.** 원본 DB
안에서 이미 손실되므로 타깃을 UTF-8 로 만들어도 소용없다. `SYM_*` 를 만든 뒤에는 못 고친다
(CLAUDE.md §20). 소스 엔진 properties 에 `mssql.use.ntypes.for.sync=true` 도 함께 켜야 한다.

**2) 모든 WMS 테이블에 PRIMARY KEY.** SymmetricDS 는 PK 로 행을 식별하고, 착수 점검이
PK 없는 테이블을 `error` 로 막는다. 없으면 실시간 동기화 시연이 시작조차 되지 않는다.

**3) MySQL binlog.** `binlog_format=ROW` · `binlog_row_image=FULL` · `gtid_mode=ON` 과
`debezium` 계정의 서버 전역 `REPLICATION SLAVE/CLIENT`. 하나라도 빠지면 커넥터는 등록되는데
변경이 오지 않는다 — 조용히 실패하는 종류다.

**4) `dw` 의 테이블 이름은 전부 소문자.** PostgreSQL 은 인용하지 않은 식별자를 소문자로 접고,
실시간 동기화는 매핑이 없으면 타깃 테이블명을 소문자로 내려 확정한다. 대문자로 만들어 두면
등록은 되는데 행이 도착하지 않는다.

**5) SQL Server 이미지에는 `docker-entrypoint-initdb.d` 가 없다.** 서버가 healthy 가 된 뒤
`mssql-wms-init` 원샷 컨테이너가 sqlcmd 로 스키마를 민다. MySQL·PostgreSQL 은 표준 훅을 쓴다.

---

## 구성

```
demo/
├── docker-compose.demo.yml     # name: ditter-demo (별도 프로젝트 · 네트워크는 ditter_default 공유)
├── .env.example                # → demo/.env
├── mysql/     conf.d/binlog.cnf · init/{01_schema.sql,02_users.sh}
├── mssql/     init/{apply.sh,01_schema.sql}
├── postgres/  init/01_init.sh · init/sql/{crm.sql,dw.sql}
├── seed/      generate.py · Dockerfile
└── scripts/   up.sh · seed.sh · reset.sh · down.sh
```

## 아직 하지 않은 것

- **ditter 연결·저장된 쿼리·파이프라인 프리셋 자동 등록** — 지금은 화면에서 손으로 만든다.
- **실시간 변경 생성기** — CDC·동기화 화면이 저절로 움직이게 하는 상주 컨테이너.
- **SymmetricDS 데모용 engine properties** — `sync/symmetricds/engines/*.properties.example` 를
  이 DB 들에 맞춰 채운 판. 소스 엔진에 `mssql.use.ntypes.for.sync=true` 를 반드시 넣을 것.
- **촬영 대본** — 장면별 클릭 순서·나레이션.
