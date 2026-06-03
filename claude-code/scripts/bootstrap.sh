#!/usr/bin/env bash
# bootstrap.sh — F.R.I.D.A.Y. claude-code installer
#
# Does the three things the plugin manager cannot:
#   1) Install the mekiki CLI engine (uv sync)
#   2) Install shared common skills (bx, html-preview, brave-search, plan)
#   3) Optionally copy the global config bundle into ~/.claude
#
# Run once after cloning the repo. Safe to re-run (idempotent).
#
# Usage:
#   bash ~/F.R.I.D.A.Y/claude-code/scripts/bootstrap.sh
#
# Then in Claude Code:
#   /plugin marketplace add pratty010/Furaide
#   /plugin install mekiki@5h1nch4n
#   /plugin install hanko@5h1nch4n
#   /reload-plugins

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = claude-code/
COMMON="$(cd "$REPO/../common" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

# ── 0) One-time data migration: ~/.satori → ~/.mekiki ────────────────────
if [[ -d "$HOME/.satori" && ! -d "$HOME/.mekiki" ]]; then
  mv "$HOME/.satori" "$HOME/.mekiki"
  ok "migrated ~/.satori → ~/.mekiki"
fi

# ── 1) mekiki CLI engine ─────────────────────────────────────────────────
if command -v uv >/dev/null 2>&1; then
  ( cd "$REPO/cli" && uv sync )
  mkdir -p "$HOME/.mekiki"
  echo "$REPO/cli/.venv/bin/mekiki" > "$HOME/.mekiki/cli-path"
  ok "mekiki CLI installed → $REPO/cli/.venv/bin/mekiki"
else
  warn "uv not found — install uv (https://docs.astral.sh/uv/getting-started/installation/), then re-run."
fi

# ── 2) Shared common skills ──────────────────────────────────────────────
printf '\nInstall shared skills (bx, html-preview, brave-search, plan) to:\n'
printf '  [g]lobal  ~/.agents/skills/ + ~/.claude/skills/\n'
printf '  [p]roject ./.claude/skills/ (current dir)\n'
printf '  [s]kip\n'
printf 'Choice [g/p/s]: '
read -r R </dev/tty || R=s
case "$R" in
  g|G) bash "$COMMON/install-common.sh" --global ;;
  p|P) bash "$COMMON/install-common.sh" --project "$PWD" ;;
  *) ok "shared skills skipped" ;;
esac

printf '\nInstall other claude-code skills from manifest (superpowers, notebooklm, …)? [y/N] '
read -r R </dev/tty || R=n
[[ "$R" =~ ^[Yy] ]] && bash "$COMMON/install-skills.sh" --ecosystem claude-code

# ── 3) Optional global config bundle ────────────────────────────────────
printf '\nCopy global config bundle into ~/.claude? [y/N] '
read -r R </dev/tty || R=n
if [[ "$R" =~ ^[Yy] ]]; then
  mkdir -p "$HOME/.claude"
  for f in CLAUDE.md statusline-command.sh; do
    cp -i "$REPO/config/$f" "$HOME/.claude/$f" && ok "copied $f → ~/.claude/"
  done
  printf '\n[note] Merge keys from %s/config/settings.json into ~/.claude/settings.json by hand.\n' "$REPO"
fi

# ── Done ─────────────────────────────────────────────────────────────────
printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Next steps in Claude Code:")"
cat <<'EOF'
  /plugin marketplace add pratty010/Furaide
  /plugin install mekiki@5h1nch4n
  /plugin install hanko@5h1nch4n
  /reload-plugins
EOF
