#!/usr/bin/env bash
# install.sh — F.R.I.D.A.Y. claude-code interactive installer
#
# Supports global (~/.claude/) and project (.claude/ under the nearest
# existing .claude/ found walking up from CWD, or repo-root/.claude/ as a
# fresh-install default) scope. Writes a .furaide-receipt.json recording
# exactly what was installed, for a clean receipt-driven uninstall.
#
# Flags:
#   --yes, -y         Run unattended, accept all defaults (no prompts)
#   --scope <s>       global | project | custom:<path>  (skips scope prompt)
#   --minimal         Only install the Idisu CLI engine (steps 0-1), skip the rest
#   --no-config       Skip the config bundle (CLAUDE.md/settings/statusline)
#   --with-skills     Also offer the extended skill manifest (heavier, git-clones)
#   --js-runtime <r>  bun | npm  (force runtime instead of auto-detecting)
#   --dry-run         Print what would happen; make no changes
#   -h, --help        Print this usage and exit
#
# Usage examples:
#   bash install.sh                          # interactive, back-navigable
#   bash install.sh --yes                    # unattended, global scope, all defaults
#   bash install.sh --scope project --yes    # unattended, project scope
#   bash install.sh --minimal                # Idisu CLI only

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../harnesses/claude-code" && pwd)"
SHARED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../shared" && pwd)"
source "$SHARED_DIR/install-lib.sh"
IDISU_HOME="${IDISU_HOME:-$HOME/.idisu}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

# ── Merge all top-level keys from src JSON into dst JSON (src overrides dst) ─
_merge_settings() {
  local src="$1" dst="$2"
  [[ -f "$src" ]] || return 0
  if [[ ! -f "$dst" ]]; then
    cp "$src" "$dst"
    ok "installed settings.json → $(dirname "$dst")"
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
    ok "merged settings.json keys into $dst"
  elif command -v jq >/dev/null 2>&1; then
    local tmp; tmp=$(mktemp)
    jq -s '.[0] * .[1]' "$dst" "$src" > "$tmp" 2>/dev/null && mv "$tmp" "$dst" \
      && ok "merged settings.json keys into $dst" \
      || { rm -f "$tmp"; warn "could not merge settings.json — add keys from $src into $dst manually"; }
  else
    warn "could not merge settings.json — add keys from $src into $dst manually"
  fi
}

# ── Flag parsing ─────────────────────────────────────────────────────────────
ASSUME_YES=0
MINIMAL=0
NO_CONFIG=0
WITH_SKILLS=0
DRY_RUN=0
FORCED_SCOPE=""
FORCED_RUNTIME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)      ASSUME_YES=1; shift ;;
    --minimal)     MINIMAL=1; shift ;;
    --no-config)   NO_CONFIG=1; shift ;;
    --with-skills) WITH_SKILLS=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --scope)       FORCED_SCOPE="$2"; shift 2 ;;
    --js-runtime)  FORCED_RUNTIME="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -euo/{ /^set -euo/d; s/^# \{0,1\}//; p }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) err "unknown flag: $1"; exit 1 ;;
  esac
done

