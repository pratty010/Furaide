#!/usr/bin/env bash
# Atomic JSONL append. Args: $1 = JSON object string (single line).
# Output path: $PURAGUIN_HOME/events/claude-code/YYYY-MM-DD.jsonl
set -euo pipefail

PURAGUIN_HOME="${PURAGUIN_HOME:-$HOME/.puraguin}"
OUT_DIR="$PURAGUIN_HOME/events/claude-code"
mkdir -p "$OUT_DIR"

DATE="$(date -u +%Y-%m-%d)"
OUT_FILE="$OUT_DIR/$DATE.jsonl"
LOCK_FILE="$OUT_FILE.lock"

# Append under a file lock so concurrent sessions don't tear lines.
{
  flock -x 9
  printf '%s\n' "$1" >> "$OUT_FILE"
} 9>"$LOCK_FILE"
