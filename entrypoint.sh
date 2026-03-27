#!/bin/bash
set -e

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

if [ "$SLUG" = "run-all" ]; then
  exec npx tsx src/cli/run-all.ts --city "$CITY" $MODE_FLAG
else
  exec npx tsx src/cli/run-tool.ts --slug "$SLUG" --city "$CITY" $MODE_FLAG
fi
