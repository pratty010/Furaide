#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

"$SCRIPT_DIR/_capture_payload.sh" "PostToolUseFailure-Skill" "$PAYLOAD"

TOOL="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // ""')"
if [ "$TOOL" != "Skill" ]; then
  exit 0
fi

LINE="$(printf '%s' "$PAYLOAD" | jq -c --arg ts "$TS" '{
  ts: $ts,
  platform: "claude-code",
  event: "skill.load_failed",
  session_id: .session_id,
  tool_use_id: .tool_use_id,
  exit_code: (.tool_result.exit_code // .tool_response.exit_code // 1),
  stderr: (.tool_result.stderr // .tool_response.stderr // "")
}')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
