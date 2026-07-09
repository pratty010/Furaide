#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. pi-agent installer
#
# Usage:
#   bash packages/cli/src/targets/pi-agent/install.sh
#
# Prerequisites: bun or node+npm, and the pi CLI (https://pi.dev)
#   --skip-checks     N/A here — pi-agent has no non-fatal pre-checks to skip
#                     (bun/npm and pi CLI absence are both hard errors)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_DIR="$(cd "$SCRIPT_DIR/../../shared" && pwd)"
source "$SHARED_DIR/install-lib.sh"
AGENT_DIR="$(cd "$SCRIPT_DIR/../../../../../harnesses/pi-agent" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
  esac
done

# ── Pre-checks ────────────────────────────────────────────────────────────────
furaide_detect_js_runtime || exit 1
ok "JS runtime: $JS_RUNTIME"

if ! command -v pi >/dev/null 2>&1; then
  err "pi CLI not found. Install from https://pi.dev then re-run."
  exit 1
fi
ok "pi CLI found"

if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ "$JS_RUNTIME" == "bun" ]]; then
    echo "[dry-run] would run: bun install in $AGENT_DIR"
  else
    echo "[dry-run] would run: npm install in $AGENT_DIR"
  fi
  echo "[dry-run] would run: pi install $AGENT_DIR"
  echo "[dry-run] would copy config/system.example.yml -> ~/.pi/agent/extensions/friday/config/system.yml (if not present)"
  exit 0
fi

# ── Install dependencies ──────────────────────────────────────────────────────
if [[ "$JS_RUNTIME" == "bun" ]]; then
  ( cd "$AGENT_DIR" && bun install )
else
  ( cd "$AGENT_DIR" && npm install )
fi
ok "dependencies installed ($JS_RUNTIME)"

# ── Register extension with Pi ────────────────────────────────────────────────
pi install "$AGENT_DIR"
ok "pi-agent registered with Pi"

# ── Copy example config on first install ─────────────────────────────────────
CONFIG_DEST="$HOME/.pi/agent/extensions/friday/config"
if [[ -f "$AGENT_DIR/config/system.example.yml" && ! -f "$CONFIG_DEST/system.yml" ]]; then
  mkdir -p "$CONFIG_DEST"
  cp "$AGENT_DIR/config/system.example.yml" "$CONFIG_DEST/system.yml"
  ok "copied example config -> $CONFIG_DEST/system.yml"
fi

printf '\n%s\n' "Done. Restart Pi for the extension to take effect."
printf '%s\n' "Themes available: friday, chimu"
printf '%s\n' "Skills from ~/.agents/skills/ are automatically available (no copy step needed)."
printf '%s\n' "Edit $CONFIG_DEST/system.yml to configure quota limits and provider keys."
