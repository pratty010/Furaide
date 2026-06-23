#!/usr/bin/env bash
# install-web-tools.sh: Full standalone web-tools installer
# Usage: bash scripts/install-web-tools.sh <target-opencode-config-dir>
#
# Copies the plugin, provider/tool modules, slash command, config, and
# pricing supplement into <target>, merges the package fragment into
# <target>/package.json, registers the plugin in <target>/opencode.jsonc
# if not already present, and runs `bun install` when dependencies change.
set -euo pipefail

TARGET_DIR="${1:-}"
if [[ -z "$TARGET_DIR" ]]; then
  echo "Usage: $0 <target-opencode-config-dir>" >&2
  echo "Example: $0 ~/.config/opencode" >&2
  echo "         $0 ./.opencode" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RST=$'\033[0m'; GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'
_info()  { printf '%b\n' "${GRN}[info]${RST}  $*"; }
_warn()  { printf '%b\n' "${YLW}[warn]${RST}  $*"; }
_err()   { printf '%b\n' "${RED}[error]${RST} $*" >&2; }

# Backup helper: copy <path> into <dir>/<basename> if it exists.
# We copy (not move) because the installer often mutates the file in-place
# immediately after; moving first would break the mutator's read path.
backup_existing() {
  local path="$1"
  if [[ -e "$path" ]]; then
    local backup_dir="$TARGET_DIR/kura_backup/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    cp "$path" "$backup_dir/"
    _warn "backed up existing $path -> $backup_dir/"
  fi
}

mkdir -p "$TARGET_DIR"

# --- 1. Copy plugin entrypoint and module tree ---
_info "Copying plugins/web-tools.ts..."
backup_existing "$TARGET_DIR/plugins/web-tools.ts"
mkdir -p "$TARGET_DIR/plugins"
cp "$FLEET_ROOT/plugins/web-tools.ts" "$TARGET_DIR/plugins/web-tools.ts"

_info "Copying plugins/web-tools/ (provider/tool/util modules)..."
mkdir -p "$TARGET_DIR/plugins/web-tools"
# Copy glob contents; if the source glob is empty this is a no-op.
if compgen -G "$FLEET_ROOT/plugins/web-tools/*" >/dev/null; then
  cp -R "$FLEET_ROOT/plugins/web-tools/." "$TARGET_DIR/plugins/web-tools/"
fi

# --- 2. Copy slash command ---
_info "Copying commands/tools-config.md..."
backup_existing "$TARGET_DIR/commands/tools-config.md"
mkdir -p "$TARGET_DIR/commands"
cp "$FLEET_ROOT/commands/tools-config.md" "$TARGET_DIR/commands/tools-config.md"

# --- 3. Copy runtime config and pricing supplement ---
_info "Copying web-tools.yml..."
backup_existing "$TARGET_DIR/web-tools.yml"
cp "$FLEET_ROOT/config/web-tools.yml" "$TARGET_DIR/web-tools.yml"

_info "Copying docs/models/gemini-tool-fees.yml..."
backup_existing "$TARGET_DIR/docs/models/gemini-tool-fees.yml"
mkdir -p "$TARGET_DIR/docs/models"
cp "$FLEET_ROOT/docs/models/gemini-tool-fees.yml" "$TARGET_DIR/docs/models/gemini-tool-fees.yml"

# --- 4. Environment warnings (informational, never fatal) ---
if [[ -z "${BRAVE_API_KEY:-}" ]]; then
  _warn "BRAVE_API_KEY is not set. Brave web_search will fail at runtime until configured."
fi
if [[ -z "${TAVILY_API_KEY:-}" ]]; then
  _warn "TAVILY_API_KEY is not set. Tavily web_search/fetch_content will fail at runtime until configured."
fi
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -n "${GOOGLE_CLOUD_PROJECT:-}" ]]; then
  _info "Vertex AI detected (GOOGLE_APPLICATION_CREDENTIALS + GOOGLE_CLOUD_PROJECT)"
  loc="${GOOGLE_CLOUD_LOCATION:-${VERTEX_LOCATION:-global}}"
  _info "Vertex AI location: ${loc}"
elif [[ -n "${GEMINI_API_KEY:-}" || -n "${GOOGLE_API_KEY:-}" ]]; then
  _info "AI Studio key detected (GEMINI_API_KEY or GOOGLE_API_KEY)"
else
  _warn "Google tools unavailable: set Vertex (GOOGLE_APPLICATION_CREDENTIALS + GOOGLE_CLOUD_PROJECT) or AI Studio (GEMINI_API_KEY / GOOGLE_API_KEY)"
fi

# --- 5. Merge package fragment and run bun install on change ---
_info "Merging package fragment..."
MERGE_OUT=$(bun "$FLEET_ROOT/scripts/merge-package-fragment.mjs" \
  "$TARGET_DIR/package.json" \
  "$FLEET_ROOT/config/package.web-tools.json" 2>&1) || {
    _err "package fragment merge failed"
    echo "$MERGE_OUT"
    exit 1
  }
echo "$MERGE_OUT"

if echo "$MERGE_OUT" | grep -q "CHANGED"; then
  _info "Dependencies changed. Running bun install..."
  (cd "$TARGET_DIR" && bun install 2>&1) || { _err "bun install failed in $TARGET_DIR"; exit 1; }
else
  _info "Dependencies already up to date."
fi

# --- 6. Register plugin in opencode.jsonc (create if missing) ---
PLUGIN_ENTRY='"./plugins/web-tools.ts"'
OPENCODE_JSON="$TARGET_DIR/opencode.jsonc"
if [[ ! -e "$OPENCODE_JSON" ]]; then
  _warn "$OPENCODE_JSON not found. Skipping plugin registration."
  _warn "Create $OPENCODE_JSON with \"plugin\": [$PLUGIN_ENTRY] and \"instructions\": [\"./rules/*.md\"] before running OpenCode."
else
  if grep -F "$PLUGIN_ENTRY" "$OPENCODE_JSON" >/dev/null 2>&1; then
    _info "Plugin already registered in $OPENCODE_JSON"
  else
    _info "Registering plugin in $OPENCODE_JSON"
    backup_existing "$OPENCODE_JSON"
    # Use node to safely mutate JSONC: strip line comments, parse, mutate, write back.
    # This preserves the original key order and formatting style for non-comment lines.
    node "$FLEET_ROOT/scripts/register-web-tools-plugin.mjs" "$OPENCODE_JSON" "$PLUGIN_ENTRY" \
      || { _err "Failed to register plugin in $OPENCODE_JSON"; exit 1; }
    _info "Registered $PLUGIN_ENTRY in $OPENCODE_JSON"
  fi
fi

_info "Web Tools installation complete."
_info "Next: restart OpenCode in $TARGET_DIR and run /tools-config to verify."
