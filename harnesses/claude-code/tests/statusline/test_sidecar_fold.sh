#!/usr/bin/env bash
# Plain-bash test harness for statusline-command.sh sidecar + duration fold (Task 8.1).
# No bats available in this environment (checked: `which bats` -> not found), so this
# is a self-contained assertion script. Run: bash tests/statusline/test_sidecar_fold.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../../config/statusline-command.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0
FAIL=0

_assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    PASS=$((PASS+1))
    echo "PASS: $desc"
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $desc"
    echo "  expected to find: $needle"
    echo "  in output:"
    printf '%s\n' "$haystack" | sed 's/^/    /'
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

_run() {  # payload_json state_dir -> stdout captured
  local payload="$1" state_dir="$2"
  COLUMNS=120 STATUSLINE_STATE_DIR="$state_dir" bash "$SCRIPT" <<<"$payload" 2>&1
}

_mk_payload() {  # session_id total_duration_ms total_api_duration_ms [total_cost_usd]
  local cost="${4:-1.23}"
  cat <<EOF
{
  "session_id": "$1",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": $2, "total_api_duration_ms": $3, "total_cost_usd": ${cost},
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"used_percentage": 10, "total_input_tokens": 1000, "total_output_tokens": 200,
                      "context_window_size": 200000, "current_usage": {"cache_read_input_tokens": 0}},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}
EOF
}

echo "== Test 1: fold on reset (current < last) =="
STATE1="$SCRATCH/fold"
mkdir -p "$STATE1"
SID1="sess-fold"
# Pre-seed sidecar: last_duration_ms=600000 (10m), base=0; last_api_ms=100000, base_api=0.
cat > "$STATE1/$SID1.json" <<'EOF'
{"base_duration_ms": 0, "last_duration_ms": 600000, "base_api_duration_ms": 0, "last_api_ms": 100000}
EOF
# Current payload duration = 180000 (3m) < last (600000) -> fold: base becomes 0+600000=600000;
# total = 600000+180000 = 780000ms = 13m exactly.
OUT1=$(_run "$(_mk_payload "$SID1" 180000 50000)" "$STATE1")
_assert_contains "fold: rendered clock shows base+current (13m)" "$OUT1" "13m"
SIDECAR1_FILE="$STATE1/$SID1.json"
_assert_json_field "fold: sidecar last_duration_ms updated to new raw current (180000)" "$SIDECAR1_FILE" '.last_duration_ms' "180000"
_assert_json_field "fold: sidecar base_duration_ms accumulated old last (600000)" "$SIDECAR1_FILE" '.base_duration_ms' "600000"
_assert_json_field "fold: api fold applied too (base_api_duration_ms=100000)" "$SIDECAR1_FILE" '.base_api_duration_ms' "100000"
_assert_json_field "fold: api last updated to raw current (50000)" "$SIDECAR1_FILE" '.last_api_ms' "50000"

echo "== Test 2: monotonic increase (current >= last), no fold =="
STATE2="$SCRATCH/mono"
mkdir -p "$STATE2"
SID2="sess-mono"
cat > "$STATE2/$SID2.json" <<'EOF'
{"base_duration_ms": 0, "last_duration_ms": 180000, "base_api_duration_ms": 0, "last_api_ms": 50000}
EOF
# Current = 600000 (10m) >= last (180000) -> no fold; base stays 0; total = 0+600000 = 600000ms = 10m.
OUT2=$(_run "$(_mk_payload "$SID2" 600000 200000)" "$STATE2")
_assert_contains "monotonic: rendered clock is current with base unchanged (10m)" "$OUT2" "10m"
SIDECAR2_FILE="$STATE2/$SID2.json"
_assert_json_field "monotonic: base_duration_ms stays 0 (no fold)" "$SIDECAR2_FILE" '.base_duration_ms' "0"
_assert_json_field "monotonic: last_duration_ms advances to new raw current (600000)" "$SIDECAR2_FILE" '.last_duration_ms' "600000"

