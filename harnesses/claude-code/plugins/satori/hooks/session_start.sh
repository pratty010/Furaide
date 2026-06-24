#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
HOOK_EVENT_ID="${TS}-$$-${RANDOM}"

"$SCRIPT_DIR/_capture_payload.sh" "SessionStart" "$PAYLOAD"

if ! command -v jq >/dev/null 2>&1; then
  "$SCRIPT_DIR/_mark_inactive.sh" "hooks-missing-jq"
  exit 0
fi

LINE="$(printf '%s' "$PAYLOAD" | jq -c --arg ts "$TS" --arg eid "$HOOK_EVENT_ID" '{
  ts: $ts,
  hook_event_id: $eid,
  platform: "claude-code",
  event: "session.start",
  session_id: .session_id,
  cwd: .cwd,
  model: .model,
  source: .source,
  transcript_path: .transcript_path
}')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
