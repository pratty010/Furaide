#!/usr/bin/env bash
# install-fleet.sh: Furaidē's Fleet modular, scope-aware installer
# Usage: bash scripts/install-fleet.sh [OPTIONS]
#
# Options:
#   --list              Print all components and exit (no install)
#   --dry-run           Show planned actions without writing files
#   --all               Install all components (uses --global/--project/--custom scope)
#   --global            Pre-select global scope (~/.config/opencode/) for all components
#   --project           Pre-select project scope (./.opencode/) for all components
#   --custom <dir>      Pre-select a custom absolute directory for all components
#   --link              Symlink mode: ln -sfn instead of cp (keep repo as source; no substitution)
#   --no-common-skills  Skip shared skills prompt (B6)
#   -y, --yes           Auto-confirm model mapping changes (non-interactive safe)
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
MANIFEST="$FLEET_ROOT/fleet-manifest.json"

GLOBAL_SCOPE="$HOME/.config/opencode"
PROJECT_SCOPE="$(pwd)/.opencode"

# ── Flags ────────────────────────────────────────────────────────────────────
DRY_RUN=0
LIST_ONLY=0
INSTALL_ALL=0
LINK_MODE=0
FORCE_SCOPE=""   # 'global' | 'project' | 'custom'
CUSTOM_DIR=""
NO_COMMON_SKILLS=0
AUTO_CONFIRM=0
INSTALL_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)           LIST_ONLY=1 ;;
    --dry-run)        DRY_RUN=1 ;;
    --all)            INSTALL_ALL=1 ;;
    --global)         FORCE_SCOPE="global" ;;
    --project)        FORCE_SCOPE="project" ;;
    --custom)
      FORCE_SCOPE="custom"
      shift
      CUSTOM_DIR="${1:-}"
      if [[ -z "$CUSTOM_DIR" || "$CUSTOM_DIR" == --* ]]; then
        _err "--custom requires an absolute path argument"
        exit 1
      fi
      ;;
    --link)
      LINK_MODE=1
      ;;
    --no-common-skills)
      NO_COMMON_SKILLS=1
      ;;
    -y|--yes)
      AUTO_CONFIRM=1
      ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      _err "Unknown flag: $1"
      exit 1
      ;;
  esac
  shift
done

# ── Dependency checks ─────────────────────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  _err "jq is required. Install via: sudo apt install jq  (or brew install jq)"
  exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
  _err "Manifest not found: $MANIFEST"
  exit 1
fi

if ! command -v bun &>/dev/null; then
  _err "bun is required for model resolution. Install via: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# ── Model resolution ───────────────────────────────────────────────────────────
MODEL_RESOLVER="$FLEET_ROOT/scripts/model-resolve.mjs"
if [[ ! -f "$MODEL_RESOLVER" ]]; then
  _err "Model resolver not found: $MODEL_RESOLVER"
  exit 1
fi

_info "Resolving model mappings..."
RESOLVER_OUTPUT=$(bun "$MODEL_RESOLVER")
if [[ $? -ne 0 ]]; then
  _err "Model resolver failed"
  exit 1
fi

ALL_AVAILABLE=$(echo "$RESOLVER_OUTPUT" | jq -r '.allAvailable')
CHANGES_JSON=$(echo "$RESOLVER_OUTPUT" | jq -c '.changes')
MODEL_MAP_JSON=$(echo "$RESOLVER_OUTPUT" | jq -c '.modelMap')
RESOLVED_ROUTING_JSON=$(echo "$RESOLVER_OUTPUT" | jq -c '.resolvedManifest')

# Check if resolver produced valid output
if [[ "$ALL_AVAILABLE" == "null" || "$MODEL_MAP_JSON" == "null" || "$RESOLVED_ROUTING_JSON" == "null" ]]; then
  _err "Model resolver produced invalid output"
  exit 1
fi

