#!/bin/bash
set -e

# Pfade relativ zum Skript aufloesen, nicht zum aktuellen Arbeitsverzeichnis
cd "$(dirname "$0")"

SLUG="${TOOL_SLUG:-$RAILWAY_SERVICE_NAME}"

if [ -z "$SLUG" ] || [ "$SLUG" = "alles-neue-tools" ]; then
  echo "No TOOL_SLUG set. Exiting."
  exit 0
fi

CITY="${TOOL_CITY:-all}"
MODE="${TOOL_MODE:-}"
MODE_FLAG=""
if [ "$MODE" = "baseline_only" ]; then
  MODE_FLAG="--baseline-only"
elif [ "$MODE" = "dry_run" ]; then
  MODE_FLAG="--dry-run"
fi

echo "▶ Starting tool: $SLUG (city: $CITY${MODE:+, mode: $MODE})"
# Node-Version mitloggen: sonst laesst sich am Deploy nicht nachvollziehen,
# welche Runtime Nixpacks aus engines.node aufgeloest hat.
echo "  runtime: node $(node -v) | $(./node_modules/.bin/tsx --version 2>/dev/null | head -1)"

if [ "$SLUG" = "run-all" ]; then
  exec ./node_modules/.bin/tsx src/cli/run-all.ts --city "$CITY" $MODE_FLAG
else
  exec ./node_modules/.bin/tsx src/cli/run-tool.ts --slug "$SLUG" --city "$CITY" $MODE_FLAG
fi
