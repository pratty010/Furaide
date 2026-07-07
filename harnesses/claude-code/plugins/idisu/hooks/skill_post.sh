#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
HOOK_EVENT_ID="${TS}-$$-${RANDOM}"

"$SCRIPT_DIR/_capture_payload.sh" "PostToolUse-Skill" "$PAYLOAD"

if ! command -v jq >/dev/null 2>&1; then
  "$SCRIPT_DIR/_mark_inactive.sh" "hooks-missing-jq"
  exit 0
fi

TOOL="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // ""')"
if [ "$TOOL" != "Skill" ]; then
  exit 0
fi

EXIT_CODE="$(printf '%s' "$PAYLOAD" | jq -r '.tool_result.exit_code // .tool_response.exit_code // 0')"

LINE="$(printf '%s' "$PAYLOAD" | jq -c --arg ts "$TS" --arg eid "$HOOK_EVENT_ID" '{
  ts: $ts,
  hook_event_id: $eid,
  platform: "claude-code",
  event: "skill.loaded",
  session_id: .session_id,
  tool_use_id: .tool_use_id,
  exit_code: (.tool_result.exit_code // .tool_response.exit_code // 0),
  run_time_seconds: (.tool_result.run_time_seconds // .tool_response.run_time_seconds // 0)
}')"

"$SCRIPT_DIR/_emit.sh" "$LINE"

# On successful load, record the skill name in the statusline sidecar.
if [ "$EXIT_CODE" = "0" ]; then
  SKILL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.skill // .tool_input.name // empty')"
  if [ -n "$SKILL_NAME" ]; then
    IDISU_HOME="${IDISU_HOME:-$HOME/.idisu}"
    SIDECAR="$IDISU_HOME/statusline-sidecar.json"
    mkdir -p "$IDISU_HOME"
    EXISTING_PMODE="$(jq -r '.permission_mode // empty' "$SIDECAR" 2>/dev/null || true)"
    jq -nc --arg ls "$SKILL_NAME" --arg pm "${EXISTING_PMODE}" \
      '{permission_mode: (if $pm == "" then null else $pm end), last_skill: $ls}' \
      > "$SIDECAR"
  fi
fi
