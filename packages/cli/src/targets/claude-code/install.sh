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
#   --with-skills     Also offer the extended skill manifest (deprecated no-op:
#                     the canonical external set now installs by default — see
#                     the "Core skills" component step)
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
DRY_RUN=0
FORCED_SCOPE=""
FORCED_RUNTIME=""
SKIP_CHECKS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)      ASSUME_YES=1; shift ;;
    --minimal)     MINIMAL=1; shift ;;
    --no-config)   NO_CONFIG=1; shift ;;
    --with-skills) shift ;;  # deprecated no-op — see the flag's help text above
    --dry-run)     DRY_RUN=1; shift ;;
    --scope)       FORCED_SCOPE="$2"; shift 2 ;;
    --js-runtime)  FORCED_RUNTIME="$2"; shift 2 ;;
    --skip-checks) SKIP_CHECKS=1; shift ;;
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

_install_idisu_cli() {
  local idisu_src="$REPO/cli/src/idisu"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] would run: bun install in $idisu_src"
    return 0
  fi
  [[ "$JS_RUNTIME" != "bun" ]] && { warn "npm runtime: Īdisu CLI requires bun specifically (bun:sqlite). Install bun to enable it."; return 0; }
  ( cd "$idisu_src" && bun install )
  chmod +x "$idisu_src/src/cli/index.ts"
  mkdir -p "$IDISU_HOME"
  printf '%s\n' "$idisu_src/src/cli/index.ts" > "$IDISU_HOME/cli-path"
  ok "Īdisu CLI installed -> $idisu_src/src/cli/index.ts"
}

[[ "$MINIMAL" -eq 1 ]] && {
  [[ ! -d "$HOME/.idisu" ]] && { [[ "$DRY_RUN" -eq 1 ]] && echo "[dry-run] would create ~/.idisu" || { mkdir -p "$HOME/.idisu"; ok "created ~/.idisu"; }; }
  _install_idisu_cli
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
if [[ "$SKIP_CHECKS" -ne 1 ]]; then
  command -v jq    >/dev/null 2>&1 || warn "jq not found - Īdisu hooks and settings merge fall back to python3."
  command -v flock >/dev/null 2>&1 || warn "flock not found - Īdisu hooks expect flock from util-linux."
  command -v git    >/dev/null 2>&1 || warn "git not found - statusline branch display will be blank."
fi

# ── Step 3: Prior install / receipt detection ───────────────────────────────
RECEIPT_PATH="$TARGET_DIR/.furaide-receipt.json"
PRIOR_RECEIPT="$(furaide_read_receipt "$RECEIPT_PATH")"
if [[ -n "$PRIOR_RECEIPT" ]]; then
  INSTALLED_AT="$(printf '%s' "$PRIOR_RECEIPT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("installedAt","?"))' 2>/dev/null || echo "?")"
  ok "found prior install (installed $INSTALLED_AT) — this run updates it"
fi

INSTALL_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# ── Step 4: Component selection ─────────────────────────────────────────────
# CC's repo-vendored skill boundary (per docs/superpowers/specs/2026-07-10-claude-code-config-restructure.md
# "CC installer ship-set"): the 5 skills CC's 5 flows actually reference. The
# retired addenda/research-scaffolds are folded into CLAUDE.md's Global
# Constraints and the new research skill respectively (not shipped as files);
# finance/security skills (dcf-valuation-model, earnings-10k-extraction,
# mcp-supply-chain-scan) and brave-search/bx stay in the shared pool for other
# harnesses but are NOT part of CC's default set.
CC_SKILL_SET="github,html-preview,handoff-furaide-addendum,post-mortem,regression-test-recipe"

INSTALL_CLAUDE_MD=1
INSTALL_SETTINGS=1
INSTALL_AGENTS=1
INSTALL_SKILLS=1
INSTALL_IDISU=1
INSTALL_REJION=1
SKILLS_ONLY_LIST="$CC_SKILL_SET"   # narrowed by the 's' picker below, or --yes default

