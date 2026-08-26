#!/usr/bin/env bash
# 모든 스크립트가 공유하는 경로·명령. 어디서 실행해도 같게 동작한다.
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$DEMO_DIR/.." && pwd)"
COMPOSE=(docker compose -f "$DEMO_DIR/docker-compose.demo.yml")

[ -f "$DEMO_DIR/.env" ] || {
  cp "$DEMO_DIR/.env.example" "$DEMO_DIR/.env"
  echo "[demo] .env 를 .env.example 에서 만들었습니다 — 필요하면 고친 뒤 다시 실행하세요."
}

say() { printf '\033[1;36m[demo]\033[0m %s\n' "$*"; }

# 비밀번호에 쓸 수 없는 문자를 **시작 전에** 막는다.
#
# .env 의 값은 초기화 SQL 의 문자열 리터럴('...')과 접속 문자열에 이스케이프 없이 들어간다
# (postgres/init/01_init.sh · mysql/init/02_users.sh · mssql/init/01_schema.sql 의 $(APP_PW)
#  · seed/generate.py 의 psycopg conninfo). 작은따옴표는 리터럴을 끊고, 공백은 접속 문자열을
# 다음 키워드로 갈라 놓으며, 역슬래시는 드라이버마다 다르게 읽는다.
#
# 네 자리를 모두 이스케이프하지 않고 여기서 거르는 이유는 **초기화가 첫 기동에만 돌기**
# 때문이다. 중간에 깨지면 반쯤 만들어진 DB 가 남고, 값을 고쳐 다시 실행해도 같은 자리에서
# 막힌다 — 볼륨을 지우기 전에는 풀리지 않는데 그 사실이 오류 메시지에 드러나지 않는다.
# 데모용이라 값을 바꿀 일이 드물다는 전제 위의 선택이다.
#
# **down.sh 는 이 검사를 부르지 않는다.** 여기서 걸린 사람에게 남은 유일한 탈출구가
# `down.sh -v` 라서, 그것까지 막으면 스스로 못 빠져나온다.
require_safe_passwords() {
  local file="$DEMO_DIR/.env" line key val bad=()
  [ -f "$file" ] || return 0
  while IFS= read -r line; do
    key="${line%%=*}"; key="${key#"${key%%[![:space:]]*}"}"
    val="${line#*=}"
    val="${val%%[[:space:]]#*}"              # compose 와 같게 인라인 주석을 뗀다
    val="${val#"${val%%[![:space:]]*}"}"     # 앞 공백
    val="${val%"${val##*[![:space:]]}"}"     # 뒤 공백
    case "$val" in
      *\'*|*\\*|*" "*) bad+=("$key") ;;
    esac
  done < <(grep -E '^[[:space:]]*DEMO_[A-Z_]*PASSWORD=' "$file" || true)

  [ ${#bad[@]} -eq 0 ] && return 0
  cat >&2 <<MSG
demo/.env 의 비밀번호에 쓸 수 없는 문자가 있습니다: ${bad[*]}

작은따옴표(') · 공백 · 역슬래시(\\) 는 쓸 수 없습니다. 이 값은 DB 초기화 SQL 의
문자열 리터럴과 접속 문자열에 그대로 들어가서, 따옴표는 SQL 을 끊고 공백은 접속
문자열을 다음 키워드로 갈라 놓습니다.

초기화는 **첫 기동에만** 돕니다. 이대로 진행하면 반쯤 만들어진 DB 가 남고, 값을
고쳐 다시 실행해도 같은 자리에서 막힙니다. 그래서 시작 전에 세웁니다.

  1) demo/.env 의 위 값을 영문·숫자와 ! @ # % ^ * - _ + = 정도로 다시 짓습니다.
  2) 이미 한 번 띄운 적이 있다면: bash demo/scripts/down.sh -v   (볼륨까지 지움)
  3) 다시: bash demo/scripts/up.sh
MSG
  exit 1
}
