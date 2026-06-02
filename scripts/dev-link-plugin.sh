#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$HOME/.claude/plugins"
PLUGIN_LINK="$PLUGIN_DIR/puraguin"

mkdir -p "$PLUGIN_DIR"
ln -sfn "$REPO_ROOT" "$PLUGIN_LINK"

printf 'Linked %s -> %s\n' "$PLUGIN_LINK" "$REPO_ROOT"
printf 'If ~/.claude/settings.json still contains stale Puraguin hook commands, restart Claude Code after relinking.\n'
