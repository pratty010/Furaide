#!/usr/bin/env bash
# statusline-lib/transcript-scan.sh — low-level dedup-correct usage-scanning
# primitives shared by the tail pass and the --recompute-all rebuild.
# Moved as-is from the pre-split statusline-command.sh (Task 1 modularization).
#
# DEDUP INVARIANT (verified against real transcripts, 2026-07-09): Claude Code
# writes one JSONL line per content block (thinking/text/tool_use) of a single
# API response; every line repeats that response's usage snapshot. For a given
# message.id, input/cache_read/cache_creation are identical across all its
# lines, while output_tokens grows monotonically (last line == max). Naive
# per-line summation therefore overcounts 2-4x; the fix is last-per-id via
# group_by(.message.id) | map(.[-1]).
#
# INCREMENTAL BOUNDARY: a message's lines can span two tail passes. The
# sidecar stores last_msg_id + last_msg_out (output counted so far for that
# id); the next pass zeroes the in/cache contributions for records matching
# last_msg_id and counts only the output growth. The byte cursor only ever
# advances over newline-complete data so a mid-write partial line is re-read
# whole on the next pass instead of being lost.
_scan_usage_stdin() {  # prev_msg_id prev_msg_out; stdin: JSONL
  # -> stdout: one compact JSON {in,out,cr,cc,web_search,web_fetch,geo_us,
  #    speed_fast,models:{<model>:{in,out,cr,cc,cc_5m,cc_1h}},last_id,last_out}
  # Dedup by message.id (last-per-id); records matching prev_msg_id contribute
  # only output growth beyond prev_msg_out. "<synthetic>" rate-limit-retry
  # placeholders (all-zero usage, non-msg_ ids) are excluded so they never
  # reach the pricing table. cache_creation splits into 5m/1h tiers when the
  # cache_creation sub-object exists; absent (older transcripts) the whole
  # value is treated as 5m-tier. Every add is null-guarded: a transcript with
  # zero assistant records must yield zeros, not null.
  # E5: web_search/web_fetch counts from usage.server_tool_use, same
  # dup-zeroing as in/cr/cc (a boundary-duplicate record contributes 0, not a
  # double count of a value already folded on a prior pass).
  # E2: geo_us/speed_fast are session-pre-scan booleans (true if ANY record in
  # THIS batch carries the flag) — checked at both the documented
  # .message.usage.inference_geo path and a .message.speed sibling path (the
  # two conventions observed across fixtures/docs), OR'd into the sidecar by
  # the caller across passes so the flag is sticky once set.
  local prev_id="${1:-}" prev_out="${2:-0}" out
  case "$prev_out" in ''|*[!0-9]*) prev_out=0 ;; esac
  out=$(jq -c -R -s --arg pid "$prev_id" --argjson pout "$prev_out" '
    (split("\n") | map(select(length>0)) | map(try fromjson catch null)
     | map(select(. != null and .type == "assistant"
                  and ((.message.usage? // null) != null)
                  and ((.message.model // "") != "<synthetic>")))) as $recs
    | (($recs | map(select((.message.id // "") != "")) | group_by(.message.id) | map(.[-1]))
       + ($recs | map(select((.message.id // "") == ""))))    # id-less records (not seen in real transcripts) pass through undeduped
       as $ded
    | ($ded
       | map(. as $r | ($r.message.usage) as $u
         | (if (($u.cache_creation? // null) != null)
            then {c5: ($u.cache_creation.ephemeral_5m_input_tokens // 0),
                  c1: ($u.cache_creation.ephemeral_1h_input_tokens // 0)}
            else {c5: ($u.cache_creation_input_tokens // 0), c1: 0} end) as $ccs
         | ((($r.message.id // "") == $pid) and ($pid != "")) as $dup
         | (($u.input_tokens // 0) + ($u.cache_read_input_tokens // 0) + ($u.cache_creation_input_tokens // 0)) as $denom
         | { model: ($r.message.model // "unknown"),
             in:    (if $dup then 0 else ($u.input_tokens // 0) end),
             out:   (if $dup then ([(($u.output_tokens // 0) - $pout), 0] | max)
                     else ($u.output_tokens // 0) end),
             cr:    (if $dup then 0 else ($u.cache_read_input_tokens // 0) end),
             cc:    (if $dup then 0 else ($u.cache_creation_input_tokens // 0) end),
             cc_5m: (if $dup then 0 else $ccs.c5 end),
             cc_1h: (if $dup then 0 else $ccs.c1 end),
             ws:    (if $dup then 0 else ($u.server_tool_use.web_search_requests // 0) end),
             wf:    (if $dup then 0 else ($u.server_tool_use.web_fetch_requests // 0) end),
             rate:  (if $dup then 0 elif $denom > 0 then ($u.cache_read_input_tokens // 0) / $denom else 0 end),
             dup:   $dup })) as $adj
    | { in:  ([$adj[].in]  | add // 0),
        out: ([$adj[].out] | add // 0),
        cr:  ([$adj[].cr]  | add // 0),
        cc:  ([$adj[].cc]  | add // 0),
        web_search: ([$adj[].ws] | add // 0),
        web_fetch:  ([$adj[].wf] | add // 0),
        geo_us:     (([$recs[] | select(((.message.usage.inference_geo? // "") == "us")
                                      or ((.message.inference_geo? // "") == "us"))] | length) > 0),
        speed_fast: (([$recs[] | select(((.message.speed? // "") == "fast")
                                      or ((.message.usage.speed? // "") == "fast"))] | length) > 0),
        models: ($adj | group_by(.model)
          | map({key: .[0].model,
                 value: {in: (map(.in)|add//0), out: (map(.out)|add//0),
                         cr: (map(.cr)|add//0), cc: (map(.cc)|add//0),
                         cc_5m: (map(.cc_5m)|add//0), cc_1h: (map(.cc_1h)|add//0)}})
          | from_entries),
        rate_sum:   ([$adj[] | select(.dup | not) | .rate] | add // 0),
        rate_turns: ([$adj[] | select((.dup | not) and ((.in + .cr + .cc) > 0))] | length),
        last_id:  (if ($recs|length) > 0 then ($recs[-1].message.id // "") else "" end),
        last_out: (if ($recs|length) > 0 then ($recs[-1].message.usage.output_tokens // 0) else 0 end) }
  ' 2>/dev/null) || return 1
  [ -z "$out" ] && return 1
  printf '%s' "$out"
}
_complete_bytes_end() {  # path offset -> stdout: byte position just past the last newline at/after offset
  # Ensures the cursor only advances over newline-terminated lines, so a line
  # caught mid-write is re-read whole next pass instead of being lost.
  # Fail-open: python3 absent/error -> echoes the full file size (old behavior).
  local path="$1" offset="$2" adv
  adv=$(python3 -c 'import sys
p, off = sys.argv[1], int(sys.argv[2])
with open(p, "rb") as f:
    f.seek(off)
    d = f.read()
i = d.rfind(b"\n")
print(off + (i + 1 if i >= 0 else 0))' "$path" "$offset" 2>/dev/null) || adv=""
  case "$adv" in ''|*[!0-9]*) adv=$(wc -c < "$path" 2>/dev/null | tr -d ' ') ;; esac
  printf '%s' "$adv"
}
