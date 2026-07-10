#!/usr/bin/env bash
# Plain-bash test harness for statusline-command.sh's v2 display layer
# (Task 8.3: Line 1/Line 2 layout, window-aware CTX ramps, rate-limit ramps).
# Same style as test_sidecar_fold.sh / test_transcript_tail.sh (no bats here).
# Run: bash tests/statusline/test_display_v2.sh
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

_assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    FAIL=$((FAIL+1))
    echo "FAIL: $desc (unexpectedly found: $needle)"
    printf '%s\n' "$haystack" | sed 's/^/    /'
  else
    PASS=$((PASS+1))
    echo "PASS: $desc"
  fi
}

_run() {  # payload_json state_dir [columns] -> stdout+stderr captured
  local payload="$1" state_dir="$2" cols="${3:-120}"
  COLUMNS="$cols" STATUSLINE_STATE_DIR="$state_dir" bash "$SCRIPT" <<<"$payload" 2>&1
}

_strip_ansi() {  # stdin -> plain text
  sed 's/\x1b\[[0-9;]*m//g'
}

echo "== Scenario 1: fresh session (null current_usage, absent rate_limits) =="
STATE1="$SCRATCH/fresh"
mkdir -p "$STATE1"
PAYLOAD1='{
  "session_id": "sess-fresh",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 0, "total_api_duration_ms": 0, "total_cost_usd": 0,
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"total_input_tokens": 0, "total_output_tokens": 0,
                      "context_window_size": 200000, "current_usage": null},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}'
