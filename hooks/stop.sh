#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

EVENT_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // "Stop"')"
case "$EVENT_NAME" in
  Stop)        OUT_EVENT="turn.stop" ;;
  StopFailure) OUT_EVENT="turn.stop_failed" ;;
  *)           OUT_EVENT="turn.stop" ;;
esac

LINE="$(printf '%s' "$PAYLOAD" | jq -c --arg ts "$TS" --arg ev "$OUT_EVENT" '{
  ts: $ts,
  platform: "claude-code",
  event: $ev,
  session_id: .session_id,
  stop_reason: (.stop_reason // "")
}')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
