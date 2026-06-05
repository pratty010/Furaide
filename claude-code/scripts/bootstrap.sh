#!/usr/bin/env bash
# bootstrap.sh — F.R.I.D.A.Y. claude-code interactive installer
#
# Prompts yes/no before each step. Pass --yes to run unattended.
#
# Steps:
#   0) ~/.satori → ~/.mekiki data migration (one-time, always runs)
#   1) mekiki CLI: uv sync in cli/; writes ~/.mekiki/cli-path
#   2) Common skills: bash common/install-common.sh --global
#   3) Agents: copy config/agents/*.md → ~/.claude/agents/ (skip if exists)
#   4) Config bundle: back up + copy CLAUDE.md and statusline-command.sh → ~/.claude/
#
# Flags:
#   --yes, -y     Run all steps unattended (no prompts)
#   --minimal     Run only steps 0-1 (migration + mekiki CLI)
#   --no-config   Run steps 0-3, skip step 4 (config bundle)
#   --with-skills After step 2, also run install-skills.sh --ecosystem claude-code
#   -h, --help    Print this usage and exit
#
# Usage examples:
#   bash bootstrap.sh                   # interactive (default)
#   bash bootstrap.sh --yes             # unattended
#   bash bootstrap.sh --minimal         # minimal, no prompts for skipped steps
#   bash bootstrap.sh --no-config --yes # steps 0-3, unattended

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = claude-code/
COMMON="$(cd "$REPO/../common" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

# Merge all top-level keys from src JSON into dst JSON (src overrides dst).
_merge_settings() {
  local src="$1" dst="$2"
  [[ -f "$src" ]] || return 0
  if [[ ! -f "$dst" ]]; then
    cp "$src" "$dst"
    ok "installed settings.json → ~/.claude/"
    return
  fi
  if python3 -c "
import json,sys
src=json.load(open(sys.argv[1]))
try: dst=json.load(open(sys.argv[2]))
except: dst={}
dst.update(src)
open(sys.argv[2],'w').write(json.dumps(dst,indent=2)+'\n')
" "$src" "$dst" 2>/dev/null; then
    ok "merged settings.json keys into ~/.claude/settings.json"
  elif command -v jq >/dev/null 2>&1; then
    local tmp; tmp=$(mktemp)
    jq -s '.[0] * .[1]' "$dst" "$src" > "$tmp" 2>/dev/null && mv "$tmp" "$dst" \
      && ok "merged settings.json keys into ~/.claude/settings.json" \
      || { rm -f "$tmp"; warn "could not merge settings.json — add keys from $src into $dst manually"; }
  else
    warn "could not merge settings.json — add keys from $src into $dst manually"
  fi
}

ASSUME_YES=0

confirm() {  # confirm "message" — returns 0 (yes) / 1 (no); default yes
  [[ "$ASSUME_YES" -eq 1 ]] && return 0
  local reply
  printf "${YELLOW}?${NC} %s [Y/n] " "$1" >&2
  read -r reply </dev/tty || { printf '\n' >&2; return 1; }
  case "$reply" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

# ── Flag parsing ─────────────────────────────────────────────────────────────
MINIMAL=0
NO_CONFIG=0
WITH_SKILLS=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y)     ASSUME_YES=1 ;;
    --minimal)     MINIMAL=1 ;;
    --no-config)   NO_CONFIG=1 ;;
    --with-skills) WITH_SKILLS=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) warn "unknown flag: $arg"; exit 1 ;;
  esac
done

# ── 0) One-time data migration (runs before flag checks — always safe) ────────
# Migration: ~/.satori → ~/.mekiki
if [[ -d "$HOME/.satori" && ! -d "$HOME/.mekiki" ]]; then
  mv "$HOME/.satori" "$HOME/.mekiki"
  ok "migrated ~/.satori → ~/.mekiki"
fi

