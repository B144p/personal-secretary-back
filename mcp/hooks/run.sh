#!/bin/sh
# Launcher for the personal-pm plan hooks (see index.ts for the events).
#   /abs/path/to/mcp/hooks/run.sh <stash|approved|first-edit|create-pre|create-post|session-start>
#
# Loads PM_API_URL / PM_TOKEN from mcp/.env like mcp/run.sh. Always exits 0
# so a broken hook never blocks Claude Code.

HOOKS_DIR=$(cd "$(dirname "$0")" && pwd)
MCP_DIR=$(dirname "$HOOKS_DIR")
ROOT=$(dirname "$MCP_DIR")
TSX="$ROOT/node_modules/.bin/tsx"
STATE_DIR=${PM_HOOK_STATE_DIR:-$HOME/.claude/personal-pm}
EVENT=$1

INPUT=$(cat)

# Fast path: first-edit runs before every edit, but only matters while this
# session has a plan pending. Skip starting node otherwise.
if [ "$EVENT" = "first-edit" ]; then
  SID=$(printf '%s' "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | tr -c 'A-Za-z0-9_\n-' '_')
  [ -n "$SID" ] && [ -f "$STATE_DIR/pending/$SID.json" ] || exit 0
fi

if [ ! -x "$TSX" ]; then
  mkdir -p "$STATE_DIR"
  echo "$(date -u +%FT%TZ) tsx not found at $TSX" >> "$STATE_DIR/hook.log"
  exit 0
fi

cd "$ROOT" || exit 0
if [ -f "$MCP_DIR/.env" ]; then
  printf '%s' "$INPUT" | "$TSX" --env-file="$MCP_DIR/.env" "$HOOKS_DIR/index.ts" "$EVENT"
else
  printf '%s' "$INPUT" | "$TSX" "$HOOKS_DIR/index.ts" "$EVENT"
fi
exit 0
