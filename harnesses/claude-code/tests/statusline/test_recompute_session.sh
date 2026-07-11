#!/usr/bin/env bash
# Plain-bash test harness for the Task 3 merged `--recompute` CLI
# (statusline-lib/recompute.sh's _recompute_session / _recompute_all /
# _recompute_session_by_id, dispatched from statusline-command.sh's
# --recompute-all / --recompute <sid> / --recompute [stdin] forms). Same
# style as test_transcript_tail.sh (no bats here).
#
# NOTE on PROJECTS_ROOT: recompute.sh hardcodes PROJECTS_ROOT="$HOME/.claude/
# projects" (not independently env-overridable the way STATUSLINE_STATE_DIR
# is for the sidecar dir). To exercise the real recompute code path against a
# throwaway fixture tree without touching the actual user's
# ~/.claude/projects, every invocation below overrides HOME to a scratch
# directory containing a fake .claude/projects/<project>/<sid>.jsonl tree.
# STATUSLINE_STATE_DIR (the sidecar output dir) is independently scoped per
# test so runs never cross-contaminate.
#
# Run: bash tests/statusline/test_recompute_session.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../../config/statusline-command.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0
FAIL=0

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

_assistant_line() {  # in out cache_read cache_creation msg_id -> one assistant JSONL record
  printf '{"type":"assistant","message":{"id":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}\n' \
    "$5" "$1" "$2" "$3" "$4"
}

# ── Fake .claude/projects tree (scratch HOME) ───────────────────────────────
FAKE_HOME="$SCRATCH/home"
PROJ="$FAKE_HOME/.claude/projects/fakeproj"
mkdir -p "$PROJ"

TARGET_SID="sess-recompute-target"
OTHER_SID_A="sess-recompute-other-a"
OTHER_SID_B="sess-recompute-other-b"

TARGET_TRANSCRIPT="$PROJ/${TARGET_SID}.jsonl"
{
  _assistant_line 1000 100 0 0 "msg_r1"
  _assistant_line 500 50 0 0 "msg_r2"
} > "$TARGET_TRANSCRIPT"
TARGET_SUBDIR="$PROJ/${TARGET_SID}/subagents"
mkdir -p "$TARGET_SUBDIR"
TARGET_AID="d1000000000000001"
_assistant_line 300 30 5 2 "msg_sub1" > "$TARGET_SUBDIR/agent-${TARGET_AID}.jsonl"

# Two unrelated sessions in the same fake tree, so --recompute-all has more
# than one session to walk (and so a per-session test can confirm the target
# form doesn't cross-contaminate the others' sidecars).
{ _assistant_line 200 20 0 0 "msg_oa1"; } > "$PROJ/${OTHER_SID_A}.jsonl"
{ _assistant_line 400 40 0 0 "msg_ob1"; } > "$PROJ/${OTHER_SID_B}.jsonl"

_run_recompute_arg() {  # sid state_dir
  HOME="$FAKE_HOME" COLUMNS=120 STATUSLINE_STATE_DIR="$2" bash "$SCRIPT" --recompute "$1" 2>&1
}
_run_recompute_all() {  # state_dir
  HOME="$FAKE_HOME" COLUMNS=120 STATUSLINE_STATE_DIR="$1" bash "$SCRIPT" --recompute all 2>&1
}
_run_recompute_stdin() {  # sid state_dir
  HOME="$FAKE_HOME" COLUMNS=120 STATUSLINE_STATE_DIR="$2" bash "$SCRIPT" --recompute <<<"{\"session_id\": \"$1\"}" 2>&1
}

echo "== Test 1: --recompute <sid> (explicit arg) matches --recompute all for the same session =="
STATE_ARG="$SCRATCH/state_arg"; mkdir -p "$STATE_ARG"
STATE_ALL="$SCRATCH/state_all"; mkdir -p "$STATE_ALL"

_run_recompute_arg "$TARGET_SID" "$STATE_ARG" >/dev/null
_run_recompute_all "$STATE_ALL" >/dev/null

SIDECAR_ARG="$STATE_ARG/${TARGET_SID}.json"
SIDECAR_ALL="$STATE_ALL/${TARGET_SID}.json"

