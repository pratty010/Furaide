#!/usr/bin/env bash
# stop.sh - fired on CC Stop hook; triggers a dream pass if cadence allows
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SATORI_HOME="${SATORI_HOME:-$HOME/.satori}"
CLI_PATH_FILE="${SATORI_HOME}/cli-path"
DEBUG_DIR="${SATORI_HOME}/debug"

mkdir -p "${SATORI_HOME}"
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
