#!/usr/bin/env bash
# statusline-lib/sidecar.sh — per-session sidecar state: globals, load/save,
# legacy-schema migration, and the generic base/last metric fold helper.
# Moved as-is from the pre-split statusline-command.sh (Task 1 modularization).
# Depends on: _jq (util.sh), $input (entry script mode dispatch).
#
# shellcheck disable=SC2034
# SESSION_ID is read by the entry script and other sourced lib files;
# FOLD_RESULT is read by the entry script right after each _fold_metric call.
# A per-file lint pass can't see that cross-file usage.

# ── Sidecar state: per-session duration fold across resume ─────────────────
# One JSON file per session: $STATUSLINE_STATE_DIR/<session_id>.json (default
# ~/.claude/statusline-state/). Only the duration fields below are read/written
# here; other keys (transcript_offset, token totals, subagent map — Task 8.2's
# concern) are round-tripped untouched so a later pass can add them safely.
# Fail-open discipline: ANY failure (missing jq, corrupt JSON, permission error,
# absent session_id) must fall back to base=0 / raw payload values, never crash.
SIDECAR_DIR="${STATUSLINE_STATE_DIR:-$HOME/.claude/statusline-state}"
SESSION_ID=$(_jq '.session_id')
SIDECAR_JSON='{}'
FOLD_RESULT=0

_sidecar_prune() {  # delete state files (sidecars + subagent-queue files) older than 30 days; never fatal
  find "$SIDECAR_DIR" -maxdepth 1 -name '*.json' -mtime +30 -delete 2>/dev/null || true
}
_sidecar_load() {  # path -> sets SIDECAR_JSON on success; returns 1 on missing/corrupt
  local path="$1" raw
  [ -f "$path" ] || return 1
  raw=$(cat "$path" 2>/dev/null) || return 1
  printf '%s' "$raw" | jq -e . >/dev/null 2>&1 || return 1
  SIDECAR_JSON="$raw"
}
_sidecar_save() {  # path json -> atomic write (temp + rename); returns 1 on any failure
  local path="$1" json="$2" tmp
  mkdir -p "$SIDECAR_DIR" 2>/dev/null || return 1
  tmp="${path}.tmp.$$"
  printf '%s' "$json" > "$tmp" 2>/dev/null || return 1
  mv -f "$tmp" "$path" 2>/dev/null || return 1
}
_migrate_sidecar() {  # mutates SIDECAR_JSON in place; no-op when .subagents is absent
  # E3: folds an OLD-shape sidecar (per-agent `.subagents{<id>:{...,done}}` map)
  # into the new cumulative-only schema: done entries -> subagent_*_total +
  # subagent_models + counted_subagents; not-done entries -> pending_subagents
  # (fallback_estimate/model only, done/pending bool flags dropped since
  # presence in the map now IS the pending signal). The legacy
  # subagent_fallback_tokens lump (if any) folds into subagent_in_total.
  # Idempotent: called after every _sidecar_load; a sidecar already in the
  # new shape (no .subagents key) passes through untouched. Fail-open: a jq
  # error leaves SIDECAR_JSON as loaded (old shape survives one more render).
  local has_old
  has_old=$(printf '%s' "$SIDECAR_JSON" | jq -r 'has("subagents")' 2>/dev/null) || return 0
  [ "$has_old" = "true" ] || return 0
  local migrated
  migrated=$(printf '%s' "$SIDECAR_JSON" | jq '
    (.subagents // {}) as $subs
    | (.subagent_fallback_tokens // 0) as $legacy_fb
    | ([$subs | to_entries[] | select(.value.done == true)]) as $done
    | ([$subs | to_entries[] | select(.value.done != true)]) as $notdone
    | ((.subagent_in_total  // 0) + ([$done[] | .value.in // 0] | add // 0) + $legacy_fb) as $new_in
    | ((.subagent_out_total // 0) + ([$done[] | .value.out // 0] | add // 0)) as $new_out
    | ((.subagent_cr_total  // 0) + ([$done[] | (.value.cache_read // 0)] | add // 0)) as $new_cr
    | ((.subagent_cc_total  // 0) + ([$done[] | (.value.cache_creation // 0)] | add // 0)) as $new_cc
    | ((.subagent_rate_sum   // 0) + ([$done[] | .value.rate_sum // 0] | add // 0)) as $new_rs
    | ((.subagent_rate_turns // 0) + ([$done[] | .value.rate_turns // 0] | add // 0)) as $new_rt
    | (reduce $done[] as $d ((.subagent_models // {});
        reduce (($d.value.models // {}) | to_entries[]) as $e (.;
          .[$e.key] = { in:    ((.[$e.key].in    // 0) + ($e.value.in    // 0)),
                        out:   ((.[$e.key].out   // 0) + ($e.value.out   // 0)),
                        cr:    ((.[$e.key].cr    // 0) + ($e.value.cr    // 0)),
                        cc:    ((.[$e.key].cc    // 0) + ($e.value.cc    // 0)),
                        cc_5m: ((.[$e.key].cc_5m // 0) + ($e.value.cc_5m // 0)),
                        cc_1h: ((.[$e.key].cc_1h // 0) + ($e.value.cc_1h // 0)) }))
      ) as $new_models
    | ((.counted_subagents // []) + [$done[].key]) as $new_counted
    | ((.pending_subagents // {}) + (reduce $notdone[] as $p ({};
        .[$p.key] = {fallback_estimate: ($p.value.fallback_estimate // 0), model: ($p.value.model // null)}))
      ) as $new_pending
    | . + { subagent_in_total: $new_in, subagent_out_total: $new_out,
            subagent_cr_total: $new_cr, subagent_cc_total: $new_cc,
            subagent_rate_sum: $new_rs, subagent_rate_turns: $new_rt,
            subagent_models: $new_models, counted_subagents: $new_counted,
            pending_subagents: $new_pending }
    | del(.subagents) | del(.subagent_fallback_tokens)
  ' 2>/dev/null) || return 0
  [ -n "$migrated" ] && SIDECAR_JSON="$migrated"
  return 0
}
_fold_metric() {  # current base_key last_key -> sets FOLD_RESULT=base+current (folds on reset)
  local current="$1" base_key="$2" last_key="$3" base last
  base=$(printf '%s' "$SIDECAR_JSON" | jq -r ".${base_key} // 0" 2>/dev/null)
  last=$(printf '%s' "$SIDECAR_JSON" | jq -r ".${last_key} // 0" 2>/dev/null)
  case "$base" in ''|*[!0-9]*) base=0 ;; esac
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  [ "$current" -lt "$last" ] && base=$(( base + last ))
  FOLD_RESULT=$(( base + current ))
  SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --argjson b "$base" --argjson l "$current" \
    ".${base_key} = \$b | .${last_key} = \$l" 2>/dev/null)
  [ -n "$SIDECAR_JSON" ] || return 1
}
