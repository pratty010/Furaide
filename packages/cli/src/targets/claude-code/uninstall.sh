#!/usr/bin/env bash
# uninstall.sh — F.R.I.D.A.Y. claude-code uninstaller
#
# Receipt-driven: reads .furaide-receipt.json written by Phase 4's install.sh
# and removes exactly what it recorded. If both a global (~/.claude/) and a
# project (.claude/, found via CWD walk-up) receipt exist, prompts for scope.
#
# Usage:
#   bash uninstall.sh                # interactive
#   bash uninstall.sh --scope global # skip scope picker
#   bash uninstall.sh --yes          # accept all defaults (delete everything with backup-restore)
#   bash uninstall.sh --dry-run      # print what would happen, no changes
#   bash uninstall.sh --purge        # also remove ~/.agents/skills/ shared-pool content
#   bash uninstall.sh -h             # help

set -euo pipefail
SHARED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../shared" && pwd)"
source "$SHARED_DIR/install-lib.sh"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../harnesses/claude-code" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC}  %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC}  %s\n" "$*" >&2; }
info() { printf "        %s\n" "$*"; }

DRY_RUN=0
PURGE=0
ASSUME_YES=0
FORCED_SCOPE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --purge)   PURGE=1; shift ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    --scope)   FORCED_SCOPE="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "unknown flag: $1"; exit 1 ;;
  esac
done

GLOBAL_TARGET="$HOME/.claude"
PROJECT_TARGET="$(furaide_find_project_dir ".claude")"
GLOBAL_RECEIPT="$GLOBAL_TARGET/.furaide-receipt.json"
PROJECT_RECEIPT="$PROJECT_TARGET/.furaide-receipt.json"

HAVE_GLOBAL=0; [[ -f "$GLOBAL_RECEIPT" ]] && HAVE_GLOBAL=1
HAVE_PROJECT=0; [[ -f "$PROJECT_RECEIPT" ]] && HAVE_PROJECT=1

# ── Step 1: Find receipt(s), pick scope if ambiguous ────────────────────────
if [[ -n "$FORCED_SCOPE" ]]; then
  case "$FORCED_SCOPE" in
    global)  TARGET_DIR="$GLOBAL_TARGET" ;;
    project) TARGET_DIR="$PROJECT_TARGET" ;;
    *) err "unknown --scope value: $FORCED_SCOPE (expected global|project)"; exit 1 ;;
  esac
elif [[ "$HAVE_GLOBAL" -eq 1 && "$HAVE_PROJECT" -eq 1 ]]; then
  printf '\nFound installs at both scopes. Which one to uninstall?\n\n' >&2
  printf '  1) Global   (%s)\n' "$GLOBAL_TARGET" >&2
  printf '  2) Project  (%s)\n\n' "$PROJECT_TARGET" >&2
  read -rp 'Enter 1 or 2: ' choice </dev/tty
  case "$choice" in
    1) TARGET_DIR="$GLOBAL_TARGET" ;;
    2) TARGET_DIR="$PROJECT_TARGET" ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
elif [[ "$HAVE_GLOBAL" -eq 1 ]]; then
  TARGET_DIR="$GLOBAL_TARGET"
elif [[ "$HAVE_PROJECT" -eq 1 ]]; then
  TARGET_DIR="$PROJECT_TARGET"
else
  err "No Furaidē install found (checked $GLOBAL_RECEIPT and $PROJECT_RECEIPT)."
  err "Run with --scope global|project if the install used a nonstandard location."
  exit 1
fi

RECEIPT_PATH="$TARGET_DIR/.furaide-receipt.json"
RECEIPT_JSON="$(furaide_read_receipt "$RECEIPT_PATH")"
if [[ -z "$RECEIPT_JSON" ]]; then
  err "No receipt found at $RECEIPT_PATH — nothing to uninstall."
  exit 1
fi

RECEIPT_TMP="$(mktemp)"
printf '%s' "$RECEIPT_JSON" > "$RECEIPT_TMP"
trap 'rm -f "$RECEIPT_TMP"' EXIT

