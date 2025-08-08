#!/usr/bin/env bash
set -euo pipefail

# Always run from the backend folder (where this script lives)
cd "$(dirname "$0")"

# --- Env & defaults ---
BOT_ID="${BOT_ID:-default}"
DATA_DIR_HOST="${DATA_DIR:-$PWD/data/$BOT_ID}"
DATA_DIR_CONTAINER="/usr/src/app/data/$BOT_ID"

mkdir -p "$DATA_DIR_HOST"

# Only request a TTY when we actually have one (fixes: "the input device is not a TTY")
TTY_ARGS=""
if [ -t 0 ] && [ -t 1 ]; then
  TTY_ARGS="-it"
fi

echo "[${BOT_ID}] 🐳 Running testPrice_Dev.js in Docker image node:20-alpine"

docker run --rm $TTY_ARGS   --env-file .env   -e BOT_ID="$BOT_ID"   -e DATA_DIR="$DATA_DIR_CONTAINER"   -e DEBUG_BUYS="${DEBUG_BUYS:-true}"   -e TEST_MODE="${TEST_MODE:-true}"   -e DEMO_MODE="${DEMO_MODE:-false}"   -e LIMIT_TO_MAX_BUY_SELL="${LIMIT_TO_MAX_BUY_SELL:-true}"   -v "$PWD:/usr/src/app"   -w /usr/src/app   node:20-alpine node testPrice_Dev.js
