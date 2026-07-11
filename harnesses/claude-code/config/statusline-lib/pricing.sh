#!/usr/bin/env bash
# statusline-lib/pricing.sh — pricing table loader + shared jq pricing library.
# Moved as-is from the pre-split statusline-command.sh (Task 1 modularization).
# Depends on: $HERE (set by the entry script before this file is sourced).

# ── Pricing JSON loader ───────────────────────────────────────────────────
# Reads the pricing table into PRICING_JSON (a shell-global jq string).
# Lookup order: CLAUDE_PRICING_FILE env → ~/.claude/claude-pricing.json →
# $HERE/claude-pricing.json (shipped). If the global copy is missing, the
# shipped copy is copied there (best-effort). Fail-open: any read/parse
# failure falls back to an in-script copy of the same schema.
_load_pricing() {
  local src=""
  # 1. Explicit env override
  if [ -n "${CLAUDE_PRICING_FILE:-}" ] && [ -r "$CLAUDE_PRICING_FILE" ]; then
    src="$CLAUDE_PRICING_FILE"
  # 2. Global user copy
  elif [ -r "$HOME/.claude/claude-pricing.json" ]; then
    src="$HOME/.claude/claude-pricing.json"
  # 3. Shipped copy relative to this script
  elif [ -r "$HERE/claude-pricing.json" ]; then
    src="$HERE/claude-pricing.json"
    # Bootstrap: populate global copy for other tools / sessions
    mkdir -p "$HOME/.claude" 2>/dev/null || true
    cp "$src" "$HOME/.claude/claude-pricing.json" 2>/dev/null || true
  fi
  if [ -n "$src" ]; then
    PRICING_JSON=$(cat "$src" 2>/dev/null) || PRICING_JSON=""
    if [ -n "$PRICING_JSON" ]; then
      printf '%s' "$PRICING_JSON" | jq -e . >/dev/null 2>&1 || PRICING_JSON=""
    fi
  fi
  # Fail-open: hard-coded copy of claude-pricing.json (same schema).
  # Bump this when the shipped file changes and you want the fallback current.
  if [ -z "${PRICING_JSON:-}" ]; then
    PRICING_JSON='{"source_url":"https://platform.claude.com/docs/en/about-claude/pricing","fetched":"2026-07-10","note":"Fallback copy — keep in sync with shipped claude-pricing.json.","models":{"claude-fable-5":{"in":10.0,"out":50.0,"cache_5m":12.50,"cache_1h":20.0,"cache_read":1.0},"claude-mythos-5":{"in":10.0,"out":50.0,"cache_5m":12.50,"cache_1h":20.0,"cache_read":1.0},"claude-opus-4-8":{"in":5.0,"out":25.0,"cache_5m":6.25,"cache_1h":10.0,"cache_read":0.50,"fast":{"in":10.0,"out":50.0}},"claude-opus-4-7":{"in":5.0,"out":25.0,"cache_5m":6.25,"cache_1h":10.0,"cache_read":0.50,"fast":{"in":30.0,"out":150.0}},"claude-opus-4-6":{"in":5.0,"out":25.0,"cache_5m":6.25,"cache_1h":10.0,"cache_read":0.50},"claude-opus-4-5":{"in":5.0,"out":25.0,"cache_5m":6.25,"cache_1h":10.0,"cache_read":0.50},"claude-opus-4-1":{"in":15.0,"out":75.0,"cache_5m":18.75,"cache_1h":30.0,"cache_read":1.50},"claude-sonnet-5":{"in":2.0,"out":10.0,"cache_5m":2.50,"cache_1h":4.0,"cache_read":0.20,"intro_until":"2026-08-31","after":{"in":3.0,"out":15.0,"cache_5m":3.75,"cache_1h":6.0,"cache_read":0.30}},"claude-sonnet-4-6":{"in":3.0,"out":15.0,"cache_5m":3.75,"cache_1h":6.0,"cache_read":0.30},"claude-sonnet-4-5":{"in":3.0,"out":15.0,"cache_5m":3.75,"cache_1h":6.0,"cache_read":0.30},"claude-haiku-4-5":{"in":1.0,"out":5.0,"cache_5m":1.25,"cache_1h":2.0,"cache_read":0.10},"claude-haiku-3-5":{"in":0.80,"out":4.0,"cache_5m":1.0,"cache_1h":1.60,"cache_read":0.08}},"families":{"claude-opus-4":{"in":15.0,"out":75.0,"cache_5m":18.75,"cache_1h":30.0,"cache_read":1.50},"claude-sonnet-4":{"in":3.0,"out":15.0,"cache_5m":3.75,"cache_1h":6.0,"cache_read":0.30},"claude-sonnet":{"in":3.0,"out":15.0,"cache_5m":3.75,"cache_1h":6.0,"cache_read":0.30},"claude-haiku":{"in":1.0,"out":5.0,"cache_5m":1.25,"cache_1h":2.0,"cache_read":0.10},"claude-opus":{"in":5.0,"out":25.0,"cache_5m":6.25,"cache_1h":10.0,"cache_read":0.50}},"default":{"in":3.0,"out":15.0,"cache_5m":3.75,"cache_1h":6.0,"cache_read":0.30},"modifiers":{"inference_geo_us_multiplier":1.1,"web_search_per_1000":10.0,"web_fetch_per_1000":0.0}}'
  fi
}
_load_pricing
TODAY=$(date +%Y-%m-%d 2>/dev/null) || TODAY="1970-01-01"
[ -n "$TODAY" ] || TODAY="1970-01-01"