confirm() {  # confirm "message" — returns 0 (yes) / 1 (no); default yes
  [[ "$ASSUME_YES" -eq 1 ]] && return 0
  local reply
  printf "${YELLOW}?${NC} %s [Y/n] " "$1" >&2
  read -r reply </dev/tty || { printf '\n' >&2; return 1; }
  case "$reply" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

# ── Step 0: JS runtime detection ────────────────────────────────────────────
if [[ -n "$FORCED_RUNTIME" ]]; then
  JS_RUNTIME="$FORCED_RUNTIME"
else
  furaide_detect_js_runtime || exit 1
fi
ok "JS runtime: $JS_RUNTIME"

[[ "$MINIMAL" -eq 1 ]] && {
  [[ ! -d "$HOME/.idisu" ]] && { [[ "$DRY_RUN" -eq 1 ]] && echo "[dry-run] would create ~/.idisu" || { mkdir -p "$HOME/.idisu"; ok "created ~/.idisu"; }; }
  IDISU_SRC="$REPO/cli/src/idisu"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] would run: ($JS_RUNTIME install) in $IDISU_SRC"
  elif [[ "$JS_RUNTIME" == "bun" ]]; then
    ( cd "$IDISU_SRC" && bun install )
    chmod +x "$IDISU_SRC/src/cli/index.ts"
    mkdir -p "$IDISU_HOME"
    printf '%s\n' "$IDISU_SRC/src/cli/index.ts" > "$IDISU_HOME/cli-path"
    ok "Īdisu CLI installed -> $IDISU_SRC/src/cli/index.ts"
  else
    warn "npm runtime: Īdisu CLI requires bun specifically (bun:sqlite). Install bun to enable it."
  fi
  printf '\n%s\n' "$(printf "${GREEN}[done]${NC} minimal mode complete.")"
  exit 0
}

# ── Step 1: Scope selection (back-navigable) ────────────────────────────────
GLOBAL_TARGET="$HOME/.claude"
PROJECT_TARGET="$(furaide_find_project_dir ".claude")"

pick_scope() {
  if [[ -n "$FORCED_SCOPE" ]]; then
    case "$FORCED_SCOPE" in
      global)  SCOPE="global"; TARGET_DIR="$GLOBAL_TARGET" ;;
      project) SCOPE="project"; TARGET_DIR="$PROJECT_TARGET" ;;
      custom:*) SCOPE="custom"; TARGET_DIR="${FORCED_SCOPE#custom:}" ;;
      *) err "unknown --scope value: $FORCED_SCOPE (expected global|project|custom:<path>)"; exit 1 ;;
    esac
    return
  fi
  [[ "$ASSUME_YES" -eq 1 ]] && { SCOPE="global"; TARGET_DIR="$GLOBAL_TARGET"; return; }

  printf '\nWhere should Claude Code config be installed?\n\n' >&2
  printf '  1) Global   (%s)\n' "$GLOBAL_TARGET" >&2
  printf '  2) Project  (%s)\n' "$PROJECT_TARGET" >&2
  printf '  3) Custom directory\n\n' >&2
  local choice
  read -rp 'Enter 1, 2, or 3: ' choice </dev/tty
  case "$choice" in
    1) SCOPE="global"; TARGET_DIR="$GLOBAL_TARGET" ;;
    2) SCOPE="project"; TARGET_DIR="$PROJECT_TARGET" ;;
    3)
      read -rp 'Absolute path: ' TARGET_DIR </dev/tty
      SCOPE="custom" ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
}
pick_scope
ok "scope: $SCOPE ($TARGET_DIR)"

# ── Step 2: Pre-checks ───────────────────────────────────────────────────────
[[ "$JS_RUNTIME" == "npm" ]] && warn "bun not found — Īdisu CLI (bun:sqlite) will not install; falling back for skills/agents/config only."
command -v jq    >/dev/null 2>&1 || warn "jq not found - Īdisu hooks and settings merge fall back to python3."
command -v flock >/dev/null 2>&1 || warn "flock not found - Īdisu hooks expect flock from util-linux."
command -v git    >/dev/null 2>&1 || warn "git not found - statusline branch display will be blank."

# ── Step 3: Prior install / receipt detection ───────────────────────────────
RECEIPT_PATH="$TARGET_DIR/.furaide-receipt.json"
PRIOR_RECEIPT="$(furaide_read_receipt "$RECEIPT_PATH")"
if [[ -n "$PRIOR_RECEIPT" ]]; then
  INSTALLED_AT="$(printf '%s' "$PRIOR_RECEIPT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("installedAt","?"))' 2>/dev/null || echo "?")"
  ok "found prior install (installed $INSTALLED_AT) — this run updates it"
fi

