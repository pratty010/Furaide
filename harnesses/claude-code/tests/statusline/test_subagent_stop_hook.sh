#!/usr/bin/env bash
# Plain-bash test harness for statusline-command.sh's `--subagent-stop` hook
# entry point (Task 2's _run_subagent_stop_hook / statusline-lib/
# subagent-tracking.sh). Same style as test_transcript_tail.sh (no bats here).
# Run: bash tests/statusline/test_subagent_stop_hook.sh
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

_run_hook() {  # payload_json state_dir -> stdout+stderr captured; sets $? via caller's $?
  local payload="$1" state_dir="$2"
  COLUMNS=120 STATUSLINE_STATE_DIR="$state_dir" bash "$SCRIPT" --subagent-stop <<<"$payload" 2>&1
}

_mk_hook_payload() {  # session_id agent_id transcript_path [agent_type]
  local atype="${4:-general-purpose}"
  cat <<EOF
{
  "session_id": "$1",
  "agent_id": "$2",
  "transcript_path": "$3",
  "agent_type": "$atype"
}
EOF
}

# ── Real-data-grounded fixture ──────────────────────────────────────────────
# Ground truth: a real subagent transcript in this project
# (~/.claude/projects/-d-Everything-Furaid-/f6af4ffb-d360-44d5-87f5-0d2d5156428b/
# subagents/agent-a88bd484a75858c1e.jsonl, a claude-haiku-4-5-20251001 run)
# was scanned with the real _scan_usage_stdin (statusline-lib/
# transcript-scan.sh) and spot-checked against its own raw JSONL usage block:
# input_tokens=2, output_tokens=181, cache_read_input_tokens=6161,
# cache_creation_input_tokens=7113 (single assistant record, no dedup
# collision to worry about). _scan_usage_stdin on that file returns
# {in:2, out:181, cr:6161, cc:7113, rate_sum:0.4640705031636035, rate_turns:1}.
# Rather than committing that real transcript file verbatim (it also carries
# real user/attachment records ahead of the assistant line, which this repo's
# own CLAUDE.md says not to commit as fixtures), this fixture is a
# SYNTHETIC-SHAPED single-assistant-record file carrying those REAL, verified
# numbers — _scan_usage_stdin against it reproduces the identical ground
# truth above (a single assistant record with these fields dedups to itself).
REAL_IN=2
REAL_OUT=181
REAL_CR=6161
REAL_CC=7113
REAL_MODEL="claude-haiku-4-5-20251001"
_real_grounded_subfile() {  # -> stdout: one real-numbers-carrying assistant JSONL line
  printf '{"type":"assistant","message":{"id":"msg_real_grounded_1","model":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}\n' \
    "$REAL_MODEL" "$REAL_IN" "$REAL_OUT" "$REAL_CR" "$REAL_CC"
}

echo "== Test 1: valid --subagent-stop payload folds a readable subagent transcript into the sidecar =="
STATE1="$SCRATCH/state1"
mkdir -p "$STATE1"
SID1="sess-hook1"
AID1="a1234567890123456"
SUBDIR1="$SCRATCH/proj1/main1/subagents"
mkdir -p "$SUBDIR1"
SUBFILE1="$SUBDIR1/agent-${AID1}.jsonl"
_real_grounded_subfile > "$SUBFILE1"