_receipt_field() {  # dotted.path -> value or empty
  python3 - "$1" "$RECEIPT_TMP" <<'PYEOF' 2>/dev/null
import json,sys
d = json.load(open(sys.argv[2]))
try:
    v = d
    for k in sys.argv[1].split('.'):
        v = v[k] if not k.isdigit() else v[int(k)]
    print(v if isinstance(v,str) else json.dumps(v))
except Exception:
    print('')
PYEOF
}

INSTALLED_AT="$(_receipt_field installedAt)"
BACKUP_DIR="$(_receipt_field backupDir)"
BACKUP_DIR="${BACKUP_DIR//\"/}"
ok "found receipt: installed $INSTALLED_AT, target $TARGET_DIR"

remove() {  # path label
  local path="$1" label="${2:-$path}"
  if [[ -e "$path" || -L "$path" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf "[dry-run] would remove %s\n" "$label"
    else
      rm -rf "$path"
      ok "removed $label"
    fi
  fi
}

restore_or_remove() {  # dst backup_rel_path label
  local dst="$1" backup_rel="$2" label="$3"
  local backup_src="$BACKUP_DIR/$backup_rel"
  if [[ -n "$BACKUP_DIR" && -e "$backup_src" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf "[dry-run] would restore %s from backup\n" "$label"
    else
      cp "$backup_src" "$dst"
      ok "restored $label from backup"
    fi
  else
    remove "$dst" "$label"
  fi
}

# ── Step 2: Select what to remove (delete/skip only) ────────────────────────
DO_CLAUDE_MD=1
DO_SETTINGS=1
DO_AGENTS=1
DO_SKILLS=1
DO_IDISU=1
DO_REJION=1

if [[ "$ASSUME_YES" -ne 1 && "$DRY_RUN" -ne 1 ]]; then
  printf '\nWhat to remove from %s (Enter=delete, s=skip):\n\n' "$TARGET_DIR" >&2
  ask() {  # var_name label
    local __var="$1" __label="$2" __reply
    read -rp "  $__label [delete/s]: " __reply </dev/tty
    case "$__reply" in s|S) printf -v "$__var" '0' ;; *) printf -v "$__var" '1' ;; esac
  }
  ask DO_CLAUDE_MD "CLAUDE.md"
  ask DO_SETTINGS  "settings.json keys"
  ask DO_AGENTS    "agents/"
  ask DO_SKILLS    "skills/ symlinks (content in ~/.agents/skills/ preserved unless --purge)"
  ask DO_IDISU     "Idisu plugin"
  ask DO_REJION    "Rejion plugin"
fi

# ── Step 3: Execute ──────────────────────────────────────────────────────────
[[ "$DO_CLAUDE_MD" -eq 1 ]] && restore_or_remove "$TARGET_DIR/CLAUDE.md" "CLAUDE.md" "CLAUDE.md"

_remove_settings_keys() {  # src_settings dst_settings
  local src_settings="$1" dst_settings="$2"
  [[ -f "$dst_settings" && -f "$src_settings" ]] || return 0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    local keys
    keys=$(python3 -c "import json,sys; print(', '.join(json.load(open(sys.argv[1])).keys()))" \
      "$src_settings" 2>/dev/null || echo "(see $src_settings)")
    printf "[dry-run] would remove settings.json keys: %s\n" "$keys"
  else
    python3 -c "
import json,sys
keys=list(json.load(open(sys.argv[1])).keys())
try: dst=json.load(open(sys.argv[2]))
except: sys.exit()
[dst.pop(k,None) for k in keys]
open(sys.argv[2],'w').write(json.dumps(dst,indent=2)+'\n')
" "$src_settings" "$dst_settings" 2>/dev/null && ok "removed settings.json keys from $dst_settings" \
      || warn "could not modify settings.json — remove keys from $dst_settings manually"
  fi
}

if [[ "$DO_SETTINGS" -eq 1 ]]; then
  _remove_settings_keys "$REPO/config/settings.json" "$TARGET_DIR/settings.json"
  [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]] && remove "$TARGET_DIR/statusline-command.sh" "statusline-command.sh symlink"
fi

if [[ "$DO_AGENTS" -eq 1 ]]; then
  agents="$(_receipt_field components.agents)"
  printf '%s' "$agents" | python3 -c "
import json,sys
try: paths = json.load(sys.stdin)
except: paths = []
for p in paths: print(p)
" 2>/dev/null | while IFS= read -r agent_path; do
    [[ -n "$agent_path" ]] && remove "$agent_path" "agents/$(basename "$agent_path")"
  done
fi

if [[ "$DO_SKILLS" -eq 1 ]]; then
  skill_names="$(_receipt_field components.skillNames)"
  printf '%s' "$skill_names" | python3 -c "
import json,sys
try: names = json.load(sys.stdin)
except: names = []
for n in names: print(n)
" 2>/dev/null | while IFS= read -r skill_name; do
    [[ -z "$skill_name" ]] && continue
    if [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
      skill_link="$HOME/.claude/skills/$skill_name"
      if [[ -L "$skill_link" ]] && [[ "$(readlink "$skill_link")" == "$HOME/.agents/skills/"* ]]; then
        remove "$skill_link" "~/.claude/skills/$skill_name (symlink → ~/.agents/skills/)"
      elif [[ -e "$skill_link" ]]; then
        warn "~/.claude/skills/$skill_name is a real directory, not our symlink — skipped (remove manually if needed)"
      fi
      if [[ "$PURGE" -eq 1 ]]; then
        remove "$HOME/.agents/skills/$skill_name" "~/.agents/skills/$skill_name (--purge: shared pool content)"
      else
        info "~/.agents/skills/$skill_name content preserved (shared pool — pass --purge to remove)"
      fi
    else
      remove "$TARGET_DIR/skills/$skill_name" "$TARGET_DIR/skills/$skill_name"
    fi
  done
fi

if [[ "$DO_IDISU" -eq 1 ]]; then
  if [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
    printf '\n[note] Idisu is a marketplace plugin — complete removal in Claude Code:\n'
    printf '  /plugin uninstall idisu@fr1d4y\n'
  else
    remove "$TARGET_DIR/skills/idisu" "$TARGET_DIR/skills/idisu (skills-dir plugin)"
  fi
fi

if [[ "$DO_REJION" -eq 1 ]]; then
  if [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
    printf '  /plugin uninstall rejion@fr1d4y\n'
    printf '  /plugin marketplace remove fr1d4y\n'
  else
    remove "$TARGET_DIR/skills/rejion" "$TARGET_DIR/skills/rejion (skills-dir plugin)"
  fi
fi

# ── Purge (Idisu data + shared skill pool if requested) ─────────────────────
if [[ "$PURGE" -eq 1 && "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
  if [[ -d "$HOME/.idisu" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf "[dry-run] would remove ~/.idisu (--purge)\n"
    else
      SIZE=$(du -sh "$HOME/.idisu" 2>/dev/null | cut -f1 || echo "?")
      remove "$HOME/.idisu" "~/.idisu ($SIZE, --purge)"
    fi
  fi
fi

remove "$HOME/.github-setup-state-friday" "~/.github-setup-state-friday"

# ── Clean up backup dir and receipt ──────────────────────────────────────────
if [[ "$DRY_RUN" -ne 1 ]]; then
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rmdir "$BACKUP_DIR" 2>/dev/null && ok "removed now-empty backup dir $BACKUP_DIR" || true
  fi
  rm -f "$RECEIPT_PATH"
  ok "removed receipt $RECEIPT_PATH"
fi

printf "\n${GREEN}[done]${NC} Uninstall complete for %s.\n" "$TARGET_DIR"
[[ "$DRY_RUN" -eq 1 ]] && printf '%s\n' "[dry-run] No changes were made."
