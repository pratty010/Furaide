#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

"$SCRIPT_DIR/_capture_payload.sh" "PreToolUse-Skill" "$PAYLOAD"

TOOL="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // ""')"
if [ "$TOOL" != "Skill" ]; then
  exit 0
fi

LINE="$(printf '%s' "$PAYLOAD" | jq -c --arg ts "$TS" '{
  ts: $ts,
  platform: "claude-code",
  event: "skill.invoke",
  session_id: .session_id,
  cwd: .cwd,
  skill: (.tool_input.skill // .tool_input.name // ""),
  args: (.tool_input.args // ""),
  tool_use_id: .tool_use_id,
  transcript_path: .transcript_path
}')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
