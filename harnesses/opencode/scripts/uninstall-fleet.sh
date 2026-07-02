#!/usr/bin/env bash
# uninstall-fleet.sh: Furaidē's Fleet modular, scope-aware uninstaller
# Usage: bash scripts/uninstall-fleet.sh [OPTIONS]
#
# Options:
#   --dry-run           Show planned actions without deleting files
#   --purge             Uninstall from all selected scopes without prompting
#   --global            Pre-select global scope (~/.config/opencode/) for cleanup
#   --project           Pre-select project scope (./.opencode/) for cleanup
#   --custom <dir>      Pre-select a custom absolute directory for cleanup
#   --include-shared-skills Also clean up shared common skills
#   -h, --help          Show this help

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'
BLU=$'\033[34m'; MAG=$'\033[35m'; CYN=$'\033[36m'

_info()  { printf '%b\n' "${BLU}[info]${RST}  $*"; }
_ok()    { printf '%b\n' "${GRN}[ok]${RST}    $*"; }
_warn()  { printf '%b\n' "${YLW}[warn]${RST}  $*"; }
_err()   { printf '%b\n' "${RED}[error]${RST} $*" >&2; }
_bold()  { printf '%b\n' "${BOLD}$*${RST}"; }

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$FLEET_ROOT/config/fleet-manifest.json"

GLOBAL_SCOPE="$HOME/.config/opencode"
PROJECT_SCOPE="$(pwd)/.opencode"

# ── Flags ────────────────────────────────────────────────────────────────────
DRY_RUN=0
PURGE=0
FORCE_SCOPE=""   # 'global' | 'project' | 'custom'
CUSTOM_DIR=""
INCLUDE_SHARED_SKILLS=0

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --purge)          PURGE=1 ;;
    --global)         FORCE_SCOPE="global" ;;
    --project)         FORCE_SCOPE="project" ;;
    --custom)
      FORCE_SCOPE="custom"
      shift
      CUSTOM_DIR="${1:-}"
      if [[ -z "$CUSTOM_DIR" || "$CUSTOM_DIR" == --* ]]; then
        _err "--custom requires an absolute path argument"
        exit 1
      fi
      ;;
    --include-shared-skills)
      INCLUDE_SHARED_SKILLS=1
      ;;
    -h|--help)
      sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      _err "Unknown flag: $1"
      exit 1
      ;;
  esac
  shift
done

if [[ ! -f "$MANIFEST" ]]; then
  _err "Manifest not found: $MANIFEST"
  exit 1
fi

# ── Load manifest ─────────────────────────────────────────────────────────────
COMPONENT_COUNT=$(jq '.components | length' "$MANIFEST")

# ── Scope resolution ──────────────────────────────────────────────────────────
resolve_scope_dir() {
  local scope="$1" custom="${2:-}"
  case "$scope" in
    global)  echo "$GLOBAL_SCOPE" ;;
    project) echo "$PROJECT_SCOPE" ;;
    custom)  echo "$custom" ;;
  esac
}

