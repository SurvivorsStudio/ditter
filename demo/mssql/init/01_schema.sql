/*  창고관리 WMS (SQL Server) — 사내 온프레미스 레거시라는 설정.

    두 가지를 여기서 못 박는다. 둘 다 나중에는 못 고친다.

    1) COLLATE Korean_Wansung_CI_AS + 문자 컬럼은 전부 NVARCHAR.
       SymmetricDS 는 변경분을 SYM_DATA.row_data 에 담는데, 그 컬럼이 varchar 이고
       DB 콜레이션이 유니코드가 아니면 한글이 글자마다 '?' 로 죽는다. 원본 DB 안에서
       이미 손실되므로 타깃을 UTF-8 로 만들어도 소용없다 (CLAUDE.md §20).

    2) 모든 테이블에 PRIMARY KEY.
       SymmetricDS 는 PK 로 행을 식별한다. 착수 점검(preflight)이 PK 없는 테이블을
       error 로 막으므로, PK 가 없으면 실시간 동기화 시연 자체가 시작되지 않는다.
*/
SET NOCOUNT ON;
GO

IF DB_ID('wms') IS NULL
    CREATE DATABASE wms COLLATE Korean_Wansung_CI_AS;
GO
/*  역할별 계정. sym 은 SymmetricDS 가 SYM_* 45개 테이블과 트리거를 만들어야 해서
    db_owner 다 — 착수 점검이 이 권한을 error 등급으로 확인한다. */
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='eai_ro')
    CREATE LOGIN eai_ro  WITH PASSWORD = '$(APP_PW)', CHECK_POLICY = OFF;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='eai_rw')
    CREATE LOGIN eai_rw  WITH PASSWORD = '$(APP_PW)', CHECK_POLICY = OFF;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='eai_ddl')
    CREATE LOGIN eai_ddl WITH PASSWORD = '$(APP_PW)', CHECK_POLICY = OFF;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='sym')
    CREATE LOGIN sym     WITH PASSWORD = '$(SYM_PW)', CHECK_POLICY = OFF;
GO

USE wms;
GO

IF OBJECT_ID('dbo.warehouses') IS NULL
CREATE TABLE dbo.warehouses (
    warehouse_code  NVARCHAR(10)  NOT NULL CONSTRAINT pk_warehouses PRIMARY KEY,
    warehouse_name  NVARCHAR(60)  NOT NULL,
    region          NVARCHAR(20)  NOT NULL,
    address         NVARCHAR(200) NOT NULL,
    manager         NVARCHAR(30)  NOT NULL,
    created_at      DATETIME2(0)  NOT NULL,
    updated_at      DATETIME2(0)  NOT NULL
);
GO

IF OBJECT_ID('dbo.locations') IS NULL
CREATE TABLE dbo.locations (
    location_code   NVARCHAR(20)  NOT NULL CONSTRAINT pk_locations PRIMARY KEY,
    warehouse_code  NVARCHAR(10)  NOT NULL,
    zone            NVARCHAR(10)  NOT NULL,
    aisle           NVARCHAR(10)  NOT NULL,
    rack            NVARCHAR(10)  NOT NULL,
    lvl             INT           NOT NULL,
    location_type   NVARCHAR(20)  NOT NULL,   -- PICK | BULK | RETURN
    created_at      DATETIME2(0)  NOT NULL,
    updated_at      DATETIME2(0)  NOT NULL
);
GO

/*  item_code 는 쇼핑몰(MySQL)의 products.sku 와 **같은 값**이다.
    연합 조회가 성립하는 이유가 이 한 줄이고, 그래서 시더가 세 DB 를 함께 채운다. */
IF OBJECT_ID('dbo.items') IS NULL
CREATE TABLE dbo.items (
    item_code       NVARCHAR(20)  NOT NULL CONSTRAINT pk_items PRIMARY KEY,
    item_name       NVARCHAR(120) NOT NULL,
    category        NVARCHAR(40)  NOT NULL,
    unit            NVARCHAR(10)  NOT NULL,
    safety_stock    INT           NOT NULL,
    abc_class       NVARCHAR(1)   NOT NULL,
    created_at      DATETIME2(0)  NOT NULL,
    updated_at      DATETIME2(0)  NOT NULL
);
GO

