#!/usr/bin/env bash
# statusline-lib/recompute.sh — one-shot full rebuild of every local sidecar,
# plus the per-session recompute primitives the --recompute CLI/hook surface
# is built from (Task 3 split of the original single _recompute_all).
# Moved as-is from the pre-split statusline-command.sh (Task 1 modularization).
# Depends on: _scan_usage_stdin/_complete_bytes_end (transcript-scan.sh),
# _sidecar_save/_sidecar_load (sidecar.sh), _PRICE_JQ_LIB/_EST_COST_JQ/
# PRICING_JSON/TODAY (pricing.sh), $SIDECAR_DIR (sidecar.sh),
# _with_queue_lock/_do_drain_queue (subagent-tracking.sh, Task 2).
#
# PROJECTS_ROOT — the on-disk root every main transcript lives under
# (~/.claude/projects/<project>/<session_id>.jsonl). Shared by all three
# functions below so there's a single place to repoint if that path ever
# changes.
PROJECTS_ROOT="$HOME/.claude/projects"

# ── _session_transcript_for: sid -> the authoritative transcript path ───────
# The same session id can legitimately exist under MULTIPLE project dirs
# (Claude Code keys project dirs by cwd — a session started in a since-removed
# worktree leaves its real transcript under the worktree's slug, while a stub
# copy can appear under the main slug, or vice versa). Always pick the largest
# copy by size: the stub is a few hundred bytes, the real transcript is the
# rest of the session. Without this, whichever copy a glob happened to order
# last would clobber the sidecar rebuilt from the real one.
_session_transcript_for() {  # sid -> stdout: largest matching transcript path ('' if none)
  local sid="$1"
  # shellcheck disable=SC2012  # session ids are hex/UUID — no glob-breaking chars
  ls -S "$PROJECTS_ROOT"/*/"${sid}.jsonl" 2>/dev/null | head -1 || true
}

# ── _recompute_session: full rescan-and-rebuild for ONE session ────────────
# Direct-from-files guarantee: this never reads a session's subagent-queue
# file as input — it independently walks subagents/agent-*.jsonl on disk,
# exactly like the original _recompute_all loop body did. The queue is only
# ever touched by _recompute_session_by_id's separate cleanup step below,
# strictly after this function returns.
_recompute_session() {  # transcript_path -> rebuilds that session's sidecar wholesale
  local sess="$1" sid sidecar existing scan size adv subs counted sub aid subscan sdir new prog
  mkdir -p "$SIDECAR_DIR" 2>/dev/null || true
  sid=$(basename "$sess" .jsonl)
  sidecar="${SIDECAR_DIR}/${sid}.json"
  existing='{}'
  if [ -f "$sidecar" ]; then
    existing=$(cat "$sidecar" 2>/dev/null) || existing='{}'
    printf '%s' "$existing" | jq -e . >/dev/null 2>&1 || existing='{}'
  fi
  scan=$(_scan_usage_stdin "" 0 < "$sess" 2>/dev/null) || { echo "skip  $sid (main scan failed)"; return 1; }
  size=$(wc -c < "$sess" 2>/dev/null | tr -d ' '); case "$size" in ''|*[!0-9]*) size=0 ;; esac
  adv=$(_complete_bytes_end "$sess" 0); case "$adv" in ''|*[!0-9]*) adv="$size" ;; esac
  # E3: build the NEW cumulative-only subagent schema directly — a full
  # local rescan can always read every subagents/agent-*.jsonl sibling, so
  # every agent found here is "done" (counted_subagents), no pending left.
  subs='{"in":0,"out":0,"cr":0,"cc":0,"rate_sum":0,"rate_turns":0,"models":{},"ws":0,"wf":0,"geo":false,"speed":false}'
  counted='[]'
  sdir="$(dirname "$sess")/${sid}/subagents"
  if [ -d "$sdir" ]; then
    for sub in "$sdir"/agent-*.jsonl; do
      [ -f "$sub" ] || continue
      aid=$(basename "$sub" .jsonl); aid=${aid#agent-}
      subscan=$(_scan_usage_stdin "" 0 < "$sub" 2>/dev/null) || continue
      subs=$(printf '%s' "$subs" | jq -c --argjson s "$subscan" '
        .in += ($s.in // 0) | .out += ($s.out // 0) | .cr += ($s.cr // 0) | .cc += ($s.cc // 0)
        | .rate_sum += ($s.rate_sum // 0) | .rate_turns += ($s.rate_turns // 0)
        | .ws += ($s.web_search // 0) | .wf += ($s.web_fetch // 0)
        | .geo = (.geo or ($s.geo_us // false)) | .speed = (.speed or ($s.speed_fast // false))
        | .models = (reduce (($s.models // {}) | to_entries[]) as $e (.models;
            .[$e.key] = { in:    ((.[$e.key].in    // 0) + ($e.value.in    // 0)),
                          out:   ((.[$e.key].out   // 0) + ($e.value.out   // 0)),
                          cr:    ((.[$e.key].cr    // 0) + ($e.value.cr    // 0)),
                          cc:    ((.[$e.key].cc    // 0) + ($e.value.cc    // 0)),
                          cc_5m: ((.[$e.key].cc_5m // 0) + ($e.value.cc_5m // 0)),
                          cc_1h: ((.[$e.key].cc_1h // 0) + ($e.value.cc_1h // 0)) }))
      ' 2>/dev/null) || continue
      counted=$(printf '%s' "$counted" | jq -c --arg a "$aid" '. + [$a]' 2>/dev/null) || continue
    done
  fi
  # shellcheck disable=SC2016  # single-quoted continuation: jq's own $vars, not bash
  prog="$_PRICE_JQ_LIB$_EST_COST_JQ"'
    (. + {transcript_offset: $off, in_total: ($s.in // 0), out_total: ($s.out // 0),
          cache_read_total: ($s.cr // 0), cache_creation_total: ($s.cc // 0),
          models: ($s.models // {}), last_msg_id: ($s.last_id // ""), last_msg_out: ($s.last_out // 0),
          rate_sum: ($s.rate_sum // 0), rate_turns: ($s.rate_turns // 0),
          web_search_total: (($s.web_search // 0) + $subs.ws), web_fetch_total: (($s.web_fetch // 0) + $subs.wf),
          inference_geo_us: (($s.geo_us // false) or $subs.geo), speed_fast: (($s.speed_fast // false) or $subs.speed),
          subagent_in_total: $subs.in, subagent_out_total: $subs.out,
          subagent_cr_total: $subs.cr, subagent_cc_total: $subs.cc,
          subagent_rate_sum: $subs.rate_sum, subagent_rate_turns: $subs.rate_turns,
          subagent_models: $subs.models, counted_subagents: $counted, pending_subagents: {}}
     | del(.subagents) | del(.subagent_fallback_tokens)) as $clean
    | $clean + {estimated_cost_cents: (($clean | total_est_cost) * 100 | round)}
  '
  new=$(printf '%s' "$existing" | jq -c --argjson s "$scan" --argjson subs "$subs" --argjson counted "$counted" \
    --argjson off "$adv" --argjson PR "$PRICING_JSON" --arg TODAY "$TODAY" "$prog" 2>/dev/null) || { echo "skip  $sid (merge failed)"; return 1; }
  if _sidecar_save "$sidecar" "$new"; then
    echo "rebuilt $sid: in=$(printf '%s' "$scan" | jq -r '.in') out=$(printf '%s' "$scan" | jq -r '.out') cr=$(printf '%s' "$scan" | jq -r '.cr') cc=$(printf '%s' "$scan" | jq -r '.cc') subagents=$(printf '%s' "$counted" | jq -r 'length') est_cost_cents=$(printf '%s' "$new" | jq -r '.estimated_cost_cents // 0')"
    return 0
  else
    echo "skip  $sid (sidecar write failed)"
    return 1
  fi
}

# ── _recompute_all: thin loop over every local main transcript ─────────────
# Each session id is processed exactly ONCE, via its largest transcript copy
# (see _session_transcript_for) — a naive per-file loop would rebuild the
# sidecar once per duplicate, letting a stub copy that globs later clobber
# the totals from the real one.
_recompute_all() {
  local sess sid count=0 seen=""
  mkdir -p "$SIDECAR_DIR" 2>/dev/null || true
  for sess in "$PROJECTS_ROOT"/*/*.jsonl; do
    [ -f "$sess" ] || continue
    sid=$(basename "$sess" .jsonl)
    case " $seen " in *" $sid "*) continue ;; esac
    seen="$seen $sid"
    sess=$(_session_transcript_for "$sid")
    [ -n "$sess" ] || continue
    _recompute_session "$sess" && count=$((count+1))
  done
  echo "recomputed ${count} sidecar(s) into ${SIDECAR_DIR}"
}

