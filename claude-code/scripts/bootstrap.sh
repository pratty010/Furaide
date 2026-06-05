#!/usr/bin/env bash
# bootstrap.sh — F.R.I.D.A.Y. claude-code installer
#
# Runs 5 steps with zero prompts by default:
#   0) ~/.satori → ~/.mekiki data migration (one-time)
#   1) mekiki CLI: uv sync in cli/; writes ~/.mekiki/cli-path
#   2) Common skills: bash common/install-common.sh --global
#   3) Agents: copy config/agents/*.md → ~/.claude/agents/ (skip if exists)
#   4) Config bundle: back up + copy CLAUDE.md and statusline-command.sh
#      into ~/.claude/ (skip step with --no-config)
#
# Flags:
#   --minimal     Run only steps 0-1 (migration + mekiki CLI). Skip 2-4.
#   --no-config   Run steps 0-3. Skip step 4 (config bundle).
#   --with-skills After step 2, also run install-skills.sh --ecosystem
#                 claude-code (heavier manifest, git-clones repos — NOT default).
#   -h, --help    Print this usage and exit.
#
# Usage examples:
#   bash ~/F.R.I.D.A.Y/claude-code/scripts/bootstrap.sh
#   bash ~/F.R.I.D.A.Y/claude-code/scripts/bootstrap.sh --minimal
#   bash ~/F.R.I.D.A.Y/claude-code/scripts/bootstrap.sh --no-config
#   bash ~/F.R.I.D.A.Y/claude-code/scripts/bootstrap.sh --with-skills
#
# Safe to re-run (idempotent).

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = claude-code/
COMMON="$(cd "$REPO/../common" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }

# ── Flag parsing ─────────────────────────────────────────────────────────────
MINIMAL=0
NO_CONFIG=0
WITH_SKILLS=0

for arg in "$@"; do
  case "$arg" in
    --minimal)     MINIMAL=1 ;;
    --no-config)   NO_CONFIG=1 ;;
    --with-skills) WITH_SKILLS=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) warn "unknown flag: $arg"; exit 1 ;;
  esac
done

# ── 0) One-time data migration: ~/.satori → ~/.mekiki ────────────────────────
if [[ -d "$HOME/.satori" && ! -d "$HOME/.mekiki" ]]; then
  mv "$HOME/.satori" "$HOME/.mekiki"
  ok "migrated ~/.satori → ~/.mekiki"
fi

# ── 1) mekiki CLI engine ──────────────────────────────────────────────────────
if command -v uv >/dev/null 2>&1; then
  ( cd "$REPO/cli" && uv sync )
  mkdir -p "$HOME/.mekiki"
  echo "$REPO/cli/.venv/bin/mekiki" > "$HOME/.mekiki/cli-path"
  ok "mekiki CLI installed → $REPO/cli/.venv/bin/mekiki"
else
  warn "uv not found — install uv (https://docs.astral.sh/uv/getting-started/installation/), then re-run."
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
bash "$COMMON/install-common.sh" --global
ok "common skills installed"

if [[ "$WITH_SKILLS" -eq 1 ]]; then
  bash "$COMMON/install-skills.sh" --ecosystem claude-code
  ok "extended skill manifest installed"
fi

# ── 3) Agents ─────────────────────────────────────────────────────────────────
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

[[ "$NO_CONFIG" -eq 1 ]] && {
  ok "no-config mode — skipping step 4"
  printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Next steps in Claude Code:")"
  printf '  /plugin marketplace add pratty010/Furaide\n'
  printf '  /plugin install mekiki@fr1d4y\n'
  printf '  /reload-plugins\n'
  exit 0
}

# ── 4) Config bundle ──────────────────────────────────────────────────────────
mkdir -p "$HOME/.claude"
for f in CLAUDE.md statusline-command.sh; do
  dest="$HOME/.claude/$f"
  if [[ -e "$dest" ]]; then
    bak="$dest.bak.$(date +%Y%m%d%H%M%S)"
    cp "$dest" "$bak"
    ok "backed up ~/.claude/$f → $(basename "$bak")"
  fi
  cp "$REPO/config/$f" "$dest"
  ok "copied $f → ~/.claude/"
done
printf '\n[note] Merge keys from %s/config/settings.json into ~/.claude/settings.json by hand.\n' "$REPO"

# ── Done ──────────────────────────────────────────────────────────────────────
printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Next steps in Claude Code:")"
printf '  /plugin marketplace add pratty010/Furaide\n'
printf '  /plugin install mekiki@fr1d4y\n'
printf '  /reload-plugins\n'
