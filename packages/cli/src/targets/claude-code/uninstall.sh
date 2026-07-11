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
# When both receipts exist, this is the first interactive prompt of this
# script's flow — nothing precedes it to go "back" to, so no back option is
# offered here (per this task's entry-prompt exception).
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
  local path="$1"
  local label="${2:-$path}"
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
DO_RULES=1
DO_SETTINGS=1
DO_AGENTS=1
DO_SKILLS=1
DO_IDISU=1
DO_REJION=1
SKILLS_REMOVE_LIST=""   # empty + DO_SKILLS=1 = remove every receipt skillName (default)
SKILLS_SUBSET_MODE=0    # 1 if the user picked a numbered subset (not all/none)

_pick_uninstall_skills_subset() {  # $1 = space-separated receipt skill names
  local all_names=("$@") names=() idx=0 name desc reply
  local desc_lookup=""
  if [[ -x "$(command -v bash)" && -d "$SHARED_DIR" ]] && command -v python3 >/dev/null 2>&1; then
    desc_lookup="$(bash "$SHARED_DIR/install-vendored-skills.sh" --list 2>/dev/null || true)"
  fi
  printf '\n  Installed skills:\n' >&2
  for name in "${all_names[@]}"; do
    [[ -z "$name" ]] && continue
    idx=$((idx + 1))
    names+=("$name")
    desc="$(printf '%s\n' "$desc_lookup" | awk -F'\t' -v n="$name" '$1==n{print $2}')"
    printf '    %d) %-32s %s\n' "$idx" "$name" "$desc" >&2
  done
  while true; do
    read -rp "  Remove which (space-separated numbers, 'all', 'none', or 'back' to return): " reply </dev/tty
    case "$reply" in
      all|ALL) SKILLS_REMOVE_LIST=""; SKILLS_SUBSET_MODE=0; return 0 ;;
      none|NONE) DO_SKILLS=0; return 0 ;;
      back|BACK) return 1 ;;
      *)
        local picked=() ok=1 n
        for n in $reply; do
          if [[ "$n" =~ ^[0-9]+$ ]] && (( n >= 1 && n <= idx )); then
            picked+=("${names[$((n-1))]}")
          else
            ok=0; break
          fi
        done
        if [[ "$ok" -eq 1 && "${#picked[@]}" -gt 0 ]]; then
          local joined="" item
          for item in "${picked[@]}"; do
            if [ -z "$joined" ]; then
              joined="$item"
            else
              joined="$joined,$item"
            fi
          done
          SKILLS_REMOVE_LIST="$joined"
          SKILLS_SUBSET_MODE=1
          return 0
        fi
        warn "  invalid selection, try again (e.g. '1 3', 'all', 'none', 'back')" ;;
    esac
  done
}

if [[ "$ASSUME_YES" -ne 1 && "$DRY_RUN" -ne 1 ]]; then
  printf '\nWhat to remove from %s (Enter=delete, s=skip, back=previous item):\n\n' "$TARGET_DIR" >&2

  # Flat sequential toggles have no upstream re-pickable step analogous to
  # install.sh's pick_scope (scope here comes from receipt discovery, not a
  # repeatable prompt) — so "back" steps to the immediately preceding item in
  # this list instead, rather than jumping to a coarse prior stage.
  _uninstall_step_names=(CLAUDE_MD RULES SETTINGS AGENTS SKILLS IDISU REJION)
  _uninstall_step_labels=(
    "CLAUDE.md"
    "rules/ (model-usage, version-control, gate-policy)"
    "settings.json keys"
    "agents/ (hanko--git-seal, kamaitachi--scout)"
    "skills/ symlinks (content in ~/.agents/skills/ preserved unless --purge)"
    "Idisu plugin"
    "Rejion plugin"
  )
  _step=0
  _total=${#_uninstall_step_names[@]}
  while (( _step < _total )); do
    _name="${_uninstall_step_names[$_step]}"
    _label="${_uninstall_step_labels[$_step]}"
    if [[ "$_name" == "SKILLS" ]]; then
      read -rp "  $_label [delete/s/subset/back]: " __skills_reply </dev/tty
      case "$__skills_reply" in
        back|BACK)
          if (( _step > 0 )); then _step=$((_step - 1)); continue; else warn "  already at first item"; continue; fi ;;
        s|S) DO_SKILLS=0 ;;
        subset)
          DO_SKILLS=1
          mapfile -t _all_receipt_skills < <(_receipt_field components.skillNames | python3 -c "
import json,sys
try: names = json.load(sys.stdin)
except Exception: names = []
for n in names: print(n)
" 2>/dev/null)
          if ! _pick_uninstall_skills_subset "${_all_receipt_skills[@]}"; then
            continue  # user chose 'back' inside the subset picker — reprompt this same item
          fi ;;
        *) DO_SKILLS=1 ;;
      esac
    else
      read -rp "  $_label [delete/s/back]: " __reply </dev/tty
      case "$__reply" in
        back|BACK)
          if (( _step > 0 )); then _step=$((_step - 1)); continue; else warn "  already at first item"; continue; fi ;;
        s|S) printf -v "DO_${_name}" '0' ;;
        *)   printf -v "DO_${_name}" '1' ;;
      esac
    fi
    _step=$((_step + 1))
  done
