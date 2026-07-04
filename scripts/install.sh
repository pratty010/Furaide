#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. root installer bootstrap
#
# Thin wrapper: detects a JS runtime (bun preferred, node+npm fallback),
# installs packages/cli's dependencies, then hands off to the TypeScript
# CLI router which dispatches to the requested target.
#
# Usage:
#   bash scripts/install.sh [args passed through to the CLI's install command]
# Examples:
#   bash scripts/install.sh                       # interactive target picker
#   bash scripts/install.sh opencode-fleet --scope project --yes

set -euo pipefail
FURAIDE_INVOKED_FROM="$(pwd)"
export FURAIDE_INVOKED_FROM
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"

RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

if [[ ! -d "$CLI_DIR" ]]; then
  err "packages/cli not found at $CLI_DIR — is this a full Furaidē checkout?"
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  ( cd "$CLI_DIR" && bun install && bun run bin/furaide.ts install "$@" )
elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  warn "bun not found — falling back to node/npm (slower)."
  warn "Install bun for the best experience: https://bun.sh"
  ( cd "$CLI_DIR" && npm install && npx --yes tsx bin/furaide.ts install "$@" )
else
  err "Neither bun nor node+npm found."
  err "Install bun (recommended): https://bun.sh"
  err "  or Node.js 18+ with npm:  https://nodejs.org"
  exit 1
fi
