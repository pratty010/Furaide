#!/usr/bin/env bash
# Plain-bash test harness for the Task 2 single-file locked queue mechanism
# (statusline-lib/subagent-tracking.sh's _with_queue_lock/_do_enqueue/
# _do_drain_queue). Same style as test_transcript_tail.sh (no bats here).
# Run: bash tests/statusline/test_subagent_queue.sh
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

_run_hook() {  # payload_json state_dir -> stdout+stderr captured
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

_assistant_line() {  # in out cache_read cache_creation msg_id [model] -> one assistant JSONL record
  local model="${6:-}"
  if [ -n "$model" ]; then
    printf '{"type":"assistant","message":{"id":"%s","model":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}\n' \
      "$5" "$model" "$1" "$2" "$3" "$4"
  else
    printf '{"type":"assistant","message":{"id":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}\n' \
      "$5" "$1" "$2" "$3" "$4"
  fi
}

echo "== Test 1: single enqueue via a full --subagent-stop invocation, then drain resolves =="
STATE1="$SCRATCH/state1"
mkdir -p "$STATE1"
SID1="sess-queue1"
AID1="a1000000000000001"
SUBDIR1="$SCRATCH/proj1/main1/subagents"
mkdir -p "$SUBDIR1"
SUBFILE1="$SUBDIR1/agent-${AID1}.jsonl"
_assistant_line 10 20 0 0 "msg_q1" > "$SUBFILE1"

_run_hook "$(_mk_hook_payload "$SID1" "$AID1" "$SUBFILE1")" "$STATE1" >/dev/null
SIDECAR1="$STATE1/$SID1.json"
QUEUE1="$STATE1/$SID1.subagent-queue.json"
_assert_json_field "run1: agent resolved into counted_subagents" "$SIDECAR1" ".counted_subagents | contains([\"$AID1\"])" "true"
_assert_json_field "run1: subagent_in_total reflects the fixture (10)" "$SIDECAR1" '.subagent_in_total' "10"
if [ -s "$QUEUE1" ]; then
  QCONTENT=$(cat "$QUEUE1")
  QKEYS=$(printf '%s' "$QCONTENT" | jq -r 'keys | length' 2>/dev/null)
  if [ "$QKEYS" = "0" ]; then
    PASS=$((PASS+1)); echo "PASS: run1: queue file left empty ({}) after drain"
  else
    FAIL=$((FAIL+1)); echo "FAIL: run1: queue file non-empty after drain: $QCONTENT"
  fi
else
  PASS=$((PASS+1)); echo "PASS: run1: queue file absent/empty after drain"
fi

echo "== Test 2: a burst of 6 concurrent enqueues against the SAME queue file all land, none lost, none double-counted =="
STATE2="$SCRATCH/state2"
mkdir -p "$STATE2"
SID2="sess-queue2"
SUBDIR2="$SCRATCH/proj2/main2/subagents"
mkdir -p "$SUBDIR2"
N=6
declare -a AIDS2=()
for i in $(seq 1 "$N"); do
  aid="b${i}00000000000000${i}"
  AIDS2+=("$aid")
  _assistant_line "$((i*10))" "$((i*5))" 0 0 "msg_burst${i}" > "$SUBDIR2/agent-${aid}.jsonl"
done

declare -a PIDS2=()
for aid in "${AIDS2[@]}"; do
  (
    _run_hook "$(_mk_hook_payload "$SID2" "$aid" "$SUBDIR2/agent-${aid}.jsonl")" "$STATE2" >/dev/null 2>&1
  ) &
  PIDS2+=("$!")
done
for pid in "${PIDS2[@]}"; do wait "$pid"; done

SIDECAR2="$STATE2/$SID2.json"
QUEUE2="$STATE2/$SID2.subagent-queue.json"

# The concurrent burst's queue file must be valid JSON at rest (post-burst).
if [ -f "$QUEUE2" ]; then
  if jq -e . "$QUEUE2" >/dev/null 2>&1; then
    PASS=$((PASS+1)); echo "PASS: burst: queue file is valid JSON immediately after the burst"
  else
    FAIL=$((FAIL+1)); echo "FAIL: burst: queue file is NOT valid JSON after the burst"
  fi
fi

# Drain repeatedly (matching the real render-path/hook-path retry behavior)
# until the queue is empty or a retry budget is exhausted, in case a straggler
# lost a lock race during the burst and needs one more pass.
for _ in 1 2 3 4 5; do
  all_counted=$(jq -r --argjson n "$N" '(.counted_subagents // []) | length >= $n' "$SIDECAR2" 2>/dev/null)
  [ "$all_counted" = "true" ] && break
  _run_hook "$(_mk_hook_payload "$SID2" "${AIDS2[0]}" "$SUBDIR2/agent-${AIDS2[0]}.jsonl")" "$STATE2" >/dev/null 2>&1
done

MISSING=0
for aid in "${AIDS2[@]}"; do
  has=$(jq -r --arg a "$aid" '(.counted_subagents // []) | contains([$a])' "$SIDECAR2" 2>/dev/null)
  [ "$has" = "true" ] || MISSING=$((MISSING+1))
done
if [ "$MISSING" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: burst: all $N concurrent agents landed in counted_subagents, none lost"
else
  FAIL=$((FAIL+1)); echo "FAIL: burst: $MISSING of $N agents missing from counted_subagents"
fi
_assert_json_field "burst: counted_subagents has no duplicate entries (length == unique length)" "$SIDECAR2" \
  '(.counted_subagents | length) == (.counted_subagents | unique | length)' "true"
EXPECT_IN=0
for i in $(seq 1 "$N"); do EXPECT_IN=$((EXPECT_IN + i*10)); done
_assert_json_field "burst: subagent_in_total sums exactly once per agent (no double-count)" "$SIDECAR2" '.subagent_in_total' "$EXPECT_IN"

echo "== Test 3: drain is idempotent — re-running against an already-empty/fully-drained queue is a no-op =="
IN_BEFORE=$(jq -r '.subagent_in_total' "$SIDECAR2" 2>/dev/null)
COUNTED_BEFORE=$(jq -r '.counted_subagents | length' "$SIDECAR2" 2>/dev/null)
# Fire the hook again for an already-counted agent: enqueue + drain must be a
# clean no-op (agent already in counted_subagents).
_run_hook "$(_mk_hook_payload "$SID2" "${AIDS2[0]}" "$SUBDIR2/agent-${AIDS2[0]}.jsonl")" "$STATE2" >/dev/null 2>&1
RC3=$?
if [ "$RC3" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: idempotent drain: repeat hook call exits 0"
else
  FAIL=$((FAIL+1)); echo "FAIL: idempotent drain: repeat hook call exited nonzero ($RC3)"
fi
_assert_json_field "idempotent drain: subagent_in_total unchanged" "$SIDECAR2" '.subagent_in_total' "$IN_BEFORE"
_assert_json_field "idempotent drain: counted_subagents length unchanged" "$SIDECAR2" '.counted_subagents | length' "$COUNTED_BEFORE"
if [ -f "$QUEUE2" ] && jq -e . "$QUEUE2" >/dev/null 2>&1; then
  PASS=$((PASS+1)); echo "PASS: idempotent drain: queue file (if present) still valid JSON, no corruption"
elif [ ! -f "$QUEUE2" ]; then
  PASS=$((PASS+1)); echo "PASS: idempotent drain: queue file absent, no corruption possible"
else
  FAIL=$((FAIL+1)); echo "FAIL: idempotent drain: queue file present but not valid JSON"
fi

echo "== Test 4: flock-unavailable path is cleanly skipped (no unlocked write, no corruption, no crash) =="
STATE4="$SCRATCH/state4"
mkdir -p "$STATE4"
SID4="sess-queue4"
AID4="c1000000000000001"
SUBDIR4="$SCRATCH/proj4/main4/subagents"
mkdir -p "$SUBDIR4"
SUBFILE4="$SUBDIR4/agent-${AID4}.jsonl"
_assistant_line 7 3 0 0 "msg_noflock" > "$SUBFILE4"

# Shadow `command -v flock` to report absent, matching how Task 2's own tests
# simulated a flock-less environment: a wrapper directory placed first on
# PATH that overrides just the `command` builtin's flock check via a stub
# `flock` binary removed from PATH is unreliable (flock is often a builtin
# lookup via `command -v`), so instead we override PATH to a scratch bin dir
# containing every needed tool EXCEPT flock, forcing `command -v flock` to
# fail inside the sourced lib exactly as _with_queue_lock checks it.
NOFLOCK_BIN="$SCRATCH/noflock-bin"
mkdir -p "$NOFLOCK_BIN"
for tool in bash jq python3 cat mkdir dirname basename printf sed grep wc tr awk date git head tail mv rm find seq cut sort ls readlink expr xargs stat; do
  real="$(command -v "$tool" 2>/dev/null)" || continue
  ln -sf "$real" "$NOFLOCK_BIN/$tool" 2>/dev/null || true
done
OUT4=$(PATH="$NOFLOCK_BIN" COLUMNS=120 STATUSLINE_STATE_DIR="$STATE4" bash "$SCRIPT" --subagent-stop \
  <<<"$(_mk_hook_payload "$SID4" "$AID4" "$SUBFILE4")" 2>&1)
RC4=$?
if [ "$RC4" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: flock-unavailable: hook still exits 0 (hard-skip, never fatal)"
else
  FAIL=$((FAIL+1)); echo "FAIL: flock-unavailable: hook exited nonzero ($RC4)"
  echo "$OUT4" | sed 's/^/    /'
fi
QUEUE4="$STATE4/$SID4.subagent-queue.json"
# _with_queue_lock opens the queue file's fd (exec 9<>"$QUEUE_FILE") BEFORE
# checking flock availability, so an empty (0-byte) file may exist even on
# the hard-skip path — that's just the fd-open side effect, not an unlocked
# write. The actual invariant to check: the file is never left holding
# HALF-WRITTEN/invalid JSON (which would indicate an unlocked write raced
# a truncate-and-rewrite).
if [ ! -f "$QUEUE4" ] || [ ! -s "$QUEUE4" ]; then
  PASS=$((PASS+1)); echo "PASS: flock-unavailable: queue file absent or empty (fd-open side effect only, no unlocked write)"
elif jq -e . "$QUEUE4" >/dev/null 2>&1; then
  PASS=$((PASS+1)); echo "PASS: flock-unavailable: queue file (if any) is still valid JSON, no corruption"
else
  FAIL=$((FAIL+1)); echo "FAIL: flock-unavailable: queue file corrupted"
fi
SIDECAR4="$STATE4/$SID4.json"
if [ -f "$SIDECAR4" ]; then
  if jq -e . "$SIDECAR4" >/dev/null 2>&1; then
    PASS=$((PASS+1)); echo "PASS: flock-unavailable: sidecar (if any) is still valid JSON"
  else
    FAIL=$((FAIL+1)); echo "FAIL: flock-unavailable: sidecar corrupted"
  fi
else
  PASS=$((PASS+1)); echo "PASS: flock-unavailable: no sidecar written (queue-gated fold never ran)"
fi

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
