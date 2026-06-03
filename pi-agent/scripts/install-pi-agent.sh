#!/usr/bin/env bash
# install-pi-agent.sh — F.R.I.D.A.Y. pi-agent installer
#
# Usage:
#   bash ~/F.R.I.D.A.Y/pi-agent/scripts/install-pi-agent.sh
#
# Prerequisites: bun, pi CLI (https://pi.dev)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

# ── Check prerequisites ───────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  warn "bun not found. Install from https://bun.sh then re-run."
  exit 1
fi
if ! command -v pi &>/dev/null; then
  warn "pi CLI not found. Install from https://pi.dev then re-run."
  exit 1
fi

# ── Install dependencies ──────────────────────────────────────────────────────
( cd "$AGENT_DIR" && bun install )
ok "bun dependencies installed"

# ── Register extension with Pi ────────────────────────────────────────────────
pi install "$AGENT_DIR"
ok "pi-agent registered with Pi"

printf '\n%s\n' "Done. Restart Pi for the extension to take effect."
printf '%s\n' "Themes available: friday, chimu"
