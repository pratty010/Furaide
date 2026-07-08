#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. root installer bootstrap
#
# Thin wrapper: detects a JS runtime (bun preferred, node+npm fallback),
# installs packages/cli's dependencies, then hands off to the TypeScript
# CLI router which dispatches to the requested target.
#
# Usage:
#   bash scripts/install.sh                       # interactive harness picker
#   bash scripts/install.sh <target> [flags]       # bypass picker
#   bash scripts/install.sh --help                 # this message
#
# Targets: claude-code, opencode-fleet, pi-agent

set -euo pipefail
FURAIDE_INVOKED_FROM="$(pwd)"
export FURAIDE_INVOKED_FROM
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"

RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ ! -d "$CLI_DIR" ]]; then
  err "packages/cli not found at $CLI_DIR — is this a full Furaidē checkout?"
  exit 1
fi

pick_target() {
  printf 'Which harness would you like to install?\n\n' >&2
  printf '  1) Claude Code   — statusline, agents, skills, Idisu + Rejion plugins\n' >&2
  printf '  2) OpenCode      — 15-agent fleet, plugins, rules, skills\n' >&2
  printf '  3) Pi Agent      — web tools, TUI, themes, skills\n\n' >&2
  local choice
  read -rp 'Enter 1, 2, or 3: ' choice </dev/tty
  case "$choice" in
    1) printf 'claude-code\n' ;;
    2) printf 'opencode-fleet\n' ;;
    3) printf 'pi-agent\n' ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
}

ARGS=("$@")
if [[ ${#ARGS[@]} -eq 0 ]]; then
  TARGET="$(pick_target)"
  ARGS=("$TARGET")
fi

if command -v bun >/dev/null 2>&1; then
  ( cd "$CLI_DIR" && bun install && bun run bin/furaide.ts install "${ARGS[@]}" )
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  warn "bun not found — falling back to node/npm (slower)."
  warn "Install bun for the best experience: https://bun.sh"
  ( cd "$CLI_DIR" && npm install && npx --yes tsx bin/furaide.ts install "${ARGS[@]}" )
else
  err "Neither bun nor node+npm found."
  err "Install bun (recommended): https://bun.sh"
  err "  or Node.js 18+ with npm:  https://nodejs.org"
  exit 1
fi
