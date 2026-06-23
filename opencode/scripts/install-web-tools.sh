#!/usr/bin/env bash
# install-web-tools.sh: Verify and install web-tools component
# Usage: bash scripts/install-web-tools.sh <target-dir>
set -euo pipefail

TARGET_DIR="${1:-}"
if [[ -z "$TARGET_DIR" ]]; then
  echo "Usage: $0 <target-dir>" >&2
  echo "Installs web-tools component into an opencode config directory." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RST=$'\033[0m'; GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'
_info()  { printf '%b\n' "${GRN}[info]${RST}  $*"; }
_warn()  { printf '%b\n' "${YLW}[warn]${RST}  $*"; }
_err()   { printf '%b\n' "${RED}[error]${RST} $*" >&2; }

_info "Copying web-tools.yml..."

if [[ -z "${BRAVE_API_KEY:-}" ]]; then
  _warn "BRAVE_API_KEY is not set. Brave web_search will fail at runtime until configured."
fi
if [[ -z "${TAVILY_API_KEY:-}" ]]; then
  _warn "TAVILY_API_KEY is not set. Tavily web_search/fetch_content will fail at runtime until configured."
fi
# Detect Google transport (Vertex AI or AI Studio)
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -n "${GOOGLE_CLOUD_PROJECT:-}" ]]; then
  _info "Vertex AI detected"
  loc="${GOOGLE_CLOUD_LOCATION:-${VERTEX_LOCATION:-global}}"
  _info "Vertex AI location: ${loc}"
elif [[ -n "${GEMINI_API_KEY:-}" || -n "${GOOGLE_API_KEY:-}" ]]; then
  _info "AI Studio key detected"
else
  _warn "Google tools unavailable: set Vertex (GOOGLE_APPLICATION_CREDENTIALS + GOOGLE_CLOUD_PROJECT) or AI Studio (GEMINI_API_KEY / GOOGLE_API_KEY)"
fi
mkdir -p "$TARGET_DIR"
cp "$FLEET_ROOT/config/web-tools.yml" "$TARGET_DIR/web-tools.yml"
_info "web-tools.yml copied."

_info "Copying gemini-tool-fees.yml..."
mkdir -p "$TARGET_DIR/docs/models"
cp "$FLEET_ROOT/docs/models/gemini-tool-fees.yml" "$TARGET_DIR/docs/models/gemini-tool-fees.yml"
_info "gemini-tool-fees.yml copied."

_info "Merging package fragment..."
MERGE_OUT=$(bun "$FLEET_ROOT/scripts/merge-package-fragment.mjs" \
  "$TARGET_DIR/package.json" \
  "$FLEET_ROOT/config/package.web-tools.json" 2>&1)
echo "$MERGE_OUT"

if echo "$MERGE_OUT" | grep -q "CHANGED"; then
  _info "Dependencies changed. Running bun install..."
  (cd "$TARGET_DIR" && bun install 2>&1) || { _err "bun install failed in $TARGET_DIR"; exit 1; }
else
  _info "Dependencies already up to date."
fi

_info "Web Tools installation complete."