INSTALL_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# ── Step 4: Component selection ─────────────────────────────────────────────
INSTALL_CLAUDE_MD=1
INSTALL_SETTINGS=1
INSTALL_AGENTS=1
INSTALL_SKILLS=1
INSTALL_IDISU=1
INSTALL_REJION=1
INSTALL_EXTENDED_SKILLS=0
[[ "$WITH_SKILLS" -eq 1 ]] && INSTALL_EXTENDED_SKILLS=1

if [[ "$SCOPE" == "project" || "$SCOPE" == "custom" ]]; then
  # statusline is not installable at project scope in a self-contained way
  # (no per-project statusline-command.sh copy is planned — settings.json
  # in project scope references the repo's absolute path instead).
  :
fi

if [[ "$ASSUME_YES" -ne 1 && "$MINIMAL" -ne 1 ]]; then
  printf '\nComponents to install (Enter=yes, n=no, b=back to scope selection):\n\n' >&2
  select_component() {  # var_name prompt
    local __var="$1" __prompt="$2" __reply
    read -rp "  $__prompt [Y/n/b]: " __reply </dev/tty
    case "$__reply" in
      b|B) pick_scope; return 1 ;;
      n|N) printf -v "$__var" '0' ;;
      *)   printf -v "$__var" '1' ;;
    esac
    return 0
  }
  select_component INSTALL_CLAUDE_MD "CLAUDE.md"                          || select_component INSTALL_CLAUDE_MD "CLAUDE.md"
  select_component INSTALL_SETTINGS  "Settings (statusline + prefs)"      || select_component INSTALL_SETTINGS  "Settings (statusline + prefs)"
  select_component INSTALL_AGENTS    "Core agents (hanko--git-seal)"      || select_component INSTALL_AGENTS    "Core agents (hanko--git-seal)"
  select_component INSTALL_SKILLS    "Core skills (github, bx, ...)"      || select_component INSTALL_SKILLS    "Core skills (github, bx, ...)"
  select_component INSTALL_IDISU     "Idisu plugin"                      || select_component INSTALL_IDISU     "Idisu plugin"
  select_component INSTALL_REJION    "Rejion plugin"                     || select_component INSTALL_REJION    "Rejion plugin"
fi

[[ "$NO_CONFIG" -eq 1 ]] && { INSTALL_CLAUDE_MD=0; INSTALL_SETTINGS=0; }

# ── Step 5: Confirm ──────────────────────────────────────────────────────────
if [[ "$ASSUME_YES" -ne 1 ]]; then
  printf '\nAbout to install to %s:\n' "$TARGET_DIR" >&2
  [[ "$INSTALL_CLAUDE_MD" -eq 1 ]] && printf '  - CLAUDE.md\n' >&2
  [[ "$INSTALL_SETTINGS" -eq 1 ]]  && printf '  - settings.json (merged)\n' >&2
  [[ "$INSTALL_AGENTS" -eq 1 ]]    && printf '  - agents/\n' >&2
  [[ "$INSTALL_SKILLS" -eq 1 ]]    && printf '  - skills/\n' >&2
  [[ "$INSTALL_IDISU" -eq 1 ]]     && printf '  - Idisu plugin\n' >&2
  [[ "$INSTALL_REJION" -eq 1 ]]    && printf '  - Rejion plugin\n' >&2
  printf 'Backup dir (if needed): %s/.furaide-backup/%s\n' "$TARGET_DIR" "$INSTALL_TIMESTAMP" >&2
  confirm "Proceed?" || { err "cancelled"; exit 1; }
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] no changes made. Would have installed the components listed above to $TARGET_DIR."
  exit 0
fi

mkdir -p "$TARGET_DIR"

