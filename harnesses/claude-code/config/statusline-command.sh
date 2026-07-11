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
# Standalone mode: `statusline-command.sh --recompute-all` (or `--recompute
# all`) skips the stdin hook payload and instead rebuilds every sidecar under
# STATUSLINE_STATE_DIR from a full-file (dedup-correct) scan of every local
# session transcript.
#
# `statusline-command.sh --recompute <session_id>` recomputes just that one
# session (resolves its transcript path, full rescan-rebuild, then drains any
# stale subagent-queue file clean — see statusline-lib/recompute.sh's
# _recompute_session_by_id).
#
# `statusline-command.sh --recompute` with NO further argument reads
# session_id from stdin hook JSON instead of argv — this is what the
# SessionEnd/SessionStart(resume) hooks in settings.json invoke, since hooks
# deliver context via stdin, not argv. Same _recompute_session_by_id call as
# the explicit-argument form, just a different session_id source.
#
# Hook mode: `statusline-command.sh --subagent-stop` reads a SubagentStop hook
# JSON payload from stdin and enqueues/drains that session's subagent-queue
# file (see statusline-lib/subagent-tracking.sh's _run_subagent_stop_hook) —
# the primary, event-driven live-update path for subagent token totals.
#
# This is the thin entry point (Task 1 modularization): mode dispatch, $HERE
# resolution, and sourcing of statusline-lib/*.sh, which hold all the actual
# logic. See statusline-lib/*.sh for the moved code's own history/comments.

set -euo pipefail
case "${1:-}" in
  --recompute-all)
    FURAIDE_SL_MODE="recompute-all"
    input='{}'
    ;;
  --recompute)
    if [ "${2:-}" = "all" ]; then
      FURAIDE_SL_MODE="recompute-all"
      input='{}'
    elif [ -n "${2:-}" ]; then
      FURAIDE_SL_MODE="recompute-session"
      RECOMPUTE_SID="$2"
      input='{}'
    else
      FURAIDE_SL_MODE="recompute-stdin"
      input=$(cat)
    fi
    ;;
  --subagent-stop)
    FURAIDE_SL_MODE="subagent-stop"
    input=$(cat)
    ;;
  *)
    FURAIDE_SL_MODE="render"
    input=$(cat)
    ;;
esac

# ── $HERE resolution (symlink-following) ────────────────────────────────────
# A global-scope install runs `bash ~/.claude/statusline-command.sh`, which is
# a SYMLINK to this repo file. The naive `cd "$(dirname "${BASH_SOURCE[0]}")"`
# does NOT follow symlinks, so $HERE would silently resolve to ~/.claude
# instead of this repo's config/ directory — masked historically only because
# the pricing-file fallback usually found a bootstrapped copy first. Fixed by
# manually resolving through any symlink chain before computing $HERE (POSIX
# loop rather than GNU-only `readlink -f`, for portability). This MUST run
# before sourcing statusline-lib/*.sh, since every source path is $HERE-relative.
_sl_src="${BASH_SOURCE[0]}"
while [ -L "$_sl_src" ]; do
  _sl_dir="$(cd -P "$(dirname "$_sl_src")" && pwd)"
  _sl_src="$(readlink "$_sl_src")"
  case "$_sl_src" in
    /*) ;;
    *) _sl_src="$_sl_dir/$_sl_src" ;;
  esac
done
HERE="$(cd -P "$(dirname "$_sl_src")" && pwd)"
unset _sl_src _sl_dir

# ── Source lib files ────────────────────────────────────────────────────────
# Order matters for top-level (non-function-body) side effects: util.sh's
# _jq/_jq_int must exist before sidecar.sh's top-level SESSION_ID=$(_jq ...),
# and $HERE must be set (above) before pricing.sh's top-level _load_pricing
# call. Each source is guarded so a missing/corrupt lib file degrades
# gracefully (silent exit) instead of crashing with a raw bash error.
source "$HERE/statusline-lib/util.sh" || exit 0
source "$HERE/statusline-lib/pricing.sh" || exit 0
source "$HERE/statusline-lib/sidecar.sh" || exit 0
source "$HERE/statusline-lib/transcript-scan.sh" || exit 0
source "$HERE/statusline-lib/subagent-tracking.sh" || exit 0
source "$HERE/statusline-lib/transcript-tail.sh" || exit 0
source "$HERE/statusline-lib/recompute.sh" || exit 0
source "$HERE/statusline-lib/display.sh" || exit 0

if [ "$FURAIDE_SL_MODE" = "recompute-all" ]; then
  command -v jq >/dev/null 2>&1 || { echo "error: --recompute requires jq" >&2; exit 1; }
  _recompute_all
  exit 0
fi

if [ "$FURAIDE_SL_MODE" = "recompute-session" ]; then
  command -v jq >/dev/null 2>&1 || { echo "error: --recompute requires jq" >&2; exit 1; }
  _recompute_session_by_id "$RECOMPUTE_SID"
  exit 0
fi

if [ "$FURAIDE_SL_MODE" = "recompute-stdin" ]; then
  # Fail-open: SessionEnd/SessionStart(resume) hooks invoke this form with no
  # argv session_id, reading it from stdin JSON instead. A hook callback must
  # never surface a nonzero exit (same discipline as --subagent-stop below).
  command -v jq >/dev/null 2>&1 || exit 0
  RECOMPUTE_SID=$(_jq '.session_id')
  if [ -n "$RECOMPUTE_SID" ]; then
    _recompute_session_by_id "$RECOMPUTE_SID" || true
  fi
  exit 0
fi

if [ "$FURAIDE_SL_MODE" = "subagent-stop" ]; then
  # Fail-open: under `set -e`, a non-zero return from the hook (e.g. lock
  # contention, missing jq) would otherwise abort the script before reaching
  # `exit 0` — this is a hook callback, it must never surface a nonzero exit.
  _run_subagent_stop_hook || true
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
  QUEUE_FILE="${SIDECAR_DIR}/${SESSION_ID}.subagent-queue.json"
  if _transcript_tail_pass "$TRANSCRIPT_PATH"; then
    _sidecar_save "$SIDECAR_PATH" "$SIDECAR_JSON" && TAIL_OK=1
  fi
fi

_render_statusline
exit 0
