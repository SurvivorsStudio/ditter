-- 쇼핑몰 (MySQL) — 주문·고객·상품·결제
--
-- DB 를 넘는 조인 키는 **자연키**를 쓴다: order_no · sku · customer_no.
-- 내부 AUTO_INCREMENT id 는 MySQL 안에서만 쓰이고, WMS·CRM 이 참조하는 것은 자연키다.
-- (AUTO_INCREMENT 를 넘기면 시더가 세 DB 를 채우는 순서에 결과가 묶인다.)
--
-- 모든 트랜잭션 테이블에 updated_at 이 있다 — 배치 파이프라인의 증분(watermark) 기준.

USE shop;

CREATE TABLE customers (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  customer_no  VARCHAR(20)  NOT NULL,
  name         VARCHAR(60)  NOT NULL,
  email        VARCHAR(120) NOT NULL,
  phone        VARCHAR(20)  NOT NULL,
  grade        VARCHAR(10)  NOT NULL COMMENT 'BRONZE|SILVER|GOLD|VIP',
  city         VARCHAR(40)  NOT NULL,
  joined_at    DATETIME     NOT NULL,
  created_at   DATETIME     NOT NULL,
  updated_at   DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_customers_no (customer_no),
  KEY ix_customers_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE products (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  sku         VARCHAR(20)   NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  category    VARCHAR(40)   NOT NULL,
  brand       VARCHAR(40)   NOT NULL,
  price       DECIMAL(12,2) NOT NULL,
  cost        DECIMAL(12,2) NOT NULL,
  status      VARCHAR(20)   NOT NULL COMMENT 'ACTIVE|DISCONTINUED',
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_products_sku (sku),
  KEY ix_products_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  order_no       VARCHAR(24)   NOT NULL,
  customer_no    VARCHAR(20)   NOT NULL,
  ordered_at     DATETIME      NOT NULL,
  status         VARCHAR(20)   NOT NULL COMMENT 'PENDING|PAID|PICKING|SHIPPED|DELIVERED|CANCELLED',
  channel        VARCHAR(20)   NOT NULL COMMENT 'WEB|MOBILE|APP|KAKAO',
  total_amount   DECIMAL(14,2) NOT NULL,
  discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(20)   NOT NULL,
  shipped_at     DATETIME      NULL,
  created_at     DATETIME      NOT NULL,
  updated_at     DATETIME      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_no (order_no),
  KEY ix_orders_customer (customer_no),
  KEY ix_orders_ordered (ordered_at),
  KEY ix_orders_status (status),
  KEY ix_orders_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  order_no    VARCHAR(24)   NOT NULL,
  line_no     INT           NOT NULL,
  sku         VARCHAR(20)   NOT NULL,
  qty         INT           NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_items (order_no, line_no),
  KEY ix_order_items_sku (sku),
  KEY ix_order_items_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payments (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  payment_no  VARCHAR(24)   NOT NULL,
  order_no    VARCHAR(24)   NOT NULL,
  method      VARCHAR(20)   NOT NULL COMMENT 'CARD|BANK|VIRTUAL|PAY',
  amount      DECIMAL(14,2) NOT NULL,
  status      VARCHAR(20)   NOT NULL COMMENT 'PAID|REFUNDED|FAILED',
  paid_at     DATETIME      NOT NULL,
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payments_no (payment_no),
  KEY ix_payments_order (order_no),
  KEY ix_payments_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
