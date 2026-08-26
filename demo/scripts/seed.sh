#!/usr/bin/env bash
# 세 DB 를 한 번에 채운다. 여러 번 돌려도 같은 데이터가 나온다(시드 고정 + 매번 비우고 넣음).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

say "목데이터 생성·적재 (규모는 demo/.env 의 DEMO_SCALE)"
"${COMPOSE[@]}" --profile seed run --rm --build seed
