#!/usr/bin/env bash
# install-common.sh — F.R.I.D.A.Y. shared skills installer
#
# Copies vendored lightweight skills from common/skills/ to a user-chosen scope.
# Called by both claude-code/scripts/bootstrap.sh and opencode/scripts/install-fleet.sh.
#
# Usage:
#   bash common/install-common.sh --global              # → ~/.agents/skills/ + ~/.claude/skills/
#   bash common/install-common.sh --project <dir>       # → <dir>/skills/
#   bash common/install-common.sh --custom <path>       # → <path>/skills/
#
# Skills installed: bx, html-preview, brave-search, plan
#
# Copy (not symlink) mode — users own the installed copy; update by re-running.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/skills"

# ── Colors ────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'
ok()   { printf '%s\n' "${GRN}[ok]${RST}   $*"; }
warn() { printf '%s\n' "${YLW}[warn]${RST} $*"; }
err()  { printf '%s\n' "${RED}[error]${RST} $*" >&2; exit 1; }

# ── Parse flags ───────────────────────────────────────────────────────────
MODE=""; TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)
      MODE="global"
      shift ;;
    --project)
      MODE="project"
      TARGET="${2:?'--project requires a directory'}"
      shift 2 ;;
    --custom)
      MODE="custom"
      TARGET="${2:?'--custom requires a path'}"
      shift 2 ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# //; s/^#//'
      exit 0 ;;
    *)
      err "Unknown option: $1" ;;
  esac
done

if [[ -z "$MODE" ]]; then
  printf 'Install shared skills to [g]lobal ~/.agents, [p]roject, or enter custom path? [g/p/path] '
  read -r reply </dev/tty || reply="g"
  case "$reply" in
    g|G) MODE="global" ;;
    p|P)
      printf 'Project directory (default: %s): ' "$PWD"
      read -r dir </dev/tty || dir="$PWD"
      MODE="project"; TARGET="${dir:-$PWD}" ;;
    *)
      MODE="custom"; TARGET="$reply" ;;
  esac
fi

# ── Resolve destination ───────────────────────────────────────────────────
case "$MODE" in
  global)
    AGENTS_DEST="$HOME/.agents/skills"
    CLAUDE_DEST="$HOME/.claude/skills"
    ;;
  project)
    AGENTS_DEST="$TARGET/skills"
    CLAUDE_DEST=""
    ;;
  custom)
    AGENTS_DEST="$TARGET/skills"
    CLAUDE_DEST=""
    ;;
esac

printf '\n%s\n' "${BOLD}Installing shared skills from common/skills/${RST}"
printf '  Source:  %s\n' "$SKILLS_SRC"
printf '  Target:  %s\n' "$AGENTS_DEST"
[[ -n "$CLAUDE_DEST" ]] && printf '  Also:    %s\n\n' "$CLAUDE_DEST"

# ── Copy skills ───────────────────────────────────────────────────────────
mkdir -p "$AGENTS_DEST"

for skill_dir in "$SKILLS_SRC"/*/; do
  skill_name="$(basename "$skill_dir")"
  dest="$AGENTS_DEST/$skill_name"

  if [[ -d "$dest" ]]; then
    warn "  $skill_name: already exists at $dest — skipping (delete to reinstall)"
  else
    cp -r "$skill_dir" "$dest"
    ok "  $skill_name → $dest"
  fi
done

# ── Also copy into Claude Code skills dir for global installs ─────────────
if [[ -n "$CLAUDE_DEST" ]]; then
  mkdir -p "$CLAUDE_DEST"
  for skill_dir in "$SKILLS_SRC"/*/; do
    skill_name="$(basename "$skill_dir")"
    dest="$CLAUDE_DEST/$skill_name"
    if [[ ! -d "$dest" ]]; then
      cp -r "$skill_dir" "$dest"
      ok "  $skill_name → $dest"
    fi
  done
fi

printf '\n%s\n' "${GRN}Done.${RST} Common skills installed."
printf '%s\n' "${DIM}To update: delete the skill dirs and re-run this script.${RST}"
