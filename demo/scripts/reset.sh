#!/usr/bin/env bash
# 촬영 NG 후 원상복구. 볼륨까지 지우고 처음부터 다시 만든다.
#
# 데이터가 시드 고정이라 **리셋해도 화면의 숫자가 그대로다** — 테이크를 여러 번 가도
# 같은 그림이 나온다. 날짜만 실행 시점 기준으로 다시 계산된다.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

say "데모 스택 삭제 (볼륨 포함) — 본체 ditter 스택은 건드리지 않는다"
"${COMPOSE[@]}" down -v --remove-orphans

"$DEMO_DIR/scripts/up.sh"
"$DEMO_DIR/scripts/seed.sh"
say "리셋 완료"