# ── 1) mekiki CLI engine ──────────────────────────────────────────────────────
if confirm "Install mekiki CLI engine (uv sync)?"; then
  if command -v uv >/dev/null 2>&1; then
    ( cd "$REPO/cli" && uv sync )
    mkdir -p "$HOME/.mekiki"
    echo "$REPO/cli/.venv/bin/mekiki" > "$HOME/.mekiki/cli-path"
    ok "mekiki CLI installed → $REPO/cli/.venv/bin/mekiki"
  else
    warn "uv not found — install uv (https://docs.astral.sh/uv/getting-started/installation/), then re-run."
  fi
fi

[[ "$MINIMAL" -eq 1 ]] && {
  ok "minimal mode — skipping steps 2-4"
  printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Next steps in Claude Code:")"
  printf '  /plugin marketplace add pratty010/Furaide\n'
  printf '  /plugin install mekiki@fr1d4y\n'
  printf '  /reload-plugins\n'
  exit 0
}

# ── 2) Common skills ──────────────────────────────────────────────────────────
if confirm "Install common skills → ~/.agents/skills (+ symlink ~/.claude/skills)?"; then
  bash "$COMMON/install-common.sh" --global
  ok "common skills installed"
fi

if [[ "$WITH_SKILLS" -eq 1 ]]; then
  if confirm "Install extended skill manifest (heavier, git-clones repos)?"; then
    bash "$COMMON/install-skills.sh" --ecosystem claude-code
    ok "extended skill manifest installed"
  fi
fi

# ── 3) Agents ─────────────────────────────────────────────────────────────────
if confirm "Install hanko--git-seal agent → ~/.claude/agents?"; then
  mkdir -p "$HOME/.claude/agents"
  for agent_src in "$REPO/config/agents/"*.md; do
    [[ -e "$agent_src" ]] || continue
    fname="$(basename "$agent_src")"
    dest="$HOME/.claude/agents/$fname"
    if [[ -e "$dest" ]]; then
      ok "skip  agents/$fname (already exists)"
    else
      cp "$agent_src" "$dest"
      ok "installed agents/$fname → ~/.claude/agents/"
    fi
  done
fi

[[ "$NO_CONFIG" -eq 1 ]] && {
  ok "no-config mode — skipping step 4"
  printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Next steps in Claude Code:")"
  printf '  /plugin marketplace add pratty010/Furaide\n'
  printf '  /plugin install mekiki@fr1d4y\n'
  printf '  /reload-plugins\n'
  exit 0
}

# ── 4) Config bundle ──────────────────────────────────────────────────────────
if confirm "Back up & install CLAUDE.md + statusline-command.sh → ~/.claude?"; then
  mkdir -p "$HOME/.claude"

  # CLAUDE.md: back up + copy (user may customize)
  dest="$HOME/.claude/CLAUDE.md"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    bak="$dest.bak.$(date +%Y%m%d%H%M%S)"
    cp "$dest" "$bak"
    ok "backed up ~/.claude/CLAUDE.md → $(basename "$bak")"
  fi
  cp "$REPO/config/CLAUDE.md" "$dest"
  ok "copied CLAUDE.md → ~/.claude/"

  # statusline-command.sh: symlink so source edits auto-deploy
  dest="$HOME/.claude/statusline-command.sh"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    bak="$dest.bak.$(date +%Y%m%d%H%M%S)"
    cp "$dest" "$bak"
    ok "backed up ~/.claude/statusline-command.sh → $(basename "$bak")"
  fi
  ln -sf "$REPO/config/statusline-command.sh" "$dest"
  ok "symlinked statusline-command.sh → $REPO/config/"

  # settings.json: merge source keys into ~/.claude/settings.json
  _merge_settings "$REPO/config/settings.json" "$HOME/.claude/settings.json"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Next steps in Claude Code:")"
printf '  /plugin marketplace add pratty010/Furaide\n'
printf '  /plugin install mekiki@fr1d4y\n'
printf '  /reload-plugins\n'
