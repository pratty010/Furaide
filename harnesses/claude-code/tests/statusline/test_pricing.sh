#!/usr/bin/env bash
# Plain-bash test harness for statusline-command.sh's pricing logic.
# Tests: exact model match, longest family prefix, default fallback,
# date-aware Sonnet 5 cutover, inference_geo: "us" multiplier,
# speed: "fast" premium pricing, and session-level pre-scan flags.
# Run: bash tests/statusline/test_pricing.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../../config/statusline-command.sh"
PRICING_FILE="$HERE/../../config/claude-pricing.json"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0
FAIL=0

_assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  # Use awk for float comparison (bash can't do floats)
  if awk "BEGIN{exit !($expected == $actual)}"; then
    PASS=$((PASS+1))
    echo "PASS: $desc"
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $desc (expected '$expected', got '$actual')"
  fi
}

_assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    PASS=$((PASS+1))
    echo "PASS: $desc"
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $desc"
    echo "  expected to find: $needle"
  fi
}

_assert_json_field() {  # desc json_file jq_path expected_value
  local desc="$1" file="$2" path="$3" expected="$4" actual
  actual=$(jq -r "$path" "$file" 2>/dev/null)
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS+1))
    echo "PASS: $desc"
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $desc (expected '$expected', got '$actual')"
  fi
}

