#!/usr/bin/env bash
set -euo pipefail

IDISU_HOME="${IDISU_HOME:-$HOME/.idisu}"
REASON="${1:?reason required}"
mkdir -p "$IDISU_HOME/debug"

MARKER="$IDISU_HOME/debug/${REASON}.log"
STAMP="$(date -u +%Y-%m-%d)"

if [[ ! -f "$MARKER" ]] || ! grep -qx "$STAMP" "$MARKER" 2>/dev/null; then
  printf '%s\n' "$STAMP" > "$MARKER"
fi
