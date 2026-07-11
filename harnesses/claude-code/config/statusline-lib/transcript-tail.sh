#!/usr/bin/env bash
# statusline-lib/transcript-tail.sh — main-thread byte-cursor/token-accumulation
# tail pass. Moved from the pre-split statusline-command.sh (Task 1
# modularization); the subagent-specific slice of this function now calls out
# to _resolve_subagent_completions (subagent-tracking.sh) instead of inlining
# that logic.
# Depends on: _complete_bytes_end/_scan_usage_stdin (transcript-scan.sh),
# _resolve_subagent_completions (subagent-tracking.sh), _PRICE_JQ_LIB/
# _EST_COST_JQ/PRICING_JSON/TODAY (pricing.sh), $SIDECAR_JSON (sidecar.sh).
#
# shellcheck disable=SC2034
# SUBAGENT_FALLBACK_TOTAL is read by display.sh; a per-file lint pass can't
# see that cross-file usage.
#
# ── Task 8.2: transcript tail pass (token totals + subagent share) ─────────
# Incremental jq pass over the session transcript from the sidecar's
# transcript_offset (byte cursor). Sums main-thread assistant message.usage
# into {in,out,cache_read,cache_creation}_total plus per-model buckets, and
# folds in per-subagent totals discovered from Task-tool completions.
# Fail-open: any jq/parse failure leaves SIDECAR_JSON and the *_TOTAL
# globals untouched (caller keeps prior values).
_transcript_tail_pass() {  # path -> mutates SIDECAR_JSON + sets *_TOTAL globals; returns 1 on any failure (no mutation)
  local path="$1" offset size adv newdata scan
  offset=$(printf '%s' "$SIDECAR_JSON" | jq -r '.transcript_offset // 0' 2>/dev/null)
  case "$offset" in ''|*[!0-9]*) offset=0 ;; esac
  size=$(wc -c < "$path" 2>/dev/null | tr -d ' ') || return 1
  case "$size" in ''|*[!0-9]*) return 1 ;; esac
  [ "$offset" -gt "$size" ] && offset=0  # transcript truncated/rotated: restart cursor defensively
  adv=$(_complete_bytes_end "$path" "$offset")
  case "$adv" in ''|*[!0-9]*) adv="$size" ;; esac
  [ "$adv" -lt "$offset" ] && adv="$offset"

  newdata=""
  [ "$offset" -lt "$adv" ] && { newdata=$(tail -c +$((offset+1)) "$path" 2>/dev/null | head -c $((adv - offset))) || return 1; }

  local base_in base_out base_cr base_cc base_fb last_id last_out
  base_in=$(printf '%s' "$SIDECAR_JSON" | jq -r '.in_total // 0' 2>/dev/null); case "$base_in" in ''|*[!0-9]*) base_in=0 ;; esac
  base_out=$(printf '%s' "$SIDECAR_JSON" | jq -r '.out_total // 0' 2>/dev/null); case "$base_out" in ''|*[!0-9]*) base_out=0 ;; esac
  base_cr=$(printf '%s' "$SIDECAR_JSON" | jq -r '.cache_read_total // 0' 2>/dev/null); case "$base_cr" in ''|*[!0-9]*) base_cr=0 ;; esac
  base_cc=$(printf '%s' "$SIDECAR_JSON" | jq -r '.cache_creation_total // 0' 2>/dev/null); case "$base_cc" in ''|*[!0-9]*) base_cc=0 ;; esac
  base_fb=$(printf '%s' "$SIDECAR_JSON" | jq -r '.subagent_fallback_tokens // 0' 2>/dev/null); case "$base_fb" in ''|*[!0-9]*) base_fb=0 ;; esac
  last_id=$(printf '%s' "$SIDECAR_JSON" | jq -r '.last_msg_id // ""' 2>/dev/null) || last_id=""
  last_out=$(printf '%s' "$SIDECAR_JSON" | jq -r '.last_msg_out // 0' 2>/dev/null); case "$last_out" in ''|*[!0-9]*) last_out=0 ;; esac

  local d_in=0 d_out=0 d_cr=0 d_cc=0 d_rs=0 d_rt=0 d_ws=0 d_wf=0 d_geo=false d_speed=false
  local dmodels='{}' new_last_id="$last_id" new_last_out="$last_out" sl_id
  if [ -n "$newdata" ]; then
    if scan=$(printf '%s' "$newdata" | _scan_usage_stdin "$last_id" "$last_out"); then
      d_in=$(printf '%s' "$scan" | jq -r '.in // 0' 2>/dev/null); case "$d_in" in ''|*[!0-9]*) d_in=0 ;; esac
      d_out=$(printf '%s' "$scan" | jq -r '.out // 0' 2>/dev/null); case "$d_out" in ''|*[!0-9]*) d_out=0 ;; esac
      d_cr=$(printf '%s' "$scan" | jq -r '.cr // 0' 2>/dev/null); case "$d_cr" in ''|*[!0-9]*) d_cr=0 ;; esac
      d_cc=$(printf '%s' "$scan" | jq -r '.cc // 0' 2>/dev/null); case "$d_cc" in ''|*[!0-9]*) d_cc=0 ;; esac
      d_rs=$(printf '%s' "$scan" | jq -r '.rate_sum // 0' 2>/dev/null); [ -z "$d_rs" ] && d_rs=0
      d_rt=$(printf '%s' "$scan" | jq -r '.rate_turns // 0' 2>/dev/null); case "$d_rt" in ''|*[!0-9]*) d_rt=0 ;; esac
      d_ws=$(printf '%s' "$scan" | jq -r '.web_search // 0' 2>/dev/null); case "$d_ws" in ''|*[!0-9]*) d_ws=0 ;; esac
      d_wf=$(printf '%s' "$scan" | jq -r '.web_fetch // 0' 2>/dev/null); case "$d_wf" in ''|*[!0-9]*) d_wf=0 ;; esac
      d_geo=$(printf '%s' "$scan" | jq -r '.geo_us // false' 2>/dev/null); [ "$d_geo" = "true" ] || d_geo=false
      d_speed=$(printf '%s' "$scan" | jq -r '.speed_fast // false' 2>/dev/null); [ "$d_speed" = "true" ] || d_speed=false
      dmodels=$(printf '%s' "$scan" | jq -c '.models // {}' 2>/dev/null) || dmodels='{}'
      sl_id=$(printf '%s' "$scan" | jq -r '.last_id // ""' 2>/dev/null) || sl_id=""
      if [ -n "$sl_id" ]; then
        new_last_id="$sl_id"
        new_last_out=$(printf '%s' "$scan" | jq -r '.last_out // 0' 2>/dev/null); case "$new_last_out" in ''|*[!0-9]*) new_last_out=0 ;; esac
      fi
    fi
  fi

  IN_TOTAL=$(( base_in + d_in ))
  OUT_TOTAL=$(( base_out + d_out ))
  CACHE_READ_TOTAL=$(( base_cr + d_cr ))
  CACHE_CREATION_TOTAL=$(( base_cc + d_cc ))
  SUBAGENT_FALLBACK_TOTAL="$base_fb"

  # E2/E5: geo_us/speed_fast/web_search/web_fetch fold in the same merge as
  # the token totals. geo_us/speed_fast are sticky booleans — OR'd with
  # whatever was already true, never reset by a pass that itself saw no flag.
  SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq \
    --argjson offset "$adv" --argjson in "$IN_TOTAL" --argjson out "$OUT_TOTAL" \
    --argjson cr "$CACHE_READ_TOTAL" --argjson cc "$CACHE_CREATION_TOTAL" \
    --argjson dm "$dmodels" --arg lid "$new_last_id" --argjson lout "$new_last_out" \
    --argjson rs "$d_rs" --argjson rt "$d_rt" \
    --argjson dws "$d_ws" --argjson dwf "$d_wf" --argjson dgeo "$d_geo" --argjson dspeed "$d_speed" \
    '.transcript_offset = $offset | .in_total = $in | .out_total = $out
     | .cache_read_total = $cr | .cache_creation_total = $cc
     | .last_msg_id = $lid | .last_msg_out = $lout
     | .rate_sum = ((.rate_sum // 0) + $rs) | .rate_turns = ((.rate_turns // 0) + $rt)
     | .web_search_total = ((.web_search_total // 0) + $dws)
     | .web_fetch_total  = ((.web_fetch_total  // 0) + $dwf)
     | .inference_geo_us = ((.inference_geo_us // false) or $dgeo)
     | .speed_fast        = ((.speed_fast // false) or $dspeed)
     | .models = (reduce ($dm | to_entries[]) as $e ((.models // {});
         .[$e.key] = { in:    ((.[$e.key].in    // 0) + ($e.value.in    // 0)),
                       out:   ((.[$e.key].out   // 0) + ($e.value.out   // 0)),
                       cr:    ((.[$e.key].cr    // 0) + ($e.value.cr    // 0)),
                       cc:    ((.[$e.key].cc    // 0) + ($e.value.cc    // 0)),
                       cc_5m: ((.[$e.key].cc_5m // 0) + ($e.value.cc_5m // 0)),
                       cc_1h: ((.[$e.key].cc_1h // 0) + ($e.value.cc_1h // 0)) }))
     | .subagent_fallback_tokens = (.subagent_fallback_tokens // 0)' \
    2>/dev/null) || return 1
  [ -n "$SIDECAR_JSON" ] || return 1

  # Subagent completion resolution + pending retry (factored out into
  # subagent-tracking.sh's _resolve_subagent_completions; same behavior,
  # including the known subfile path-construction bug, unchanged).
  _resolve_subagent_completions "$path" "$newdata"

  # Confirmed sums now read straight off the cumulative fields (no map scan);
  # pending estimates aggregate from pending_subagents so the display can
  # flag them as approximate.
  SUBAGENT_IN_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '.subagent_in_total // 0' 2>/dev/null)
  SUBAGENT_OUT_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '.subagent_out_total // 0' 2>/dev/null)
  SUBAGENT_CR_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '.subagent_cr_total // 0' 2>/dev/null)
  SUBAGENT_CC_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '.subagent_cc_total // 0' 2>/dev/null)
  PENDING_EST_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[(.pending_subagents // {})[] | .fallback_estimate // 0] | add // 0' 2>/dev/null)
  PENDING_COUNT=$(printf '%s' "$SIDECAR_JSON" | jq -r '(.pending_subagents // {}) | length' 2>/dev/null)
  case "$SUBAGENT_IN_TOTAL" in ''|*[!0-9]*) SUBAGENT_IN_TOTAL=0 ;; esac
  case "$SUBAGENT_OUT_TOTAL" in ''|*[!0-9]*) SUBAGENT_OUT_TOTAL=0 ;; esac
  case "$SUBAGENT_CR_TOTAL" in ''|*[!0-9]*) SUBAGENT_CR_TOTAL=0 ;; esac
  case "$SUBAGENT_CC_TOTAL" in ''|*[!0-9]*) SUBAGENT_CC_TOTAL=0 ;; esac
  case "$PENDING_EST_TOTAL" in ''|*[!0-9]*) PENDING_EST_TOTAL=0 ;; esac
  case "$PENDING_COUNT" in ''|*[!0-9]*) PENDING_COUNT=0 ;; esac

  # E4: estimated_cost_cents — best-effort session-level pricing estimate
  # from main .models + subagent_models cumulative + pending fallbacks +
  # web-search, geo/fast-modified. Written on every render so a session that
  # never carried a live cost payload still gets an estimate on file.
  # Fail-open: any jq error leaves the prior estimated_cost_cents in place.
  local est_prog est_sc
  est_prog="$_PRICE_JQ_LIB$_EST_COST_JQ"'
    . + {estimated_cost_cents: ((total_est_cost * 100) | round)}
  '
  est_sc=$(printf '%s' "$SIDECAR_JSON" | jq --argjson PR "$PRICING_JSON" --arg TODAY "$TODAY" "$est_prog" 2>/dev/null) || est_sc=""
  [ -n "$est_sc" ] && SIDECAR_JSON="$est_sc"

  return 0
}
