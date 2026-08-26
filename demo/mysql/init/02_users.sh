#!/bin/bash
# 권한을 역할별로 나눈다. 화면(허용 명령)만이 아니라 **DB 권한으로도** 읽기 전용이
# 기본이라는 것을 보여주는 자리다 — 시연에서 이 계층이 있고 없고 차이가 크다.
#   eai_ro  조회만  ·  eai_rw  DML  ·  eai_ddl  DDL 포함  ·  debezium  CDC 복제
set -euo pipefail

APP_PW="${DEMO_APP_PASSWORD:?}"
DBZ_PW="${DEMO_DEBEZIUM_PASSWORD:?}"

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER 'eai_ro'@'%'  IDENTIFIED BY '${APP_PW}';
CREATE USER 'eai_rw'@'%'  IDENTIFIED BY '${APP_PW}';
CREATE USER 'eai_ddl'@'%' IDENTIFIED BY '${APP_PW}';
CREATE USER 'debezium'@'%' IDENTIFIED BY '${DBZ_PW}';

GRANT SELECT, SHOW VIEW                     ON shop.* TO 'eai_ro'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE        ON shop.* TO 'eai_rw'@'%';
GRANT ALL PRIVILEGES                        ON shop.* TO 'eai_ddl'@'%';

-- EXPLAIN / 성능 분석 화면이 실행 계획을 읽으려면 필요하다.
GRANT PROCESS ON *.* TO 'eai_ro'@'%';
GRANT PROCESS ON *.* TO 'eai_rw'@'%';

-- Debezium: binlog 를 따라가려면 서버 전역 권한이 필요하다 (스키마 권한으로는 안 된다).
GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT
  ON *.* TO 'debezium'@'%';

-- eai_rw 에도 같은 복제 권한을 준다. CDC 는 **연결에 저장된 계정**을 그대로 Debezium 에
-- 넘기므로(cdc_connect.py), 없으면 콘솔용 연결과 CDC 용 연결을 따로 만들어야 한다.
-- 화면에 연결이 둘로 늘어나는 것보다 이쪽이 시연에서 깔끔하다. eai_ro 는 그대로 읽기 전용이다.
GRANT RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'eai_rw'@'%';

FLUSH PRIVILEGES;
SQL
