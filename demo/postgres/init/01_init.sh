#!/bin/bash
# PostgreSQL 은 두 데이터베이스를 담는다.
#   crm — 고객센터 클레임 (운영계, 연합 조회의 세 번째 조인 대상)
#   dw  — 적재 타깃. **일부러 비워 둔다** — 파이프라인이 채우는 것을 보여주는 자리다.
set -euo pipefail

APP_PW="${DEMO_APP_PASSWORD:?}"
SYM_PW="${DEMO_SYM_PASSWORD:?}"
psql_super() { psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "$@"; }

psql_super --dbname crm <<SQL
CREATE ROLE eai_ro  LOGIN PASSWORD '${APP_PW}';
CREATE ROLE eai_rw  LOGIN PASSWORD '${APP_PW}';
CREATE ROLE eai_ddl LOGIN PASSWORD '${APP_PW}';
-- SymmetricDS 타깃 노드. SYM_* 45개 테이블을 dw 에 직접 만든다.
CREATE ROLE sym     LOGIN PASSWORD '${SYM_PW}';
-- Debezium 이 PostgreSQL 을 소스로도 쓸 수 있게 (기본 시나리오는 MySQL 소스다).
CREATE ROLE debezium LOGIN REPLICATION PASSWORD '${APP_PW}';
CREATE DATABASE dw OWNER eai_ddl;
SQL

psql_super --dbname crm -f /docker-entrypoint-initdb.d/sql/crm.sql
psql_super --dbname dw  -f /docker-entrypoint-initdb.d/sql/dw.sql