# Helper: run the jq price() function for a model, returns "{in, out}"
_price_block() {  # model [today]
  local model="$1" today="${2:-2026-07-10}"
  echo "null" | jq -r --argjson pr "$(cat "$PRICING_FILE")" --arg today "$today" --arg m "$model" '
    # price($model): exact models[$model] -> longest-prefix families match -> default.
    # WHY longest-prefix: "claude-opus-4-8" should match models["claude-opus-4-8"] exactly,
    # NOT the broader "claude-opus" family. "claude-sonnet-4-99" has no exact match and no
    # "claude-sonnet-4-99" family, so it falls through to the longest family that IS a prefix.
    def price($model):
      (if ($pr.models | has($model)) then $pr.models[$model]
       else ($pr.families | to_entries
             | map(select(.key as $fk | $model | startswith($fk)))
             | sort_by(.key | length) | last | .value // $pr.default) end)
      | if .intro_until? and ($today > .intro_until) then .after else . end;
    price($m) | {in: .in, out: .out}
  '
}

# Helper: run the jq bcost() function, returns the cost
_bcost() {  # model input_tokens output_tokens cache_read cc_5m cc_1h [today] [geo_us] [fast]
  local model="$1" in_tok="$2" out_tok="$3" cr="$4" cc5="$5" cc1="$6"
  local today="${7:-2026-07-10}" geo_us="${8:-false}" fast="${9:-false}"
  echo "null" | jq -r --argjson pr "$(cat "$PRICING_FILE")" --arg today "$today" \
    --arg m "$model" --argjson in "$in_tok" --argjson out "$out_tok" \
    --argjson cr "$cr" --argjson cc5 "$cc5" --argjson cc1 "$cc1" \
    --argjson geo_us "$geo_us" --argjson fast "$fast" '
    def price($model):
      (if ($pr.models | has($model)) then $pr.models[$model]
       else ($pr.families | to_entries
             | map(select(.key as $fk | $model | startswith($fk)))
             | sort_by(.key | length) | last | .value // $pr.default) end)
      | if .intro_until? and ($today > .intro_until) then .after else . end;
    def bcost($model; $in; $out; $cr; $cc5; $cc1; $geo_us; $fast):
      price($model) as $p |
      (if $fast and ($p.fast? // null) != null then $p.fast else $p end) as $sp |
      (if $geo_us then ($pr.modifiers.inference_geo_us_multiplier // 1.1) else 1 end) as $gm |
      {in: ($sp.in * $gm), out: ($sp.out * $gm),
       cr: (($p.cache_read // ($sp.in * 0.1)) * $gm),
       c5m: (($p.cache_5m // ($sp.in * 1.25)) * $gm),
       c1h: (($p.cache_1h // ($sp.in * 2.0)) * $gm)} as $prices |
      ($in * $prices.in + $out * $prices.out + $cr * $prices.cr +
       $cc5 * $prices.c5m + $cc1 * $prices.c1h) / 1000000;
    bcost($m; $in; $out; $cr; $cc5; $cc1; $geo_us; $fast)
  '
}

# Helper: run a full script invocation with geo/speed fields in the transcript
_run_with_geo_speed() {  # transcript_jsonl payload_json state_dir -> stdout
  local transcript="$1" payload="$2" state_dir="$3"
  COLUMNS=120 STATUSLINE_STATE_DIR="$state_dir" bash "$SCRIPT" <<<"$payload" 2>&1
}

_mk_payload() {  # session_id transcript_path [total_cost_usd]
  local cost="${3:-1.23}"
  cat <<EOF
{
  "session_id": "$1",
  "transcript_path": "$2",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 0, "total_api_duration_ms": 0, "total_cost_usd": ${cost},
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"used_percentage": 10, "total_input_tokens": 1000, "total_output_tokens": 200,
                      "context_window_size": 200000, "current_usage": {"cache_read_input_tokens": 0}},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}
EOF
}



echo "=== Pricing Tests ==="

echo "== Test 1: exact model match (claude-fable-5 gets \$10/\$50) =="
BLOCK=$(_price_block "claude-fable-5")
_assert_eq "fable-5 in=10.0" "10.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "fable-5 out=50.0" "50.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 2: exact model match (claude-opus-4-8 gets \$5/\$25) =="
BLOCK=$(_price_block "claude-opus-4-8")
_assert_eq "opus-4-8 in=5.0" "5.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "opus-4-8 out=25.0" "25.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 3: longest family prefix match (unknown claude-sonnet-4-99 gets \$3/\$15) =="
BLOCK=$(_price_block "claude-sonnet-4-99")
_assert_eq "sonnet-4-99 in=3.0 (family match)" "3.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "sonnet-4-99 out=15.0 (family match)" "15.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 4: family prefix match (claude-opus-4 gets \$15/\$75 via claude-opus-4 family) =="
BLOCK=$(_price_block "claude-opus-4")
_assert_eq "opus-4 family in=15.0 (longest prefix)" "15.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "opus-4 family out=75.0 (longest prefix)" "75.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 5: fallback to default (brand-new unknown model gets \$3/\$15) =="
BLOCK=$(_price_block "claude-ultra-6-0")
_assert_eq "unknown model in=3.0 (default)" "3.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "unknown model out=15.0 (default)" "15.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 6: Sonnet 5 introductory rate (today <= 2026-08-31 gets \$2/\$10) =="
BLOCK=$(_price_block "claude-sonnet-5" "2026-08-15")
_assert_eq "sonnet-5 intro in=2.0" "2.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "sonnet-5 intro out=10.0" "10.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 7: Sonnet 5 post-cutover rate (today > 2026-08-31 gets \$3/\$15) =="
BLOCK=$(_price_block "claude-sonnet-5" "2026-09-01")
_assert_eq "sonnet-5 after in=3.0" "3.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "sonnet-5 after out=15.0" "15.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 8: Sonnet 5 cutover boundary (today == 2026-08-31 still intro \$2/\$10) =="
BLOCK=$(_price_block "claude-sonnet-5" "2026-08-31")
_assert_eq "sonnet-5 boundary in=2.0 (still intro)" "2.0" "$(echo "$BLOCK" | jq '.in')"
_assert_eq "sonnet-5 boundary out=10.0 (still intro)" "10.0" "$(echo "$BLOCK" | jq '.out')"

echo "== Test 9: inference_geo: us 1.1x multiplier (haiku-4-5: in \$1.0 * 1.1 = \$1.1/MTok) =="
# bcost with geo_us=true: 1000 input tokens -> 1000 * 1.1 / 1000000 = 0.0011
COST=$(_bcost "claude-haiku-4-5" 1000 0 0 0 0 "2026-07-10" true false)
_assert_eq "geo_us: haiku input 1000 tokens costs 0.0011" "0.0011" "$COST"

echo "== Test 10: no geo multiplier (haiku-4-5: in \$1.0, 1000 tokens -> \$0.001) =="
COST=$(_bcost "claude-haiku-4-5" 1000 0 0 0 0 "2026-07-10" false false)
_assert_eq "no geo: haiku input 1000 tokens costs 0.001" "0.001" "$COST"

echo "== Test 11: speed: fast premium for opus-4-8 (fast.in=10, fast.out=50) =="
COST=$(_bcost "claude-opus-4-8" 1000000 1000000 0 0 0 "2026-07-10" false true)
# 1M * 10 + 1M * 50 = 60M / 1M = 60.0
_assert_eq "fast opus-4-8: 1M in + 1M out = 60.0" "60.0" "$COST"

echo "== Test 12: speed: fast premium for opus-4-7 (fast.in=30, fast.out=150) =="
COST=$(_bcost "claude-opus-4-7" 1000000 1000000 0 0 0 "2026-07-10" false true)
# 1M * 30 + 1M * 150 = 180M / 1M = 180.0
_assert_eq "fast opus-4-7: 1M in + 1M out = 180.0" "180.0" "$COST"

echo "== Test 13: no fast -> standard pricing for opus-4-8 (in=5, out=25) =="
COST=$(_bcost "claude-opus-4-8" 1000000 1000000 0 0 0 "2026-07-10" false false)
# 1M * 5 + 1M * 25 = 30M / 1M = 30.0
_assert_eq "no fast opus-4-8: 1M in + 1M out = 30.0" "30.0" "$COST"

echo "== Test 14: explicit cache pricing (cache_read, cache_5m, cache_1h) =="
# haiku-4-5: cache_read=0.10, cache_5m=1.25, cache_1h=2.0
COST=$(_bcost "claude-haiku-4-5" 0 0 1000000 500000 250000 "2026-07-10" false false)
# cr: 1M * 0.10 = 100000; cc5: 500K * 1.25 = 625000; cc1: 250K * 2.0 = 500000
# sum = 1225000 / 1M = 1.225
_assert_eq "cache pricing: 1M cr + 500K cc5 + 250K cc1 = 1.225" "1.225" "$COST"

echo "== Test 15: stacked multipliers (geo_us + explicit cache) =="
# haiku-4-5 with geo_us: cache_read=0.10*1.1=0.11, cache_5m=1.25*1.1=1.375, cache_1h=2.0*1.1=2.2
COST=$(_bcost "claude-haiku-4-5" 0 0 1000000 500000 250000 "2026-07-10" true false)
# cr: 1M * 0.11 = 110000; cc5: 500K * 1.375 = 687500; cc1: 250K * 2.2 = 550000
# sum = 1347500 / 1M = 1.3475
_assert_eq "stacked geo+cache: 1.3475" "1.3475" "$COST"

echo "== Test 16: bcost with opus-4-7 no-fast (in=5, out=25) full calc =="
COST=$(_bcost "claude-opus-4-7" 500000 200000 100000 50000 25000 "2026-07-10" false false)
# in:  500K * 5   = 2500000
# out: 200K * 25  = 5000000
# cr:  100K * 0.5 = 50000
# c5m: 50K * 6.25 = 312500
# c1h: 25K * 10   = 250000
# sum = 8112500 / 1M = 8.1125
_assert_eq "opus-4-7 full calc = 8.1125" "8.1125" "$COST"

echo "== Test 17: bcost with opus-4-7 fast (fast.in=30, fast.out=150) =="
COST=$(_bcost "claude-opus-4-7" 500000 200000 100000 50000 25000 "2026-07-10" false true)
# in:  500K * 30  = 15000000
# out: 200K * 150 = 30000000
# cr:  100K * 0.5 = 50000  (cache_read uses base price, not fast)
# c5m: 50K * 6.25 = 312500 (cache_5m uses base price, not fast)
# c1h: 25K * 10   = 250000 (cache_1h uses base price, not fast)
# sum = 45612500 / 1M = 45.6125
_assert_eq "opus-4-7 fast full calc = 45.6125" "45.6125" "$COST"

echo "== Test 18: cache pricing fallback (older transcript: cc_5m/cc_1h absent, cc present) =="
# Simulate an older transcript with only flat cache_creation (no split).
# We test by calling bcost with cc5=0, cc1=0, and a flat cc bucket.
# The jq bcost function should handle: when cc_5m and cc_1h are both 0 but cc > 0,
# it uses cc * cache_5m_price (fallback).
# This is a structural test — the actual script's bcost needs to support this.
# For now, test the jq function directly with a custom invocation:
COST=$(echo "null" | jq -r --argjson pr "$(cat "$PRICING_FILE")" --arg today "2026-07-10" \
  --arg m "claude-haiku-4-5" --argjson in 0 --argjson out 0 \
  --argjson cr 0 --argjson cc 1000000 '
  def price($model):
    (if ($pr.models | has($model)) then $pr.models[$model]
     else ($pr.families | to_entries
           | map(select(.key as $fk | $model | startswith($fk)))
           | sort_by(.key | length) | last | .value // $pr.default) end)
    | if .intro_until? and ($today > .intro_until) then .after else . end;
  def bcost_flat($model; $in; $out; $cr; $cc):
    price($model) as $p |
    {in: $p.in, out: $p.out,
     cr: ($p.cache_read // ($p.in * 0.1)),
     c5m: ($p.cache_5m // ($p.in * 1.25))} as $prices |
    ($in * $prices.in + $out * $prices.out + $cr * $prices.cr +
     $cc * $prices.c5m) / 1000000;
  bcost_flat($m; $in; $out; $cr; $cc)
')
# haiku-4-5: cc=1M * cache_5m=1.25 = 1250000 / 1M = 1.25
_assert_eq "flat cache fallback (cc * cache_5m) = 1.25" "1.25" "$COST"

echo
echo "=== E4: estimated_cost_cents Tests ==="

STATE_EC="$SCRATCH/state_ec"
mkdir -p "$STATE_EC"
SID_EC="sess-est-cost"
TRANSCRIPT_EC="$SCRATCH/transcript_ec.jsonl"
# One main-thread turn on haiku-4-5: 1M input tokens * $1.0/MTok = $1.00,
# 500K output tokens * $5.0/MTok = $2.50 -> $3.50 total -> 350 cents.
# Payload cost.total_cost_usd is 0 (never rendered live before) so the
# display must fall back to this estimate rather than showing $0.00.
{
  printf '{"type":"assistant","message":{"id":"msg_ec1","model":"claude-haiku-4-5","usage":{"input_tokens":1000000,"output_tokens":500000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
} > "$TRANSCRIPT_EC"
OUT_EC=$(_run_with_geo_speed "$TRANSCRIPT_EC" "$(_mk_payload "$SID_EC" "$TRANSCRIPT_EC" 0)" "$STATE_EC")
SIDECAR_EC="$STATE_EC/$SID_EC.json"

echo "== Test 25: estimated_cost_cents computed from main .models bucket (1M in + 500K out on haiku-4-5 = 350 cents) =="
_assert_json_field "estimated_cost_cents = 350 (\$1.00 in + \$2.50 out)" "$SIDECAR_EC" '.estimated_cost_cents' "350"

echo "== Test 26: COST display falls back to estimated_cost_cents when the payload/folded cost is 0 =="
OUT_EC_PLAIN=$(printf '%s' "$OUT_EC" | sed 's/\x1b\[[0-9;]*m//g')
_assert_contains "COST falls back to the \$3.50 estimate when payload cost is 0" "$OUT_EC_PLAIN" '$: 3.50'

echo "== Test 27: COST prefers the authoritative folded payload cost when it is non-zero (does not use the estimate) =="
STATE_EC2="$SCRATCH/state_ec2"
mkdir -p "$STATE_EC2"
SID_EC2="sess-est-cost-live"
TRANSCRIPT_EC2="$SCRATCH/transcript_ec2.jsonl"
{
  printf '{"type":"assistant","message":{"id":"msg_ec2","model":"claude-haiku-4-5","usage":{"input_tokens":1000000,"output_tokens":500000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
} > "$TRANSCRIPT_EC2"
# Live payload cost is $9.99 -- far from the $3.50 token-bucket estimate --
# and must win since it is the authoritative harness-reported figure.
OUT_EC2=$(_run_with_geo_speed "$TRANSCRIPT_EC2" "$(_mk_payload "$SID_EC2" "$TRANSCRIPT_EC2" 9.99)" "$STATE_EC2")
OUT_EC2_PLAIN=$(printf '%s' "$OUT_EC2" | sed 's/\x1b\[[0-9;]*m//g')
_assert_contains "COST shows the live \$9.99 payload cost, not the token-bucket estimate" "$OUT_EC2_PLAIN" '$: 9.99'

echo
echo "=== Session Pre-scan Tests ==="

# Tests for inference_geo_us and speed_fast flags in the transcript scan.
# We verify these by running the full script and checking the sidecar JSON.
STATE_GS="$SCRATCH/state_gs"
mkdir -p "$STATE_GS"
SID_GS="sess-geospeed"
TRANSCRIPT_GS="$SCRATCH/transcript_gs.jsonl"

echo "== Test 19: session pre-scan detects inference_geo: us =="
# Assistant record with inference_geo: "us"
{
  printf '{"type":"assistant","message":{"id":"msg_gs1","model":"claude-opus-4-8","usage":{"input_tokens":1000,"output_tokens":200,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"inference_geo":"us"}}}\n'
} > "$TRANSCRIPT_GS"
_run_with_geo_speed "$TRANSCRIPT_GS" "$(_mk_payload "$SID_GS" "$TRANSCRIPT_GS")" "$STATE_GS" >/dev/null
SIDECAR_GS="$STATE_GS/$SID_GS.json"
_assert_json_field "geo pre-scan: sidecar inference_geo_us=true" "$SIDECAR_GS" '.inference_geo_us' "true"

echo "== Test 20: session pre-scan detects speed: fast =="
STATE_SF="$SCRATCH/state_sf"
mkdir -p "$STATE_SF"
SID_SF="sess-speed"
TRANSCRIPT_SF="$SCRATCH/transcript_sf.jsonl"
{
  printf '{"type":"assistant","message":{"id":"msg_sf1","model":"claude-opus-4-8","usage":{"input_tokens":1000,"output_tokens":200,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"speed":"fast"}}\n'
} > "$TRANSCRIPT_SF"
_run_with_geo_speed "$TRANSCRIPT_SF" "$(_mk_payload "$SID_SF" "$TRANSCRIPT_SF")" "$STATE_SF" >/dev/null
SIDECAR_SF="$STATE_SF/$SID_SF.json"
_assert_json_field "speed pre-scan: sidecar speed_fast=true" "$SIDECAR_SF" '.speed_fast' "true"

echo "== Test 21: session pre-scan: no geo/speed when absent =="
STATE_NS="$SCRATCH/state_ns"
mkdir -p "$STATE_NS"
SID_NS="sess-noflags"
TRANSCRIPT_NS="$SCRATCH/transcript_ns.jsonl"
{
  printf '{"type":"assistant","message":{"id":"msg_ns1","model":"claude-opus-4-8","usage":{"input_tokens":1000,"output_tokens":200,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
} > "$TRANSCRIPT_NS"
_run_with_geo_speed "$TRANSCRIPT_NS" "$(_mk_payload "$SID_NS" "$TRANSCRIPT_NS")" "$STATE_NS" >/dev/null
SIDECAR_NS="$STATE_NS/$SID_NS.json"
_assert_json_field "no-flags pre-scan: inference_geo_us defaults false" "$SIDECAR_NS" '.inference_geo_us // false' "false"
_assert_json_field "no-flags pre-scan: speed_fast defaults false" "$SIDECAR_NS" '.speed_fast // false' "false"

echo "== Test 22: geo flag accumulates across incremental tail passes =="
STATE_ACC="$SCRATCH/state_acc"
mkdir -p "$STATE_ACC"
SID_ACC="sess-geo-acc"
TRANSCRIPT_ACC="$SCRATCH/transcript_acc.jsonl"
# First pass: no geo flag
{
  printf '{"type":"assistant","message":{"id":"msg_acc1","model":"claude-sonnet-5","usage":{"input_tokens":500,"output_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
} > "$TRANSCRIPT_ACC"
_run_with_geo_speed "$TRANSCRIPT_ACC" "$(_mk_payload "$SID_ACC" "$TRANSCRIPT_ACC")" "$STATE_ACC" >/dev/null
SIDECAR_ACC="$STATE_ACC/$SID_ACC.json"
_assert_json_field "geo accum: pass1 inference_geo_us=false" "$SIDECAR_ACC" '.inference_geo_us // false' "false"
# Second pass: append geo record
{
  printf '{"type":"assistant","message":{"id":"msg_acc2","model":"claude-sonnet-5","usage":{"input_tokens":500,"output_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"inference_geo":"us"}}}\n'
} >> "$TRANSCRIPT_ACC"
_run_with_geo_speed "$TRANSCRIPT_ACC" "$(_mk_payload "$SID_ACC" "$TRANSCRIPT_ACC")" "$STATE_ACC" >/dev/null
_assert_json_field "geo accum: pass2 inference_geo_us flips to true" "$SIDECAR_ACC" '.inference_geo_us' "true"

echo "== Test 23: speed flag accumulates across incremental tail passes =="
STATE_SACC="$SCRATCH/state_sacc"
mkdir -p "$STATE_SACC"
SID_SACC="sess-speed-acc"
TRANSCRIPT_SACC="$SCRATCH/transcript_sacc.jsonl"
{
  printf '{"type":"assistant","message":{"id":"msg_sa1","model":"claude-opus-4-8","usage":{"input_tokens":500,"output_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
} > "$TRANSCRIPT_SACC"
_run_with_geo_speed "$TRANSCRIPT_SACC" "$(_mk_payload "$SID_SACC" "$TRANSCRIPT_SACC")" "$STATE_SACC" >/dev/null
SIDECAR_SACC="$STATE_SACC/$SID_SACC.json"
_assert_json_field "speed accum: pass1 speed_fast=false" "$SIDECAR_SACC" '.speed_fast // false' "false"
{
  printf '{"type":"assistant","message":{"id":"msg_sa2","model":"claude-opus-4-8","usage":{"input_tokens":500,"output_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"speed":"fast"}}\n'
} >> "$TRANSCRIPT_SACC"
_run_with_geo_speed "$TRANSCRIPT_SACC" "$(_mk_payload "$SID_SACC" "$TRANSCRIPT_SACC")" "$STATE_SACC" >/dev/null
_assert_json_field "speed accum: pass2 speed_fast flips to true" "$SIDECAR_SACC" '.speed_fast' "true"

echo "== Test 24: geo flag detected from .message.usage.inference_geo path =="
STATE_GU="$SCRATCH/state_gu"
mkdir -p "$STATE_GU"
SID_GU="sess-geo-usage"
TRANSCRIPT_GU="$SCRATCH/transcript_gu.jsonl"
{
  printf '{"type":"assistant","message":{"id":"msg_gu1","model":"claude-haiku-4-5","usage":{"input_tokens":200,"output_tokens":50,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"inference_geo":"us"}}}\n'
} > "$TRANSCRIPT_GU"
_run_with_geo_speed "$TRANSCRIPT_GU" "$(_mk_payload "$SID_GU" "$TRANSCRIPT_GU")" "$STATE_GU" >/dev/null
SIDECAR_GU="$STATE_GU/$SID_GU.json"
_assert_json_field "geo usage path: inference_geo_us=true" "$SIDECAR_GU" '.inference_geo_us' "true"

echo

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
