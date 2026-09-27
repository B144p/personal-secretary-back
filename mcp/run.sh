#!/bin/sh
# Launcher for the personal-pm MCP server, so registration needs one path:
#   claude mcp add personal-pm --scope user -- /abs/path/to/mcp/run.sh
#
# Loads PM_API_URL / PM_TOKEN from mcp/.env when it exists; otherwise they
# must already be in the environment (e.g. `claude mcp add -e ...`).
# Never write to stdout here: it carries the MCP protocol.

MCP_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$MCP_DIR")
TSX="$ROOT/node_modules/.bin/tsx"

if [ ! -x "$TSX" ]; then
  echo "[personal-pm] tsx not found at $TSX; run pnpm install in $ROOT" >&2
  exit 1
fi

cd "$ROOT" || exit 1

if [ -f "$MCP_DIR/.env" ]; then
  exec "$TSX" --env-file="$MCP_DIR/.env" "$MCP_DIR/index.ts"
fi
exec "$TSX" "$MCP_DIR/index.ts"
