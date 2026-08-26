-- 통합 마트 (적재 타깃). **테이블은 있고 행은 없다** — 파이프라인이 채우는 것을 보여준다.
--
-- 이름을 전부 소문자로 둔 이유: PostgreSQL 은 인용하지 않은 식별자를 소문자로 접는다.
-- 실시간 동기화는 매핑이 없으면 타깃 테이블명을 소문자로 내려 확정하므로(CLAUDE.md §20),
-- 여기서 대문자로 만들어 두면 등록은 되는데 행이 도착하지 않는다.

-- 배치 파이프라인 타깃: 쇼핑몰 주문 → 일별 매출 집계
CREATE TABLE sales_daily (
    sales_date    date          NOT NULL,
    channel       varchar(20)   NOT NULL,
    category      varchar(40)   NOT NULL,
    order_count   integer       NOT NULL,
    item_count    integer       NOT NULL,
    gross_amount  numeric(16,2) NOT NULL,
    loaded_at     timestamp     NOT NULL DEFAULT now(),
    PRIMARY KEY (sales_date, channel, category)
);

-- CDC 타깃: 쇼핑몰 주문을 실시간으로 흘려 넣는 자리
CREATE TABLE orders_live (
    order_no        varchar(24)   PRIMARY KEY,
    customer_no     varchar(20)   NOT NULL,
    ordered_at      timestamp     NOT NULL,
    status          varchar(20)   NOT NULL,
    channel         varchar(20)   NOT NULL,
    total_amount    numeric(14,2) NOT NULL,
    payment_method  varchar(20)   NOT NULL,
    shipped_at      timestamp,
    updated_at      timestamp     NOT NULL
);

-- 실시간 동기화(SymmetricDS) 타깃: WMS 재고 미러.
-- SymmetricDS 는 타깃 테이블을 만들어 주지 않는다 — 컬럼 이름·타입이 소스와 맞아야 한다.
CREATE TABLE inventory (
    item_code       varchar(20) NOT NULL,
    warehouse_code  varchar(10) NOT NULL,
    location_code   varchar(20) NOT NULL,
    on_hand_qty     integer     NOT NULL,
    allocated_qty   integer     NOT NULL,
    available_qty   integer     NOT NULL,
    last_counted_at timestamp,
    updated_at      timestamp   NOT NULL,
    PRIMARY KEY (item_code, warehouse_code)
);

GRANT USAGE ON SCHEMA public TO eai_ro, eai_rw, eai_ddl, sym;
GRANT SELECT                         ON ALL TABLES IN SCHEMA public TO eai_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eai_rw;
GRANT ALL                            ON ALL TABLES IN SCHEMA public TO eai_ddl;
-- SymmetricDS 타깃 노드는 SYM_* 를 스스로 만든다 — 스키마 생성 권한이 필요하다.
GRANT CREATE ON SCHEMA public TO sym;
GRANT ALL    ON ALL TABLES IN SCHEMA public TO sym;

-- crm.sql 과 같은 이유 — DDL 계정이 실제로 주인이어야 한다.
ALTER TABLE sales_daily OWNER TO eai_ddl;
ALTER TABLE orders_live OWNER TO eai_ddl;
ALTER TABLE inventory   OWNER TO eai_ddl;
