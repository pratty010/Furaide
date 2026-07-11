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

_strip_ansi() {  # stdin -> plain text
  sed 's/\x1b\[[0-9;]*m//g'
}

_subdir_for() {  # main_transcript_path -> stdout: that session's subagents/ dir
  # Mirrors _subagent_dir (statusline-lib/subagent-tracking.sh): the correct
  # nesting is <transcript-dir>/<transcript-basename-without-.jsonl>/subagents,
  # NOT a flat <transcript-dir>/subagents sibling (that was the Task 2 bug).
  printf '%s/%s/subagents' "$(dirname "$1")" "$(basename "$1" .jsonl)"
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

_MSG_ID_COUNTER=0
_assistant_line() {  # in out cache_read cache_creation [msg_id] [model]
  # message.id defaults to an auto-incrementing "msg_fixN" so every call
  # produces a distinct turn (dedup is by message.id — distinct turns MUST
  # have distinct ids). Pass an explicit msg_id to deliberately repeat an id
  # across lines (dedup regression fixtures). model is optional; omitted
  # entirely when not given so existing callers keep working unchanged.
  local mid="${5:-}" model="${6:-}"
  if [ -z "$mid" ]; then
    _MSG_ID_COUNTER=$((_MSG_ID_COUNTER+1))
    mid="msg_fix${_MSG_ID_COUNTER}"
  fi
  if [ -n "$model" ]; then
    printf '{"type":"assistant","message":{"id":"%s","model":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}' \
      "$mid" "$model" "$1" "$2" "$3" "$4"
  else
    printf '{"type":"assistant","message":{"id":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}' \
      "$mid" "$1" "$2" "$3" "$4"
  fi
}

_subagent_transcript_line() {  # in out cache_read cache_creation [msg_id] [model] -> one assistant record for a subagent's own transcript file
  _assistant_line "$1" "$2" "$3" "$4" "${5:-}" "${6:-}"
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
SUBDIR="$(_subdir_for "$TRANSCRIPT")"
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
_assert_contains "run1: grand-total in rendered (1500+50+10+300+20+0=1880 -> 1k)" "$OUT1" "↑1k"
_assert_contains "run1: cache-hit% rendered ((50+20)*100/1880 -> 3%)" "$OUT1" "⚡3%"
_assert_contains "run1: grand-total out rendered (300+150=450)" "$OUT1" "↓450"
_assert_contains "run1: subagent bracket renders raw counts, done entry only (in=300+20+0=320, out=150)" "$OUT1" "[⫂ 320/150]"

SIDECAR="$STATE/$SID.json"
_assert_json_field "run1: sidecar in_total" "$SIDECAR" '.in_total' "1500"
_assert_json_field "run1: sidecar out_total" "$SIDECAR" '.out_total' "300"
_assert_json_field "run1: sidecar cache_read_total" "$SIDECAR" '.cache_read_total' "50"
_assert_json_field "run1: sidecar cache_creation_total" "$SIDECAR" '.cache_creation_total' "10"
_assert_json_field "run1: sidecar subagent_in_total" "$SIDECAR" '.subagent_in_total' "300"
_assert_json_field "run1: sidecar subagent_out_total" "$SIDECAR" '.subagent_out_total' "150"
_assert_json_field "run1: sidecar counted_subagents includes sub1" "$SIDECAR" '.counted_subagents | contains(["a11111111111111a1"])' "true"
_assert_json_field "run1: sidecar subagent_fallback_tokens" "$SIDECAR" '.subagent_fallback_tokens' "0"
OFFSET1=$(jq -r '.transcript_offset' "$SIDECAR" 2>/dev/null)
SIZE1=$(wc -c < "$TRANSCRIPT" | tr -d ' ')
_assert_json_field "run1: transcript_offset advanced to full file size" "$SIDECAR" '.transcript_offset' "$SIZE1"

echo "== Test 2: second run with no new transcript lines adds nothing (idempotency) =="
OUT2=$(_run "$(_mk_payload "$SID" "$TRANSCRIPT")" "$STATE")
_assert_contains "run2: totals unchanged (no new data)" "$OUT2" "↑1k"
_assert_contains "run2: subagent bracket unchanged (sub1 not double-counted)" "$OUT2" "[⫂ 320/150]"
_assert_json_field "run2: sidecar in_total unchanged" "$SIDECAR" '.in_total' "1500"
_assert_json_field "run2: sidecar transcript_offset unchanged" "$SIDECAR" '.transcript_offset' "$OFFSET1"
_assert_json_field "run2: subagent_in_total still counted exactly once (no double-fold)" "$SIDECAR" '.subagent_in_total' "300"
_assert_json_field "run2: counted_subagents still length 1 (no double-append)" "$SIDECAR" '.counted_subagents | length' "1"

echo "== Test 3: new lines + missing subagent transcript file -> pending (not folded into confirmed sums) =="
# sub2's transcript file is deliberately never created under $SUBDIR (simulates a
# completion that raced ahead of the subagent's own transcript being flushed). The
# completion record's own <usage>subagent_tokens: 777</usage> is stashed only as a
# flagged fallback_estimate on a pending entry — never folded into the confirmed
# in/out sums, and retried against the real file on every subsequent render.
{
  _assistant_line 200 50 5 1
  printf '\n'
  _completion_line "b22222222222222b2" 777
  printf '\n'
} >> "$TRANSCRIPT"

OUT3=$(_run "$(_mk_payload "$SID" "$TRANSCRIPT")" "$STATE")
_assert_contains "run3: grand-total out advanced (350+150=500)" "$OUT3" "↓500"
_assert_contains "run3: cache-hit% advanced ((55+20)*100/2086 -> 3%)" "$OUT3" "⚡3%"
_assert_contains "run3: confirmed subagent bracket still just sub1 (320/150)" "$OUT3" "[⫂ 320/150]"
# Pending marker is now a dim "~" prefix on the token composite AND the cost
# composite (both gated on PENDING_COUNT > 0) — not a per-agent "~<n>(count)"
# suffix. ANSI-strip first since the "~" and the glyph it prefixes are
# separated by color-reset/color-start escape codes.
OUT3_PLAIN=$(printf '%s' "$OUT3" | _strip_ansi)
_assert_contains "run3: pending marker renders on token composite (~↑)" "$OUT3_PLAIN" "~↑"
_assert_contains "run3: pending marker renders on cost composite (~\$:)" "$OUT3_PLAIN" '~$:'

_assert_json_field "run3: sidecar in_total advanced" "$SIDECAR" '.in_total' "1700"
_assert_json_field "run3: sidecar out_total advanced" "$SIDECAR" '.out_total' "350"
_assert_json_field "run3: sidecar cache_read_total advanced" "$SIDECAR" '.cache_read_total' "55"
_assert_json_field "run3: sidecar cache_creation_total advanced" "$SIDECAR" '.cache_creation_total' "11"
_assert_json_field "run3: sidecar pending_subagents has sub2" "$SIDECAR" '.pending_subagents | has("b22222222222222b2")' "true"
_assert_json_field "run3: sidecar pending_subagents[sub2].fallback_estimate" "$SIDECAR" '.pending_subagents["b22222222222222b2"].fallback_estimate' "777"
_assert_json_field "run3: sidecar counted_subagents does not yet include sub2" "$SIDECAR" '.counted_subagents | contains(["b22222222222222b2"])' "false"
_assert_json_field "run3: sidecar subagent_fallback_tokens stays 0 (legacy read-only key)" "$SIDECAR" '.subagent_fallback_tokens' "0"
_assert_json_field "run3: sidecar subagent_in_total untouched by run3 (sub1 only)" "$SIDECAR" '.subagent_in_total' "300"

echo "== Test 3b: pending subagent resolves once its transcript file appears (retried every render) =="
SUB2_FILE="$SUBDIR/agent-b22222222222222b2.jsonl"
_subagent_transcript_line 400 250 10 5 > "$SUB2_FILE"
OUT3B=$(_run "$(_mk_payload "$SID" "$TRANSCRIPT")" "$STATE")
_assert_json_field "run3b: sidecar counted_subagents now includes sub2" "$SIDECAR" '.counted_subagents | contains(["b22222222222222b2"])' "true"
_assert_json_field "run3b: sidecar pending_subagents[sub2] resets (removed)" "$SIDECAR" '.pending_subagents | has("b22222222222222b2")' "false"
_assert_json_field "run3b: sidecar subagent_in_total (300 sub1 + 400 sub2)" "$SIDECAR" '.subagent_in_total' "700"
_assert_json_field "run3b: sidecar subagent_out_total (150 sub1 + 250 sub2)" "$SIDECAR" '.subagent_out_total' "400"
_assert_contains "run3b: confirmed subagent bracket now includes sub2 (320+400+10+5=735 / 150+250=400)" "$OUT3B" "[⫂ 735/400]"
# Pending marker must disappear entirely once PENDING_COUNT is back to 0 —
# plain absence-of-"~" check on the ANSI-stripped output (no other glyph in
# this display uses a bare tilde).
OUT3B_PLAIN=$(printf '%s' "$OUT3B" | _strip_ansi)
if printf '%s' "$OUT3B_PLAIN" | grep -qF -- '~'; then
  FAIL=$((FAIL+1)); echo "FAIL: run3b: pending marker must disappear once resolved"
  printf '%s\n' "$OUT3B_PLAIN" | sed 's/^/    /'
else
  PASS=$((PASS+1)); echo "PASS: run3b: pending marker correctly absent once resolved"
fi

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
if printf '%s' "$OUT4" | grep -qF -- '[⫂'; then
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
if printf '%s' "$OUT5" | grep -qF -- '[⫂'; then
  FAIL=$((FAIL+1)); echo "FAIL: launch-only record must not render a subagent share segment"
else
  PASS=$((PASS+1)); echo "PASS: launch-only record correctly renders no subagent share segment"
fi
_assert_json_field "launch-only: sidecar counted_subagents does not include the launch-ack id" "$SIDECAR5" '(.counted_subagents // []) | contains(["cdead00000000dead"])' "false"
_assert_json_field "launch-only: sidecar pending_subagents does not include the launch-ack id" "$SIDECAR5" '(.pending_subagents // {}) | has("cdead00000000dead")' "false"

echo "== Test 6: neither subagent transcript file nor parseable <usage> tokens -> pending with 0 estimate (retryable) =="
STATE6="$SCRATCH/state6"
mkdir -p "$STATE6"
SID6="sess-neithersource"
TRANSCRIPT6="$SCRATCH/transcript6.jsonl"
# <usage> block present (so the completion signal fires) but with no
# subagent_tokens: line, and no subagents/agent-<id>.jsonl file on disk.
# The agent id is stored as a pending entry with fallback_estimate=0 (not
# left absent) so it keeps getting retried against the real file on every
# subsequent render.
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
_assert_json_field "neither-source: stored as a pending entry" "$SIDECAR6" '.pending_subagents | has("dead111111111dead1")' "true"
_assert_json_field "neither-source: fallback_estimate is 0 (retryable, not fabricated)" "$SIDECAR6" '.pending_subagents["dead111111111dead1"].fallback_estimate' "0"
_assert_json_field "neither-source: subagent_fallback_tokens stays 0" "$SIDECAR6" '.subagent_fallback_tokens' "0"
if printf '%s' "$OUT6" | grep -qF -- '[⫂'; then
  FAIL=$((FAIL+1)); echo "FAIL: neither-source case must not render a confirmed subagent bracket"
else
  PASS=$((PASS+1)); echo "PASS: neither-source case correctly renders no confirmed subagent bracket"
fi
OUT6_PLAIN=$(printf '%s' "$OUT6" | _strip_ansi)
_assert_contains "neither-source: pending marker renders on token composite even with a 0 estimate (~↑)" "$OUT6_PLAIN" "~↑"

echo "== Test 7: dedup regression (message.id dedup — last-per-id wins, not naive per-line sum) =="
STATE7="$SCRATCH/state7"
mkdir -p "$STATE7"
SID7="sess-dedup"
TRANSCRIPT7="$SCRATCH/transcript7.jsonl"
# Three lines share id msg_dup1 (Claude Code writes one JSONL line per content
# block of a single API response; each line repeats that response's usage
# snapshot, with output_tokens growing across lines — last line == max). Naive
# per-line summation would double/triple count; dedup takes the LAST record.
{
  _assistant_line 100 3 0 0 "msg_dup1"
  printf '\n'
  _assistant_line 100 3 0 0 "msg_dup1"
  printf '\n'
  _assistant_line 100 541 0 0 "msg_dup1"
  printf '\n'
  _assistant_line 50 100 0 0 "msg_dup2"
  printf '\n'
} > "$TRANSCRIPT7"
OUT7=$(_run "$(_mk_payload "$SID7" "$TRANSCRIPT7")" "$STATE7")
SIDECAR7="$STATE7/$SID7.json"
_assert_json_field "test7: in_total dedups to 150 (last-per-id: 100+50, NOT naive 350)" "$SIDECAR7" '.in_total' "150"
_assert_json_field "test7: out_total dedups to 641 (last-per-id: 541+100, NOT naive 647)" "$SIDECAR7" '.out_total' "641"

echo "== Test 8: dedup holds across an incremental tail-pass boundary (message split mid-scan) =="
STATE8="$SCRATCH/state8"
mkdir -p "$STATE8"
SID8="sess-dedup-boundary"
TRANSCRIPT8="$SCRATCH/transcript8.jsonl"
# First pass sees only the first two msg_dup1 lines; second pass sees the
# third msg_dup1 line plus msg_dup2. The sidecar's last_msg_id/last_msg_out
# must ensure the second pass only adds msg_dup1's output GROWTH beyond what
# pass 1 already counted, not a second full in/out contribution.
{
  _assistant_line 100 3 0 0 "msg_dup1"
  printf '\n'
  _assistant_line 100 3 0 0 "msg_dup1"
  printf '\n'
} > "$TRANSCRIPT8"
_run "$(_mk_payload "$SID8" "$TRANSCRIPT8")" "$STATE8" >/dev/null
{
  _assistant_line 100 541 0 0 "msg_dup1"
  printf '\n'
  _assistant_line 50 100 0 0 "msg_dup2"
  printf '\n'
} >> "$TRANSCRIPT8"
_run "$(_mk_payload "$SID8" "$TRANSCRIPT8")" "$STATE8" >/dev/null
SIDECAR8="$STATE8/$SID8.json"
_assert_json_field "test8: in_total after boundary split is 150 (no double count across passes)" "$SIDECAR8" '.in_total' "150"
_assert_json_field "test8: out_total after boundary split is 641 (no double count across passes)" "$SIDECAR8" '.out_total' "641"

echo "== Test 9: subagent cost pricing (done entry with a per-model bucket) =="
STATE9="$SCRATCH/state9"
mkdir -p "$STATE9"
SID9="sess-pricing"
TRANSCRIPT9="$SCRATCH/transcript9.jsonl"
{
  _assistant_line 10 5 0 0
  printf '\n'
  _completion_line "c33333333333333c3" 1
  printf '\n'
} > "$TRANSCRIPT9"
# Subagent transcript lives under THIS transcript's own dir/subagents/ (each
# main transcript gets its own nested subagents/ dir, keyed by its own
# basename — TRANSCRIPT9 != TRANSCRIPT, so this is NOT the same $SUBDIR as
# Test 1).
SUBDIR9="$(_subdir_for "$TRANSCRIPT9")"
mkdir -p "$SUBDIR9"
_subagent_transcript_line 2000000 1000000 0 0 "" "claude-haiku-4-5-20251001" > "$SUBDIR9/agent-c33333333333333c3.jsonl"
OUT9=$(_run "$(_mk_payload "$SID9" "$TRANSCRIPT9" 14.00)" "$STATE9")
_assert_contains "test9: subagent cost shown as % of total (7.00/14.00 = 50%)" "$OUT9" "[50%]"
echo "== Test 10: cache-hit% is average of per-turn rates, not cumulative token-weighted =="
STATE10="$SCRATCH/state10"
mkdir -p "$STATE10"
SID10="sess-average"
TRANSCRIPT10="$SCRATCH/transcript10.jsonl"
# One huge turn with 0% cache-read (dominates cumulative denominator) plus two
# tiny turns that are 100% cache-read. Cumulative ratio is ~20/10020 = 0.2%,
# but the unweighted average across the three turns is (0+1+1)/3 = 66.6...%.
{
  _assistant_line 10000 0 0 0
  printf '\n'
  _assistant_line 0 0 10 0
  printf '\n'
  _assistant_line 0 0 10 0
  printf '\n'
} > "$TRANSCRIPT10"
OUT10=$(_run "$(_mk_payload "$SID10" "$TRANSCRIPT10")" "$STATE10")
SIDECAR10="$STATE10/$SID10.json"
_assert_contains "test10: average cache-hit% rendered (66%)" "$OUT10" "⚡66%"
_assert_json_field "test10: sidecar rate_sum is 2.0 (two 100% turns)" "$SIDECAR10" '.rate_sum' "2"
_assert_json_field "test10: sidecar rate_turns is 3 (three contributing turns)" "$SIDECAR10" '.rate_turns' "3"

echo "== Test 11: E3 migration — an OLD-shape sidecar (.subagents map) folds into the new cumulative schema =="
STATE11="$SCRATCH/state11"
mkdir -p "$STATE11"
SID11="sess-migrate"
# A pre-existing OLD-shape sidecar: one done entry (old1, with a per-model
# bucket + rate data), one pending entry (old2), and a legacy
# subagent_fallback_tokens lump. No transcript_path resolves (isolates the
# migration step, which runs on every _sidecar_load, from the tail pass).
cat > "$STATE11/$SID11.json" <<'EOF'
{
  "subagents": {
    "old1111111111111old1": {
      "in": 100, "out": 50, "cache_read": 5, "cache_creation": 2,
      "models": {"claude-sonnet-5": {"in": 100, "out": 50, "cr": 5, "cc": 2, "cc_5m": 2, "cc_1h": 0}},
      "rate_sum": 0.5, "rate_turns": 1, "done": true
    },
    "old2222222222222old2": {
      "pending": true, "fallback_estimate": 42, "model": "claude-haiku-4-5", "done": false
    }
  },
  "subagent_fallback_tokens": 10
}
EOF
_run "$(_mk_payload "$SID11" "$SCRATCH/does-not-exist-11.jsonl")" "$STATE11" >/dev/null
SIDECAR11="$STATE11/$SID11.json"
_assert_json_field "migrate: subagent_in_total folds done.in + legacy fallback (100+10=110)" "$SIDECAR11" '.subagent_in_total' "110"
_assert_json_field "migrate: subagent_out_total folds done.out (50)" "$SIDECAR11" '.subagent_out_total' "50"
_assert_json_field "migrate: subagent_cr_total folds done.cache_read (5)" "$SIDECAR11" '.subagent_cr_total' "5"
_assert_json_field "migrate: subagent_cc_total folds done.cache_creation (2)" "$SIDECAR11" '.subagent_cc_total' "2"
_assert_json_field "migrate: subagent_rate_sum folds done.rate_sum (0.5)" "$SIDECAR11" '.subagent_rate_sum' "0.5"
_assert_json_field "migrate: subagent_rate_turns folds done.rate_turns (1)" "$SIDECAR11" '.subagent_rate_turns' "1"
_assert_json_field "migrate: subagent_models carries the done entry's per-model bucket" "$SIDECAR11" '.subagent_models["claude-sonnet-5"].in' "100"
_assert_json_field "migrate: counted_subagents includes the done id" "$SIDECAR11" '.counted_subagents | contains(["old1111111111111old1"])' "true"
_assert_json_field "migrate: pending_subagents carries the not-done entry" "$SIDECAR11" '.pending_subagents["old2222222222222old2"].fallback_estimate' "42"
_assert_json_field "migrate: old .subagents key is dropped" "$SIDECAR11" 'has("subagents")' "false"
_assert_json_field "migrate: legacy subagent_fallback_tokens key is dropped" "$SIDECAR11" 'has("subagent_fallback_tokens")' "false"

echo "== Test 11b: E3 migration is idempotent — re-running on an already-migrated (or fresh) sidecar is a no-op =="
_run "$(_mk_payload "$SID11" "$SCRATCH/does-not-exist-11.jsonl")" "$STATE11" >/dev/null
_assert_json_field "migrate idempotent: subagent_in_total unchanged on second load (110)" "$SIDECAR11" '.subagent_in_total' "110"
_assert_json_field "migrate idempotent: counted_subagents still length 1" "$SIDECAR11" '.counted_subagents | length' "1"

echo "== Test 12: E5 captures web_search/web_fetch counts from usage.server_tool_use (dedup-aware) =="
STATE12="$SCRATCH/state12"
mkdir -p "$STATE12"
SID12="sess-websearch"
TRANSCRIPT12="$SCRATCH/transcript12.jsonl"
# msg_ws1: 2 web_search + 1 web_fetch. msg_ws2 repeated 3x with the same id
# (same-pass dedup via group_by/last-per-id, independent of the incremental
# boundary logic) carrying 0 web_search + 3 web_fetch on its last line only
# — the earlier duplicate lines must not multiply the count.
{
  printf '{"type":"assistant","message":{"id":"msg_ws1","model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"server_tool_use":{"web_search_requests":2,"web_fetch_requests":1}}}}\n'
  printf '{"type":"assistant","message":{"id":"msg_ws2","model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":3}}}}\n'
  printf '{"type":"assistant","message":{"id":"msg_ws2","model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":9,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":3}}}}\n'
} > "$TRANSCRIPT12"
_run "$(_mk_payload "$SID12" "$TRANSCRIPT12")" "$STATE12" >/dev/null
SIDECAR12="$STATE12/$SID12.json"
_assert_json_field "E5: web_search_total sums across deduped records (2+0=2)" "$SIDECAR12" '.web_search_total' "2"
_assert_json_field "E5: web_fetch_total sums across deduped records, no double-count of the dup line (1+3=4)" "$SIDECAR12" '.web_fetch_total' "4"

echo

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
