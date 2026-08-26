#!/bin/bash
# SQL Server 이미지에는 초기화 훅이 없다 — 서버가 healthy 가 된 뒤 이 원샷 컨테이너가
# sqlcmd 로 스키마를 한 번 민다. 이미 적용돼 있으면 조용히 끝난다(멱등).
set -euo pipefail

SQLCMD=""
for p in /opt/mssql-tools18/bin/sqlcmd /opt/mssql-tools/bin/sqlcmd; do
  [ -x "$p" ] && SQLCMD="$p" && break
done
[ -n "$SQLCMD" ] || { echo "sqlcmd 를 찾지 못했습니다"; exit 1; }

# -C: 이미지의 자체서명 인증서를 신뢰 (tools18 은 TLS 검증이 기본이라 없으면 붙지 못한다)
run() { "$SQLCMD" -S mssql-wms -U sa -P "$MSSQL_SA_PASSWORD" -C -b "$@"; }

echo "[mssql-init] 서버 접속 대기…"
for i in $(seq 1 60); do
  run -Q "SELECT 1" -o /dev/null && break
  sleep 2
done

echo "[mssql-init] 스키마 적용"
run -i /init/01_schema.sql \
    -v APP_PW="$DEMO_APP_PASSWORD" SYM_PW="$DEMO_SYM_PASSWORD"
echo "[mssql-init] 완료"
