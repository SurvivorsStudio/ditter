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