# Show model change summary and confirm if changes
CHANGE_COUNT=$(echo "$CHANGES_JSON" | jq 'length')
if [[ "$CHANGE_COUNT" -gt 0 ]]; then
  _bold "\nModel Mapping Changes Required:"
  echo "$RESOLVER_OUTPUT" | jq -r '.changes[] | "  \(.agent).\(.field): \(.from) -> \(.to // "none") (\(.reason))"'
  if [[ "$AUTO_CONFIRM" -eq 1 ]]; then
    _info "Auto-confirming model mappings (--yes flag)."
  elif [[ -t 0 ]]; then
    printf '\nApply these model mappings? [Y/n] '
    read -r confirm
    confirm="${confirm:-Y}"
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      _info "Install cancelled by user."
      exit 0
    fi
  else
    _err "Model mapping changes required but running in non-interactive mode."
    _err "Re-run with --yes to auto-confirm, or run interactively."
    exit 1
  fi
  _ok "Model mappings confirmed."
else
  _ok "All desired models available. No changes needed."
fi

# ── Load manifest ─────────────────────────────────────────────────────────────
COMPONENT_COUNT=$(jq '.components | length' "$MANIFEST")

# ── --list mode ───────────────────────────────────────────────────────────────
if [[ "$LIST_ONLY" -eq 1 ]]; then
  _bold "\nFuraidē's Fleet : Component Catalog\n"
  printf '%-4s %-22s %-8s %-8s %-8s %s\n' '#' 'Label' 'Atomic' 'Bun?' 'Default' 'Description'
  printf '%-4s %-22s %-8s %-8s %-8s %s\n' '---' '---------------------' '------' '-----' '-------' '-----------'
  for i in $(seq 0 $((COMPONENT_COUNT - 1))); do
    label=$(jq -r ".components[$i].label" "$MANIFEST")
    atomic=$(jq -r ".components[$i].atomic" "$MANIFEST")
    bun=$(jq -r ".components[$i].requires_bun" "$MANIFEST")
    def=$(jq -r ".components[$i].default_on" "$MANIFEST")
    desc=$(jq -r ".components[$i].description" "$MANIFEST")
    coupling=$(jq -r ".components[$i].coupling" "$MANIFEST")
    file_count=$(jq ".components[$i].files | length" "$MANIFEST")
    glob_count=$(jq ".components[$i].globs | length" "$MANIFEST")
    printf '%-4s %-22s %-8s %-8s %-8s %s\n' \
      "$((i+1))." "$label" "$atomic" "$bun" "$def" "$desc"
    printf '     %s%-22s%s Coupling: %s  Files: %d  Globs: %d\n' \
      "$DIM" '' "$RST" "$coupling" "$file_count" "$glob_count"
  done
  echo ""
  exit 0
fi

# ── Scope resolution ──────────────────────────────────────────────────────────
resolve_scope_dir() {
  local scope="$1" custom="${2:-}"
  case "$scope" in
    global)  echo "$GLOBAL_SCOPE" ;;
    project) echo "$PROJECT_SCOPE" ;;
    custom)  echo "$custom" ;;
  esac
}

# ── Conflict detection ────────────────────────────────────────────────────────
# Stores: component_id -> array of resolved absolute paths
declare -A COMP_TARGETS   # id -> space-separated absolute dirs
declare -A TARGET_COMPONENTS
declare -A TARGET_INSTALLED_FILES
declare -A TARGET_BACKUP_ROOTS
declare -A TARGET_BACKUP_CREATED

ACTIVE_TARGET_DIR=""
ACTIVE_COMPONENT_ID=""

ensure_backup_root() {
  local target_dir="$1"
  local root="${TARGET_BACKUP_ROOTS[$target_dir]:-}"
  if [[ -n "$root" ]]; then
    printf '%s\n' "$root"
    return
  fi
  root="$target_dir/kura_backup/$INSTALL_TIMESTAMP"
  TARGET_BACKUP_ROOTS["$target_dir"]="$root"
  printf '%s\n' "$root"
}

