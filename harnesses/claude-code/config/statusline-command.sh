#!/usr/bin/env bash
# Furaidē statusline — 2-line, outer-pinned, width-adaptive (reads $COLUMNS).
# Requires: jq, python3. Claude Code exports COLUMNS before each run (v2.1.153+).
# Re-runs on: new assistant message, /compact, permission/vim mode change, refreshInterval timer.
# Terminal resize is NOT an automatic trigger — refreshInterval is the only mitigation.
#
# Line 1  L: 🧠 <model> │ <effort> │ 🕐 dur(📡 api-dur)   R: ↑inΣ⚡r% /↓outΣ[turn] [⫂ subin/subout] ~est(n) │ CTX: [bar] cur/win
# Line 2  L: 📁 path (branch) │ +add/-rem        R: 5hr: % (reset) │ 1wk: % (reset) │ $: cost [subcost]
#
# Env: STATUSLINE_GLYPHS=emoji|nerd|text   (default emoji)
# Env: STATUSLINE_STATE_DIR=<dir>          (default ~/.claude/statusline-state; test override)
#
# Standalone mode: `statusline-command.sh --recompute-all` skips the stdin
# hook payload and instead rebuilds every sidecar under STATUSLINE_STATE_DIR
# from a full-file (dedup-correct) scan of every local session transcript.

set -euo pipefail
if [ "${1:-}" = "--recompute-all" ]; then
  FURAIDE_SL_MODE="recompute"
  input='{}'
else
  FURAIDE_SL_MODE="render"
  input=$(cat)
fi

# ── ANSI ──────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'
BLU=$'\033[34m'; MAG=$'\033[35m'; CYN=$'\033[36m'; BYLW=$'\033[93m'
ORANGE=$'\033[38;5;208m'  # 256-color; modern terminals overwhelmingly support it (see README)
GLYPHS="${STATUSLINE_GLYPHS:-emoji}"

# ── jq helpers ─────────────────────────────────────────────────────────────
_jq()     { echo "$input" | jq -r "${1} // empty" 2>/dev/null || true; }
_jq_int() { echo "$input" | jq -r "${1} // 0" 2>/dev/null | cut -d. -f1 || true; }

# ── Pricing JSON loader ───────────────────────────────────────────────────
# Reads the pricing table into PRICING_JSON (a shell-global jq string).
# Lookup order: CLAUDE_PRICING_FILE env → ~/.claude/claude-pricing.json →
# $HERE/claude-pricing.json (shipped). If the global copy is missing, the
# shipped copy is copied there (best-effort). Fail-open: any read/parse
# failure falls back to an in-script copy of the same schema.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# ── width / format helpers ─────────────────────────────────────────────────
ESC=$'\033'
_vlen() {
  # Unicode-aware visual width: counts W/F chars as 2, combining marks as 0, rest as 1.
  # Falls back to awk byte-count if python3 absent.
  printf '%s' "$1" | python3 -c "
import sys,re,unicodedata as u
FW=set()
s=sys.stdin.read()
s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
print(sum(2 if c in FW or u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1) for c in s))
" 2>/dev/null || printf '%s' "$1" | sed "s/${ESC}\[[0-9;]*m//g" | awk '{print length}'
}
_trunc() {
  # Truncate to n visual columns, preserving ANSI color codes.
  # Only appends RST when input contained ANSI. Fallback: plain-text truncation.
  local s="$1" n="$2"
  printf '%s' "$s" | python3 -c "
import sys,re,unicodedata as u
FW=set()
def vw(c):return 2 if c in FW or u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1)
s=sys.stdin.read(); n=int('$n')
has_ansi=bool(re.search(r'\x1b\[',s))
plain=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
if sum(vw(c) for c in plain)<=n:sys.stdout.write(s);sys.exit()
r,w,i='',0,0
while i<len(s):
    m=re.match(r'\x1b\[[0-9;]*[A-Za-z]',s[i:])
    if m:r+=m.group();i+=len(m.group());continue
    cw=vw(s[i])
    if w+cw>n-1:break
    r+=s[i];w+=cw;i+=1