/*  available_qty 를 계산 컬럼으로 두지 않는다 — 계산 컬럼은 타깃에 INSERT 할 수 없어
    실시간 동기화가 그 테이블에서 막힌다. 값으로 들고 있는다. */
IF OBJECT_ID('dbo.inventory') IS NULL
CREATE TABLE dbo.inventory (
    item_code       NVARCHAR(20)  NOT NULL,
    warehouse_code  NVARCHAR(10)  NOT NULL,
    location_code   NVARCHAR(20)  NOT NULL,
    on_hand_qty     INT           NOT NULL,
    allocated_qty   INT           NOT NULL,
    available_qty   INT           NOT NULL,
    last_counted_at DATETIME2(0)  NULL,
    updated_at      DATETIME2(0)  NOT NULL,
    CONSTRAINT pk_inventory PRIMARY KEY (item_code, warehouse_code)
);
GO

IF OBJECT_ID('dbo.stock_movements') IS NULL
CREATE TABLE dbo.stock_movements (
    movement_no     NVARCHAR(24)  NOT NULL CONSTRAINT pk_stock_movements PRIMARY KEY,
    item_code       NVARCHAR(20)  NOT NULL,
    warehouse_code  NVARCHAR(10)  NOT NULL,
    location_code   NVARCHAR(20)  NOT NULL,
    movement_type   NVARCHAR(10)  NOT NULL,   -- IN | OUT | ADJ | MOVE
    qty             INT           NOT NULL,
    ref_no          NVARCHAR(24)  NULL,       -- OUT 이면 쇼핑몰 order_no
    moved_by        NVARCHAR(30)  NOT NULL,
    moved_at        DATETIME2(0)  NOT NULL,
    created_at      DATETIME2(0)  NOT NULL
);
GO

IF OBJECT_ID('dbo.outbound_orders') IS NULL
CREATE TABLE dbo.outbound_orders (
    outbound_no     NVARCHAR(24)  NOT NULL CONSTRAINT pk_outbound_orders PRIMARY KEY,
    order_no        NVARCHAR(24)  NOT NULL,   -- 쇼핑몰 orders.order_no
    warehouse_code  NVARCHAR(10)  NOT NULL,
    status          NVARCHAR(20)  NOT NULL,   -- WAITING | PICKING | PACKED | SHIPPED | HOLD
    requested_at    DATETIME2(0)  NOT NULL,
    picked_at       DATETIME2(0)  NULL,
    shipped_at      DATETIME2(0)  NULL,
    picker          NVARCHAR(30)  NULL,
    hold_reason     NVARCHAR(100) NULL,
    updated_at      DATETIME2(0)  NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_locations_wh')
    CREATE INDEX ix_locations_wh        ON dbo.locations(warehouse_code);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_inventory_updated')
    CREATE INDEX ix_inventory_updated   ON dbo.inventory(updated_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_movements_moved')
    CREATE INDEX ix_movements_moved     ON dbo.stock_movements(moved_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_movements_ref')
    CREATE INDEX ix_movements_ref       ON dbo.stock_movements(ref_no);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_outbound_order')
    CREATE INDEX ix_outbound_order      ON dbo.outbound_orders(order_no);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_outbound_updated')
    CREATE INDEX ix_outbound_updated    ON dbo.outbound_orders(updated_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='eai_ro')
    CREATE USER eai_ro  FOR LOGIN eai_ro;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='eai_rw')
    CREATE USER eai_rw  FOR LOGIN eai_rw;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='eai_ddl')
    CREATE USER eai_ddl FOR LOGIN eai_ddl;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='sym')
    CREATE USER sym     FOR LOGIN sym;
GO

ALTER ROLE db_datareader ADD MEMBER eai_ro;
ALTER ROLE db_datareader ADD MEMBER eai_rw;
ALTER ROLE db_datawriter ADD MEMBER eai_rw;
ALTER ROLE db_owner      ADD MEMBER eai_ddl;
ALTER ROLE db_owner      ADD MEMBER sym;
GO

-- 실행 계획(EXPLAIN 화면)을 읽으려면 필요하다.
GRANT SHOWPLAN TO eai_ro;
GRANT SHOWPLAN TO eai_rw;
GO
