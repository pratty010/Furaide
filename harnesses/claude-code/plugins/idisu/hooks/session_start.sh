#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PAYLOAD="$(cat)"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

"$SCRIPT_DIR/_capture_payload.sh" "SessionStart" "$PAYLOAD"

if ! command -v jq >/dev/null 2>&1; then
  "$SCRIPT_DIR/_mark_inactive.sh" "hooks-missing-jq"
  exit 0
fi

if ! command -v sha256sum >/dev/null 2>&1; then
  "$SCRIPT_DIR/_mark_inactive.sh" "hooks-missing-sha256sum"
  exit 0
fi

SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // "unknown-session"')"

# Mirror EventEnvelope's engine-side makeEventId(sourceId, sourcePosition):
# sha256("<source_id>:<source_position>"), first 32 hex chars. Using a fixed
# source_position ("session.start") per session_id keeps this hook's own
# emission idempotent across accidental double-fires — INSERT OR IGNORE in
# repo.ts dedupes on event_id.
SOURCE_ID="cc-hook:${SESSION_ID}"
SOURCE_POSITION="session.start"
EVENT_ID="$(printf '%s' "${SOURCE_ID}:${SOURCE_POSITION}" | sha256sum | cut -c1-32)"

LINE="$(printf '%s' "$PAYLOAD" | jq -c \
  --arg ts "$TS" \
  --arg event_id "$EVENT_ID" \
  --arg source_id "$SOURCE_ID" \
  --arg source_position "$SOURCE_POSITION" \
  --arg session_id "$SESSION_ID" \
  '{
    schema_version: 1,
    event_id: $event_id,
    source_id: $source_id,
    source_position: $source_position,
    observed_at: $ts,
    ingested_at: $ts,
    harness: "claude_code",
    event_type: "session.observed",
    payload_version: 1,
    payload: ({
      session_id: $session_id,
      harness: "claude_code",
      workspace: .cwd,
      model: .model,
      source: .source,
      started_at: $ts,
      transcript_pointer: (.transcript_path // "")
    } | with_entries(select(.value != null)))
  }')"

"$SCRIPT_DIR/_emit.sh" "$LINE"
