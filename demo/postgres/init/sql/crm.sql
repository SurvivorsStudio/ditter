-- 고객센터 CRM — 클레임·상담.
-- order_no · customer_no · sku 는 쇼핑몰(MySQL)·WMS(MSSQL)와 **같은 값**이다.
-- 연합 조회에서 세 DB 를 잇는 것이 이 세 컬럼이다.

CREATE TABLE agents (
    agent_id    varchar(10)  PRIMARY KEY,
    agent_name  varchar(30)  NOT NULL,
    team        varchar(20)  NOT NULL,
    hired_at    date         NOT NULL
);

CREATE TABLE claims (
    id           bigserial    PRIMARY KEY,
    claim_no     varchar(24)  NOT NULL UNIQUE,
    order_no     varchar(24)  NOT NULL,
    customer_no  varchar(20)  NOT NULL,
    sku          varchar(20),
    category     varchar(30)  NOT NULL,   -- 배송지연 | 오배송 | 파손 | 품절 | 환불 | 문의
    channel      varchar(20)  NOT NULL,   -- 전화 | 채팅 | 이메일 | 앱
    severity     varchar(10)  NOT NULL,   -- LOW | MEDIUM | HIGH | URGENT
    status       varchar(20)  NOT NULL,   -- OPEN | IN_PROGRESS | RESOLVED | CLOSED
    agent_id     varchar(10)  REFERENCES agents(agent_id),
    summary      text         NOT NULL,
    opened_at    timestamp    NOT NULL,
    closed_at    timestamp,
    updated_at   timestamp    NOT NULL
);

CREATE INDEX ix_claims_order    ON claims(order_no);
CREATE INDEX ix_claims_sku      ON claims(sku);
CREATE INDEX ix_claims_opened   ON claims(opened_at);
CREATE INDEX ix_claims_updated  ON claims(updated_at);

GRANT USAGE ON SCHEMA public TO eai_ro, eai_rw, eai_ddl;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA public TO eai_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO eai_rw;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO eai_rw;
GRANT ALL                            ON ALL TABLES    IN SCHEMA public TO eai_ddl;
GRANT ALL                            ON ALL SEQUENCES IN SCHEMA public TO eai_ddl;

-- 소유권을 eai_ddl 로 넘긴다. 초기화 스크립트는 superuser 로 도는데, 그러면 테이블·시퀀스
-- 주인이 postgres 가 되고 eai_ddl 은 GRANT ALL 을 받아도 `TRUNCATE ... RESTART IDENTITY`
-- 를 못 한다(그건 권한이 아니라 **소유권**을 요구한다). 시더가 여기서 막힌다.
ALTER TABLE agents         OWNER TO eai_ddl;
ALTER TABLE claims         OWNER TO eai_ddl;
ALTER SEQUENCE claims_id_seq OWNER TO eai_ddl;
