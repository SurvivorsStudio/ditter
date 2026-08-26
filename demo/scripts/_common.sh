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

# 비밀번호를 **허용된 문자만으로** 제한한다. 시작 전에 본다.
#
# .env 의 값은 초기화 SQL 의 문자열 리터럴('...')과 접속 문자열에 이스케이프 없이 들어간다
# (postgres/init/01_init.sh · mysql/init/02_users.sh · mssql/init/01_schema.sql 의 $(APP_PW)
#  · seed/generate.py 의 psycopg conninfo). 작은따옴표는 리터럴을 끊고, 공백은 접속 문자열을
# 다음 키워드로 갈라 놓으며, 역슬래시는 드라이버마다 다르게 읽는다.
#
# **막을 문자를 세는 대신 쓸 문자를 정한다.** 위험한 문자를 하나씩 나열하면 반드시 빠뜨린다 —
# 실제로 처음엔 따옴표·공백·역슬래시만 막았는데, 그 목록을 통과하는 `$` 가 더 나빴다.
# `Dit$ter1` 은 compose 가 `$ter1` 을 변수로 읽어 **`Dit` 로 잘라서** 넘긴다(실측: compose
# 27.4.0). 그때 나오는 것이 error 가 아니라 `The "ter1" variable is not set` **warning**
# 하나뿐이라 기동이 멈추지 않는다 — 잘린 비밀번호로 DB 가 만들어지고, 로그는 지나간 뒤라
# 아무도 그 줄을 보지 않는다. 백틱·`&`·`|` 도 같은 식으로 언젠가 물릴 자리다.
#
# 그래서 영문·숫자와 ! @ # % ^ * - _ + = 만 통과시킨다. .env.example 이 권장해 온 문자집합과
# 같은 것이고, 데모 비밀번호에 이보다 더 필요할 일이 없다. LC_ALL=C 로 두는 것은 A-Z 범위가
# 로케일 대조순서를 타지 않게 하려는 것이다 — 그러지 않으면 환경마다 통과 여부가 달라진다.
#
# 이 자리에서 거르는 이유는 **초기화가 첫 기동에만 돌기**
# 때문이다. 중간에 깨지면 반쯤 만들어진 DB 가 남고, 값을 고쳐 다시 실행해도 같은 자리에서
# 막힌다 — 볼륨을 지우기 전에는 풀리지 않는데 그 사실이 오류 메시지에 드러나지 않는다.
# 데모용이라 값을 바꿀 일이 드물다는 전제 위의 선택이다.
#
# **down.sh 는 이 검사를 부르지 않는다.** 여기서 걸린 사람에게 남은 유일한 탈출구가
# `down.sh -v` 라서, 그것까지 막으면 스스로 못 빠져나온다.
#: 비밀번호에 쓸 수 있는 문자. 여기를 넓히면 위 주석의 이유들을 다시 따져야 한다.
PASSWORD_ALLOWED_DESC='영문 대소문자 · 숫자 · ! @ # % ^ * - _ + ='

require_safe_passwords() {
  local file="$DEMO_DIR/.env" line key val bad=()
  local LC_ALL=C   # A-Za-z0-9 범위가 로케일을 타지 않게 (한글·악센트 문자가 새지 않는다)
  [ -f "$file" ] || return 0
  while IFS= read -r line; do
    key="${line%%=*}"; key="${key#"${key%%[![:space:]]*}"}"
    val="${line#*=}"
    val="${val%%[[:space:]]#*}"              # compose 와 같게 인라인 주석을 뗀다
    val="${val#"${val%%[![:space:]]*}"}"     # 앞 공백
    val="${val%"${val##*[![:space:]]}"}"     # 뒤 공백
    # 허용 문자 **밖**이 하나라도 있으면 막는다 (여는 [! 가 부정, 끝의 - 는 글자 그대로).
    case "$val" in
      *[!A-Za-z0-9!@#%^*_+=-]*) bad+=("$key") ;;
    esac
  done < <(grep -E '^[[:space:]]*DEMO_[A-Z_]*PASSWORD=' "$file" || true)

  [ ${#bad[@]} -eq 0 ] && return 0
  cat >&2 <<MSG
demo/.env 의 비밀번호에 쓸 수 없는 문자가 있습니다: ${bad[*]}

쓸 수 있는 문자는 이것뿐입니다:
  ${PASSWORD_ALLOWED_DESC}

그 밖의 문자(따옴표 ' " · 공백 · 역슬래시 \\ · 백틱 \` · \$ & | ( ) 등)는 이 값이 그대로
들어가는 DB 초기화 SQL 과 접속 문자열을 끊습니다. 특히 **\$ 는 조용히 망가집니다** —
docker compose 가 그 뒤를 변수 이름으로 읽어 'Dit\$ter1' 을 'Dit' 로 잘라서 넘기는데,
경고 한 줄이 지나갈 뿐 기동은 멈추지 않아 잘린 비밀번호로 DB 가 만들어집니다.

초기화는 **첫 기동에만** 돕니다. 이대로 진행하면 반쯤 만들어진 DB 가 남고, 값을
고쳐 다시 실행해도 같은 자리에서 막힙니다. 그래서 시작 전에 세웁니다.

  1) demo/.env 의 위 값을 허용 문자만으로 다시 짓습니다.
  2) 이미 한 번 띄운 적이 있다면: bash demo/scripts/down.sh -v   (볼륨까지 지움)
  3) 다시: bash demo/scripts/up.sh
MSG
  exit 1
}
