#!/bin/bash
set -e

SLUG="${TOOL_SLUG:-$RAILWAY_SERVICE_NAME}"

if [ -z "$SLUG" ] || [ "$SLUG" = "alles-neue-tools" ]; then
  echo "No TOOL_SLUG set. Exiting."
  exit 0
fi

CITY="${TOOL_CITY:-all}"

echo "▶ Starting tool: $SLUG (city: $CITY)"

if [ "$SLUG" = "run-all" ]; then
  exec npx tsx src/cli/run-all.ts --city "$CITY"
else
  exec npx tsx src/cli/run-tool.ts --slug "$SLUG" --city "$CITY"
fi
