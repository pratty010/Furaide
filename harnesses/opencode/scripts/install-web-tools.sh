#!/usr/bin/env bash
# install-web-tools.sh: Full standalone web-tools installer
# Usage: bash scripts/install-web-tools.sh <target-opencode-config-dir>
#
# The fleet installer's `web-tools` manifest component already installs
# these same files as part of a normal `install-fleet.sh` run — you don't
# need to run this script for a standard install. It exists for direct /
# manual installs of just the web-tools plugin; standalone runs are still
# covered by `uninstall-fleet.sh --purge` (backups use the same shared
# .kura_backup convention and receipt-aware reuse as install-fleet.sh, and
# the web-tools files are already tracked by that fleet-manifest component).
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

# ── Preflight: required tools ─────────────────────────────────────────────────
for bin in bun jq git; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    case "$bin" in
      bun) url='https://bun.sh' ;;
      jq)  url='https://jqlang.org/download/' ;;
      git) url='https://git-scm.com/downloads' ;;
    esac
    _err "Required tool '$bin' not found on PATH. Install it first: $url"
    exit 1
  fi
done

# Shared backup-root convention (matches install-fleet.sh's ensure_backup_root):
# reuse the backup root recorded in an existing install receipt for this
# target if one is present, so uninstall-fleet.sh's restore logic (which
# reads .backup.root from the receipt) finds these backups too, instead of
# minting a second, disconnected backup root that nothing ever restores from.
INSTALL_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RECEIPT_PATH="$TARGET_DIR/.furaide-install-receipt.json"
BACKUP_ROOT=""
if [[ -f "$RECEIPT_PATH" ]]; then
  BACKUP_ROOT="$(jq -r '.backup.root // empty' "$RECEIPT_PATH" 2>/dev/null || true)"
fi
if [[ -z "$BACKUP_ROOT" ]]; then
  BACKUP_ROOT="$TARGET_DIR/.kura_backup/$INSTALL_TIMESTAMP"
fi

# Backup helper: copy <path> into $BACKUP_ROOT/<relative-path-under-target>
# if it exists, preserving the relative path so uninstall-fleet.sh's
# restore-by-relative-path lookup can find it. Skips the backup if a copy
# already exists at that spot in the (possibly reused) backup root — the
# true original is already preserved there.
# We copy (not move) because the installer often mutates the file in-place
# immediately after; moving first would break the mutator's read path.
backup_existing() {
  local path="$1"
  if [[ -e "$path" ]]; then
    local rel="${path#"$TARGET_DIR"/}"
    local backup_dst="$BACKUP_ROOT/$rel"
    if [[ -e "$backup_dst" ]]; then
      return 0
    fi
    mkdir -p "$(dirname "$backup_dst")"
    cp -P "$path" "$backup_dst"
    _warn "backed up existing $path -> $backup_dst"
  fi
}

mkdir -p "$TARGET_DIR"

# --- 1. Copy plugin entrypoint and module tree ---
_info "Copying plugins/tools/web-tools.ts..."
backup_existing "$TARGET_DIR/plugins/tools/web-tools.ts"
mkdir -p "$TARGET_DIR/plugins/tools"
cp "$FLEET_ROOT/plugins/tools/web-tools.ts" "$TARGET_DIR/plugins/tools/web-tools.ts"

_info "Copying plugins/tools/web-tools/ (provider/tool/util modules)..."
mkdir -p "$TARGET_DIR/plugins/tools/web-tools"
# Copy glob contents; if the source glob is empty this is a no-op.
if compgen -G "$FLEET_ROOT/plugins/tools/web-tools/*" >/dev/null; then
  cp -R "$FLEET_ROOT/plugins/tools/web-tools/." "$TARGET_DIR/plugins/tools/web-tools/"
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
PLUGIN_ENTRY='"./plugins/tools/web-tools.ts"'
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
