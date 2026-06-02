#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$HOME/.claude/plugins"
PLUGIN_LINK="$PLUGIN_DIR/satori"

mkdir -p "$PLUGIN_DIR"
ln -sfn "$REPO_ROOT" "$PLUGIN_LINK"

printf 'Linked %s -> %s\n' "$PLUGIN_LINK" "$REPO_ROOT"
printf 'If ~/.claude/settings.json still contains stale Satori hook commands, restart Claude Code after relinking.\n'

# ── Offer skill installation ──────────────────────────────────────────────
printf '\n%s' 'Install F.R.I.D.A.Y. workflow skills now? [y/N] '
read -r REPLY </dev/tty || REPLY="n"
if [[ "$REPLY" =~ ^[Yy] ]]; then
  bash "$REPO_ROOT/scripts/install-skills.sh"
else
  printf 'Skipped. Run later with:  bash %s/scripts/install-skills.sh\n' "$REPO_ROOT"
fi
