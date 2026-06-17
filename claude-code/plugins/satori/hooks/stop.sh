#!/usr/bin/env bash
# stop.sh - fired on CC Stop hook; triggers a dream pass if cadence allows

SATORI_HOME="${HOME}/.satori"
DREAM_LOCK="${SATORI_HOME}/.dream.lock"
LAST_DREAM_FILE="${SATORI_HOME}/.last_dream"
CLI_PATH_FILE="${SATORI_HOME}/cli-path"
INTERVAL_HOURS="${SATORI_DREAM_INTERVAL_HOURS:-24}"

mkdir -p "${SATORI_HOME}"
: > "${DREAM_LOCK}"

if ! flock -x -n "${DREAM_LOCK}" true 2>/dev/null; then
  exit 0
fi

if [[ -f "${LAST_DREAM_FILE}" ]]; then
  last=$(cat "${LAST_DREAM_FILE}")
  now=$(date +%s)
  elapsed=$(((now - last) / 3600))
  if [[ "${elapsed}" -lt "${INTERVAL_HOURS}" ]]; then
    exit 0
  fi
fi

if [[ ! -f "${CLI_PATH_FILE}" ]]; then exit 0; fi
CLI_RUNNER=$(cat "${CLI_PATH_FILE}")
if [[ ! -x "${CLI_RUNNER}" && ! -f "${CLI_RUNNER}" ]]; then exit 0; fi

date +%s > "${LAST_DREAM_FILE}"
flock -x "${DREAM_LOCK}" ${CLI_RUNNER} dream &>/dev/null &