# ── Execute: Īdisu CLI (bun only; global scope only — project scope has no
#    per-project Idisu CLI concept, it's a user-level tool) ─────────────────
COMPONENTS_INSTALLED=()
if [[ "$SCOPE" == "global" ]]; then
  if [[ ! -d "$HOME/.idisu" ]]; then mkdir -p "$HOME/.idisu"; ok "created ~/.idisu"; fi
  if [[ "$JS_RUNTIME" == "bun" ]]; then
    IDISU_SRC="$REPO/cli/src/idisu"
    ( cd "$IDISU_SRC" && bun install )
    chmod +x "$IDISU_SRC/src/cli/index.ts"
    mkdir -p "$IDISU_HOME"
    printf '%s\n' "$IDISU_SRC/src/cli/index.ts" > "$IDISU_HOME/cli-path"
    ok "Īdisu CLI installed -> $IDISU_SRC/src/cli/index.ts"
  fi
fi

# ── Execute: Skills ──────────────────────────────────────────────────────────
SKILL_NAMES=()
if [[ "$INSTALL_SKILLS" -eq 1 ]]; then
  if [[ "$SCOPE" == "global" ]]; then
    bash "$SHARED_DIR/install-vendored-skills.sh" --global
  else
    bash "$SHARED_DIR/install-vendored-skills.sh" --project "$(dirname "$TARGET_DIR")"
  fi
  for d in "$REPO/config/../../../skills"/*/; do :; done 2>/dev/null || true
  for d in "$REPO"/../../skills/*/; do
    [[ -d "$d" ]] && SKILL_NAMES+=("$(basename "$d")")
  done
  COMPONENTS_INSTALLED+=("skills")
fi
if [[ "$INSTALL_EXTENDED_SKILLS" -eq 1 ]]; then
  if confirm "Install extended skill manifest (heavier, git-clones repos)?"; then
    bash "$SHARED_DIR/install-external-skills.sh" --ecosystem claude-code
    ok "extended skill manifest installed"
    COMPONENTS_INSTALLED+=("extended-skills")
  fi
fi

# ── Execute: Agents ───────────────────────────────────────────────────────────
AGENT_FILES=()
if [[ "$INSTALL_AGENTS" -eq 1 ]]; then
  mkdir -p "$TARGET_DIR/agents"
  for agent_src in "$REPO/config/agents/"*.md; do
    [[ -e "$agent_src" ]] || continue
    fname="$(basename "$agent_src")"
    dest="$TARGET_DIR/agents/$fname"
    if [[ -e "$dest" ]]; then
      ok "skip  agents/$fname (already exists)"
    else
      cp "$agent_src" "$dest"
      ok "installed agents/$fname → $TARGET_DIR/agents/"
    fi
    AGENT_FILES+=("$dest")
  done
  COMPONENTS_INSTALLED+=("agents")
fi

# ── Execute: Config bundle (CLAUDE.md, settings.json, statusline) ───────────
if [[ "$INSTALL_CLAUDE_MD" -eq 1 ]]; then
  dest="$TARGET_DIR/CLAUDE.md"
  furaide_backup_file "$dest" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
  cp "$REPO/config/CLAUDE.md" "$dest"
  ok "copied CLAUDE.md → $TARGET_DIR/"
  COMPONENTS_INSTALLED+=("claudeMd")
fi

if [[ "$INSTALL_SETTINGS" -eq 1 ]]; then
  furaide_backup_file "$TARGET_DIR/settings.json" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
  if [[ "$SCOPE" == "global" ]]; then
    dest="$TARGET_DIR/statusline-command.sh"
    furaide_backup_file "$dest" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
    ln -sf "$REPO/config/statusline-command.sh" "$dest"
    ok "symlinked statusline-command.sh → $REPO/config/"
    _merge_settings "$REPO/config/settings.json" "$TARGET_DIR/settings.json"
  else
    # Project scope: statusline command references the repo's absolute path
    # directly in the merged settings.json rather than a per-project symlink.
    TMP_SETTINGS="$(mktemp)"
    python3 -c "
import json
with open('$REPO/config/settings.json') as f: cfg = json.load(f)
if 'statusLine' in cfg and isinstance(cfg['statusLine'], dict):
    cfg['statusLine']['command'] = '$REPO/config/statusline-command.sh'