OUT1=$(_run "$PAYLOAD1" "$STATE1")
RC1=$?
if [ "$RC1" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: fresh session does not crash (exit 0)"
else
  FAIL=$((FAIL+1)); echo "FAIL: fresh session caused nonzero exit ($RC1)"
fi
_assert_contains "fresh: model name renders" "$OUT1" "Sonnet"
_assert_not_contains "fresh: no literal 'null' leaks into output" "$(printf '%s' "$OUT1" | _strip_ansi)" "null"
_assert_not_contains "fresh: no +null turn-out suffix" "$OUT1" "+null"
_assert_not_contains "fresh: no subagent share segment, old glyph (no subagent activity)" "$OUT1" "[⑂"
_assert_not_contains "fresh: no subagent share segment, new glyph (no subagent activity)" "$OUT1" "[⫂"
_assert_contains "fresh: rate-limit segment absent, cost still renders" "$(printf '%s' "$OUT1" | _strip_ansi)" '$: 0.00'
_assert_not_contains "fresh: no 5hr segment when rate_limits absent" "$OUT1" "5hr:"
_assert_not_contains "fresh: no 1wk segment when rate_limits absent" "$OUT1" "1wk:"

echo "== Scenario 2: 1M-token window (CTX ramp tier switch: 20/50 thresholds) =="
STATE2="$SCRATCH/bigwin"
mkdir -p "$STATE2"
# used_percentage=30 -> under the >300K tier's 50 threshold (YLW at >=20) but
# would be GRN under the <=300K tier's 50 threshold. Confirms tier selection.
PAYLOAD2='{
  "session_id": "sess-bigwin",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 0, "total_api_duration_ms": 0, "total_cost_usd": 2.5,
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"used_percentage": 30, "total_input_tokens": 300000, "total_output_tokens": 1000,
                      "context_window_size": 1000000,
                      "current_usage": {"input_tokens": 300000, "output_tokens": 1000,
                                         "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}'
OUT2=$(_run "$PAYLOAD2" "$STATE2")
_assert_contains "1M-window: renders window size (1.0M, via _human)" "$OUT2" "1.0M"
# 30% under >300K tier (20/50) falls in the YLW bracket -> ANSI 33m, not 32m(GRN).
BAR_LINE=$(printf '%s' "$OUT2" | grep -o $'\033\[3[0-9]m\[█*░*\]' | head -1)
_assert_contains "1M-window: CTX bar uses YLW (33m) ramp color at 30% (20/50 tier)" "$BAR_LINE" $'\033[33m'

echo "== Scenario 3: narrow terminal (COLUMNS=80) exercises truncation =="
STATE3="$SCRATCH/narrow"
mkdir -p "$STATE3"
PAYLOAD3='{
  "session_id": "sess-narrow",
  "model": {"display_name": "Claude Sonnet 4.6 (very-long-display-name-variant)"},
  "cost": {"total_duration_ms": 90000, "total_api_duration_ms": 45000, "total_cost_usd": 3.456,
           "total_lines_added": 12, "total_lines_removed": 4},
  "context_window": {"used_percentage": 45, "total_input_tokens": 90000, "total_output_tokens": 500,
                      "context_window_size": 200000,
                      "current_usage": {"input_tokens": 90000, "output_tokens": 500,
                                         "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 200}},
  "workspace": {"current_dir": "/some/very/long/nested/directory/path/that/is/quite/deep/indeed", "git_worktree": ""},
  "rate_limits": {"five_hour": {"used_percentage": 55, "resets_at": "2026-07-08T10:00:00Z"},
                   "seven_day": {"used_percentage": 20, "resets_at": "2026-07-10T00:00:00Z"}}
}'
OUT3=$(_run "$PAYLOAD3" "$STATE3" 80)
RC3=$?
if [ "$RC3" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: narrow terminal (COLUMNS=80) does not crash (exit 0)"
else
  FAIL=$((FAIL+1)); echo "FAIL: narrow terminal caused nonzero exit ($RC3)"
fi
# Each rendered line's visual width must fit within COLUMNS (minus the script's own margin).
WIDTHS=$(printf '%s' "$OUT3" | while IFS= read -r line; do
  printf '%s' "$line" | python3 -c "
import sys,re,unicodedata as u
s=sys.stdin.read()
s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
print(sum(2 if u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1) for c in s))
"
done)
BAD_WIDTH=0
while IFS= read -r w; do
  [ -z "$w" ] && continue
  if [ "$w" -gt 80 ]; then BAD_WIDTH=1; fi
done <<<"$WIDTHS"
if [ "$BAD_WIDTH" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: narrow terminal: all rendered lines fit within COLUMNS=80"
else
  FAIL=$((FAIL+1)); echo "FAIL: narrow terminal: a rendered line exceeded COLUMNS=80"
  printf '%s\n' "$OUT3" | sed 's/^/    /'
fi
_assert_contains "narrow: truncation ellipsis appears somewhere (long model/path forced truncation)" "$OUT3" "…"

echo "== Scenario 3b: clock/API segment spacing in all glyph modes =="
STATE3B="$SCRATCH/spacing"
mkdir -p "$STATE3B"
PAYLOAD3B='{
  "session_id": "sess-spacing",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 90000, "total_api_duration_ms": 45000, "total_cost_usd": 0.5,
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"used_percentage": 5, "total_input_tokens": 500, "total_output_tokens": 100,
                      "context_window_size": 200000,
                      "current_usage": {"input_tokens": 500, "output_tokens": 100,
                                         "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""}
}'
for GLYPH in emoji nerd text; do
  OUT3B=$(COLUMNS=120 STATUSLINE_STATE_DIR="$STATE3B" STATUSLINE_GLYPHS="$GLYPH" bash "$SCRIPT" <<<"$PAYLOAD3B" 2>&1)
  OUT3B_PLAIN=$(printf '%s' "$OUT3B" | _strip_ansi)
  case "$GLYPH" in
    emoji)
      _assert_contains "spacing emoji: no space before '(', space after 📡" "$OUT3B_PLAIN" 'm(📡 '
      _assert_not_contains "spacing emoji: must not render '( ' (stray space before paren)" "$OUT3B_PLAIN" 'm ('
      ;;
    nerd)
      _assert_contains "spacing nerd: no space before '(', trailing space after '('" "$OUT3B_PLAIN" 'm( '
      _assert_not_contains "spacing nerd: must not render '( ' (stray space before paren)" "$OUT3B_PLAIN" 'm ('
      ;;
    text)
      _assert_contains "spacing text: no glyph, no stray space" "$OUT3B_PLAIN" 'm(45s)'
      _assert_not_contains "spacing text: must not render '( ' (stray space before paren)" "$OUT3B_PLAIN" 'm ('
      ;;
  esac
done

echo "== Scenario 4: one rate-limit window present, the other absent =="
STATE4="$SCRATCH/onerate"
mkdir -p "$STATE4"
PAYLOAD4='{
  "session_id": "sess-onerate",
  "model": {"display_name": "Sonnet"},
  "cost": {"total_duration_ms": 60000, "total_api_duration_ms": 30000, "total_cost_usd": 0.5,
           "total_lines_added": 0, "total_lines_removed": 0},
  "context_window": {"used_percentage": 5, "total_input_tokens": 500, "total_output_tokens": 100,
                      "context_window_size": 200000,
                      "current_usage": {"input_tokens": 500, "output_tokens": 100,
                                         "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}},
  "workspace": {"current_dir": "/tmp", "git_worktree": ""},
  "rate_limits": {"seven_day": {"used_percentage": 92, "resets_at": "2026-07-14T00:00:00Z"}}
}'
OUT4=$(_run "$PAYLOAD4" "$STATE4")
RC4=$?
if [ "$RC4" -eq 0 ]; then
  PASS=$((PASS+1)); echo "PASS: one-window-absent payload does not crash (exit 0)"
else
  FAIL=$((FAIL+1)); echo "FAIL: one-window-absent payload caused nonzero exit ($RC4)"
fi
_assert_not_contains "onerate: 5hr segment absent when five_hour missing" "$OUT4" "5hr:"
_assert_contains "onerate: 1wk segment renders when seven_day present" "$OUT4" "1wk:"
_assert_contains "onerate: 1wk percentage renders (92%)" "$OUT4" "92%"
# 92% is >=90 -> RED ramp (31m), not ORANGE (38;5;208m).
RATE_LINE=$(printf '%s' "$OUT4" | grep "1wk:")
_assert_contains "onerate: 92% uses RED ramp color (>=90 threshold)" "$RATE_LINE" $'\033[31m'

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