record_installed_file() {
  local dst="$1"
  [[ -n "$ACTIVE_TARGET_DIR" ]] || return 0
  case "$dst" in
    "$ACTIVE_TARGET_DIR"/*)
      local rel="${dst#"$ACTIVE_TARGET_DIR"/}"
      TARGET_INSTALLED_FILES["$ACTIVE_TARGET_DIR"]+="$rel"$'\n'
      ;;
  esac
}

backup_existing_file() {
  local dst="$1"
  [[ -e "$dst" || -L "$dst" ]] || return 0
  [[ -n "$ACTIVE_TARGET_DIR" ]] || return 0

  local root rel backup_path
  root="$(ensure_backup_root "$ACTIVE_TARGET_DIR")"
  case "$dst" in
    "$ACTIVE_TARGET_DIR"/*) rel="${dst#"$ACTIVE_TARGET_DIR"/}" ;;
    *) return 0 ;;
  esac
  backup_path="$root/$rel"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %b[dry-run]%b Backup would be created: %s -> %s\n' "$DIM" "$RST" "$dst" "$backup_path"
    TARGET_BACKUP_CREATED["$ACTIVE_TARGET_DIR"]=1
    return 0
  fi

  if [[ -e "$backup_path" || -L "$backup_path" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "$backup_path")"
  cp -P "$dst" "$backup_path"
  TARGET_BACKUP_CREATED["$ACTIVE_TARGET_DIR"]=1
  _warn "Backup created: $backup_path"
}

detect_conflict() {
  local id="$1" dir="$2"
  local existing="${COMP_TARGETS[$id]:-}"
  for d in $existing; do
    if [[ "$(realpath -m "$d" 2>/dev/null || echo "$d")" == "$(realpath -m "$dir" 2>/dev/null || echo "$dir")" ]]; then
      _err "Conflict: component '$id' selects the same directory twice: $dir"
      exit 1
    fi
  done
  COMP_TARGETS["$id"]="${existing:+$existing }$dir"
}

# ── File operations ───────────────────────────────────────────────────────────
do_copy() {
  local src="$1" dst="$2"
  backup_existing_file "$dst"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    local verb="cp"; [[ "$LINK_MODE" -eq 1 ]] && verb="ln -sfn"
    printf '  %b[dry-run]%b %s %s -> %s\n' "$DIM" "$RST" "$verb" "$src" "$dst"
    record_installed_file "$dst"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ "$LINK_MODE" -eq 1 ]]; then
    ln -sfn "$src" "$dst"
  else
    cp "$src" "$dst"
  fi
  record_installed_file "$dst"
}

do_copy_glob() {
  local pattern="$1" src_base="$2" dst_base="$3"
  # Two forms in the manifest:
  #   dir/**     - recursive copy of an entire directory tree
  #   dir/*.ext  - flat glob within one directory
  if [[ "$pattern" == *"/**" ]]; then
    local src_dir="$src_base/${pattern%/**}"
    [[ -d "$src_dir" ]] || return 0
    while IFS= read -r -d '' f; do
      local rel="${f#$src_base/}"
      do_copy "$f" "$dst_base/$rel"
    done < <(find "$src_dir" -type f -print0 2>/dev/null)
  else
    local dir_part glob_part src_dir
    dir_part="$(dirname "$pattern")"
    glob_part="$(basename "$pattern")"
    src_dir="$src_base/$dir_part"
    [[ -d "$src_dir" ]] || return 0
    while IFS= read -r -d '' f; do
      local rel="${f#$src_base/}"
      do_copy "$f" "$dst_base/$rel"
    done < <(find "$src_dir" -maxdepth 1 -name "$glob_part" -type f -print0 2>/dev/null)
  fi
}

substitute_fleet_root() {
  local file="$1" root="$2"
  # Skip substitution in link mode — plugins self-locate via _SELF_ROOT = resolve(dirname, '..')
  [[ "$LINK_MODE" -eq 1 ]] && return 0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %b[dry-run]%b substitute __FLEET_ROOT__ -> %s in %s\n' "$DIM" "$RST" "$root" "$file"
    return
  fi
  if grep -q '__FLEET_ROOT__' "$file" 2>/dev/null; then
    sed -i "s|__FLEET_ROOT__|$root|g" "$file"
  fi
}

# ── Config merge ──────────────────────────────────────────────────────────────
merge_config() {
  local target_dir="$1"
  local plugins_to_add=("${!2}")  # nameref array
  local has_rules="${3:-0}"
  local has_agents_source="${4:-0}"  # 1 if agents-core was installed at this target
  local resolved_model_map_json="${5:-}"  # JSON string of resolved model map

  # Prefer .json; fall back to .jsonc
  local cfg_json="$target_dir/opencode.json"
  local cfg_jsonc="$target_dir/opencode.jsonc"
  local cfg=""

  if [[ -f "$cfg_json" ]]; then
    cfg="$cfg_json"
  elif [[ -f "$cfg_jsonc" ]]; then
    cfg="$cfg_jsonc"
    # Use merge-config.mjs for .jsonc (strips line comments, modifies, writes back)
    if command -v bun &>/dev/null; then
      local mjs_args=()
      for p in "${plugins_to_add[@]}"; do mjs_args+=("$(basename "$p")"); done
      [[ "$has_rules" -eq 1 ]] && mjs_args+=("--rules")
      if [[ "$has_agents_source" -eq 1 && -n "$resolved_model_map_json" ]]; then
        mjs_args+=("--agents-json" "$resolved_model_map_json")
      fi
      if [[ "$DRY_RUN" -eq 0 ]]; then
        bun "$FLEET_ROOT/scripts/merge-config.mjs" "$cfg" "${mjs_args[@]}" && _ok "Config merged (jsonc): $cfg" && return
        _warn "merge-config.mjs failed; falling back to manual instructions."
      else
        printf '  %b[dry-run]%b bun merge-config.mjs %s %s\n' "$DIM" "$RST" "$cfg" "${mjs_args[*]}"
        return
      fi
    fi
    # bun not available — print manual instructions
    _warn ".jsonc detected — bun not found. Append manually to $cfg_jsonc:"
    for p in "${plugins_to_add[@]}"; do
      printf '    %b"./plugins/%s",%b\n' "$YLW" "$(basename "$p")" "$RST"
    done
    if [[ "$has_rules" -eq 1 ]]; then
      printf '    %b"./rules/*.md"%b\n' "$YLW" "$RST"
    fi
    if [[ "$has_agents_source" -eq 1 ]]; then
      _warn "Also merge agent model mappings from resolved model map into $cfg."
    fi
    return
  else
    cfg="$cfg_json"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      mkdir -p "$target_dir"
      echo '{"plugin":[],"instructions":[]}' > "$cfg"
    fi
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %b[dry-run]%b config merge into %s\n' "$DIM" "$RST" "${cfg:-$cfg_json}"
    for p in "${plugins_to_add[@]}"; do
      printf '    add plugin: ./plugins/%s\n' "$(basename "$p")"
    done
    if [[ "$has_rules" -eq 1 ]]; then
      printf '    add instructions: ./rules/*.md\n'
    fi
    if [[ "$has_agents_source" -eq 1 ]]; then
      printf '    add agent model mappings from resolved model map\n'
    fi
    return
  fi

  # Build jq filter to add plugins (dedup) and (optionally) agent model mappings
  local jq_expr='. '
  for p in "${plugins_to_add[@]}"; do
    local rel="./plugins/$(basename "$p")"
    jq_expr+="| if (.plugin // []) | map(. == \"$rel\") | any then . else .plugin += [\"$rel\"] end "
  done
  if [[ "$has_rules" -eq 1 ]]; then
    jq_expr+='| if (.instructions // []) | map(. == "./rules/*.md") | any then . else .instructions += ["./rules/*.md"] end'
  fi

  local tmp
  tmp=$(mktemp)
  backup_existing_file "$cfg"
  if [[ "$has_agents_source" -eq 1 && -n "$resolved_model_map_json" ]]; then
    # Merge each agent from the resolved model map into the target's agent key.
    # Fleet entries win on conflict (.agent = target + fleet, jq object-merge
    # right-side wins), so model upgrades land and user agents not in the
    # source fleet are preserved.
    local fleet_agents_tmp
    fleet_agents_tmp=$(mktemp)
    echo "$resolved_model_map_json" | jq 'with_entries(.value = { model: .value }) | {agent: .}' > "$fleet_agents_tmp"
    jq --slurpfile fleet_agents "$fleet_agents_tmp" \
      "$jq_expr | .agent = (.agent // {}) + \$fleet_agents[0].agent" \
      "$cfg" > "$tmp" && mv "$tmp" "$cfg"
    rm -f "$fleet_agents_tmp"
  else
    jq "$jq_expr" "$cfg" > "$tmp" && mv "$tmp" "$cfg"
  fi
  _ok "Config merged: $cfg"
}

write_install_receipt() {
  local target_dir="$1"
  local receipt_path="$target_dir/.furaide-install-receipt.json"
  local components_raw="${TARGET_COMPONENTS[$target_dir]:-}"
  local files_raw="${TARGET_INSTALLED_FILES[$target_dir]:-}"
  local plugins_raw="${TARGET_PLUGINS[$target_dir]:-}"
  local has_rules="${TARGET_HAS_RULES[$target_dir]:-0}"
  local has_agents="${TARGET_HAS_AGENTS[$target_dir]:-0}"
  local backup_root="${TARGET_BACKUP_ROOTS[$target_dir]:-}"
  local backup_created="${TARGET_BACKUP_CREATED[$target_dir]:-0}"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %b[dry-run]%b write install receipt -> %s\n' "$DIM" "$RST" "$receipt_path"
    return
  fi

  local tmp receipt_plugins_json receipt_agent_keys_json receipt_components_json receipt_files_json
  tmp=$(mktemp)
  receipt_components_json=$(printf '%s' "$components_raw" | awk 'NF' | sort -u | jq -R . | jq -s .)
  receipt_files_json=$(printf '%s' "$files_raw" | awk 'NF' | sort -u | jq -R . | jq -s .)
  receipt_plugins_json=$(printf '%s' "$plugins_raw" | tr ' ' '\n' | awk 'NF' | sed 's|.*/||' | sed 's|^|./plugins/|' | sort -u | jq -R . | jq -s .)
  if [[ "$has_agents" -eq 1 ]]; then
    receipt_agent_keys_json=$(echo "$MODEL_MAP_JSON" | jq 'keys')
  else
    receipt_agent_keys_json='[]'
  fi

  jq -n \
    --arg timestamp "$INSTALL_TIMESTAMP" \
    --arg sourceRoot "$FLEET_ROOT" \
    --arg targetDir "$target_dir" \
    --arg backupRoot "$backup_root" \
    --argjson backupCreated "$backup_created" \
    --argjson selectedComponents "$receipt_components_json" \
    --argjson installedFiles "$receipt_files_json" \
    --argjson mergedPlugins "$receipt_plugins_json" \
    --argjson mergedRules "$([[ "$has_rules" -eq 1 ]] && printf 'true' || printf 'false')" \
    --argjson agentKeys "$receipt_agent_keys_json" \
    --argjson modelMapSummary "$MODEL_MAP_JSON" \
    '{
      timestamp: $timestamp,
      sourceRoot: $sourceRoot,
      targetDir: $targetDir,
      selectedComponents: $selectedComponents,
      installedFiles: $installedFiles,
      mergedConfig: {
        plugins: $mergedPlugins,
        rules: $mergedRules,
        agentKeys: $agentKeys
      },
      backup: {
        created: $backupCreated,
        root: (if $backupRoot == "" then null else $backupRoot end)
      },
      modelMapSummary: $modelMapSummary
    }' > "$tmp"
  mv "$tmp" "$receipt_path"
  _ok "Install receipt written: $receipt_path"
}

