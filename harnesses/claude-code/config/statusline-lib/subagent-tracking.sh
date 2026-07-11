#!/usr/bin/env bash
# statusline-lib/subagent-tracking.sh — subagent-completion detection and the
# completion-resolution + pending-subagent-retry logic. Factored out of the
# middle third of _transcript_tail_pass as part of the Task 1 modularization.
# Task 2 fixed the subfile path-construction bug (subagents/ nests one level
# deeper, under the session id's own directory) and added the SubagentStop
# hook entry point plus the single-file locked queue mechanism (the primary,
# event-driven live-update path; the pending-retry logic below remains the
# fallback tier for when the hook path never fired).
# Depends on: _scan_usage_stdin (transcript-scan.sh), $SIDECAR_JSON (sidecar.sh),
# $SIDECAR_DIR/_sidecar_load/_sidecar_save/_migrate_sidecar (sidecar.sh),
# $_PRICE_JQ_LIB/$_EST_COST_JQ (pricing.sh), _jq (util.sh).
#
# Subagent completion sources, in priority order:
#   - A completed Task-tool subagent surfaces in the MAIN transcript as a
#     type:"user" tool_result record whose (recursively flattened) text
#     contains both "agentId: <id>" and a "<usage>...</usage>" block — this
#     combination (not "agentId:" alone, which also appears on the *launch*
#     notification) is the "done" signal.
#   - Primary: the subagent's own transcript at
#     <transcript-dir>/subagents/agent-<id>.jsonl, scanned with the same
#     dedup logic (nested subagents write there too, as flat siblings — a
#     flat glob is complete at any spawn depth).
#   - If that file isn't readable yet, the agent is stored as
#     {pending:true, fallback_estimate, model} — the completion record's own
#     subagent_tokens lump (proven to undercount 14-28x: it is the FINAL
#     TURN's usage, not cumulative) is kept only as a flagged estimate and
#     retried against the real file on every subsequent render. Pending
#     estimates are never folded into the confirmed sums.
#   - subagent_fallback_tokens is a legacy lump written by older versions of
#     this script; it is still read (and shown in the confirmed "in" side)
#     but never written to anymore.
# Fail-open: any jq/parse failure leaves SIDECAR_JSON untouched for that entry
# (caller keeps prior values).
_extract_subagent_completions_stdin() {  # stdin: JSONL -> stdout one JSON object/line: {agent_id,fallback_tokens,resolved_model}
  # Real Task-tool subagent completions surface as a type:"user" tool_result
  # record. Flattening all nested .text fields catches the case where the
  # "agentId: <id> (...)" text and the "<usage>subagent_tokens: N ...</usage>"
  # block live in separate content blocks of the same tool_result. Requiring
  # BOTH excludes the earlier launch-acknowledgement record, which mentions
  # agentId but never carries a <usage> block. resolvedModel (the model the
  # subagent actually ran on — often different from the main session's) comes
  # from the record's structured toolUseResult, and is what prices a pending
  # entry's fallback estimate.
  jq -c -R -s '
    (split("\n") | map(select(length>0)) | map(try fromjson catch null)
     | map(select(. != null and .type == "user"))) as $recs
    | $recs[]
    | ([.. | .text? // empty] | join("\n")) as $txt
    | select($txt | test("<usage>"))
    | (try ($txt | capture("agentId:\\s*(?<id>[a-f0-9]+)")) catch null) as $m
    | select($m != null)
    | {
        agent_id: $m.id,
        # Array-collect the capture: a non-match yields an EMPTY STREAM (not
        # null), which would otherwise collapse this whole object construction
        # to zero outputs and silently drop the completion record.
        fallback_tokens: ([$txt | capture("subagent_tokens:\\s*(?<n>[0-9]+)").n] | first),
        resolved_model: (.toolUseResult.resolvedModel? // null)
      }
  ' 2>/dev/null
}
_subagent_dir() {  # main_transcript_path -> stdout: that session's subagents/ dir
  local main="$1" sid
  sid=$(basename "$main" .jsonl)
  printf '%s/%s/subagents' "$(dirname "$main")" "$sid"
}
_fold_subagent_into_sidecar() {  # aid subfile -> mutates SIDECAR_JSON; returns 1 on failure (no mutation)
  local aid="$1" subfile="$2" sub_scan
  sub_scan=$(_scan_usage_stdin "" 0 < "$subfile" 2>/dev/null) || return 1
  SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$aid" --argjson s "$sub_scan" '
    .subagent_in_total   = ((.subagent_in_total   // 0) + ($s.in // 0))
    | .subagent_out_total  = ((.subagent_out_total  // 0) + ($s.out // 0))
    | .subagent_cr_total   = ((.subagent_cr_total   // 0) + ($s.cr // 0))
    | .subagent_cc_total   = ((.subagent_cc_total   // 0) + ($s.cc // 0))
    | .subagent_rate_sum   = ((.subagent_rate_sum   // 0) + ($s.rate_sum // 0))
    | .subagent_rate_turns = ((.subagent_rate_turns // 0) + ($s.rate_turns // 0))
    | .subagent_models = (reduce (($s.models // {}) | to_entries[]) as $e ((.subagent_models // {});
        .[$e.key] = { in: ((.[$e.key].in // 0) + ($e.value.in // 0)), out: ((.[$e.key].out // 0) + ($e.value.out // 0)),
                      cr: ((.[$e.key].cr // 0) + ($e.value.cr // 0)), cc: ((.[$e.key].cc // 0) + ($e.value.cc // 0)),
                      cc_5m: ((.[$e.key].cc_5m // 0) + ($e.value.cc_5m // 0)), cc_1h: ((.[$e.key].cc_1h // 0) + ($e.value.cc_1h // 0)) }))
    | .counted_subagents = ((.counted_subagents // []) + [$t])
    | .pending_subagents = ((.pending_subagents // {}) | del(.[$t]))
  ' 2>/dev/null) || return 1
  [ -n "$SIDECAR_JSON" ] || return 1
}
_resolve_subagent_completions() {  # path newdata -> mutates SIDECAR_JSON (completion resolution + pending retry)
  local path="$1" newdata="$2"
  # E3: subagent completion handler — folds a resolved agent directly into
  # the cumulative subagent_*_total + subagent_models buckets and appends its
  # id to counted_subagents (the re-fold guard, replacing the old per-agent
  # .subagents[$t].done flag). Unresolved agents land in pending_subagents
  # (fallback_estimate/model only — no per-agent totals kept until resolved).
  if [ -n "$newdata" ]; then
    local completions line
    completions=$(printf '%s' "$newdata" | _extract_subagent_completions_stdin) || completions=""
    if [ -n "$completions" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        local aid ftok rmodel already subfile
        aid=$(printf '%s' "$line" | jq -r '.agent_id // empty' 2>/dev/null)
        [ -z "$aid" ] && continue
        already=$(printf '%s' "$SIDECAR_JSON" | jq -r --arg t "$aid" '(.counted_subagents // []) | contains([$t])' 2>/dev/null)
        [ "$already" = "true" ] && continue
        ftok=$(printf '%s' "$line" | jq -r '.fallback_tokens // empty' 2>/dev/null)
        case "$ftok" in ''|*[!0-9]*) ftok=0 ;; esac
        rmodel=$(printf '%s' "$line" | jq -r '.resolved_model // empty' 2>/dev/null) || rmodel=""

        subfile="$(_subagent_dir "$path")/agent-${aid}.jsonl"
        if [ -r "$subfile" ]; then
          _fold_subagent_into_sidecar "$aid" "$subfile" || continue
        else
          # Transcript file not readable yet: record a pending entry with the
          # completion record's lump as a flagged ESTIMATE (final-turn-only,
          # undercounts real usage 14-28x) and retry the file on every
          # subsequent render. Never folded into the confirmed sums.
          SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$aid" --argjson fb "$ftok" --arg m "$rmodel" '
            .pending_subagents = ((.pending_subagents // {}) + {($t): {fallback_estimate: $fb,
                                   model: (if $m == "" then null else $m end)}})
          ' 2>/dev/null) || continue
        fi
      done <<<"$completions"
    fi
  fi

  # Pending retry: runs every render (with or without new transcript bytes) —
  # a subagent transcript that raced the completion record usually lands
  # within the next render or two.
  local pend_ids pid p_file
  pend_ids=$(printf '%s' "$SIDECAR_JSON" | jq -r '(.pending_subagents // {}) | keys[]' 2>/dev/null) || pend_ids=""
  if [ -n "$pend_ids" ]; then
    while IFS= read -r pid; do
      [ -z "$pid" ] && continue
      p_file="$(_subagent_dir "$path")/agent-${pid}.jsonl"
      [ -r "$p_file" ] || continue
      _fold_subagent_into_sidecar "$pid" "$p_file" || continue
    done <<<"$pend_ids"
  fi

  # Render-path queue drain (the backstop for a burst's last hook losing the
  # lock race with nothing firing afterward to pick up stragglers). Cheap
  # early-exit before ever acquiring the lock so idle sessions pay nothing.
  if [ -n "${QUEUE_FILE:-}" ] && [ -s "$QUEUE_FILE" ]; then
    _with_queue_lock _do_drain_queue || true   # opportunistic: skip on lock contention, never fatal
  fi
}

# ── Single-file locked queue mechanism (primary, event-driven live-update
# path for the SubagentStop hook) ───────────────────────────────────────────
# One artifact per session, no directory, no separate lock file:
# ${SIDECAR_DIR}/<session_id>.subagent-queue.json — a JSON object keyed by
# agent_id: {"<id>": {"transcript_path": "...", "agent_type": "..."}, ...}.
# Locked directly via its own fd (never a separate .lock file) and only ever
# mutated in-place (read -> jq-transform -> truncate-and-rewrite), NEVER
# replaced via temp-file-plus-rename: flock is tied to the open file
# description, so a rename swaps in a new inode a later opener would lock
# against with zero contention against an in-flight holder. The sidecar's own
# separate rename-based save (sidecar.sh's _sidecar_save) is untouched by
# this rule.
_with_queue_lock() {  # fn_name [args...]  -- runs "$fn" "$@" holding fd 9; LOCK_MODE=blocking|nonblocking (env)
  local fn="$1" mode="${LOCK_MODE:-nonblocking}"; shift
  exec 9<>"$QUEUE_FILE" 2>/dev/null || return 1
  if command -v flock >/dev/null 2>&1; then
    if [ "$mode" = "blocking" ]; then
      flock -w "${LOCK_TIMEOUT:-3}" 9 || { exec 9>&-; return 1; }
    else
      flock -n 9 || { exec 9>&-; return 1; }
    fi
  else
    exec 9>&-; return 2   # flock unavailable: hard-skip, caller falls back to legacy route
  fi
  "$fn" "$@"; local rc=$?
  exec 9>&-
  return $rc
}
_do_enqueue() {  # aid transcript_path agent_type
  local aid="$1" tp="$2" atype="$3" cur
  cur=$(cat "$QUEUE_FILE" 2>/dev/null); printf '%s' "$cur" | jq -e . >/dev/null 2>&1 || cur='{}'
  printf '%s' "$cur" | jq --arg a "$aid" --arg t "$tp" --arg y "$atype" \
    '. + {($a): {transcript_path: $t, agent_type: $y}}' > "$QUEUE_FILE" 2>/dev/null
}
_do_drain_queue() {  # requires SIDECAR_JSON already loaded by caller; mutates it in place
  local cur agent_ids aid tp already
  cur=$(cat "$QUEUE_FILE" 2>/dev/null)
  printf '%s' "$cur" | jq -e . >/dev/null 2>&1 || { printf '{}' > "$QUEUE_FILE" 2>/dev/null; return 0; }
  agent_ids=$(printf '%s' "$cur" | jq -r 'keys[]' 2>/dev/null)
  [ -z "$agent_ids" ] && return 0
  while IFS= read -r aid; do
    [ -z "$aid" ] && continue
    already=$(printf '%s' "$SIDECAR_JSON" | jq -r --arg t "$aid" '(.counted_subagents // []) | contains([$t])' 2>/dev/null)
    if [ "$already" = "true" ]; then
      cur=$(printf '%s' "$cur" | jq --arg a "$aid" 'del(.[$a])' 2>/dev/null); continue
    fi
    tp=$(printf '%s' "$cur" | jq -r --arg a "$aid" '.[$a].transcript_path // empty')
    [ -r "$tp" ] || continue   # not readable yet: leave queued, retry next drain
    if _fold_subagent_into_sidecar "$aid" "$tp"; then
      cur=$(printf '%s' "$cur" | jq --arg a "$aid" 'del(.[$a])' 2>/dev/null)
    fi
  done <<<"$agent_ids"
  printf '%s' "$cur" > "$QUEUE_FILE" 2>/dev/null
}

# ── SubagentStop hook entry point ───────────────────────────────────────────
_run_subagent_stop_hook() {  # reads hook JSON from global $input
  command -v jq >/dev/null 2>&1 || return 0
  local sid aid tp atype
  sid=$(_jq '.session_id'); aid=$(_jq '.agent_id')
  tp=$(_jq '.transcript_path'); atype=$(_jq '.agent_type')
  [ -n "$sid" ] && [ -n "$aid" ] || return 0

  # Defensive: docs don't fully disambiguate subagent-own vs. parent transcript_path
  # for the SubagentStop hook payload. Hedge cheaply.
  if [ -z "$tp" ] || [ ! -r "$tp" ] || ! printf '%s' "$tp" | grep -qF "/subagents/agent-"; then
    tp="$(_subagent_dir "$(_jq '.transcript_path')")/agent-${aid}.jsonl"
  fi

  SIDECAR_PATH="${SIDECAR_DIR}/${sid}.json"
  QUEUE_FILE="${SIDECAR_DIR}/${sid}.subagent-queue.json"
  _sidecar_prune

  if [ -r "$tp" ]; then
    LOCK_MODE=blocking LOCK_TIMEOUT=3 _with_queue_lock _do_enqueue "$aid" "$tp" "$atype"
  fi

  _sidecar_load "$SIDECAR_PATH" || SIDECAR_JSON='{}'
  _migrate_sidecar
  _with_queue_lock _do_drain_queue
  _recompute_cost_estimate
  _sidecar_save "$SIDECAR_PATH" "$SIDECAR_JSON"
}