# ── File operations ───────────────────────────────────────────────────────────
do_uninstall_file() {
  local rel="$1" dst_base="$2"
  local dst="$dst_base/$rel"
  local restore_src=""
  [[ -n "${RESTORE_ROOT:-}" ]] && restore_src="$RESTORE_ROOT/$rel"
  if [[ -f "$dst" || -L "$dst" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      if [[ -n "$restore_src" && ( -f "$restore_src" || -L "$restore_src" ) ]]; then
        printf '  %b[dry-run]%b restore %s -> %s\n' "$DIM" "$RST" "$restore_src" "$dst"
      else
        printf '  %b[dry-run]%b rm %s\n' "$DIM" "$RST" "$dst"
      fi
    else
      if [[ -n "$restore_src" && ( -f "$restore_src" || -L "$restore_src" ) ]]; then
        mv "$restore_src" "$dst"
        _ok "Restored original: $dst"
      else
        rm -f "$dst"
        _ok "Removed file $dst"
      fi
    fi
  fi
  # Clean up empty parent directories up to dst_base
  local parent
  parent="$(dirname "$dst")"
  while [[ "$parent" != "$dst_base" && "$parent" != "/" && -d "$parent" ]]; do
    if [[ -z "$(ls -A "$parent" 2>/dev/null)" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  %b[dry-run]%b rmdir %s\n' "$DIM" "$RST" "$parent"
      else
        rmdir "$parent" 2>/dev/null || true
      fi
      parent="$(dirname "$parent")"
    else
      break
    fi
  done
}

do_uninstall_glob() {
  local pattern="$1" dst_base="$2"
  if [[ "$pattern" == *"/**" ]]; then
    local rel_dir="${pattern%/**}"
    local dst_dir="$dst_base/$rel_dir"
    if [[ -d "$dst_dir" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  %b[dry-run]%b rm -rf %s\n' "$DIM" "$RST" "$dst_dir"
      else
        rm -rf "$dst_dir"
        _ok "Removed directory tree $dst_dir"
      fi
    fi
  else
    local dir_part glob_part search_dir
    dir_part="$(dirname "$pattern")"
    glob_part="$(basename "$pattern")"
    search_dir="$dst_base/$dir_part"
    if [[ -d "$search_dir" ]]; then
      while IFS= read -r -d '' f; do
        if [[ "$DRY_RUN" -eq 1 ]]; then
          printf '  %b[dry-run]%b rm %s\n' "$DIM" "$RST" "$f"
        else
          rm -f "$f"
          _ok "Removed $f"
        fi
      done < <(find "$search_dir" -maxdepth 1 -name "$glob_part" -type f -print0 2>/dev/null)
      
      # If search_dir is now empty, remove it too
      if [[ -z "$(ls -A "$search_dir" 2>/dev/null)" ]]; then
        if [[ "$DRY_RUN" -eq 1 ]]; then
          printf '  %b[dry-run]%b rmdir %s\n' "$DIM" "$RST" "$search_dir"
        else
          rmdir "$search_dir" 2>/dev/null || true
        fi
      fi
    fi
  fi
}

# ── Config cleanup ────────────────────────────────────────────────────────────
unwire_config() {
  local target_dir="$1"
  local plugins_to_remove=("${!2}")  # array reference
  local has_rules="${3:-0}"
  local has_agents_source="${4:-0}"
  local agents_source_override="${5:-}"

  local cfg_json="$target_dir/opencode.json"
  local cfg_jsonc="$target_dir/opencode.jsonc"
  local cfg=""

  if [[ -f "$cfg_json" ]]; then
    cfg="$cfg_json"
  elif [[ -f "$cfg_jsonc" ]]; then
    cfg="$cfg_jsonc"
  else
    return 0  # No config to unwire
  fi

  # Pass the full relative path (e.g. "plugins/gates/nio.js") straight
  # through, matching install-fleet.sh's merge_config(), which does the
  # same. unmerge-config.mjs's normalizePluginRel() only strips a leading
  # "./" and "plugins/" prefix -- it does NOT collapse subdirectories, so
  # passing basename-only ("nio.js") here would produce "./plugins/nio.js"
  # instead of "./plugins/gates/nio.js", which never matches what
  # merge-config.mjs actually wrote and silently leaves the plugin entry
  # in the array.
  local unwire_args=()
  for p in "${plugins_to_remove[@]}"; do unwire_args+=("$p"); done
  [[ "$has_rules" -eq 1 ]] && unwire_args+=("--rules")
  if [[ "$has_agents_source" -eq 1 && -n "$agents_source_override" && -f "$agents_source_override" ]]; then
    unwire_args+=("--agents-source" "$agents_source_override")
  elif [[ "$has_agents_source" -eq 1 && -f "$FLEET_ROOT/opencode.jsonc" ]]; then
    unwire_args+=("--agents-source" "$FLEET_ROOT/opencode.jsonc")
  fi

  if command -v bun &>/dev/null || command -v node &>/dev/null; then
    local runner="node"
    command -v bun &>/dev/null && runner="bun"

    if [[ "$DRY_RUN" -eq 0 ]]; then
      $runner "$SCRIPT_DIR/unmerge-config.mjs" "$cfg" "${unwire_args[@]}" && _ok "Config cleaned: $cfg" && return
      _warn "unmerge-config.mjs failed; falling back to manual config instructions."
    else
      printf '  %b[dry-run]%b %s unmerge-config.mjs %s %s\n' "$DIM" "$RST" "$runner" "$cfg" "${unwire_args[*]}"
      return
    fi
  fi

  # Fallback manual instructions
  _warn "Bun or Node not found. Remove these manually from $cfg:"
  for p in "${plugins_to_remove[@]}"; do
    printf '    "./%s"\n' "${p#./}"
  done
  if [[ "$has_rules" -eq 1 ]]; then
    printf '    "./rules/*.md"\n'
  fi
  if [[ "$has_agents_source" -eq 1 ]]; then
    _warn "Also remove the 'agent' keys listed in $FLEET_ROOT/opencode.jsonc from $cfg."
  fi
}

# ── Interactive scope selection ───────────────────────────────────────────────
ask_scopes() {
  local -n _result=$1

  _bold "\nSelect scopes to clean up:"
  echo "  [1] global ($GLOBAL_SCOPE)"
  echo "  [2] project ($PROJECT_SCOPE)"
  echo "  [3] custom (you specify)"
  echo "  [s] skip / exit"

  local raw_input=""
  printf '  > (default: s): '
  read -r raw_input
  raw_input="${raw_input:-}"

  if [[ -z "$raw_input" ]]; then
    raw_input="s"
  fi

  _result=()
  for tok in $raw_input; do
    case "$tok" in
      1) _result+=("global") ;;
      2) _result+=("project") ;;
      3)
        local cdir=""
        printf '  Custom absolute path: '
        read -r cdir
        cdir="${cdir/#\~/$HOME}"
        if [[ "$cdir" != /* ]]; then
          _err "Custom path must be absolute: $cdir"
          exit 1
        fi
        _result+=("custom:$cdir")
        ;;
      s|S|skip) ;;
      *) _warn "Unknown selection '$tok': skipped" ;;
    esac
  done
}

# ── Main ──────────────────────────────────────────────────────────────────────
_bold "\nFuraidē's Fleet Uninstaller\n"
if [[ "$DRY_RUN" -eq 1 ]]; then
  _warn "DRY-RUN mode, no files will be deleted"
fi

declare -a selected_scopes=()
if [[ -n "$FORCE_SCOPE" ]]; then
  if [[ "$FORCE_SCOPE" == "custom" ]]; then
    selected_scopes+=("custom:$CUSTOM_DIR")
  else
    selected_scopes+=("$FORCE_SCOPE")
  fi
elif [[ "$PURGE" -eq 1 ]]; then
  # Purge default: clean up both global and project if directories exist
  [[ -d "$GLOBAL_SCOPE" ]] && selected_scopes+=("global")
  [[ -d "$PROJECT_SCOPE" ]] && selected_scopes+=("project")
else
  ask_scopes selected_scopes
fi

if [[ ${#selected_scopes[@]} -eq 0 ]]; then
  _info "No scopes selected. Exiting."
  exit 0
fi

# We'll track target dirs to unwire configs for
declare -A TARGET_PLUGINS
declare -A TARGET_HAS_RULES
declare -A TARGET_HAS_AGENTS
declare -A TARGET_AGENT_SOURCE_OVERRIDE

build_receipt_agent_source() {
  local receipt_path="$1"
  local tmp
  tmp=$(mktemp)
  jq '{agent: (.mergedConfig.agentKeys // [] | reduce .[] as $key ({}; .[$key] = {}))}' "$receipt_path" > "$tmp"
  printf '%s\n' "$tmp"
}

for scope_spec in "${selected_scopes[@]}"; do
  local_custom=""
  scope="$scope_spec"
  if [[ "$scope_spec" == custom:* ]]; then
    scope="custom"
    local_custom="${scope_spec#custom:}"
  fi

  target_dir=$(resolve_scope_dir "$scope" "$local_custom")
  _bold "\nCleaning scope: $target_dir\n"

  receipt_path="$target_dir/.furaide-install-receipt.json"
  use_receipt=0
  RESTORE_ROOT=""
  if [[ -f "$receipt_path" ]]; then
    use_receipt=1
    if jq -e '.mergedConfig.agentKeys | length > 0' "$receipt_path" >/dev/null 2>&1; then
      TARGET_AGENT_SOURCE_OVERRIDE["$target_dir"]="$(build_receipt_agent_source "$receipt_path")"
    fi
    if jq -e '(.backup.root // "") != ""' "$receipt_path" >/dev/null 2>&1; then
      RESTORE_ROOT="$(jq -r '.backup.root' "$receipt_path")"
    fi
  fi

  # Loop components backwards to remove leaf nodes first
  for i in $(seq $((COMPONENT_COUNT - 1)) -1 0); do
    id=$(jq -r ".components[$i].id" "$MANIFEST")
    label=$(jq -r ".components[$i].label" "$MANIFEST")

    if [[ "$use_receipt" -eq 1 ]]; then
      if ! jq -e --arg id "$id" '.selectedComponents | index($id)' "$receipt_path" >/dev/null 2>&1; then
        continue
      fi
    fi
    
    _info "Cleaning component: $label"

    # Pre-uninstall: unmerge package fragment before files removed
    if [[ "$id" == "web-tools" ]]; then
      pkg_fragment="$FLEET_ROOT/config/package.web-tools.json"
      target_pkg="$target_dir/package.json"
      if [[ -f "$pkg_fragment" && ( -f "$target_pkg" || "$DRY_RUN" -eq 1 ) ]]; then
        if [[ "$DRY_RUN" -eq 1 ]]; then
          printf '  %b[dry-run]%b unmerge-package-fragment %s %s\n' "$DIM" "$RST" "$target_pkg" "$pkg_fragment"
        else
          _info "Removing web-tools package entries from $target_pkg"
          bun "$FLEET_ROOT/scripts/unmerge-package-fragment.mjs" "$target_pkg" "$pkg_fragment" || true
        fi
      fi
    fi

    # Files
    mapfile -t files < <(jq -r ".components[$i].files[]" "$MANIFEST")
    for rel in "${files[@]}"; do
      do_uninstall_file "$rel" "$target_dir"
    done

    # Common files (if any)
    if jq -e ".components[$i].common_files" "$MANIFEST" &>/dev/null; then
      mapfile -t common_dsts < <(jq -r ".components[$i].common_files[].dst" "$MANIFEST")
      for dst in "${common_dsts[@]}"; do
        do_uninstall_file "$dst" "$target_dir"
      done
    fi

    # Globs
    mapfile -t globs < <(jq -r ".components[$i].globs[]" "$MANIFEST")
    for g in "${globs[@]}"; do
      do_uninstall_glob "$g" "$target_dir"
    done

    # Track plugins, rules, and agents for unwiring config
    for rel in "${files[@]}"; do
      if [[ "$rel" == plugins/*.js || "$rel" == plugins/*.ts ]]; then
        TARGET_PLUGINS["$target_dir"]+=" $rel"
      fi
    done
    if [[ "$id" == "rules" ]]; then
      TARGET_HAS_RULES["$target_dir"]=1
    fi
    if [[ "$id" == "agents-core" || "$id" == "brand-builder" ]]; then
      TARGET_HAS_AGENTS["$target_dir"]=1
    fi
  done

  # If the backup root is now empty, remove it; leave unmatched backup
  # residue in place otherwise (safety net over cleanliness).
  if [[ -n "${RESTORE_ROOT:-}" && -d "$RESTORE_ROOT" && "$DRY_RUN" -eq 0 ]]; then
    rmdir "$RESTORE_ROOT" 2>/dev/null || true
  fi
done

# ── Config unwiring ───────────────────────────────────────────────────────────
_bold "\nUnwiring configs...\n"
# Union of all target dirs needing config unwire
declare -A UNWIRE_TARGETS
for target_dir in "${!TARGET_PLUGINS[@]}" "${!TARGET_HAS_RULES[@]}" "${!TARGET_HAS_AGENTS[@]}"; do
  UNWIRE_TARGETS["$target_dir"]=1
done
for target_dir in "${!UNWIRE_TARGETS[@]}"; do
  plugins_str="${TARGET_PLUGINS[$target_dir]:-}"
  has_rules="${TARGET_HAS_RULES[$target_dir]:-0}"
  has_agents="${TARGET_HAS_AGENTS[$target_dir]:-0}"
  IFS=' ' read -ra plugins_arr <<< "$plugins_str"
  filtered=()
  for p in "${plugins_arr[@]}"; do
    [[ -n "$p" ]] && filtered+=("$p")
  done
  unwire_config "$target_dir" filtered[@] "$has_rules" "$has_agents" "${TARGET_AGENT_SOURCE_OVERRIDE[$target_dir]:-}"
  receipt_path="$target_dir/.furaide-install-receipt.json"
  if [[ -f "$receipt_path" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '  %b[dry-run]%b rm %s\n' "$DIM" "$RST" "$receipt_path"
    else
      rm -f "$receipt_path"
      _ok "Removed receipt $receipt_path"
    fi
  fi
  if [[ -n "${TARGET_AGENT_SOURCE_OVERRIDE[$target_dir]:-}" ]]; then
    rm -f "${TARGET_AGENT_SOURCE_OVERRIDE[$target_dir]}"
  fi
done

# ── Clean up shared common skills ─────────────────────────────────────────────
clean_shared_skills() {
  local target_dir="$1"
  local agents_skills_dir="$target_dir/skills"
  local claude_skills_dir=""

  if [[ "$target_dir" == "$GLOBAL_SCOPE" ]]; then
    agents_skills_dir="$HOME/.agents/skills"
    claude_skills_dir="$HOME/.claude/skills"
  elif [[ "$target_dir" == "$PROJECT_SCOPE" ]]; then
    agents_skills_dir="$target_dir/.agents/skills"
    claude_skills_dir="$target_dir/.claude/skills"
  fi

  local skills=(bx html-preview brave-search plan github)
  for skill in "${skills[@]}"; do
    do_uninstall_file "$skill" "$agents_skills_dir"
    if [[ -n "$claude_skills_dir" ]]; then
      do_uninstall_file "$skill" "$claude_skills_dir"
    fi
  done
}

if [[ "$INCLUDE_SHARED_SKILLS" -eq 1 ]]; then
  for scope_spec in "${selected_scopes[@]}"; do
    local_custom=""
    scope="$scope_spec"
    [[ "$scope_spec" == custom:* ]] && scope="custom" && local_custom="${scope_spec#custom:}"
    target_dir=$(resolve_scope_dir "$scope" "$local_custom")
    _info "Cleaning up shared common skills from $target_dir"
    clean_shared_skills "$target_dir"
  done
elif [[ "$PURGE" -eq 0 ]]; then
  printf '\nClean up shared common skills (bx, html-preview, brave-search, plan, github)? [y/N] '
  read -r reply </dev/tty || reply="n"
  if [[ "$reply" =~ ^[Yy] ]]; then
    for scope_spec in "${selected_scopes[@]}"; do
      local_custom=""
      scope="$scope_spec"
      [[ "$scope_spec" == custom:* ]] && scope="custom" && local_custom="${scope_spec#custom:}"
      target_dir=$(resolve_scope_dir "$scope" "$local_custom")
      _info "Cleaning up shared common skills from $target_dir"
      clean_shared_skills "$target_dir"
    done
  fi
fi

_ok "\nUninstall complete."
if [[ "$DRY_RUN" -eq 1 ]]; then
  _warn "Dry-run: no files were deleted."
fi