# ── Skills subset picker: numbered multi-select scoped to CC_SKILL_SET ─────
_pick_skills_subset() {
  local list_output names=() reply idx name desc
  list_output="$(bash "$SHARED_DIR/install-vendored-skills.sh" --list)"
  IFS=',' read -ra _cc_set <<< "$CC_SKILL_SET"
  printf '\n  Available skills:\n' >&2
  idx=0
  for name in "${_cc_set[@]}"; do
    idx=$((idx + 1))
    names+=("$name")
    desc="$(printf '%s\n' "$list_output" | awk -F'\t' -v n="$name" '$1==n{print $2}')"
    printf '    %d) %-32s %s\n' "$idx" "$name" "$desc" >&2
  done
  while true; do
    read -rp "  Select (space-separated numbers, 'all', or 'none'): " reply </dev/tty
    case "$reply" in
      all|ALL) SKILLS_ONLY_LIST="$CC_SKILL_SET"; return 0 ;;
      none|NONE) SKILLS_ONLY_LIST=""; return 0 ;;
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
          SKILLS_ONLY_LIST="$(IFS=,; echo "${picked[*]}")"
          return 0
        fi
        warn "  invalid selection, try again (e.g. '1 3 5', 'all', 'none')" ;;
    esac
  done
}

if [[ "$ASSUME_YES" -ne 1 && "$MINIMAL" -ne 1 ]]; then
  printf '\nComponents to install (Enter=yes, n=no, b=back to scope selection):\n\n' >&2
  select_component() {  # var_name prompt
    while true; do
      local __var="$1" __prompt="$2" __reply
      read -rp "  $__prompt [Y/n/b]: " __reply </dev/tty
      case "$__reply" in
        b|B) pick_scope ;;
        n|N) printf -v "$__var" '0'; return 0 ;;
        *)   printf -v "$__var" '1'; return 0 ;;
      esac
    done
  }
  select_component INSTALL_CLAUDE_MD "CLAUDE.md"
  select_component INSTALL_SETTINGS  "Settings (statusline + prefs)"
  select_component INSTALL_AGENTS    "Core agents (hanko--git-seal, kamaitachi--scout)"

  while true; do
    read -rp "  Skills: $CC_SKILL_SET + research + canonical external set (superpowers/mattpocock/ponytail) [Y/n/s/b]: " __skills_reply </dev/tty
    case "$__skills_reply" in
      b|B) pick_scope ;;
      n|N) INSTALL_SKILLS=0; break ;;
      s|S) INSTALL_SKILLS=1; _pick_skills_subset; break ;;
      *)   INSTALL_SKILLS=1; SKILLS_ONLY_LIST="$CC_SKILL_SET"; break ;;
    esac
  done

  select_component INSTALL_IDISU     "Idisu plugin"
  select_component INSTALL_REJION    "Rejion plugin"
fi

[[ "$NO_CONFIG" -eq 1 ]] && { INSTALL_CLAUDE_MD=0; INSTALL_SETTINGS=0; }

# ── Step 5: Confirm ──────────────────────────────────────────────────────────
if [[ "$ASSUME_YES" -ne 1 ]]; then
  printf '\nAbout to install to %s:\n' "$TARGET_DIR" >&2
  [[ "$INSTALL_CLAUDE_MD" -eq 1 ]] && printf '  - CLAUDE.md + rules/\n' >&2
  [[ "$INSTALL_SETTINGS" -eq 1 ]]  && printf '  - settings.json (merged)\n' >&2
  [[ "$INSTALL_AGENTS" -eq 1 ]]    && printf '  - agents/\n' >&2
  [[ "$INSTALL_SKILLS" -eq 1 ]]    && printf '  - skills/ (%s) + research skill + canonical external set\n' "${SKILLS_ONLY_LIST:-none selected}" >&2
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
if [[ "$SCOPE" == "global" ]]; then
  if [[ ! -d "$HOME/.idisu" ]]; then mkdir -p "$HOME/.idisu"; ok "created ~/.idisu"; fi
  _install_idisu_cli
fi

