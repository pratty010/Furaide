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
#   --link              [stub] Symlink mode (not yet implemented)
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
FORCE_SCOPE=""   # 'global' | 'project' | 'custom'
CUSTOM_DIR=""

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
      _err "--link (symlink mode) is not yet implemented. Use copy mode (default)."
      exit 1
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
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %b[dry-run]%b cp %s -> %s\n' "$DIM" "$RST" "$src" "$dst"
    return
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
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

  # Prefer .json; fall back to .jsonc
  local cfg_json="$target_dir/opencode.json"
  local cfg_jsonc="$target_dir/opencode.jsonc"
  local cfg=""

  if [[ -f "$cfg_json" ]]; then
    cfg="$cfg_json"
  elif [[ -f "$cfg_jsonc" ]]; then
    cfg="$cfg_jsonc"
    _warn ".jsonc detected at $cfg_jsonc. Comment-preserving merge not supported."
    _warn "Append the following to 'plugin' and 'instructions' arrays manually:"
    for p in "${plugins_to_add[@]}"; do
      printf '    %b"./plugins/%s",%b\n' "$YLW" "$(basename "$p")" "$RST"
    done
    if [[ "$has_rules" -eq 1 ]]; then
      printf '    %b"./rules/*.md"%b\n' "$YLW" "$RST"
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
    return
  fi

  # Build jq filter to add plugins (dedup)
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
  jq "$jq_expr" "$cfg" > "$tmp" && mv "$tmp" "$cfg"
  _ok "Config merged: $cfg"
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

    _ok "Done: $label -> $target_dir"
  done
done

# ── Config merge for each target dir ─────────────────────────────────────────
_bold "\nWiring configs...\n"
for target_dir in "${!TARGET_PLUGINS[@]}"; do
  plugins_str="${TARGET_PLUGINS[$target_dir]}"
  has_rules="${TARGET_HAS_RULES[$target_dir]:-0}"
  # Convert space-separated string to array
  IFS=' ' read -ra plugins_arr <<< "$plugins_str"
  # Remove empty entries
  filtered=()
  for p in "${plugins_arr[@]}"; do
    [[ -n "$p" ]] && filtered+=("$p")
  done
  merge_config "$target_dir" filtered[@] "$has_rules"
done

# Also wire configs for dirs that only got rules (no plugins)
for target_dir in "${!TARGET_HAS_RULES[@]}"; do
  if [[ -z "${TARGET_PLUGINS[$target_dir]:-}" ]]; then
    empty_arr=()
    merge_config "$target_dir" empty_arr[@] "1"
  fi
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