# ── Write resolved routing manifest ────────────────────────────────────────────
write_resolved_routing() {
  local target_dir="$1"
  local resolved_routing_json="$2"
  local dst="$target_dir/docs/routing-manifest.json"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %b[dry-run]%b write resolved routing-manifest.json -> %s\n' "$DIM" "$RST" "$dst"
    return
  fi

  mkdir -p "$(dirname "$dst")"
  echo "$resolved_routing_json" | jq '.' > "$dst"
  _ok "Resolved routing manifest written: $dst"
}

# ── Interactive scope selection ───────────────────────────────────────────────
ask_scope() {
  local label="$1" id="$2" default_on="$3"
  local -n _result=$4  # nameref for return value (array of scope strings)

  printf '\n%b%s%b\n' "$BOLD" "$label" "$RST"

  if [[ -n "$FORCE_SCOPE" && "$INSTALL_ALL" -eq 1 ]]; then
    if [[ "$default_on" == "false" && "$id" == "brand-builder" ]]; then
      _warn "$label is opt-in and was skipped (use --all without --project/--global to be prompted)"
      _result=()
      return
    fi
    _result=("$FORCE_SCOPE")
    _info "Auto-selected scope: $FORCE_SCOPE"
    return
  fi

  echo "  Scopes (space-separated numbers, or 's' to skip):"
  echo "  [1] global ($GLOBAL_SCOPE)"
  echo "  [2] project ($PROJECT_SCOPE)"
  echo "  [3] custom (you specify)"
  echo "  [s] skip"

  local default_hint=""
  if [[ "$default_on" == "true" ]]; then
    default_hint=" (default: 1)"
  else
    default_hint=" (default: s, opt-in only)"
  fi

  local raw_input=""
  printf '  > %s' "$default_hint"
  read -r raw_input
  raw_input="${raw_input:-}"

  if [[ -z "$raw_input" ]]; then
    if [[ "$default_on" == "true" ]]; then
      raw_input="1"
    else
      raw_input="s"
    fi
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

# ── Main install loop ─────────────────────────────────────────────────────────
_bold "\nFuraidē's Fleet Installer\n"
if [[ "$DRY_RUN" -eq 1 ]]; then
  _warn "DRY-RUN mode, no files will be written"
fi

# Tracks which plugins go to which target dir, for config merge
declare -A TARGET_PLUGINS   # target_dir -> space-separated plugin basenames
declare -A TARGET_HAS_RULES # target_dir -> 1 if rules selected
declare -A TARGET_HAS_AGENTS # target_dir -> 1 if agents-core or brand-builder selected

for i in $(seq 0 $((COMPONENT_COUNT - 1))); do
  id=$(jq -r       ".components[$i].id"           "$MANIFEST")
  label=$(jq -r    ".components[$i].label"         "$MANIFEST")
  desc=$(jq -r     ".components[$i].description"   "$MANIFEST")
  atomic=$(jq -r   ".components[$i].atomic"        "$MANIFEST")
  coupling=$(jq -r ".components[$i].coupling"      "$MANIFEST")
  requires_bun=$(jq -r ".components[$i].requires_bun" "$MANIFEST")
  default_on=$(jq -r   ".components[$i].default_on"   "$MANIFEST")
  file_count=$(jq  ".components[$i].files | length"   "$MANIFEST")
  glob_count=$(jq  ".components[$i].globs | length"   "$MANIFEST")

  printf '\n%b[%d/%d]%b %b%s%b\n' "$CYN" "$((i+1))" "$COMPONENT_COUNT" "$RST" "$BOLD" "$label" "$RST"
  printf '  %s\n' "$desc"
  if [[ "$atomic" == "true" ]]; then
    printf '  %bAtomic bundle, coupling: %s%b\n' "$YLW" "$coupling" "$RST"
  fi
  if [[ "$requires_bun" == "true" ]]; then
    printf '  %bRequires: bun install after copy%b\n' "$MAG" "$RST"
  fi
  printf '  Files: %d  Globs: %d  Default: %s\n' "$file_count" "$glob_count" "$default_on"

  declare -a selected_scopes=()
  ask_scope "$label" "$id" "$default_on" selected_scopes

  if [[ ${#selected_scopes[@]} -eq 0 ]]; then
    _info "Skipped: $label"
    continue
  fi

  for scope_spec in "${selected_scopes[@]}"; do
    local_custom=""
    scope="$scope_spec"
    if [[ "$scope_spec" == custom:* ]]; then
      scope="custom"
      local_custom="${scope_spec#custom:}"
    fi

    if [[ "$scope" == "custom" && -z "$local_custom" && -n "$CUSTOM_DIR" ]]; then
      local_custom="$CUSTOM_DIR"
    fi

    target_dir=$(resolve_scope_dir "$scope" "$local_custom")
    detect_conflict "$id" "$target_dir"
    TARGET_COMPONENTS["$target_dir"]+="$id"$'\n'
    ACTIVE_TARGET_DIR="$target_dir"
    ACTIVE_COMPONENT_ID="$id"

    _info "Installing $label -> $target_dir"

    # Copy files
    mapfile -t files < <(jq -r ".components[$i].files[]" "$MANIFEST")
    for rel in "${files[@]}"; do
      src="$FLEET_ROOT/$rel"
      dst="$target_dir/$rel"
      if [[ -f "$src" ]]; then
        do_copy "$src" "$dst"
      else
        _warn "Source not found (skip): $src"
      fi
    done

    # Copy globs
    mapfile -t globs < <(jq -r ".components[$i].globs[]" "$MANIFEST")
    for g in "${globs[@]}"; do
      do_copy_glob "$g" "$FLEET_ROOT" "$target_dir" ""
    done

    # Substitute __FLEET_ROOT__ in installed plugins
    if [[ "$DRY_RUN" -eq 0 ]]; then
      for rel in "${files[@]}"; do
        if [[ "$rel" == plugins/*.js ]]; then
          installed="$target_dir/$rel"
          [[ -f "$installed" ]] && substitute_fleet_root "$installed" "$target_dir"
        fi
      done
    else
      for rel in "${files[@]}"; do
        if [[ "$rel" == plugins/*.js ]]; then
          printf '  %b[dry-run]%b substitute __FLEET_ROOT__ -> %s in %s\n' "$DIM" "$RST" "$target_dir" "$target_dir/$rel"
        fi
      done
    fi

    # Track plugins and rules for config merge
    for rel in "${files[@]}"; do
      if [[ "$rel" == plugins/*.js ]]; then
        TARGET_PLUGINS["$target_dir"]+=" $rel"
      fi
    done
    if [[ "$id" == "rules" ]]; then
      TARGET_HAS_RULES["$target_dir"]=1
    fi
    # agents-core and brand-builder both contribute fleet agent files;
    # their model mappings come from $FLEET_ROOT/opencode.jsonc.
    if [[ "$id" == "agents-core" || "$id" == "brand-builder" ]]; then
      TARGET_HAS_AGENTS["$target_dir"]=1
    fi

    _ok "Done: $label -> $target_dir"
  done
done

# ── Package fragment merge ─────────────────────────────────────────────────────
web_tools_targets="${COMP_TARGETS[web-tools]:-}"
if [[ -n "$web_tools_targets" ]]; then
  _info "Verifying web-tools CLI dependencies..."
  if ! command -v bx &>/dev/null; then
    _err "bx CLI is required for web-tools. Install from: https://opencode.ai/docs/bx"
    exit 1
  fi
  if ! command -v tvly &>/dev/null; then
    _err "tvly CLI is required for web-tools. Install from: https://tavily.com"
    exit 1
  fi
  _ok "bx and tvly CLI verified."
  for target_dir in $web_tools_targets; do
    pkg_fragment="$FLEET_ROOT/config/package.web-tools.json"
    target_pkg="$target_dir/package.json"
    if [[ -f "$pkg_fragment" ]]; then
      _info "Merging web-tools package fragment into $target_pkg"
      if [[ "$DRY_RUN" -eq 1 ]]; then
        printf '  %b[dry-run]%b merge-package-fragment %s %s\n' "$DIM" "$RST" "$target_pkg" "$pkg_fragment"
      else
        merge_out=$(bun "$FLEET_ROOT/scripts/merge-package-fragment.mjs" "$target_pkg" "$pkg_fragment" 2>&1)
        echo "$merge_out"
        if echo "$merge_out" | grep -q "CHANGED"; then
          _info "Web Tools dependencies changed. Running bun install..."
          (cd "$target_dir" && bun install 2>&1) && _ok "bun install for web-tools complete" || _warn "bun install failed (may need manual install)"
        fi
      fi
    fi
  done
fi

# ── Config merge for each target dir ─────────────────────────────────────────
_bold "\nWiring configs...\n"
# Build the union of all target dirs that need config wiring
declare -A WIRED_TARGETS
for target_dir in "${!TARGET_PLUGINS[@]}" "${!TARGET_HAS_RULES[@]}" "${!TARGET_HAS_AGENTS[@]}"; do
  WIRED_TARGETS["$target_dir"]=1
done
for target_dir in "${!WIRED_TARGETS[@]}"; do
  plugins_str="${TARGET_PLUGINS[$target_dir]:-}"
  has_rules="${TARGET_HAS_RULES[$target_dir]:-0}"
  has_agents="${TARGET_HAS_AGENTS[$target_dir]:-0}"
  # Convert space-separated string to array
  IFS=' ' read -ra plugins_arr <<< "$plugins_str"
  # Remove empty entries
  filtered=()
  for p in "${plugins_arr[@]}"; do
    [[ -n "$p" ]] && filtered+=("$p")
  done
  merge_config "$target_dir" filtered[@] "$has_rules" "$has_agents" "$MODEL_MAP_JSON"
  # Write resolved routing manifest to targets that have failover component
  write_resolved_routing "$target_dir" "$RESOLVED_ROUTING_JSON"
  write_install_receipt "$target_dir"
done

# ── Post-install notes ────────────────────────────────────────────────────────
_bold "\nPost-install notes:\n"

brand_targets="${COMP_TARGETS[brand-builder]:-}"
if [[ -n "$brand_targets" ]]; then
  for target_dir in $brand_targets; do
    _warn "Brand Builder requires bun install:"
    printf '    cd %s/brand-builder-plugin && bun install\n' "$target_dir"
  done
fi

custom_targets=""
for id in "${!COMP_TARGETS[@]}"; do
  targets="${COMP_TARGETS[$id]}"
  for t in $targets; do
    if [[ "$t" != "$GLOBAL_SCOPE" && "$t" != "$PROJECT_SCOPE" ]]; then
      custom_targets+=" $t"
    fi
  done
done
if [[ -n "$custom_targets" ]]; then
  echo "  Custom scope directories require OPENCODE_CONFIG_DIR:"
  for t in $(echo "$custom_targets" | tr ' ' '\n' | sort -u); do
    [[ -n "$t" ]] && printf '    export OPENCODE_CONFIG_DIR=%s\n' "$t"
  done
fi

_ok "\nInstall complete."
if [[ "$DRY_RUN" -eq 1 ]]; then
  _warn "Dry-run: no files were written."
fi

# ── Common skills (B6) ────────────────────────────────────────────────────────
if [[ "$NO_COMMON_SKILLS" -eq 0 ]]; then
  COMMON_DIR="$(cd "$FLEET_ROOT/../common" 2>/dev/null && pwd)" || COMMON_DIR=""
  if [[ -n "$COMMON_DIR" && -f "$COMMON_DIR/install-common.sh" ]]; then
    printf '\n'
    _bold "Shared skills (bx, html-preview, brave-search, plan)"
    if [[ -t 0 ]]; then
      printf 'Install to [g]lobal ~/.agents/skills, [p]roject, or [s]kip? [g/p/s] '
      read -r _skill_scope
      _skill_scope="${_skill_scope:-s}"
    else
      _info "Non-interactive mode: skipping shared skills prompt (use --no-common-skills to suppress)."
      _skill_scope="s"
    fi
    case "$_skill_scope" in
      g|G)
        if [[ "$DRY_RUN" -eq 0 ]]; then bash "$COMMON_DIR/install-common.sh" --global
        else printf '  [dry-run] bash common/install-common.sh --global\n'; fi ;;
      p|P)
        if [[ "$DRY_RUN" -eq 0 ]]; then bash "$COMMON_DIR/install-common.sh" --project "$PWD"
        else printf '  [dry-run] bash common/install-common.sh --project %s\n' "$PWD"; fi ;;
      *) _info "Common skills skipped." ;;
    esac
    if [[ -t 0 ]]; then
      printf 'Install other opencode skills from manifest (superpowers, tavily-*, …)? [y/N] '
      read -r _extra_skills
      _extra_skills="${_extra_skills:-n}"
    else
      _extra_skills="n"
    fi
    if [[ "$_extra_skills" =~ ^[Yy] && "$DRY_RUN" -eq 0 ]]; then
      bash "$COMMON_DIR/install-skills.sh" --ecosystem opencode
    fi
  fi
fi