sys.stdout.write(r+'…'+('\x1b[0m' if has_ansi else ''))
" 2>/dev/null || { local v; v=$(printf '%s' "$s" | sed "s/${ESC}\[[0-9;]*m//g"); printf '%.*s…' "$((n-1))" "$v"; }
}
_human() {
  local n="${1:-0}"
  if   [ "$n" -ge 1000000 ]; then awk -v x="$n" 'BEGIN{printf "%.1fM", x/1000000}'
  elif [ "$n" -ge 1000 ];    then awk -v x="$n" 'BEGIN{printf "%dk", int(x/1000)}'
  else printf '%d' "$n"; fi
}
_until() {
  local t="$1" secs now diff d h m
  [ -z "$t" ] && return
  if printf '%s' "$t" | grep -qE '^[0-9]+$'; then secs="$t"
  else secs=$(date -d "$t" +%s 2>/dev/null || echo ""); fi
  [ -z "$secs" ] && return
  now=$(date +%s); diff=$(( secs - now )); [ "$diff" -lt 0 ] && diff=0
  d=$(( diff/86400 )); h=$(( (diff%86400)/3600 )); m=$(( (diff%3600)/60 ))
  if   [ "$d" -gt 0 ]; then printf '%dd%dh' "$d" "$h"
  elif [ "$h" -gt 0 ]; then printf '%dh%dm' "$h" "$m"
  else printf '%dm' "$m"; fi
}
_dur() {  # ms -> compact h/m/s (e.g. 3900000 -> "1h5m", 2400000 -> "40m", 3000 -> "3s")
  local ms="${1:-0}" tot h m s
  if [ "$ms" -lt 60000 ]; then
    s=$(( ms / 1000 )); printf '%ds' "$s"; return
  fi
  tot=$(( ms / 60000 )); h=$(( tot / 60 )); m=$(( tot % 60 ))
  if [ "$h" -gt 0 ]; then printf '%dh%dm' "$h" "$m"; else printf '%dm' "$m"; fi
}
_bar() {  # pct width
  local pct="$1" w="$2" f e i out=""
  f=$(( pct * w / 100 )); [ "$f" -gt "$w" ] && f=$w; [ "$f" -lt 0 ] && f=0
  e=$(( w - f ))
  for ((i=0;i<f;i++)); do out="${out}█"; done
  for ((i=0;i<e;i++)); do out="${out}░"; done
  printf '%s' "$out"
}
_pathshort() {  # collapse long path to <first>/…/<basename>
  local p="$1" max="${2:-28}"
  [ "${#p}" -le "$max" ] && { printf '%s' "$p"; return; }
  printf '%s/…/%s' "${p%%/*}" "$(basename "$p")"
}

COLS="${COLUMNS:-80}"; MARGIN=4; USABLE=$(( COLS - MARGIN ))
[ "$USABLE" -lt 20 ] && USABLE=20

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