if [ -f "$SIDECAR_ARG" ] && [ -f "$SIDECAR_ALL" ]; then
  PASS=$((PASS+1)); echo "PASS: both forms produced a sidecar for the target session"
else
  FAIL=$((FAIL+1)); echo "FAIL: one of the two forms did not produce a sidecar (arg:$( [ -f "$SIDECAR_ARG" ] && echo yes || echo no), all:$( [ -f "$SIDECAR_ALL" ] && echo yes || echo no))"
fi

# transcript_offset legitimately differs run-to-run only if the file changed
# between runs (it hasn't here), so a full jq -S diff should be byte-identical.
DIFF_ARG_ALL=$(diff <(jq -S . "$SIDECAR_ARG" 2>/dev/null) <(jq -S . "$SIDECAR_ALL" 2>/dev/null))
if [ -z "$DIFF_ARG_ALL" ]; then
  PASS=$((PASS+1)); echo "PASS: --recompute <sid> sidecar is byte-identical (post jq -S) to --recompute all's for the same session"
else
  FAIL=$((FAIL+1)); echo "FAIL: sidecars differ between the two forms:"
  printf '%s\n' "$DIFF_ARG_ALL" | sed 's/^/    /'
fi
_assert_json_field "explicit-arg form: in_total correct (1500)" "$SIDECAR_ARG" '.in_total' "1500"
_assert_json_field "explicit-arg form: subagent_in_total correct (300)" "$SIDECAR_ARG" '.subagent_in_total' "300"
_assert_json_field "explicit-arg form: counted_subagents includes the fixture agent" "$SIDECAR_ARG" \
  ".counted_subagents | contains([\"$TARGET_AID\"])" "true"

echo "== Test 2: --recompute with NO arg (stdin session_id) matches the explicit-arg form =="
STATE_STDIN="$SCRATCH/state_stdin"; mkdir -p "$STATE_STDIN"
_run_recompute_stdin "$TARGET_SID" "$STATE_STDIN" >/dev/null
SIDECAR_STDIN="$STATE_STDIN/${TARGET_SID}.json"
DIFF_STDIN_ARG=$(diff <(jq -S . "$SIDECAR_STDIN" 2>/dev/null) <(jq -S . "$SIDECAR_ARG" 2>/dev/null))
if [ -z "$DIFF_STDIN_ARG" ]; then
  PASS=$((PASS+1)); echo "PASS: stdin form produces an identical sidecar to the explicit-arg form"
else
  FAIL=$((FAIL+1)); echo "FAIL: stdin form differs from explicit-arg form:"
  printf '%s\n' "$DIFF_STDIN_ARG" | sed 's/^/    /'
fi

echo "== Test 3: a stale non-empty subagent-queue.json (entry's transcript file DOES exist) is drained clean =="
STATE_QUEUE="$SCRATCH/state_queue"; mkdir -p "$STATE_QUEUE"
QUEUE_FILE="$STATE_QUEUE/${TARGET_SID}.subagent-queue.json"
# The queue entry points at the SAME real fixture file already on disk under
# TARGET_SUBDIR — this simulates a SubagentStop hook firing whose enqueue
# beat the render path's own full recompute, i.e. exactly the race
# _recompute_session_by_id's "recompute runs strictly BEFORE the queue drain"
# ordering is designed to resolve cleanly.
printf '{"%s": {"transcript_path": "%s", "agent_type": "general-purpose"}}' \
  "$TARGET_AID" "$TARGET_SUBDIR/agent-${TARGET_AID}.jsonl" > "$QUEUE_FILE"

_run_recompute_arg "$TARGET_SID" "$STATE_QUEUE" >/dev/null
SIDECAR_QUEUE="$STATE_QUEUE/${TARGET_SID}.json"

QUEUE_AFTER=$(cat "$QUEUE_FILE" 2>/dev/null)
QUEUE_KEYS_AFTER=$(printf '%s' "$QUEUE_AFTER" | jq -r 'keys | length' 2>/dev/null)
if [ -z "$QUEUE_AFTER" ] || [ "$QUEUE_KEYS_AFTER" = "0" ]; then
  PASS=$((PASS+1)); echo "PASS: stale queue file is empty (or removed) after recompute"