fi

# ── Step 3: Execute ──────────────────────────────────────────────────────────
[[ "$DO_CLAUDE_MD" -eq 1 ]] && restore_or_remove "$TARGET_DIR/CLAUDE.md" "CLAUDE.md" "CLAUDE.md"

if [[ "$DO_RULES" -eq 1 ]]; then
  rule_files="$(_receipt_field components.ruleFiles)"
  printf '%s' "$rule_files" | python3 -c "
import json,sys
try: paths = json.load(sys.stdin)
except Exception: paths = []
for p in paths: print(p)
" 2>/dev/null | while IFS= read -r rule_path; do
    [[ -n "$rule_path" ]] && remove "$rule_path" "rules/$(basename "$rule_path")"
  done
  # Legacy receipts predate ruleFiles — fall back to a directory sweep so
  # older installs still get cleaned up.
  if [[ -z "$rule_files" || "$rule_files" == "null" ]] && [[ -d "$TARGET_DIR/rules" ]]; then
    remove "$TARGET_DIR/rules" "rules/ (legacy receipt, swept whole dir)"
  fi
fi

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

REMOVED_SKILLS_TMP="$(mktemp)"
trap 'rm -f "$RECEIPT_TMP" "$REMOVED_SKILLS_TMP"' EXIT

if [[ "$DO_SKILLS" -eq 1 ]]; then
  skill_names="$(_receipt_field components.skillNames)"
  printf '%s' "$skill_names" | python3 -c "
