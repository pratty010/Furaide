#!/usr/bin/env bash
set -euo pipefail

SATORI_HOME="${SATORI_HOME:-$HOME/.satori}"
REASON="${1:?reason required}"
mkdir -p "$SATORI_HOME/debug"

MARKER="$SATORI_HOME/debug/${REASON}.log"
STAMP="$(date -u +%Y-%m-%d)"

if [[ ! -f "$MARKER" ]] || ! grep -qx "$STAMP" "$MARKER" 2>/dev/null; then
  printf '%s\n' "$STAMP" > "$MARKER"
fi