# ── Execute: Skills ──────────────────────────────────────────────────────────
# Receipt-drift fix: SKILL_NAMES comes from install-vendored-skills.sh's own
# INSTALLED: lines (what it actually put on disk), not a re-glob of skills/*
# — the old re-glob recorded every repo skill regardless of --only filtering.
SKILL_NAMES=()
if [[ "$INSTALL_SKILLS" -eq 1 && -n "$SKILLS_ONLY_LIST" ]]; then
  VENDORED_OUT="$(mktemp)"
  if [[ "$SCOPE" == "global" ]]; then
    bash "$SHARED_DIR/install-vendored-skills.sh" --global --only "$SKILLS_ONLY_LIST" | tee "$VENDORED_OUT"
  else
    bash "$SHARED_DIR/install-vendored-skills.sh" --custom "$TARGET_DIR" --only "$SKILLS_ONLY_LIST" | tee "$VENDORED_OUT"
  fi
  while IFS= read -r line; do
    [[ "$line" == INSTALLED:\ * ]] && SKILL_NAMES+=("${line#INSTALLED: }")
  done < "$VENDORED_OUT"
  rm -f "$VENDORED_OUT"

  # config/skills/research/ — CC-bundled skill (analogous to config/agents/).
  # Always a plain repo copy (never a symlink), matching the config/agents/*.md
  # skip-if-exists convention elsewhere in this file: re-installs are idempotent
  # (no clobber, no misfiring "foreign file" warning), and refreshing it after
  # an update means deleting it first, same as any other bundled file here.
  if [[ -d "$REPO/config/skills/research" ]]; then
    mkdir -p "$TARGET_DIR/skills"
    research_dest="$TARGET_DIR/skills/research"
    if [[ -e "$research_dest" ]]; then
      ok "  research: skip (already exists — delete to reinstall)"
    else
      cp -r "$REPO/config/skills/research" "$research_dest"
      ok "  research → $research_dest"
    fi
    SKILL_NAMES+=("research")
  fi

  # Canonical external skills (superpowers + mattpocock subset, ponytail) are
  # part of CC's standard ship-set per the config-restructure spec — no longer
  # a rare --with-skills opt-in. Dedup variants (diagnosing-bugs, grilling/
  # grill-me, test-driven-development, write-a-skill/writing-great-skills,
  # readme-blueprint-generator) and "manual"-tagged sets (hanko/github — already
  # covered by install-vendored-skills.sh above; notebooklm — genuinely
  # hand-install-only per its own manifest description) are excluded at the
  # manifest level (install-external-skills.sh skips install_target=="manual"
  # entirely), not here.
  #
  # install-external-skills.sh has no --custom/--scope concept of its own — it
  # only knows "global" (~/.agents/, ~/.claude/skills/) or --project (relative
  # ./.claude/skills/, no path parameter). For any non-global CC scope,
  # redirect via its env-var overrides so the sweep stays fully inside
  # TARGET_DIR instead of touching the real ~/.agents/skill-repos,
  # ~/.agents/skills, ~/.claude/skills on the host machine — matches how
  # install-vendored-skills.sh already isolates project/custom scope.
  #
  # Non-fatal: this step reaches the network (git clone/pull); a transient
  # failure here must not abort the rest of the install (CLAUDE.md/rules/
  # agents/settings, none of which depend on it) — set -e is active, so guard
  # explicitly rather than let it propagate.
  if [[ "$SCOPE" == "global" ]]; then
    bash "$SHARED_DIR/install-external-skills.sh" --ecosystem claude-code --all \
      && ok "canonical external skills installed (superpowers/mattpocock/ponytail)" \
      || warn "canonical external skills install failed (network?) — re-run 'bash $SHARED_DIR/install-external-skills.sh --ecosystem claude-code --all' later"
  else
    AGENTS_SKILL_REPOS="$TARGET_DIR/.agents/skill-repos" \
    AGENTS_SKILLS="$TARGET_DIR/.agents/skills" \
    CLAUDE_SKILLS="$TARGET_DIR/skills" \
      bash "$SHARED_DIR/install-external-skills.sh" --ecosystem claude-code --all \
      && ok "canonical external skills installed (superpowers/mattpocock/ponytail)" \
      || warn "canonical external skills install failed (network?) — re-run manually with the same AGENTS_SKILL_REPOS/AGENTS_SKILLS/CLAUDE_SKILLS overrides targeting $TARGET_DIR"
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
fi

