#!/usr/bin/env bash
# Plain-bash test harness for statusline-command.sh's transcript tail pass
# (Task 8.2: token totals + subagent share). Same style as test_sidecar_fold.sh
# (no bats in this environment). Run: bash tests/statusline/test_transcript_tail.sh
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

_mk_payload() {  # session_id transcript_path
  cat <<EOF
{
  "session_id": "$1",
  "transcript_path": "$2",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 0, "total_api_duration_ms": 0, "total_cost_usd": 1.23,
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"used_percentage": 10, "total_input_tokens": 1000, "total_output_tokens": 200,
                      "context_window_size": 200000, "current_usage": {"cache_read_input_tokens": 0}},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}
EOF
}

_assistant_line() {  # in out cache_read cache_creation
  printf '{"type":"assistant","message":{"usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}' "$1" "$2" "$3" "$4"
}

_subagent_transcript_line() {  # in out cache_read cache_creation -> one assistant record for a subagent's own transcript file
  _assistant_line "$1" "$2" "$3" "$4"
}

_completion_line() {  # agent_id subagent_tokens -> a real type:"user" tool_result record carrying the
  # "agentId: <id> (use SendMessage ...)" text and a "<usage>subagent_tokens: N ...</usage>" block,
  # matching the actual Claude Code wire format (both pieces required as the "done" signal).
  python3 -c "
import json,sys
aid, tok = sys.argv[1], sys.argv[2]
rec = {
  'type': 'user',
  'message': {
    'role': 'user',
    'content': [
      {'tool_use_id': 'toolu_01xyz', 'type': 'tool_result', 'content': [
        {'type': 'text', 'text': f\"agentId: {aid} (use SendMessage with to: '{aid}', summary: 'recap' to continue this agent)\"},
        {'type': 'text', 'text': f'<usage>subagent_tokens: {tok}\ntool_uses: 3\nduration_ms: 1000</usage>'}
      ]}
    ]
  }
}
print(json.dumps(rec))
" "$1" "$2"
}

_launch_line() {  # agent_id -> a launch-acknowledgement record (agentId present, NO <usage> block) — must NOT count as done
  python3 -c "
import json,sys
aid = sys.argv[1]
rec = {
  'type': 'user',
  'message': {
    'role': 'user',
    'content': [
      {'tool_use_id': 'toolu_00launch', 'type': 'tool_result', 'content': [
        {'type': 'text', 'text': f'Async agent launched successfully.\nagentId: {aid} (internal ID - do not mention to user.)'}
      ]}
    ]
  }
}
print(json.dumps(rec))
" "$1"
}

STATE="$SCRATCH/state"
mkdir -p "$STATE"
SID="sess-tail"
TRANSCRIPT="$SCRATCH/transcript.jsonl"
SUBDIR="$SCRATCH/subagents"
mkdir -p "$SUBDIR"
SUB1_FILE="$SUBDIR/agent-a11111111111111a1.jsonl"

echo "== Test 1: initial pass sums main-thread usage + real subagent transcript file =="
# Main thread: two assistant messages (1000/200/50/10) + (500/100/0/0) = 1500/300/50/10.
# One non-assistant record must be ignored. A launch-ack record for sub1 (agentId present,
# no <usage> block) must NOT be treated as done. The real completion record (agentId +
# <usage> block) triggers discovery of subagents/agent-sub1....jsonl -> counted via its
# own usage (300/150/20/0); the completion record's inline subagent_tokens=999 must be
# IGNORED since the subagent transcript file took priority.
{
  _assistant_line 1000 200 50 10
  printf '\n'
  printf '{"type":"user","message":{"content":"hi"}}\n'
  _assistant_line 500 100 0 0
  printf '\n'
  _launch_line "a11111111111111a1"
  printf '\n'
  _completion_line "a11111111111111a1" 999
  printf '\n'
} > "$TRANSCRIPT"
_subagent_transcript_line 300 150 20 0 > "$SUB1_FILE"

OUT1=$(_run "$(_mk_payload "$SID" "$TRANSCRIPT")" "$STATE")
_assert_contains "run1: main-thread in/out totals rendered (1500/300 -> 1k/300)" "$OUT1" "↑1k"
_assert_contains "run1: main-thread cache read% rendered (50/1500 -> 3%)" "$OUT1" "⚡3%"
_assert_contains "run1: main-thread out total rendered" "$OUT1" "↓300"
_assert_contains "run1: subagent share rendered (sub in=300,out=150 vs totals 1500/300)" "$OUT1" "[⑂16%/33%]"

SIDECAR="$STATE/$SID.json"
_assert_json_field "run1: sidecar in_total" "$SIDECAR" '.in_total' "1500"
_assert_json_field "run1: sidecar out_total" "$SIDECAR" '.out_total' "300"
_assert_json_field "run1: sidecar cache_read_total" "$SIDECAR" '.cache_read_total' "50"
_assert_json_field "run1: sidecar cache_creation_total" "$SIDECAR" '.cache_creation_total' "10"
_assert_json_field "run1: sidecar subagents[sub1].in" "$SIDECAR" '.subagents["a11111111111111a1"].in' "300"
_assert_json_field "run1: sidecar subagents[sub1].out" "$SIDECAR" '.subagents["a11111111111111a1"].out' "150"
_assert_json_field "run1: sidecar subagents[sub1].done" "$SIDECAR" '.subagents["a11111111111111a1"].done' "true"
_assert_json_field "run1: sidecar subagent_fallback_tokens" "$SIDECAR" '.subagent_fallback_tokens' "0"
OFFSET1=$(jq -r '.transcript_offset' "$SIDECAR" 2>/dev/null)
SIZE1=$(wc -c < "$TRANSCRIPT" | tr -d ' ')
_assert_json_field "run1: transcript_offset advanced to full file size" "$SIDECAR" '.transcript_offset' "$SIZE1"

echo "== Test 2: second run with no new transcript lines adds nothing (idempotency) =="
OUT2=$(_run "$(_mk_payload "$SID" "$TRANSCRIPT")" "$STATE")
_assert_contains "run2: totals unchanged (no new data)" "$OUT2" "↑1k"
_assert_contains "run2: subagent share unchanged (sub1 not double-counted)" "$OUT2" "[⑂16%/33%]"
_assert_json_field "run2: sidecar in_total unchanged" "$SIDECAR" '.in_total' "1500"
_assert_json_field "run2: sidecar transcript_offset unchanged" "$SIDECAR" '.transcript_offset' "$OFFSET1"
_assert_json_field "run2: subagents[sub1] still counted exactly once" "$SIDECAR" '.subagents["a11111111111111a1"].in' "300"

echo "== Test 3: new lines + missing subagent transcript file falls back to <usage> block =="
# sub2's transcript file is deliberately never created under $SUBDIR (simulates
# deletion/absence); the completion record's own <usage>subagent_tokens: 777</usage>
# is the only source available, so it must be used as the fallback lump sum.
{
  _assistant_line 200 50 5 1
  printf '\n'
  _completion_line "b22222222222222b2" 777
  printf '\n'
} >> "$TRANSCRIPT"

OUT3=$(_run "$(_mk_payload "$SID" "$TRANSCRIPT")" "$STATE")
_assert_contains "run3: main-thread out total advanced (350)" "$OUT3" "↓350"
_assert_contains "run3: main-thread cache read% advanced (55/1700 -> 3%)" "$OUT3" "⚡3%"
_assert_contains "run3: subagent share advanced (sub1 in=300 + fallback=777 vs total 1700; sub_out=150 vs 350)" "$OUT3" "[⑂38%/30%]"

_assert_json_field "run3: sidecar in_total advanced" "$SIDECAR" '.in_total' "1700"
_assert_json_field "run3: sidecar out_total advanced" "$SIDECAR" '.out_total' "350"
_assert_json_field "run3: sidecar cache_read_total advanced" "$SIDECAR" '.cache_read_total' "55"
_assert_json_field "run3: sidecar cache_creation_total advanced" "$SIDECAR" '.cache_creation_total' "11"
_assert_json_field "run3: sidecar subagents[sub2].done" "$SIDECAR" '.subagents["b22222222222222b2"].done' "true"
_assert_json_field "run3: sidecar subagents[sub2].in falls back to 0" "$SIDECAR" '.subagents["b22222222222222b2"].in' "0"
_assert_json_field "run3: sidecar subagent_fallback_tokens" "$SIDECAR" '.subagent_fallback_tokens' "777"
_assert_json_field "run3: sidecar subagents[sub1] untouched by run3" "$SIDECAR" '.subagents["a11111111111111a1"].in' "300"

echo "== Test 4: fail-open when transcript_path is absent/unreadable =="
STATE4="$SCRATCH/state4"
mkdir -p "$STATE4"
SID4="sess-notranscript"
OUT4=$(_run "$(_mk_payload "$SID4" "$SCRATCH/does-not-exist.jsonl")" "$STATE4")
RC4=$?
if [ "$RC4" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: missing transcript_path does not crash the script (exit 0)"
else
  FAIL=$((FAIL+1)); echo "FAIL: missing transcript_path caused nonzero exit ($RC4)"
fi
_assert_contains "fail-open: still renders model name despite missing transcript" "$OUT4" "Sonnet"
_assert_contains "fail-open: token display falls back to context_window payload fields (1000/200 -> 1k/200)" "$OUT4" "↑1k"
if printf '%s' "$OUT4" | grep -qF -- '[⑂'; then
  FAIL=$((FAIL+1)); echo "FAIL: subagent share segment should be absent with no subagent activity"
else
  PASS=$((PASS+1)); echo "PASS: subagent share segment correctly absent with no subagent activity"
fi

echo "== Test 5: launch-ack alone (agentId present, no <usage> block) never counts as done =="
STATE5="$SCRATCH/state5"
mkdir -p "$STATE5"
SID5="sess-launchonly"
TRANSCRIPT5="$SCRATCH/transcript5.jsonl"
{
  _assistant_line 100 20 0 0
  printf '\n'
  _launch_line "cdead00000000dead"
  printf '\n'
} > "$TRANSCRIPT5"
OUT5=$(_run "$(_mk_payload "$SID5" "$TRANSCRIPT5")" "$STATE5")
SIDECAR5="$STATE5/$SID5.json"
if printf '%s' "$OUT5" | grep -qF -- '[⑂'; then
  FAIL=$((FAIL+1)); echo "FAIL: launch-only record must not render a subagent share segment"
else
  PASS=$((PASS+1)); echo "PASS: launch-only record correctly renders no subagent share segment"
fi
_assert_json_field "launch-only: sidecar has no subagents entry" "$SIDECAR5" '.subagents["cdead00000000dead"] // "absent"' "absent"

echo "== Test 6: neither subagent transcript file nor parseable <usage> tokens -> left unmarked =="
STATE6="$SCRATCH/state6"
mkdir -p "$STATE6"
SID6="sess-neithersource"
TRANSCRIPT6="$SCRATCH/transcript6.jsonl"
# <usage> block present (so the completion signal fires) but with no
# subagent_tokens: line, and no subagents/agent-<id>.jsonl file on disk.
{
  _assistant_line 100 20 0 0
  printf '\n'
  printf '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t1","type":"tool_result","content":[{"type":"text","text":"agentId: dead111111111dead1 (use SendMessage with to: '"'"'dead111111111dead1'"'"', summary: '"'"'x'"'"' to continue this agent)\\n<usage>tool_uses: 2\\nduration_ms: 500</usage>"}]}]}}\n'
} > "$TRANSCRIPT6"
OUT6=$(_run "$(_mk_payload "$SID6" "$TRANSCRIPT6")" "$STATE6")
RC6=$?
SIDECAR6="$STATE6/$SID6.json"
if [ "$RC6" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: neither-source case does not crash the script (exit 0)"
else
  FAIL=$((FAIL+1)); echo "FAIL: neither-source case caused nonzero exit ($RC6)"
fi
_assert_json_field "neither-source: not fabricated into subagents map" "$SIDECAR6" '.subagents["dead111111111dead1"] // "absent"' "absent"
_assert_json_field "neither-source: subagent_fallback_tokens stays 0" "$SIDECAR6" '.subagent_fallback_tokens' "0"
if printf '%s' "$OUT6" | grep -qF -- '[⑂'; then
  FAIL=$((FAIL+1)); echo "FAIL: neither-source case must not render a subagent share segment"
else
  PASS=$((PASS+1)); echo "PASS: neither-source case correctly renders no subagent share segment"
fi

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
