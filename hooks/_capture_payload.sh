#!/usr/bin/env bash
# Optional raw hook-payload capture for one-off smoke tests.
set -euo pipefail

if [ "${PURAGUIN_CAPTURE_HOOK_PAYLOADS:-0}" != "1" ]; then
  exit 0
fi

HOOK_NAME="${1:?hook name required}"
PAYLOAD="${2:?payload required}"
PURAGUIN_HOME="${PURAGUIN_HOME:-$HOME/.puraguin}"
OUT_DIR="$PURAGUIN_HOME/debug/claude-code-hook-payloads"
mkdir -p "$OUT_DIR"

TS="$(date -u +%Y%m%dT%H%M%S.%3NZ)"
SAFE_HOOK="$(printf '%s' "$HOOK_NAME" | tr -c '[:alnum:]._-' '_')"
OUT_FILE="$OUT_DIR/${TS}-${SAFE_HOOK}-$$.json"

printf '%s\n' "$PAYLOAD" > "$OUT_FILE"