OUT1=$(_run_hook "$(_mk_hook_payload "$SID1" "$AID1" "$SUBFILE1")" "$STATE1")
RC1=$?
if [ "$RC1" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: valid payload exits 0"
else
  FAIL=$((FAIL+1)); echo "FAIL: valid payload exited nonzero ($RC1)"
  printf '%s\n' "$OUT1" | sed 's/^/    /'
fi

SIDECAR1="$STATE1/$SID1.json"
_assert_json_field "run1: counted_subagents includes the agent id" "$SIDECAR1" \
  ".counted_subagents | contains([\"$AID1\"])" "true"
_assert_json_field "run1: subagent_in_total reflects the real-grounded fixture (in=$REAL_IN)" "$SIDECAR1" '.subagent_in_total' "$REAL_IN"
_assert_json_field "run1: subagent_out_total reflects the real-grounded fixture (out=$REAL_OUT)" "$SIDECAR1" '.subagent_out_total' "$REAL_OUT"
_assert_json_field "run1: subagent_cr_total reflects the real-grounded fixture (cr=$REAL_CR)" "$SIDECAR1" '.subagent_cr_total' "$REAL_CR"
_assert_json_field "run1: subagent_cc_total reflects the real-grounded fixture (cc=$REAL_CC)" "$SIDECAR1" '.subagent_cc_total' "$REAL_CC"
_assert_json_field "run1: subagent_models carries the real model bucket" "$SIDECAR1" ".subagent_models[\"$REAL_MODEL\"].in" "$REAL_IN"

echo "== Test 2: firing the identical payload twice does not double-count =="
OUT2=$(_run_hook "$(_mk_hook_payload "$SID1" "$AID1" "$SUBFILE1")" "$STATE1")
RC2=$?
if [ "$RC2" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: repeat payload exits 0"
else
  FAIL=$((FAIL+1)); echo "FAIL: repeat payload exited nonzero ($RC2)"
  printf '%s\n' "$OUT2" | sed 's/^/    /'
fi
_assert_json_field "run2: subagent_in_total unchanged (no double count)" "$SIDECAR1" '.subagent_in_total' "$REAL_IN"
_assert_json_field "run2: subagent_out_total unchanged (no double count)" "$SIDECAR1" '.subagent_out_total' "$REAL_OUT"
_assert_json_field "run2: counted_subagents still length 1 (no double-append)" "$SIDECAR1" '.counted_subagents | length' "1"

echo "== Test 3: missing agent_id fails open (exit 0, no sidecar mutation) =="
STATE3="$SCRATCH/state3"
mkdir -p "$STATE3"
SID3="sess-hook3"
PAYLOAD3="{\"session_id\": \"$SID3\", \"transcript_path\": \"$SUBFILE1\", \"agent_type\": \"general-purpose\"}"
OUT3=$(_run_hook "$PAYLOAD3" "$STATE3")
RC3=$?
if [ "$RC3" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: missing agent_id exits 0"
else
  FAIL=$((FAIL+1)); echo "FAIL: missing agent_id exited nonzero ($RC3)"
  printf '%s\n' "$OUT3" | sed 's/^/    /'
fi
if [ -f "$STATE3/$SID3.json" ]; then
  FAIL=$((FAIL+1)); echo "FAIL: missing agent_id must not create/mutate a sidecar file"
else
  PASS=$((PASS+1)); echo "PASS: missing agent_id correctly created no sidecar file"
fi

echo "== Test 4: missing session_id fails open (exit 0, no sidecar mutation) =="
STATE4="$SCRATCH/state4"
mkdir -p "$STATE4"
AID4="a9999999999999999"
PAYLOAD4="{\"agent_id\": \"$AID4\", \"transcript_path\": \"$SUBFILE1\", \"agent_type\": \"general-purpose\"}"
OUT4=$(_run_hook "$PAYLOAD4" "$STATE4")
RC4=$?
if [ "$RC4" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: missing session_id exits 0"
else
  FAIL=$((FAIL+1)); echo "FAIL: missing session_id exited nonzero ($RC4)"
  printf '%s\n' "$OUT4" | sed 's/^/    /'
fi
FILES4=$(find "$STATE4" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$FILES4" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: missing session_id correctly created no state file at all"
else
  FAIL=$((FAIL+1)); echo "FAIL: missing session_id unexpectedly created $FILES4 state file(s)"
fi

echo "== Test 5: unreadable/nonexistent transcript path fails open (exit 0, agent stays unresolved) =="
STATE5="$SCRATCH/state5"
mkdir -p "$STATE5"
SID5="sess-hook5"
AID5="adeadbeef000000001"
BADPATH="$SCRATCH/proj5/main5/subagents/agent-${AID5}.jsonl"  # deliberately never created
OUT5=$(_run_hook "$(_mk_hook_payload "$SID5" "$AID5" "$BADPATH")" "$STATE5")
RC5=$?
if [ "$RC5" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: unreadable transcript path exits 0 (fail-open)"
else
  FAIL=$((FAIL+1)); echo "FAIL: unreadable transcript path exited nonzero ($RC5)"
  printf '%s\n' "$OUT5" | sed 's/^/    /'
fi
SIDECAR5="$STATE5/$SID5.json"
_assert_json_field "run5: agent id is NOT in counted_subagents (left for the legacy fallback route)" "$SIDECAR5" \
  "(.counted_subagents // []) | contains([\"$AID5\"])" "false"

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
