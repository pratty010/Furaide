#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

"$SCRIPT_DIR/_capture_payload.sh" "SessionStart" "$PAYLOAD"

LINE="$(printf '%s' "$PAYLOAD" | jq -c --arg ts "$TS" '{
  ts: $ts,
  platform: "claude-code",
  event: "session.start",
  session_id: .session_id,
  cwd: .cwd,
  model: .model,
  source: .source,
  transcript_path: .transcript_path
}')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
