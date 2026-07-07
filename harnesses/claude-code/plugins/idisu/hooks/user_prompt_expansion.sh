#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
HOOK_EVENT_ID="${TS}-$$-${RANDOM}"

"$SCRIPT_DIR/_capture_payload.sh" "UserPromptExpansion" "$PAYLOAD"

if ! command -v jq >/dev/null 2>&1; then
  "$SCRIPT_DIR/_mark_inactive.sh" "hooks-missing-jq"
  exit 0
fi

COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.command_name // .slash_command_name // .skill_name // ""')"
if [ -z "$COMMAND" ]; then
  exit 0
fi

EFFORT="$(printf '%s' "$PAYLOAD" | jq -r '.effort.level // ""')"
CMD_SOURCE="$(printf '%s' "$PAYLOAD" | jq -r '.command_source // ""')"

LINE="$(printf '%s' "$PAYLOAD" | jq -c \
  --arg ts "$TS" \
  --arg eid "$HOOK_EVENT_ID" \
  --arg cmd "$COMMAND" \
  --arg eff "$EFFORT" \
  --arg src "$CMD_SOURCE" \
  '{
    ts: $ts,
    hook_event_id: $eid,
    platform: "claude-code",
    event: "skill.user_typed",
    session_id: .session_id,
    skill: $cmd,
    effort_level: $eff,
    command_source: $src,
    transcript_path: .transcript_path
  }')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