_sidecar_prune() {  # delete state files older than 30 days; never fatal
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

# ── Task 8.2: transcript tail pass (token totals + subagent share) ─────────
# Incremental jq pass over the session transcript from the sidecar's
# transcript_offset (byte cursor). Sums main-thread assistant message.usage
# into {in,out,cache_read,cache_creation}_total plus per-model buckets, and
# folds in per-subagent totals discovered from Task-tool completions.
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
# Fail-open: any jq/parse failure leaves SIDECAR_JSON and the *_TOTAL
# globals untouched (caller keeps prior values).
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
        local aid ftok rmodel already sub_scan subfile
        aid=$(printf '%s' "$line" | jq -r '.agent_id // empty' 2>/dev/null)
        [ -z "$aid" ] && continue
        already=$(printf '%s' "$SIDECAR_JSON" | jq -r --arg t "$aid" '(.counted_subagents // []) | contains([$t])' 2>/dev/null)
        [ "$already" = "true" ] && continue
        ftok=$(printf '%s' "$line" | jq -r '.fallback_tokens // empty' 2>/dev/null)
        case "$ftok" in ''|*[!0-9]*) ftok=0 ;; esac
        rmodel=$(printf '%s' "$line" | jq -r '.resolved_model // empty' 2>/dev/null) || rmodel=""

        subfile="$(dirname "$path")/subagents/agent-${aid}.jsonl"
        if [ -r "$subfile" ] && sub_scan=$(_scan_usage_stdin "" 0 < "$subfile" 2>/dev/null); then
          SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$aid" --argjson s "$sub_scan" '
            .subagent_in_total    = ((.subagent_in_total    // 0) + ($s.in // 0))
            | .subagent_out_total   = ((.subagent_out_total   // 0) + ($s.out // 0))
            | .subagent_cr_total    = ((.subagent_cr_total    // 0) + ($s.cr // 0))
            | .subagent_cc_total    = ((.subagent_cc_total    // 0) + ($s.cc // 0))
            | .subagent_rate_sum    = ((.subagent_rate_sum    // 0) + ($s.rate_sum // 0))
            | .subagent_rate_turns  = ((.subagent_rate_turns  // 0) + ($s.rate_turns // 0))
            | .subagent_models = (reduce (($s.models // {}) | to_entries[]) as $e ((.subagent_models // {});
                .[$e.key] = { in:    ((.[$e.key].in    // 0) + ($e.value.in    // 0)),
                              out:   ((.[$e.key].out   // 0) + ($e.value.out   // 0)),
                              cr:    ((.[$e.key].cr    // 0) + ($e.value.cr    // 0)),
                              cc:    ((.[$e.key].cc    // 0) + ($e.value.cc    // 0)),
                              cc_5m: ((.[$e.key].cc_5m // 0) + ($e.value.cc_5m // 0)),
                              cc_1h: ((.[$e.key].cc_1h // 0) + ($e.value.cc_1h // 0)) }))
            | .counted_subagents = ((.counted_subagents // []) + [$t])
            | .pending_subagents = ((.pending_subagents // {}) | del(.[$t]))
          ' 2>/dev/null) || continue
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
  local pend_ids pid p_scan p_file
  pend_ids=$(printf '%s' "$SIDECAR_JSON" | jq -r '(.pending_subagents // {}) | keys[]' 2>/dev/null) || pend_ids=""
  if [ -n "$pend_ids" ]; then
    while IFS= read -r pid; do
      [ -z "$pid" ] && continue
      p_file="$(dirname "$path")/subagents/agent-${pid}.jsonl"
      [ -r "$p_file" ] || continue
      p_scan=$(_scan_usage_stdin "" 0 < "$p_file" 2>/dev/null) || continue
      SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$pid" --argjson s "$p_scan" '
        .subagent_in_total    = ((.subagent_in_total    // 0) + ($s.in // 0))
        | .subagent_out_total   = ((.subagent_out_total   // 0) + ($s.out // 0))
        | .subagent_cr_total    = ((.subagent_cr_total    // 0) + ($s.cr // 0))
        | .subagent_cc_total    = ((.subagent_cc_total    // 0) + ($s.cc // 0))
        | .subagent_rate_sum    = ((.subagent_rate_sum    // 0) + ($s.rate_sum // 0))
        | .subagent_rate_turns  = ((.subagent_rate_turns  // 0) + ($s.rate_turns // 0))
        | .subagent_models = (reduce (($s.models // {}) | to_entries[]) as $e ((.subagent_models // {});
            .[$e.key] = { in:    ((.[$e.key].in    // 0) + ($e.value.in    // 0)),
                          out:   ((.[$e.key].out   // 0) + ($e.value.out   // 0)),
                          cr:    ((.[$e.key].cr    // 0) + ($e.value.cr    // 0)),
                          cc:    ((.[$e.key].cc    // 0) + ($e.value.cc    // 0)),
                          cc_5m: ((.[$e.key].cc_5m // 0) + ($e.value.cc_5m // 0)),
                          cc_1h: ((.[$e.key].cc_1h // 0) + ($e.value.cc_1h // 0)) }))
        | .counted_subagents = ((.counted_subagents // []) + [$t])
        | .pending_subagents = ((.pending_subagents // {}) | del(.[$t]))
      ' 2>/dev/null) || continue
    done <<<"$pend_ids"
  fi

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

# ── --recompute-all: one-shot full rebuild of every local sidecar ──────────
# Iterates every top-level main transcript under ~/.claude/projects/*/ (only
# main sessions live at that level — subagent transcripts always sit under a
# parent session's subagents/ dir and never get their own sidecar). For each:
# full-file dedup scan of the main thread + every subagents/agent-*.jsonl
# sibling (direct glob — more robust than completion-record parsing, and a
# full local rescan can always read the files, so no pending entries remain),
# then rebuild the sidecar's token fields wholesale. Duration-fold keys from
# an existing sidecar are preserved; the byte cursor is set past the last
# complete line so future incremental passes start from a correct baseline.
_recompute_all() {
  local sess sid sidecar existing scan size adv subs counted sub aid subscan sdir new count=0 prog
  mkdir -p "$SIDECAR_DIR" 2>/dev/null || true
  for sess in "$HOME"/.claude/projects/*/*.jsonl; do
    [ -f "$sess" ] || continue
    sid=$(basename "$sess" .jsonl)
    sidecar="${SIDECAR_DIR}/${sid}.json"
    existing='{}'
    if [ -f "$sidecar" ]; then
      existing=$(cat "$sidecar" 2>/dev/null) || existing='{}'
      printf '%s' "$existing" | jq -e . >/dev/null 2>&1 || existing='{}'
    fi
    scan=$(_scan_usage_stdin "" 0 < "$sess" 2>/dev/null) || { echo "skip  $sid (main scan failed)"; continue; }
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
      --argjson off "$adv" --argjson PR "$PRICING_JSON" --arg TODAY "$TODAY" "$prog" 2>/dev/null) || { echo "skip  $sid (merge failed)"; continue; }
    if _sidecar_save "$sidecar" "$new"; then
      count=$((count+1))
      echo "rebuilt $sid: in=$(printf '%s' "$scan" | jq -r '.in') out=$(printf '%s' "$scan" | jq -r '.out') cr=$(printf '%s' "$scan" | jq -r '.cr') cc=$(printf '%s' "$scan" | jq -r '.cc') subagents=$(printf '%s' "$counted" | jq -r 'length') est_cost_cents=$(printf '%s' "$new" | jq -r '.estimated_cost_cents // 0')"
    else
      echo "skip  $sid (sidecar write failed)"
    fi
  done
  echo "recomputed ${count} sidecar(s) into ${SIDECAR_DIR}"
}
if [ "$FURAIDE_SL_MODE" = "recompute" ]; then
  command -v jq >/dev/null 2>&1 || { echo "error: --recompute-all requires jq" >&2; exit 1; }
  _recompute_all
  exit 0
fi

RAW_DURATION_MS=$(_jq_int '.cost.total_duration_ms')
RAW_API_MS=$(_jq_int '.cost.total_api_duration_ms')
case "$RAW_DURATION_MS" in ''|*[!0-9]*) RAW_DURATION_MS=0 ;; esac
case "$RAW_API_MS" in ''|*[!0-9]*) RAW_API_MS=0 ;; esac
DURATION_MS="$RAW_DURATION_MS"
API_MS="$RAW_API_MS"

if command -v jq >/dev/null 2>&1 && [ -n "$SESSION_ID" ]; then
  SIDECAR_PATH="${SIDECAR_DIR}/${SESSION_ID}.json"
  _sidecar_prune
  _sidecar_load "$SIDECAR_PATH" || SIDECAR_JSON='{}'
  _migrate_sidecar
  if _fold_metric "$RAW_DURATION_MS" base_duration_ms last_duration_ms; then
    FOLDED_DURATION_MS="$FOLD_RESULT"
    if _fold_metric "$RAW_API_MS" base_api_duration_ms last_api_ms; then
      FOLDED_API_MS="$FOLD_RESULT"
      # D1: cost is reset by Claude Code on resume, so fold it like duration.
      # _fold_metric is integer-only; keep cost in cents internally and convert
      # back to dollars only for display. Non-numeric payload cost falls open to 0.
      RAW_COST_CENTS=$(awk -v c="$(_jq '.cost.total_cost_usd // 0')" 'BEGIN{printf "%d", c*100 + 0.5}')
      case "$RAW_COST_CENTS" in ''|*[!0-9]*) RAW_COST_CENTS=0 ;; esac
      if _fold_metric "$RAW_COST_CENTS" base_cost_cents last_cost_cents; then
        FOLDED_COST_CENTS="$FOLD_RESULT"
        if _sidecar_save "$SIDECAR_PATH" "$SIDECAR_JSON"; then
          DURATION_MS="$FOLDED_DURATION_MS"
          API_MS="$FOLDED_API_MS"
          COST=$(awk -v c="$FOLDED_COST_CENTS" 'BEGIN{printf "%.2f", c/100}')
        fi
      fi
    fi
  fi
fi

# ── Task 8.2: transcript tail pass (reuses SIDECAR_JSON/SIDECAR_PATH above) ─
TRANSCRIPT_PATH=$(_jq '.transcript_path')
IN_TOTAL=0; OUT_TOTAL=0; CACHE_READ_TOTAL=0; CACHE_CREATION_TOTAL=0
SUBAGENT_IN_TOTAL=0; SUBAGENT_OUT_TOTAL=0; SUBAGENT_FALLBACK_TOTAL=0
SUBAGENT_CR_TOTAL=0; SUBAGENT_CC_TOTAL=0
PENDING_EST_TOTAL=0; PENDING_COUNT=0
TAIL_OK=0
if command -v jq >/dev/null 2>&1 && [ -n "$SESSION_ID" ] \
   && [ -n "$TRANSCRIPT_PATH" ] && [ -r "$TRANSCRIPT_PATH" ]; then
  SIDECAR_PATH="${SIDECAR_DIR}/${SESSION_ID}.json"
  if _transcript_tail_pass "$TRANSCRIPT_PATH"; then
    _sidecar_save "$SIDECAR_PATH" "$SIDECAR_JSON" && TAIL_OK=1
  fi
fi

_ramp() {  # pct t1 t2 [t3] -> color code. 3 args: GRN<t1<=YLW<t2<=RED. 4 args: GRN<t1<=YLW<t2<=ORANGE<t3<=RED.
  local pct="$1" t1="$2" t2="$3" t3="${4:-}"
  if [ -n "$t3" ]; then
    if   [ "$pct" -ge "$t3" ]; then printf '%s' "$RED"
    elif [ "$pct" -ge "$t2" ]; then printf '%s' "$ORANGE"
    elif [ "$pct" -ge "$t1" ]; then printf '%s' "$YLW"
    else printf '%s' "$GRN"; fi
  else
    if   [ "$pct" -ge "$t2" ]; then printf '%s' "$RED"
    elif [ "$pct" -ge "$t1" ]; then printf '%s' "$YLW"
    else printf '%s' "$GRN"; fi
  fi
}

_lr() {  # left right [pre-ll] [pre-rl] -> outer-pinned line with truncation
  local left="$1" right="$2" ll="${3:-}" rl="${4:-}"
  [ -z "$ll" ] && ll=$(_vlen "$left")
  [ -z "$rl" ] && rl=$(_vlen "$right")
  if [ $(( ll + rl + 1 )) -gt "$USABLE" ]; then
    local maxleft=$(( USABLE - rl - 1 )); [ "$maxleft" -lt 4 ] && maxleft=4
    left=$(_trunc "$left" "$maxleft"); ll=$(_vlen "$left")
    if [ $(( ll + rl + 1 )) -gt "$USABLE" ]; then
      right=$(_trunc "$right" $(( USABLE - ll - 1 ))); rl=$(_vlen "$right")
    fi
  fi
  local pad=$(( USABLE - ll - rl )); [ "$pad" -lt 1 ] && pad=1
  printf '%s%*s%s\n' "$left" "$pad" '' "$right"
}

# ── Line 1 LEFT: model │ effort │ 🕐 dur(📡 api-dur) ─────────────────────────
MODEL=$(_jq '.model.display_name'); [ -z "$MODEL" ] && MODEL="?"
case "$MODEL" in
  *Opus*)   MC="$MAG" ;; *Sonnet*) MC="$BLU" ;; *Haiku*) MC="$GRN" ;;
  *Fable*|*Mythos*) MC="$ORANGE" ;; *) MC="$BOLD" ;;
esac
case "$GLYPHS" in emoji) MG="🧠 " ;; nerd) MG=$' ' ;; *) MG="" ;; esac
L1L="${BOLD}${MC}${MG}${MODEL}${RST}"
EFFORT=$(_jq '.effort.level')
if [ -n "$EFFORT" ]; then
  case "$EFFORT" in
    low) EC="$DIM" ;; medium) EC="$CYN" ;; high) EC="$YLW" ;;
    xhigh) EC="$BYLW" ;; max) EC="$RED" ;; *) EC="$DIM" ;;
  esac
  L1L+=" ${DIM}│${RST} ${EC}${EFFORT}${RST}"
fi
if [ "$DURATION_MS" -ge 60000 ]; then
  case "$GLYPHS" in emoji) CG="🕐 " ;; nerd) CG=$' ' ;; *) CG="" ;; esac
  L1L+=" ${DIM}│${RST} ${DIM}${CG}$(_dur "$DURATION_MS")${RST}"
  if [ "$API_MS" -gt 0 ]; then
    # D2: keep the space inside the glyph var so emoji shows "(📡 ", nerd
    # shows "( ", and text shows "(...)" with no stray leading space.
    case "$GLYPHS" in emoji) PG="📡 " ;; nerd) PG=$' ' ;; *) PG="" ;; esac
    L1L+="${DIM}(${PG}$(_dur "$API_MS"))${RST}"
  fi
fi

# ── Line 1 RIGHT: ↑inΣ⚡r% /↓outΣ[turn] [⫂ subin/subout] ~est(n) │ CTX: [bar] cur/win ──
# Token totals: prefer the transcript tail-pass sums (whole-session, deduped
# by message.id); fall back to the payload's own context_window fields when
# the tail pass didn't run (missing/unreadable transcript, no jq — fail-open).
# current_usage is read first because its output_tokens feeds the [turn]
# bracket on the ↓ figure. Documented quirk: current_usage can be null before
# the first response or right after /compact — CUR then falls back to the
# session-total input field and the [turn] bracket is omitted.
CU_PRESENT=$(_jq '.context_window.current_usage')
if [ -n "$CU_PRESENT" ] && [ "$CU_PRESENT" != "null" ]; then
  CUR_IN=$(_jq_int '.context_window.current_usage.input_tokens')
  CUR_OUT_T=$(_jq_int '.context_window.current_usage.output_tokens')
  CUR_CR=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
  CUR_CC=$(_jq_int '.context_window.current_usage.cache_creation_input_tokens')
  CUR=$(( CUR_IN + CUR_OUT_T + CUR_CR + CUR_CC ))
  TURN_OUT="$CUR_OUT_T"
  HAVE_TURN_OUT=1
else
  CUR=$(_jq_int '.context_window.total_input_tokens')
  TURN_OUT=0
  HAVE_TURN_OUT=0
fi

DISPLAY_IN="$IN_TOTAL"; DISPLAY_OUT="$OUT_TOTAL"
DISPLAY_CR="$CACHE_READ_TOTAL"; DISPLAY_CC="$CACHE_CREATION_TOTAL"
if [ "$TAIL_OK" -ne 1 ]; then
  DISPLAY_IN=$(_jq_int '.context_window.total_input_tokens')
  DISPLAY_OUT=$(_jq_int '.context_window.total_output_tokens')
  DISPLAY_CR=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
  DISPLAY_CC=0
  SUBAGENT_IN_TOTAL=0; SUBAGENT_OUT_TOTAL=0; SUBAGENT_CR_TOTAL=0; SUBAGENT_CC_TOTAL=0
  SUBAGENT_FALLBACK_TOTAL=0; PENDING_EST_TOTAL=0; PENDING_COUNT=0
fi
# The subagent "in" figure folds its own cache reads/writes (mirroring how
# the grand ↑ figure folds the main thread's) plus the legacy fallback lump
# from pre-pending sidecars. Pending estimates stay out of confirmed sums.
SUB_IN_EFF=$(( SUBAGENT_IN_TOTAL + SUBAGENT_CR_TOTAL + SUBAGENT_CC_TOTAL + SUBAGENT_FALLBACK_TOTAL ))
SUB_OUT_EFF="$SUBAGENT_OUT_TOTAL"
GRAND_TOTAL_IN=$(( DISPLAY_IN + DISPLAY_CR + DISPLAY_CC + SUB_IN_EFF ))
GRAND_TOTAL_OUT=$(( DISPLAY_OUT + SUB_OUT_EFF ))
# Token glyphs honor STATUSLINE_GLYPHS: emoji (default) keeps the compact
# unicode set; nerd swaps the subagent glyph for the git-branch icon; text
# degrades to pure-ASCII labels.
case "$GLYPHS" in
  text) TG_IN="in:"; TG_CACHE=" cache:"; TG_OUT="out:"; TG_SUB="sub " ;;
  nerd) TG_IN="↑"; TG_CACHE="⚡"; TG_OUT="↓"; TG_SUB=$' ' ;;
  *)    TG_IN="↑"; TG_CACHE="⚡"; TG_OUT="↓"; TG_SUB="⫂ " ;;
esac
IN_STR="${GRN}${TG_IN}$(_human "$GRAND_TOTAL_IN")${RST}"
# D3: cache-hit % is the unweighted average of each turn's own read rate.
# When we have transcript-derived sidecar data, compute from per-turn rate_sum
# and rate_turns (main + done subagents); otherwise fall back to the legacy
# cumulative token-weighted ratio (no per-turn data available).
if [ "$TAIL_OK" -eq 1 ]; then
  READ_PCT=$(printf '%s' "$SIDECAR_JSON" | jq -r '
    ((.rate_sum // 0) + (.subagent_rate_sum // 0)) as $rs
    | ((.rate_turns // 0) + (.subagent_rate_turns // 0)) as $rt
    | if $rt > 0 and $rs > 0 then ((100 * $rs / $rt) | floor) else 0 end' 2>/dev/null)
  case "$READ_PCT" in ''|*[!0-9]*) READ_PCT=0 ;; esac
  if [ "$READ_PCT" -gt 0 ]; then
    IN_STR+="${DIM}${TG_CACHE}${READ_PCT}%${RST}"
  fi
else
  READ_TOTAL=$(( DISPLAY_CR + SUBAGENT_CR_TOTAL ))
  if [ "$GRAND_TOTAL_IN" -gt 0 ] && [ "$READ_TOTAL" -gt 0 ]; then
    READ_PCT=$(( READ_TOTAL * 100 / GRAND_TOTAL_IN ))
    IN_STR+="${DIM}${TG_CACHE}${READ_PCT}%${RST}"
  fi
fi
OUT_STR="${BLU}${TG_OUT}$(_human "$GRAND_TOTAL_OUT")${RST}"
[ "$HAVE_TURN_OUT" -eq 1 ] && OUT_STR+="${DIM}[$(_human "$TURN_OUT")]${RST}"
TOK="${IN_STR} ${DIM}/${RST}${OUT_STR}"

# Subagent segment: confirmed raw counts as [⫂ in/out]; any still-pending
# (transcript-not-yet-readable) subagents render separately as ~est(n) so an
# estimate never blends into the confirmed figures. Omit both when idle.
SUB_SEG=""
if [ "$SUB_IN_EFF" -gt 0 ] || [ "$SUB_OUT_EFF" -gt 0 ]; then
  SUB_SEG=" ${DIM}[${TG_SUB}$(_human "$SUB_IN_EFF")/$(_human "$SUB_OUT_EFF")]${RST}"
fi
if [ "${PENDING_COUNT:-0}" -gt 0 ]; then
  SUB_SEG+=" ${DIM}~$(_human "$PENDING_EST_TOTAL")(${PENDING_COUNT})${RST}"
fi

# CTX: window-aware ramp tiers (>300K tier: 20/50; <=300K tier: 50/75).
WIN=$(_jq_int '.context_window.context_window_size')
CTX_PCT_RAW=$(_jq '.context_window.used_percentage')
if [ -n "$CTX_PCT_RAW" ]; then
  CTX_PCT=$(printf '%s' "$CTX_PCT_RAW" | cut -d. -f1)
elif [ "$WIN" -gt 0 ]; then
  CTX_PCT=$(( CUR * 100 / WIN ))
else
  CTX_PCT=0
fi
if [ "$WIN" -gt 300000 ]; then CTXC=$(_ramp "$CTX_PCT" 20 50)
else CTXC=$(_ramp "$CTX_PCT" 50 75)
fi
CTX_SEG="${DIM}CTX:${RST} ${CTXC}[$(_bar "$CTX_PCT" 10)]${RST} ${DIM}$(_human "$CUR")/$(_human "$WIN")${RST}"

L1R="${TOK}${SUB_SEG} ${DIM}│${RST} ${CTX_SEG}"

# ── Line 2 LEFT: path (branch) │ +add/-rem ────────────────────────────────
DIR=$(_jq '.workspace.current_dir // .cwd')
RAWDIR="$DIR"
case "$DIR" in "$HOME"*) DIR="~${DIR#"$HOME"}" ;; esac
DIR=$(_pathshort "$DIR")
BRANCH=""
[ -n "$RAWDIR" ] && BRANCH=$(git -C "$RAWDIR" branch --show-current 2>/dev/null \
  || git -C "$RAWDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
WT=$(_jq '.workspace.git_worktree')
[ -z "$BRANCH" ] && BRANCH="$WT"
case "$GLYPHS" in emoji) DG="📁 " ;; nerd) DG=$' ' ;; *) DG="" ;; esac
case "$GLYPHS" in nerd) BG=$' ' ;; *) BG="" ;; esac  # powerline branch glyph, nerd mode only
L2L="${DG}${BOLD}${DIR}${RST}"
[ -n "$BRANCH" ] && L2L+=" ${YLW}(${BG}${BRANCH})${RST}"
LINES_ADD=$(_jq_int '.cost.total_lines_added')
LINES_REM=$(_jq_int '.cost.total_lines_removed')
if [ "$LINES_ADD" -gt 0 ] || [ "$LINES_REM" -gt 0 ]; then
  L2L+=" ${DIM}│${RST} ${GRN}+${LINES_ADD}${RST}/${RED}-${LINES_REM}${RST}"
fi

# ── Line 2 RIGHT: rate limits (each window independently optional) │ $: cost [subcost] ──
# If the sidecar fold ran, COST was already set to the folded dollars (the
# authoritative live payload total). Fail-open path (no jq/session_id): read
# the raw payload value directly. E4: when neither source produced a
# non-zero figure (no live cost payload ever seen for this session), fall
# back to the sidecar's own estimated_cost_cents (our token x pricing
# estimate — the only source available for recompute-only sessions). No
# special "this is an estimate" marker, same convention as SUB_COST below.
if [ -z "${COST:-}" ]; then
  COST=$(_jq '.cost.total_cost_usd // empty')
  [ -n "$COST" ] && COST=$(printf '%s' "$COST" | awk '{printf "%.2f",$1}')
fi
NEED_EST_FALLBACK=0
if [ -z "${COST:-}" ]; then
  NEED_EST_FALLBACK=1
else
  awk -v c="$COST" 'BEGIN{exit !(c==0)}' && NEED_EST_FALLBACK=1
fi
if [ "$NEED_EST_FALLBACK" -eq 1 ]; then
  EST_COST_CENTS=""
  if [ "$TAIL_OK" -eq 1 ]; then
    EST_COST_CENTS=$(printf '%s' "$SIDECAR_JSON" | jq -r '.estimated_cost_cents // 0' 2>/dev/null)
    case "$EST_COST_CENTS" in ''|*[!0-9]*) EST_COST_CENTS=0 ;; esac
  fi
  if [ -n "$EST_COST_CENTS" ] && [ "$EST_COST_CENTS" -gt 0 ]; then
    COST=$(awk -v c="$EST_COST_CENTS" 'BEGIN{printf "%.2f", c/100}')
  fi
fi
# Subagent cost estimate: per-model token buckets × the E2 pricing-JSON
# lookup (exact model -> longest family prefix -> default; date-aware Sonnet
# 5; explicit cache_5m/cache_1h/cache_read values; geo_us/fast modifiers
# applied session-wide per the sidecar's sticky flags). No per-call cost
# exists anywhere in the harness data (total_cost_usd is one session-wide
# number), so this is a computed ESTIMATE by design — do not try to
# reconcile it against the harness total. E3: reads the cumulative
# subagent_models bucket + pending_subagents fallbacks, not a per-agent map.
SUB_COST=""
if [ "$TAIL_OK" -eq 1 ]; then
  # shellcheck disable=SC2016  # single-quoted continuation: jq's own $vars, not bash
  SUB_COST_PROG="$_PRICE_JQ_LIB"'
    ((.inference_geo_us // false)) as $geo
    | ((.speed_fast // false)) as $fast
    | ( [ (.subagent_models // {}) | to_entries[] | bcost(.key; .value; $geo; $fast) ] | add // 0 )
      + ( [ (.pending_subagents // {}) | to_entries[] | fbcost(.value.model // "unknown"; .value.fallback_estimate // 0; $geo) ] | add // 0 )
      + fbcost("unknown"; (.subagent_fallback_tokens // 0); $geo)
    | if . > 0 then tostring else empty end
  '
  SUB_COST=$(printf '%s' "$SIDECAR_JSON" | jq -r --argjson PR "$PRICING_JSON" --arg TODAY "$TODAY" "$SUB_COST_PROG" 2>/dev/null) || SUB_COST=""
  [ -n "$SUB_COST" ] && SUB_COST=$(printf '%s' "$SUB_COST" | awk '{printf "%.2f",$1}')
fi
R5_RAW=$(_jq '.rate_limits.five_hour.used_percentage')
R7_RAW=$(_jq '.rate_limits.seven_day.used_percentage')
L2R=""
if [ -n "$R5_RAW" ]; then
  R5=$(printf '%s' "$R5_RAW" | cut -d. -f1); [ -z "$R5" ] && R5=0
  R5C=$(_ramp "$R5" 50 75 90)
  T5=$(_until "$(_jq '.rate_limits.five_hour.resets_at')")
  L2R+="${DIM}5hr:${RST} ${R5C}${R5}%${RST}"; [ -n "$T5" ] && L2R+=" (${T5})"
fi
if [ -n "$R7_RAW" ]; then
  R7=$(printf '%s' "$R7_RAW" | cut -d. -f1); [ -z "$R7" ] && R7=0
  R7C=$(_ramp "$R7" 50 75 90)
  T7=$(_until "$(_jq '.rate_limits.seven_day.resets_at')")
  [ -n "$L2R" ] && L2R+=" ${DIM}│${RST} "
  L2R+="${DIM}1wk:${RST} ${R7C}${R7}%${RST}"; [ -n "$T7" ] && L2R+=" (${T7})"
fi
# Cost magnitude ramp (total only; the [sub] estimate stays dim):
# dim < $5 <= yellow < $25 <= orange < $50 <= red.
COST_C="$DIM"
COST_INT=$(printf '%s' "${COST:-0}" | cut -d. -f1)
case "$COST_INT" in ''|*[!0-9]*) COST_INT=0 ;; esac
if   [ "$COST_INT" -ge 50 ]; then COST_C="$RED"
elif [ "$COST_INT" -ge 25 ]; then COST_C="$ORANGE"
elif [ "$COST_INT" -ge 5 ];  then COST_C="$YLW"
fi
[ -n "$L2R" ] && L2R+=" ${DIM}│${RST} "
L2R+="${DIM}\$:${RST} ${COST_C}${COST:-0.00}${RST}"
# D4: subagent cost is displayed as a % of the (folded) session total, not as
# dollars. SUB_COST is an independent estimate against the harness total, so
# the % can legitimately exceed 100 — do not clamp it.
SUB_COST_PCT=""
if [ -n "$SUB_COST" ] && [ -n "${COST:-}" ]; then
  SUB_COST_PCT=$(awk -v s="$SUB_COST" -v t="$COST" 'BEGIN{ if (t+0 > 0) printf "%d", (s*100)/t }')
fi
[ -n "$SUB_COST_PCT" ] && L2R+=" ${DIM}[${SUB_COST_PCT}%]${RST}"

# ── Batch width computation → render both lines ────────────────────────────
read -r _w1l _w1r _w2l _w2r < <(
  printf '%s\n%s\n%s\n%s\n' "$L1L" "$L1R" "$L2L" "$L2R" \
  | python3 -c "
import sys,re,unicodedata as u
FW=set()
def vw(s):
    s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
    return sum(2 if c in FW or u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1) for c in s)
for line in sys.stdin: print(vw(line.rstrip('\n')), end=' ')
" 2>/dev/null) || true
_lr "$L1L" "$L1R" "${_w1l:-}" "${_w1r:-}"
_lr "$L2L" "$L2R" "${_w2l:-}" "${_w2r:-}"

exit 0
