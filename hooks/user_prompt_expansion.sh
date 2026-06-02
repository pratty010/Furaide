#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

"$SCRIPT_DIR/_capture_payload.sh" "UserPromptExpansion" "$PAYLOAD"

COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.command_name // .slash_command_name // .skill_name // ""')"
if [ -z "$COMMAND" ]; then
  exit 0
fi

LINE="$(printf '%s' "$PAYLOAD" | jq -c --arg ts "$TS" --arg cmd "$COMMAND" '{
  ts: $ts,
  platform: "claude-code",
  event: "skill.user_typed",
  session_id: .session_id,
  skill: $cmd,
  transcript_path: .transcript_path
}')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
