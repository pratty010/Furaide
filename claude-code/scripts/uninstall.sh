#!/usr/bin/env bash
# uninstall.sh — F.R.I.D.A.Y. claude-code uninstaller
#
# Removes everything installed by bootstrap.sh in two tiers:
#   Tier 1 (always): machinery — skills, agents, CLI venv, caches, report server
#   Tier 2 (prompt): user data — ~/.mekiki, config files (with backup restore offer)
#
# Usage:
#   bash claude-code/scripts/uninstall.sh            # interactive tier-2 prompts
#   bash claude-code/scripts/uninstall.sh --dry-run  # print what would be removed, change nothing
#   bash claude-code/scripts/uninstall.sh --purge    # remove everything, no prompts
#   bash claude-code/scripts/uninstall.sh -h         # help
#
# Environment overrides:
#   MEKIKI_HOME       (default: ~/.mekiki)
#   AGENTS_SKILLS     (default: ~/.agents/skills)
#   CLAUDE_SKILLS     (default: ~/.claude/skills)

set -euo pipefail

MEKIKI_HOME="${MEKIKI_HOME:-$HOME/.mekiki}"
AGENTS_SKILLS="${AGENTS_SKILLS:-$HOME/.agents/skills}"
CLAUDE_SKILLS="${CLAUDE_SKILLS:-$HOME/.claude/skills}"
CLAUDE_AGENTS="$HOME/.claude/agents"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC}  %s\n" "$*" >&2; }
info() { printf "        %s\n" "$*"; }

# Remove all top-level keys in src JSON from dst JSON, in-place.
_remove_settings_keys() {
  local src="$1" dst="$2"
  [[ -f "$src" && -f "$dst" ]] || return 0
  if python3 -c "
import json,sys
keys=list(json.load(open(sys.argv[1])).keys())
try: dst=json.load(open(sys.argv[2]))
except: sys.exit()
[dst.pop(k,None) for k in keys]
open(sys.argv[2],'w').write(json.dumps(dst,indent=2)+'\n')
" "$src" "$dst" 2>/dev/null; then
    ok "removed settings.json keys from ~/.claude/settings.json"
  elif command -v jq >/dev/null 2>&1; then
    local keys filter tmp
    mapfile -t keys < <(jq -r 'keys[]' "$src" 2>/dev/null)
    filter=$(printf ' | del(."%s")' "${keys[@]}")
    tmp=$(mktemp)
    jq ".${filter}" "$dst" > "$tmp" 2>/dev/null && mv "$tmp" "$dst" \
      && ok "removed settings.json keys from ~/.claude/settings.json" \
      || { rm -f "$tmp"; warn "could not modify settings.json — remove keys manually"; }
  else
    warn "could not modify settings.json — remove keys from $dst manually"
  fi
}

DRY_RUN=false
PURGE=false

# parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --purge)   PURGE=true;   shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# //; s/^#//'; exit 0 ;;
    *) printf "Unknown option: %s\n" "$1" >&2; exit 1 ;;
  esac
done

# Helper: remove a path (file or dir), respecting dry-run
remove() {
  local path="$1"
  local label="${2:-$path}"
  if [[ -e "$path" || -L "$path" ]]; then
    if $DRY_RUN; then
      printf "[dry-run] would remove %s\n" "$label"
    else
      rm -rf "$path"
      ok "removed $label"
    fi
  fi
}

# ===========================================================================
# Tier 1 — always run (no prompts)
# ===========================================================================
printf '\n%s\n' "=== Tier 1: removing machinery ==="

# 1a. Kill report server (if running)
PID_FILE="$MEKIKI_HOME/reports/.server.pid"
REPORT_PORT="${SATORI_REPORT_PORT:-8765}"
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    if $DRY_RUN; then
      printf "[dry-run] would kill report server (PID %s)\n" "$PID"
    else
      kill "$PID" && ok "killed report server (PID $PID)" || warn "could not kill PID $PID"
    fi
  fi
  remove "$PID_FILE" "report server PID file"
else
  # Also check by port as fallback
  if command -v lsof >/dev/null 2>&1; then
    PID=$(lsof -ti tcp:"$REPORT_PORT" 2>/dev/null || true)
    if [[ -n "$PID" ]]; then
      if $DRY_RUN; then
        printf "[dry-run] would kill process on port %s (PID %s)\n" "$REPORT_PORT" "$PID"
      else
        kill "$PID" && ok "killed process on port $REPORT_PORT (PID $PID)" || true
      fi
    fi
  fi
fi

# 1b. Remove named skills from ~/.agents/skills/ and ~/.claude/skills/
SKILL_NAMES=(bx html-preview brave-search plan github)
for skill in "${SKILL_NAMES[@]}"; do
  remove "$AGENTS_SKILLS/$skill" "~/.agents/skills/$skill"
  remove "$CLAUDE_SKILLS/$skill"  "~/.claude/skills/$skill"
