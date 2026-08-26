#!/usr/bin/env bash
# 데모 스택을 내린다. 인자로 -v 를 주면 데이터(볼륨)까지 지운다.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
"${COMPOSE[@]}" down "$@"
say "내렸습니다"