json.dump(cfg, open('$TMP_SETTINGS', 'w'), indent=2)
" 2>/dev/null || cp "$REPO/config/settings.json" "$TMP_SETTINGS"
    _merge_settings "$TMP_SETTINGS" "$TARGET_DIR/settings.json"
    rm -f "$TMP_SETTINGS"
  fi
  COMPONENTS_INSTALLED+=("settings")
fi

# ── Execute: Plugins ──────────────────────────────────────────────────────────
PLUGINS_INSTALLED=()
if [[ "$SCOPE" == "global" ]]; then
  [[ "$INSTALL_IDISU" -eq 1 ]]  && PLUGINS_INSTALLED+=("idisu")
  [[ "$INSTALL_REJION" -eq 1 ]] && PLUGINS_INSTALLED+=("rejion")
else
  mkdir -p "$TARGET_DIR/skills"
  if [[ "$INSTALL_IDISU" -eq 1 && -d "$REPO/plugins/idisu" ]]; then
    cp -r "$REPO/plugins/idisu" "$TARGET_DIR/skills/idisu"
    ok "copied Idisu plugin → $TARGET_DIR/skills/idisu (skills-dir plugin)"
    PLUGINS_INSTALLED+=("idisu")
  fi
  if [[ "$INSTALL_REJION" -eq 1 && -d "$REPO/plugins/rejion" ]]; then
    cp -r "$REPO/plugins/rejion" "$TARGET_DIR/skills/rejion"
    ok "copied Rejion plugin → $TARGET_DIR/skills/rejion (skills-dir plugin)"
    PLUGINS_INSTALLED+=("rejion")
  fi
fi

# ── Write receipt ─────────────────────────────────────────────────────────────
python3 -c "
import json, sys
receipt = {
    'version': 1,
    'jsRuntime': '$JS_RUNTIME',
    'scope': '$SCOPE',
    'installedAt': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'targetDir': '$TARGET_DIR',
    'backupDir': '$TARGET_DIR/.furaide-backup/$INSTALL_TIMESTAMP',
    'components': {
        'claudeMd': $([[ $INSTALL_CLAUDE_MD -eq 1 ]] && echo "'$TARGET_DIR/CLAUDE.md'" || echo 'None'),
        'settings': $([[ $INSTALL_SETTINGS -eq 1 ]] && echo "'$TARGET_DIR/settings.json'" || echo 'None'),
        'agents': [$(printf '"%s",' "${AGENT_FILES[@]}" 2>/dev/null)],
        'skillNames': [$(printf '"%s",' "${SKILL_NAMES[@]}" 2>/dev/null)],
        'plugins': [$(printf '"%s",' "${PLUGINS_INSTALLED[@]}" 2>/dev/null)],
    },
}
json.dump(receipt, open('$RECEIPT_PATH', 'w'), indent=2)
print()
" 2>/dev/null || warn "could not write receipt to $RECEIPT_PATH (python3 unavailable) — uninstall will need --scope to target this install manually"
[[ -f "$RECEIPT_PATH" ]] && ok "receipt written → $RECEIPT_PATH"

# ── Done ──────────────────────────────────────────────────────────────────────
printf '\n%s\n' "$(printf "${GREEN}[done]${NC} Installed to %s." "$TARGET_DIR")"
if [[ "$SCOPE" == "global" ]]; then
  printf '\nNext steps in Claude Code:\n'
  printf '  /plugin marketplace add pratty010/Furaide\n'
  [[ "$INSTALL_IDISU" -eq 1 ]]  && printf '  /plugin install idisu@fr1d4y\n'
  [[ "$INSTALL_REJION" -eq 1 ]] && printf '  /plugin install rejion@fr1d4y\n'
  printf '  /reload-plugins\n'
else
  printf '\nCommit %s to share this setup with your team.\n' "$TARGET_DIR"
  printf 'Each team member: accept the workspace trust prompt, then run /reload-plugins.\n'
fi