else
  FAIL=$((FAIL+1)); echo "FAIL: stale queue file still has entries after recompute: $QUEUE_AFTER"
fi
_assert_json_field "stale-queue: fixture agent counted exactly once (subagent_in_total == 300, not doubled)" "$SIDECAR_QUEUE" '.subagent_in_total' "300"
_assert_json_field "stale-queue: counted_subagents has no duplicate of the fixture agent" "$SIDECAR_QUEUE" \
  "[.counted_subagents[] | select(. == \"$TARGET_AID\")] | length" "1"

echo "== Test 4: --recompute against an unknown session_id is a graceful no-op =="
STATE_UNKNOWN="$SCRATCH/state_unknown"; mkdir -p "$STATE_UNKNOWN"
UNKNOWN_SID="sess-does-not-exist-anywhere"
OUT_UNKNOWN=$(_run_recompute_arg "$UNKNOWN_SID" "$STATE_UNKNOWN")
RC_UNKNOWN=$?
if [ "$RC_UNKNOWN" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: unknown session_id exits 0 (no crash)"
else
  FAIL=$((FAIL+1)); echo "FAIL: unknown session_id exited nonzero ($RC_UNKNOWN)"
  printf '%s\n' "$OUT_UNKNOWN" | sed 's/^/    /'
fi
if [ -f "$STATE_UNKNOWN/${UNKNOWN_SID}.json" ]; then
  FAIL=$((FAIL+1)); echo "FAIL: unknown session_id unexpectedly created a spurious sidecar file"
else
  PASS=$((PASS+1)); echo "PASS: unknown session_id created no spurious sidecar file"
fi

echo "== Test 5: duplicate session id across project dirs — largest transcript wins, stub never clobbers =="
# Claude Code keys project dirs by cwd, so one session can leave transcripts
# under two slugs (e.g. a removed worktree's slug holds the real 9MB file, the
# main slug a few-hundred-byte stub). Regression: a naive per-file recompute
# loop rebuilt the sidecar once per copy, and whichever globbed last (often
# the stub) clobbered the real totals with zeros.
PROJ_DUP="$FAKE_HOME/.claude/projects/otherproj"
mkdir -p "$PROJ_DUP"
DUP_SID="sess-duplicated"
# Real copy (bigger, has usage + a subagent) lives under fakeproj:
DUP_REAL="$PROJ/${DUP_SID}.jsonl"
{
  _assistant_line 2000 200 0 0 "msg_dup1"
  _assistant_line 600 60 0 0 "msg_dup2"
} > "$DUP_REAL"
DUP_SUBDIR="$PROJ/${DUP_SID}/subagents"
mkdir -p "$DUP_SUBDIR"
DUP_AID="d2000000000000002"
_assistant_line 100 10 0 0 "msg_dupsub" > "$DUP_SUBDIR/agent-${DUP_AID}.jsonl"
# Stub copy (tiny, no usage) lives under otherproj, whose name globs AFTER
# fakeproj — without largest-wins dedupe this one would run last and zero out
# the sidecar the real copy just built:
printf '{"type":"summary","summary":"stub"}\n' > "$PROJ_DUP/${DUP_SID}.jsonl"

STATE_DUP="$SCRATCH/state_dup"; mkdir -p "$STATE_DUP"
_run_recompute_all "$STATE_DUP" >/dev/null
SIDECAR_DUP="$STATE_DUP/${DUP_SID}.json"
_assert_json_field "dup-sid: --recompute all keeps the real copy's totals (in_total 2600, not 0)" "$SIDECAR_DUP" '.in_total' "2600"
_assert_json_field "dup-sid: subagent from the real copy's tree survives" "$SIDECAR_DUP" '.subagent_in_total' "100"

STATE_DUP2="$SCRATCH/state_dup2"; mkdir -p "$STATE_DUP2"
_run_recompute_arg "$DUP_SID" "$STATE_DUP2" >/dev/null
_assert_json_field "dup-sid: --recompute <sid> resolves to the largest copy too (in_total 2600)" "$STATE_DUP2/${DUP_SID}.json" '.in_total' "2600"

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
