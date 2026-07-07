#!/usr/bin/env bash
# stop.sh - fired on CC Stop hook; triggers a dream pass if cadence allows
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IDISU_HOME="${IDISU_HOME:-$HOME/.idisu}"
CLI_PATH_FILE="${IDISU_HOME}/cli-path"
DEBUG_DIR="${IDISU_HOME}/debug"

mkdir -p "${IDISU_HOME}"
mkdir -p "${DEBUG_DIR}"

if [[ ! -f "${CLI_PATH_FILE}" ]]; then
  "$SCRIPT_DIR/_mark_inactive.sh" "scheduled-dream-missing-cli-path"
  exit 0
fi
CLI_RUNNER="$(cat "${CLI_PATH_FILE}")"
if [[ -z "${CLI_RUNNER}" ]]; then
  "$SCRIPT_DIR/_mark_inactive.sh" "scheduled-dream-empty-cli-path"
  exit 0
fi
if [[ ! -x "${CLI_RUNNER}" ]]; then
  "$SCRIPT_DIR/_mark_inactive.sh" "scheduled-dream-nonexecutable-cli"
  exit 0
fi

(
  if ! "${CLI_RUNNER}" dream --scheduled >>"${DEBUG_DIR}/scheduled-dream.log" 2>&1; then
    "$SCRIPT_DIR/_mark_inactive.sh" "scheduled-dream-run-failed"
  fi
) &