# ── _recompute_session_by_id: resolve session_id -> recompute -> drain queue
# clean. Used by the --recompute CLI/hook surface (SessionEnd/SessionStart
# hooks + explicit-argument/stdin forms in the entry script). Recompute runs
# strictly BEFORE the queue drain: _recompute_session rebuilds
# counted_subagents from an independent full rescan of every real subagent
# transcript file, so every queued entry is already-counted by the time
# _do_drain_queue's idempotency check runs against it — that's the whole
# "verify the queue is empty, then delete it" mechanism, no new fold/verify
# logic needed.
_recompute_session_by_id() {  # sid -> resolves transcript path, recomputes, then drains the queue clean
  local sid="$1" sess
  # Fail-open: _session_transcript_for returns '' for an unknown sid (its
  # `|| true` absorbs the failed-glob `ls` exit under pipefail), so an
  # unknown session_id is a graceful no-op, not a crash — the entry script's
  # --recompute <sid> dispatch calls this with no guard of its own.
  sess=$(_session_transcript_for "$sid")
  [ -n "$sess" ] || return 0
  _recompute_session "$sess"
  SIDECAR_PATH="${SIDECAR_DIR}/${sid}.json"
  QUEUE_FILE="${SIDECAR_DIR}/${sid}.subagent-queue.json"
  [ -f "$QUEUE_FILE" ] || return 0
  _sidecar_load "$SIDECAR_PATH" || return 0
  _with_queue_lock _do_drain_queue
  _sidecar_save "$SIDECAR_PATH" "$SIDECAR_JSON"
}
