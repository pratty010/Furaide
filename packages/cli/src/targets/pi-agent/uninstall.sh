#!/usr/bin/env bash
# uninstall.sh — F.R.I.D.A.Y. pi-agent uninstaller
#
# Usage:
#   bash packages/cli/src/targets/pi-agent/uninstall.sh
#   bash packages/cli/src/targets/pi-agent/uninstall.sh --yes
#   bash packages/cli/src/targets/pi-agent/uninstall.sh --dry-run

set -euo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)  ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
  esac
done

if ! command -v pi >/dev/null 2>&1; then
  err "pi CLI not found on PATH. Cannot uninstall without it — install pi first (https://pi.dev), then re-run."
  exit 1
fi
ok "pi CLI found"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would run: pi uninstall friday-furaidee"
  echo "[dry-run] would check ~/.pi/agent/extensions/friday/config/ for leftover files"
  exit 0
fi

pi uninstall friday-furaidee
ok "pi-agent unregistered from Pi"

CONFIG_DIR="$HOME/.pi/agent/extensions/friday/config"
if [[ -d "$CONFIG_DIR" ]]; then
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    rm -rf "$CONFIG_DIR"
    ok "removed $CONFIG_DIR"
  else
    # Sole interactive prompt in this script (pi CLI check and `pi uninstall`
    # above are non-interactive) — nothing precedes it to go "back" to, so no
    # back option is offered here (entry-prompt exception). The [y/N] wording
    # is already self-explanatory, matching this repo's other
    # already-sufficient inline prompts.
    printf 'Remove leftover config at %s? [y/N] ' "$CONFIG_DIR"
    read -r reply </dev/tty || reply="n"
    case "$reply" in
      y|Y) rm -rf "$CONFIG_DIR"; ok "removed $CONFIG_DIR" ;;
      *)   printf '        kept %s\n' "$CONFIG_DIR" ;;
    esac
  fi
fi

printf '\n%s\n' "Shared skills in ~/.agents/skills/ are not removed here — they are"
printf '%s\n' "managed by the claude-code or opencode-fleet uninstall flow."