# ── E2: shared jq pricing library (price/bcost/fbcost) ─────────────────────
# Concatenated (bash-level, single-expansion — safe, no eval) ahead of each
# call site's own expression so jq sees "defs; expr" as required by its
# grammar. Every call site passes --argjson PR "$PRICING_JSON" --arg TODAY
# "$TODAY". Lookup order matches test_pricing.sh's independent reference
# implementation exactly: exact models[$model] -> longest families prefix ->
# default; Sonnet 5 swaps to .after once $TODAY > .intro_until. Cache prices
# use the JSON's explicit cache_5m/cache_1h/cache_read values directly (E2:
# no more derived 1.25x/2x/0.1x multipliers) with a same-formula fallback
# only for pricing blocks that omit them. Modifiers STACK: geo_us x fast.
# shellcheck disable=SC2016  # single-quoted on purpose: $model/$b/... below are jq variables, not bash
_PRICE_JQ_LIB='
def price($model):
  (if ($PR.models | has($model)) then $PR.models[$model]
   else ($PR.families | to_entries
         | map(select(.key as $fk | $model | startswith($fk)))
         | sort_by(.key | length) | last | .value // $PR.default) end)
  | if ((.intro_until? // null) != null) and ($TODAY > .intro_until) then .after else . end;
def bcost($model; $b; $geo_us; $fast):
  price($model) as $p |
  (if $fast and (($p.fast? // null) != null) then $p.fast else $p end) as $sp |
  (if $geo_us then ($PR.modifiers.inference_geo_us_multiplier // 1.1) else 1 end) as $gm |
  {in:  ($sp.in * $gm), out: ($sp.out * $gm),
   cr:  (($p.cache_read // ($sp.in * 0.1))  * $gm),
   c5m: (($p.cache_5m   // ($sp.in * 1.25)) * $gm),
   c1h: (($p.cache_1h   // ($sp.in * 2.0))  * $gm)} as $pr2 |
  ( (($b.in // 0) * $pr2.in)
    + (($b.out // 0) * $pr2.out)
    + (($b.cr // $b.cache_read // 0) * $pr2.cr)
    + (if (($b.cc_5m? // null) != null) or (($b.cc_1h? // null) != null)
       then (($b.cc_5m // 0) * $pr2.c5m + ($b.cc_1h // 0) * $pr2.c1h)
       else (($b.cc // $b.cache_creation // 0) * $pr2.c5m) end)
  ) / 1000000;
def fbcost($model; $n; $geo_us):
  price($model) as $p |
  (if $geo_us then ($PR.modifiers.inference_geo_us_multiplier // 1.1) else 1 end) as $gm |
  ($n * $p.in * $gm) / 1000000;
'
# E4: total estimated cost over an already-folded sidecar object (main
# .models + cumulative .subagent_models + .pending_subagents fallback
# estimates + legacy subagent_fallback_tokens + web-search), geo-multiplied
# session-wide when .inference_geo_us is set. Operates on "." (the sidecar).
# shellcheck disable=SC2016  # single-quoted on purpose: $geo/$fast/... below are jq variables, not bash
_EST_COST_JQ='
def total_est_cost:
  ((.inference_geo_us // false)) as $geo
  | ((.speed_fast // false)) as $fast
  | ( [ (.models // {}) | to_entries[] | bcost(.key; .value; $geo; $fast) ] | add // 0 )
    + ( [ (.subagent_models // {}) | to_entries[] | bcost(.key; .value; $geo; $fast) ] | add // 0 )
    + ( [ (.pending_subagents // {}) | to_entries[] | fbcost(.value.model // "unknown"; .value.fallback_estimate // 0; $geo) ] | add // 0 )
    + fbcost("unknown"; (.subagent_fallback_tokens // 0); $geo)
    + (((.web_search_total // 0) * ($PR.modifiers.web_search_per_1000 // 0)) / 1000)
    + (((.web_fetch_total  // 0) * ($PR.modifiers.web_fetch_per_1000  // 0)) / 1000);
'
# _recompute_cost_estimate — small wrapper applying the shared _PRICE_JQ_LIB/
# _EST_COST_JQ jq-source pattern (same construction as transcript-tail.sh's
# inline est_prog and recompute.sh's $prog) to the current $SIDECAR_JSON,
# writing estimated_cost_cents. Fail-open: any jq error leaves SIDECAR_JSON
# untouched. Used by subagent-tracking.sh's _run_subagent_stop_hook, which
# has no transcript tail pass of its own to compute this inline.
_recompute_cost_estimate() {
  local prog result
  prog="$_PRICE_JQ_LIB$_EST_COST_JQ"'
    . + {estimated_cost_cents: ((total_est_cost * 100) | round)}
  '
  result=$(printf '%s' "$SIDECAR_JSON" | jq --argjson PR "$PRICING_JSON" --arg TODAY "$TODAY" "$prog" 2>/dev/null) || return 0
  [ -n "$result" ] && SIDECAR_JSON="$result"
  return 0
}