echo "== Test 3: fail-open on corrupt sidecar JSON =="
STATE3="$SCRATCH/corrupt"
mkdir -p "$STATE3"
SID3="sess-corrupt"
printf '{ this is not valid json' > "$STATE3/$SID3.json"
# Corrupt sidecar -> treated as empty {} -> base=0,last=0 for both -> current(300000)>=last(0) -> no fold.
# total = 0 + 300000 = 300000ms = 5m. Script must not crash (exit 0) and must still render.
OUT3=$(_run "$(_mk_payload "$SID3" 300000 90000)" "$STATE3")
RC3=$?
if [ "$RC3" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: corrupt sidecar does not crash the script (exit 0)"
else
  FAIL=$((FAIL+1)); echo "FAIL: corrupt sidecar caused nonzero exit ($RC3)"
fi
_assert_contains "fail-open: still renders model name despite corrupt sidecar" "$OUT3" "Sonnet"
_assert_contains "fail-open: clock falls back to base=0 + raw current (5m)" "$OUT3" "5m"

echo "== Test 4: sidecar preserves fields it does not populate (8.2 fields untouched) =="
STATE4="$SCRATCH/preserve"
mkdir -p "$STATE4"
SID4="sess-preserve"
cat > "$STATE4/$SID4.json" <<'EOF'
{"transcript_offset": 812345, "in_total": 5800000, "subagent_fallback_tokens": 7,
 "base_duration_ms": 0, "last_duration_ms": 60000, "base_api_duration_ms": 0, "last_api_ms": 10000}
EOF
_run "$(_mk_payload "$SID4" 120000 20000)" "$STATE4" >/dev/null
SIDECAR4_FILE="$STATE4/$SID4.json"
_assert_json_field "preserve: transcript_offset field untouched" "$SIDECAR4_FILE" '.transcript_offset' "812345"
_assert_json_field "preserve: in_total field untouched" "$SIDECAR4_FILE" '.in_total' "5800000"
_assert_json_field "preserve: subagent_fallback_tokens field untouched" "$SIDECAR4_FILE" '.subagent_fallback_tokens' "7"

echo "== Test 5: prune stale sidecar files (>30d) =="
STATE5="$SCRATCH/prune"
mkdir -p "$STATE5"
SID5="sess-prune"
STALE="$STATE5/stale-session.json"
echo '{"base_duration_ms":0,"last_duration_ms":0}' > "$STALE"
touch -d '35 days ago' "$STALE" 2>/dev/null || touch -t "$(date -d '35 days ago' +%Y%m%d0000 2>/dev/null)" "$STALE" 2>/dev/null || true
_run "$(_mk_payload "$SID5" 60000 10000)" "$STATE5" >/dev/null
if [ -f "$STALE" ]; then
  FAIL=$((FAIL+1)); echo "FAIL: stale sidecar file (>30d) was not pruned"
else
  PASS=$((PASS+1)); echo "PASS: stale sidecar file (>30d) pruned"
fi
echo "== Test 6: cost folds on session resume (second payload cost lower than first) =="
STATE6="$SCRATCH/cost"
mkdir -p "$STATE6"
SID6="sess-cost"
# First run records live cost at $5.00; Claude Code resets cost.* on resume,
# so the second payload reports only $1.00. Without folding we'd render $1.00;
# with folding we render 5.00 + 1.00 = $6.00.
_run "$(_mk_payload "$SID6" 60000 10000 5.00)" "$STATE6" >/dev/null
OUT6=$(_run "$(_mk_payload "$SID6" 60000 10000 1.00)" "$STATE6")
OUT6_PLAIN=$(printf '%s' "$OUT6" | sed 's/\x1b\[[0-9;]*m//g')
_assert_contains "cost fold: rendered total accumulates across reset (\$: 6.00)" "$OUT6_PLAIN" '$: 6.00'
SIDECAR6_FILE="$STATE6/$SID6.json"
_assert_json_field "cost fold: sidecar last_cost_cents updated to new raw current (100)" "$SIDECAR6_FILE" '.last_cost_cents' "100"
_assert_json_field "cost fold: sidecar base_cost_cents accumulated old last (500)" "$SIDECAR6_FILE" '.base_cost_cents' "500"

echo

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
