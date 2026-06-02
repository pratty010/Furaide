#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

"$SCRIPT_DIR/_capture_payload.sh" "Stop" "$PAYLOAD"

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

# Write permission_mode to statusline sidecar so the statusline can display it.
# The sidecar is a simple JSON file merged by statusline-command.sh at render time.
SATORI_HOME="${SATORI_HOME:-$HOME/.satori}"
SIDECAR="$SATORI_HOME/statusline-sidecar.json"
mkdir -p "$SATORI_HOME"
PMODE="$(printf '%s' "$PAYLOAD" | jq -r '.permission_mode // empty')"
if [ -n "$PMODE" ]; then
  EXISTING_SKILL="$(jq -r '.last_skill // empty' "$SIDECAR" 2>/dev/null || true)"
  jq -nc --arg pm "$PMODE" --arg ls "${EXISTING_SKILL}" \
    '{permission_mode: $pm, last_skill: (if $ls == "" then null else $ls end)}' \
    > "$SIDECAR"
fi
