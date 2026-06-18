#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${OPENCODE_ALL_INSTALL_DIR:-$HOME/.local/share/opencode/tools/opencode-all}"
BIN_DIR="${OPENCODE_ALL_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/opencode-all"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  "$SOURCE_DIR/" "$INSTALL_DIR/"

chmod +x "$INSTALL_DIR/src/tui.tsx"
ln -sfn "$INSTALL_DIR/src/tui.tsx" "$BIN_PATH"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'warning: %s is not on PATH\n' "$BIN_DIR" >&2 ;;
esac

printf 'installed opencode-all -> %s\n' "$BIN_PATH"