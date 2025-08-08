#!/usr/bin/env bash
set -euo pipefail

# === Docker launcher for AutoTradePro Crypto ===
# Usage:
#   ./run.sh                # runs default entry (testPrice_Dev.js)
#   ./run.sh myEntry.js     # runs specified entry file
#   DEBUG_BUYS=1 TEST_MODE=1 ./run.sh
#   PULL_IMAGE=1 ./run.sh   # pulls the image before running
#
# Env vars respected (all optional):
#   IMAGE=node:20-alpine
#   DEBUG_BUYS=true|1|yes|on
#   TEST_MODE=true|1|yes|on
#   DEMO_MODE=false|0|no|off
#   LIMIT_TO_MAX_BUY_SELL=true|1|yes|on

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_DEFAULT="testPrice_Dev.js"
APP="${1:-$APP_DEFAULT}"
IMAGE="${IMAGE:-node:20-alpine}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,35p' "$0"
  exit 0
fi

if [[ ! -f "$APP" ]]; then
  echo "❌ Cannot find '$APP' in $(pwd)."
  echo "   Pass a filename: ./run.sh myFile.js"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker not found. Install Docker Desktop and try again."
  exit 1
fi

# Optional: pull the image if requested
if [[ "${PULL_IMAGE:-}" == "1" ]]; then
  echo "⬇️  Pulling Docker image: $IMAGE"
  docker pull "$IMAGE"
fi

# Defaults; your code now tolerates 1/true/yes/on via asBool()
DEBUG_BUYS="${DEBUG_BUYS:-true}"
TEST_MODE="${TEST_MODE:-true}"
DEMO_MODE="${DEMO_MODE:-false}"
LIMIT_TO_MAX_BUY_SELL="${LIMIT_TO_MAX_BUY_SELL:-true}"

DOCKER_ARGS=(
  --rm -it
  -v "$PWD:/usr/src/app"
  -w /usr/src/app
  -e DEBUG_BUYS="$DEBUG_BUYS"
  -e TEST_MODE="$TEST_MODE"
  -e DEMO_MODE="$DEMO_MODE"
  -e LIMIT_TO_MAX_BUY_SELL="$LIMIT_TO_MAX_BUY_SELL"
)

# Include .env if present
if [[ -f .env ]]; then
  DOCKER_ARGS+=( --env-file .env )
fi

echo "🐳 Running $APP in Docker image $IMAGE"
docker run "${DOCKER_ARGS[@]}" "$IMAGE" sh -lc "node -v; node \"$APP\""