# ── Execute: Config bundle (CLAUDE.md, rules/, settings.json, statusline) ───
RULE_FILES=()
if [[ "$INSTALL_CLAUDE_MD" -eq 1 ]]; then
  dest="$TARGET_DIR/CLAUDE.md"
  furaide_backup_file "$dest" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
  cp "$REPO/config/CLAUDE.md" "$dest"
  ok "copied CLAUDE.md → $TARGET_DIR/"

  if [[ -d "$REPO/config/rules" ]]; then
    mkdir -p "$TARGET_DIR/rules"
    for rule_src in "$REPO/config/rules/"*.md; do
      [[ -e "$rule_src" ]] || continue
      fname="$(basename "$rule_src")"
      rule_dest="$TARGET_DIR/rules/$fname"
      furaide_backup_file "$rule_dest" "$TARGET_DIR" "$INSTALL_TIMESTAMP"
      cp "$rule_src" "$rule_dest"
      ok "copied rules/$fname → $TARGET_DIR/rules/"
      RULE_FILES+=("$rule_dest")
    done
  fi
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
    python3 - "$REPO/config/settings.json" "$TMP_SETTINGS" "$REPO/config/statusline-command.sh" <<'PYEOF' 2>/dev/null || cp "$REPO/config/settings.json" "$TMP_SETTINGS"
import json,sys
cfg = json.load(open(sys.argv[1]))
if 'statusLine' in cfg and isinstance(cfg['statusLine'], dict):
    cfg['statusLine']['command'] = sys.argv[3]
json.dump(cfg, open(sys.argv[2], 'w'), indent=2)
PYEOF
    _merge_settings "$TMP_SETTINGS" "$TARGET_DIR/settings.json"
    rm -f "$TMP_SETTINGS"
  fi
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
_agent_args=("${AGENT_FILES[@]+"${AGENT_FILES[@]}"}")
_skill_args=("${SKILL_NAMES[@]+"${SKILL_NAMES[@]}"}")
_plugin_args=("${PLUGINS_INSTALLED[@]+"${PLUGINS_INSTALLED[@]}"}")
_rule_args=("${RULE_FILES[@]+"${RULE_FILES[@]}"}")

python3 - \
  "$RECEIPT_PATH" \
  "$JS_RUNTIME" \
  "$SCOPE" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$TARGET_DIR" \
  "$TARGET_DIR/.furaide-backup/$INSTALL_TIMESTAMP" \
  "$( [[ $INSTALL_CLAUDE_MD -eq 1 ]] && echo "$TARGET_DIR/CLAUDE.md" || echo "" )" \
  "$( [[ $INSTALL_SETTINGS  -eq 1 ]] && echo "$TARGET_DIR/settings.json" || echo "" )" \
  "${_agent_args[@]+"${_agent_args[@]}"}" \
  -- \
  "${_skill_args[@]+"${_skill_args[@]}"}" \
  -- \
  "${_plugin_args[@]+"${_plugin_args[@]}"}" \
  -- \
  "${_rule_args[@]+"${_rule_args[@]}"}" \
<<'PYEOF' 2>/dev/null || warn "could not write receipt to $RECEIPT_PATH (python3 unavailable) — uninstall will need --scope to target this install manually"
import json,sys
args = sys.argv[1:]
receipt_path, js_runtime, scope, installed_at, target_dir, backup_dir, claude_md, settings_json = args[:8]
rest = args[8:]
sep = rest.index('--') if '--' in rest else len(rest)
agent_files = rest[:sep]
rest2 = rest[sep+1:] if sep < len(rest) else []
sep2 = rest2.index('--') if '--' in rest2 else len(rest2)
skill_names = rest2[:sep2]
rest3 = rest2[sep2+1:] if sep2 < len(rest2) else []
sep3 = rest3.index('--') if '--' in rest3 else len(rest3)
plugin_names = rest3[:sep3]
rule_files = rest3[sep3+1:] if sep3 < len(rest3) else []
receipt = {
    'version': 1,
    'jsRuntime': js_runtime,
    'scope': scope,
    'installedAt': installed_at,
    'targetDir': target_dir,
    'backupDir': backup_dir,
    'components': {
        'claudeMd': claude_md if claude_md else None,
        'settings': settings_json if settings_json else None,
        'agents': agent_files,
        'skillNames': skill_names,
        'plugins': plugin_names,
        'ruleFiles': rule_files,
    },
}
json.dump(receipt, open(receipt_path, 'w'), indent=2)
PYEOF
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
