#!/usr/bin/env bash
# Atomic JSONL append. Args: $1 = JSON object string (single line).
# Output path: $IDISU_HOME/spool/YYYY-MM-DD.jsonl
set -euo pipefail

IDISU_HOME="${IDISU_HOME:-$HOME/.idisu}"
DATE="$(date -u +%F)"
OUT_DIR="$IDISU_HOME/spool"
mkdir -p "$OUT_DIR"

if ! command -v flock >/dev/null 2>&1; then
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_mark_inactive.sh" "hooks-missing-flock"
  exit 0
fi

OUT_FILE="$OUT_DIR/$DATE.jsonl"
LOCK_FILE="$OUT_FILE.lock"

# Append under a file lock so concurrent sessions don't tear lines.
{
  flock -x 9
  printf '%s\n' "$1" >> "$OUT_FILE"
} 9>"$LOCK_FILE"