import json,sys
try: names = json.load(sys.stdin)
except: names = []
for n in names: print(n)
" 2>/dev/null | while IFS= read -r skill_name; do
    [[ -z "$skill_name" ]] && continue
    if [[ -n "$SKILLS_REMOVE_LIST" ]]; then
      case ",$SKILLS_REMOVE_LIST," in *",$skill_name,"*) ;; *) continue ;; esac
    fi

    # research is a direct CC-bundled copy (like agents/), not a vendored-pool
    # symlink — handle it separately from the generic symlink logic below.
    if [[ "$skill_name" == "research" ]]; then
      remove "$TARGET_DIR/skills/research" "$TARGET_DIR/skills/research (bundled research skill)"
      echo "$skill_name" >> "$REMOVED_SKILLS_TMP"
      continue
    fi

    if [[ "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
      skill_link="$HOME/.claude/skills/$skill_name"
      if [[ -L "$skill_link" ]] && [[ "$(readlink "$skill_link")" == "$HOME/.agents/skills/"* ]]; then
        remove "$skill_link" "$HOME/.claude/skills/$skill_name (symlink → $HOME/.agents/skills/)"
      elif [[ -e "$skill_link" ]]; then
        warn "$HOME/.claude/skills/$skill_name is a real directory, not our symlink — skipped (remove manually if needed)"
      fi
      if [[ "$PURGE" -eq 1 ]]; then
        remove "$HOME/.agents/skills/$skill_name" "$HOME/.agents/skills/$skill_name (--purge: shared pool content)"
      else
        info "$HOME/.agents/skills/$skill_name content preserved (shared pool — pass --purge to remove)"
      fi
    else
      remove "$TARGET_DIR/skills/$skill_name" "$TARGET_DIR/skills/$skill_name"
    fi
    echo "$skill_name" >> "$REMOVED_SKILLS_TMP"
  done
fi

# Canonical external skills (superpowers/mattpocock subset + notebooklm +
# ponytail) install by DEFAULT as of this restructure (see claude-code/install.sh's
# CC_SKILL_SET comment) but come from install-external-skills.sh, a separate
# script that doesn't feed the receipt's skillNames. They're not covered by
# the receipt-driven loop above, so a full uninstall would otherwise silently
# leave them behind. Best-effort: only touch our own symlink pattern (same
# guard as the vendored-skills loop), silently skip anything not present
# (older installs, or a subset uninstall that never had them). Not offered as
# part of the per-skill subset picker — this is a "clean up the default
# external set" companion pass, not a user-selectable target.
if [[ "$DO_SKILLS" -eq 1 && -z "$SKILLS_REMOVE_LIST" && "$TARGET_DIR" == "$GLOBAL_TARGET" ]]; then
  # Matches exactly what install-external-skills.sh's --all sweep installs by
  # default (install_target != "manual" sets) — notebooklm stays excluded
  # there (manual/hand-install), so it's excluded here too.
  CANONICAL_EXTERNAL_SKILLS="brainstorming writing-plans subagent-driven-development verification-before-completion requesting-code-review finishing-a-development-branch using-git-worktrees caveman diagnose systematic-debugging tdd skill-creator writing-skills humanizer receiving-code-review create-readme improve-codebase-architecture grill-with-docs impeccable prototype to-prd to-issues triage html-preview find-docs dispatching-parallel-agents handoff executing-plans ponytail"
  for skill_name in $CANONICAL_EXTERNAL_SKILLS; do
    skill_link="$HOME/.claude/skills/$skill_name"
    [[ -L "$skill_link" ]] || continue
    [[ "$(readlink "$skill_link")" == "$HOME/.agents/skills/"* ]] || continue
    remove "$skill_link" "$HOME/.claude/skills/$skill_name (external, symlink → $HOME/.agents/skills/)"
    if [[ "$PURGE" -eq 1 ]]; then
      remove "$HOME/.agents/skills/$skill_name" "$HOME/.agents/skills/$skill_name (--purge: shared pool content)"
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
      remove "$HOME/.idisu" "$HOME/.idisu ($SIZE, --purge)"
    fi
  fi
fi

remove "$HOME/.github-setup-state-friday" "$HOME/.github-setup-state-friday"

# ── Clean up backup dir and receipt ──────────────────────────────────────────
if [[ "$DRY_RUN" -ne 1 ]]; then
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rmdir "$BACKUP_DIR" 2>/dev/null && ok "removed now-empty backup dir $BACKUP_DIR" || true
  fi
  # rmdir is a no-op (silently fails, caught) if anything is left inside —
  # only clears the dir when every file it held was actually removed above.
  rmdir "$TARGET_DIR/rules" 2>/dev/null || true
  rmdir "$TARGET_DIR/agents" 2>/dev/null || true

  if [[ "$SKILLS_SUBSET_MODE" -eq 1 ]]; then
    # Partial skill removal: rewrite the receipt's skillNames minus what was
    # actually removed, rather than deleting the whole receipt — the install
    # is still partially present (other skills, agents, config all untouched).
    removed_json="$(python3 -c "
import json,sys
with open(sys.argv[1]) as f:
    print(json.dumps([l.strip() for l in f if l.strip()]))
" "$REMOVED_SKILLS_TMP" 2>/dev/null || echo '[]')"
    python3 -c "
import json,sys
receipt_path, removed_json = sys.argv[1], sys.argv[2]
with open(receipt_path) as f:
    r = json.load(f)
removed = set(json.loads(removed_json))
r.setdefault('components', {})['skillNames'] = [
    n for n in r.get('components', {}).get('skillNames', []) if n not in removed
]
with open(receipt_path, 'w') as f:
    json.dump(r, f, indent=2)
" "$RECEIPT_PATH" "$removed_json" 2>/dev/null \
      && ok "receipt updated: skillNames minus removed subset" \
      || warn "could not rewrite receipt skillNames — edit $RECEIPT_PATH manually if needed"
  else
    rm -f "$RECEIPT_PATH"
    ok "removed receipt $RECEIPT_PATH"
  fi
fi

printf "\n${GREEN}[done]${NC} Uninstall complete for %s.\n" "$TARGET_DIR"
if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '%s\n' "[dry-run] No changes were made."
fi
exit 0
