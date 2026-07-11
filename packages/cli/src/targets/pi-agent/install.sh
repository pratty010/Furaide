#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. pi-agent installer
#
# Usage:
#   bash packages/cli/src/targets/pi-agent/install.sh
#
# Prerequisites: bun or node+npm, and the pi CLI (https://pi.dev)
#   --skip-checks     N/A here — pi-agent has no non-fatal pre-checks to skip
#                     (bun/npm and pi CLI absence are both hard errors)
#   --dry-run         Print what would happen; make no changes
#   --yes, -y         Run unattended: skip the shared-skill-pool prompt and
#                     leave ~/.agents/skills untouched if it's empty (pi's
#                     no-copy design stays opt-in, never force-populated)

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
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
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

# ── Shared skill pool ─────────────────────────────────────────────────────────
# Pi reads skills live from ~/.agents/skills (no copy step). If that pool is
# empty (e.g. Pi is the first harness installed on this machine), Pi has zero
# skills available with no hint why -- offer to populate it now.
POOL_DIR="$HOME/.agents/skills"
POOL_EMPTY=0
if [[ ! -d "$POOL_DIR" ]] || [[ -z "$(ls -A "$POOL_DIR" 2>/dev/null)" ]]; then
  POOL_EMPTY=1
fi

if [[ "$POOL_EMPTY" -eq 1 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] would prompt to populate ~/.agents/skills"
  elif [[ "$ASSUME_YES" -eq 1 ]]; then
    warn "shared skill pool ($POOL_DIR) is empty -- skipping unattended (--yes); run 'bash $SHARED_DIR/install-vendored-skills.sh --global' manually to populate it"
  else
    # Sole interactive prompt in this script (js-runtime/pi-CLI checks above
    # are non-interactive hard errors) — nothing precedes it to go "back" to,
    # so no back option is offered here (entry-prompt exception). The [y/N]
    # wording is already self-explanatory, matching this repo's other
    # already-sufficient inline prompts.
    printf "Shared skill pool (~/.agents/skills) is empty. Install shared skills now? [y/N] "
    reply=""
    read -r reply </dev/tty || reply="n"
    case "$reply" in
      y|Y|yes|YES)
        bash "$SHARED_DIR/install-vendored-skills.sh" --global
        ok "shared skill pool populated -> $POOL_DIR"
        printf '%s\n' "Tip: run it again later with --only <names> to install just a subset (see: bash $SHARED_DIR/install-vendored-skills.sh --list)."
        ;;
      *)
        warn "skipping shared skill pool population -- run 'bash $SHARED_DIR/install-vendored-skills.sh --global' later"
        ;;
    esac
  fi
fi

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
