#!/usr/bin/env bash
# install-fleet-bootstrap.sh — one-command curl-pipe installer for Furaidē's Fleet
#
# Usage (no clone needed):
#   bash <(curl -fsSL https://raw.githubusercontent.com/pratty010/F.R.I.D.A.Y/main/opencode/scripts/install-fleet-bootstrap.sh)
#
# Or with flags passed through to install-fleet.sh:
#   bash <(curl -fsSL ...) -- --all --global

set -euo pipefail

REPO_URL="https://github.com/pratty010/F.R.I.D.A.Y.git"
FLEET_DEST="${FLEET_DEST:-$HOME/furaidee-fleet}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
info() { printf "[info] %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

# ── Clone or update ───────────────────────────────────────────────────────────
if [[ -d "$FLEET_DEST/.git" ]]; then
  info "Updating existing clone at $FLEET_DEST…"
  git -C "$FLEET_DEST" pull --ff-only --quiet && ok "Updated."
else
  info "Cloning F.R.I.D.A.Y. into $FLEET_DEST…"
  git clone --depth=1 --quiet "$REPO_URL" "$FLEET_DEST" && ok "Cloned."
fi

# ── Pass through to install-fleet.sh ─────────────────────────────────────────
exec bash "$FLEET_DEST/opencode/scripts/install-fleet.sh" "$@"