done

# 1c. Remove hanko--git-seal agent
remove "$CLAUDE_AGENTS/hanko--git-seal.md" "~/.claude/agents/hanko--git-seal.md"

# 1d. Remove CLI venv and egg-info (relative to the script's repo location)
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remove "$REPO/cli/.venv"                    "cli/.venv"
remove "$REPO/cli/src/mekiki.egg-info"      "cli/src/mekiki.egg-info"

# 1e. Remove setup state file
remove "$HOME/.github-setup-state-friday" "~/.github-setup-state-friday"

# 1f. Print Claude Code CLI steps (cannot automate)
printf '\n[note] Complete removal in Claude Code:\n'
printf '  /plugin uninstall mekiki@fr1d4y\n'
printf '  /plugin marketplace remove fr1d4y\n'

# ===========================================================================
# Tier 2 — prompt unless --purge
# ===========================================================================
printf '\n%s\n' "=== Tier 2: user data ==="

# 2a. ~/.mekiki (and legacy ~/.satori)
for datadir in "$MEKIKI_HOME" "$HOME/.satori"; do
  if [[ -d "$datadir" ]]; then
    if $PURGE; then
      remove "$datadir" "$datadir"
    elif $DRY_RUN; then
      printf "[dry-run] would prompt to remove %s\n" "$datadir"
    else
      SIZE=$(du -sh "$datadir" 2>/dev/null | cut -f1 || echo "?")
      printf '\nRemove %s (%s of data: events, transcripts, state.db)? [y/N] ' "$datadir" "$SIZE"
      read -r R </dev/tty || R=n
      [[ "$R" =~ ^[Yy] ]] && remove "$datadir" "$datadir" || info "kept $datadir"
    fi
  fi
done

# 2b. ~/.claude/CLAUDE.md and ~/.claude/statusline-command.sh
for cfile in CLAUDE.md statusline-command.sh; do
  cpath="$HOME/.claude/$cfile"
  if [[ -f "$cpath" ]]; then
    # Check for backups
    mapfile -t backups < <(ls "$HOME/.claude/$cfile".bak.* 2>/dev/null || true)

    if $PURGE; then
      remove "$cpath" "~/.claude/$cfile"
    elif $DRY_RUN; then
      printf "[dry-run] would prompt to remove ~/.claude/%s\n" "$cfile"
      if [[ ${#backups[@]} -gt 0 ]]; then
        printf "[dry-run]   backup available: %s\n" "${backups[-1]}"
      fi
    else
      printf '\nRemove ~/.claude/%s?' "$cfile"
      if [[ ${#backups[@]} -gt 0 ]]; then
        printf ' (backup: %s)\n' "${backups[-1]}"
        printf '[r]estore backup / [d]elete / [s]kip? [r/d/s]: '
        read -r R </dev/tty || R=s
        case "$R" in
          r|R)
            cp "${backups[-1]}" "$cpath"
            ok "restored $cpath from ${backups[-1]}"
            ;;
          d|D)
            remove "$cpath" "~/.claude/$cfile"
            ;;
          *)
            info "kept ~/.claude/$cfile"
            ;;
        esac
      else
        printf ' [y/N] '
        read -r R </dev/tty || R=n
        [[ "$R" =~ ^[Yy] ]] && remove "$cpath" "~/.claude/$cfile" || info "kept ~/.claude/$cfile"
      fi
    fi
  fi
done

# 2c. ~/.claude/settings.json — remove keys installed by bootstrap
src_settings="$REPO/config/settings.json"
dst_settings="$HOME/.claude/settings.json"
if [[ -f "$dst_settings" && -f "$src_settings" ]]; then
  if $PURGE; then
    _remove_settings_keys "$src_settings" "$dst_settings"
  elif $DRY_RUN; then
    keys=$(python3 -c "import json; print(', '.join(json.load(open('$src_settings')).keys()))" 2>/dev/null \
           || echo "(see $src_settings)")
    printf "[dry-run] would remove settings.json keys: %s\n" "$keys"
  else
    keys=$(python3 -c "import json; print(', '.join(json.load(open('$src_settings')).keys()))" 2>/dev/null \
           || echo "(see $src_settings)")
    printf '\nRemove installed keys from ~/.claude/settings.json? (%s) [y/N] ' "$keys"
    read -r R </dev/tty || R=n
    [[ "$R" =~ ^[Yy] ]] && _remove_settings_keys "$src_settings" "$dst_settings" \
      || info "kept settings.json unchanged"
  fi
fi

# ===========================================================================
# Done
# ===========================================================================
printf "\n${GREEN}[done]${NC} Uninstall complete.\n"
if $DRY_RUN; then
  printf '%s\n' "[dry-run] No changes were made."
fi
