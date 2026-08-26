#!/usr/bin/env bash
# 시연용 DB 3종을 띄우고 스키마가 적용될 때까지 기다린다. 데이터는 넣지 않는다(seed.sh).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_safe_passwords   # 컨테이너를 만들기 전에 — 초기화는 첫 기동에만 돈다

NET="${DEMO_NETWORK:-ditter_default}"
docker network inspect "$NET" >/dev/null 2>&1 || {
  cat >&2 <<MSG
네트워크 '$NET' 가 없습니다.

데모 DB 는 본체(ditter) 스택의 네트워크에 올라탑니다 — 그래야 api·worker 가
'mysql-shop' 같은 컨테이너 이름으로 찾아가고, 본체를 재시작해도 끊기지 않습니다.
본체 스택을 먼저 띄우세요:  docker compose up -d
MSG
  exit 1
}

say "컨테이너 기동 (MySQL 3307 · MSSQL 1433 · PostgreSQL 5433)"
"${COMPOSE[@]}" up -d

say "MSSQL 스키마 적용 대기 — SQL Server 는 초기화 훅이 없어 원샷 컨테이너가 민다"
# 다 기다리고도 끝나지 않았으면 **반드시 실패로 끝낸다.** 그냥 빠져나가면 스키마가 없는데도
# exit 0 이 되어 reset.sh 의 set -e 가 무력해지고, "다음: seed.sh" 안내까지 뜬다.
applied=0
for _ in $(seq 1 90); do
  state="$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' 2>/dev/null | awk '$1=="mssql-wms-init"{print $2" "$3}')"
  case "$state" in
    "exited 0") say "스키마 적용 완료"; applied=1; break ;;
    "exited "*) "${COMPOSE[@]}" logs mssql-wms-init; echo "MSSQL 초기화 실패" >&2; exit 1 ;;
  esac
  sleep 2
done

[ "$applied" = 1 ] || {
  "${COMPOSE[@]}" logs mssql-wms-init
  echo "MSSQL 스키마 적용이 180초 안에 끝나지 않았습니다 (mssql-wms-init 상태: ${state:-알 수 없음})" >&2
  exit 1
}

"${COMPOSE[@]}" ps
say "다음: demo/scripts/seed.sh (목데이터 적재)"
