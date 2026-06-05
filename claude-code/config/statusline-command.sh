#!/usr/bin/env bash
# Furaidē statusline — 3-line, outer-pinned, width-adaptive (reads $COLUMNS).
# Requires: jq. Claude Code v2.1.153+ exports COLUMNS/LINES and re-runs on resize.
#
# Line 1  L: 🧠 <model> │ <effort>          R: [⚠ ]CTX: [bar] used/window
# Line 2  L: 📁 path (branch) │ ↑in/↓out    R: 5hr:[bar]% (reset) │ 1wk:[bar]% (reset)  OR  $: cost
# Line 3  L: [pmode] PR#N state             (printed only when non-empty)
#
# Env: STATUSLINE_GLYPHS=emoji|nerd|text   (default emoji)

set -euo pipefail
input=$(cat)

# ── ANSI ──────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'
BLU=$'\033[34m'; MAG=$'\033[35m'; CYN=$'\033[36m'; BYLW=$'\033[93m'
GLYPHS="${STATUSLINE_GLYPHS:-emoji}"

# ── jq helpers ─────────────────────────────────────────────────────────────
_jq()     { echo "$input" | jq -r "${1} // empty" 2>/dev/null || true; }
_jq_int() { echo "$input" | jq -r "${1} // 0" 2>/dev/null | cut -d. -f1; }

# ── width / format helpers ─────────────────────────────────────────────────
ESC=$'\033'
_vlen() {
  printf '%s' "$1" \
  | sed "s/${ESC}\[[0-9;]*m//g" \
  | sed -e 's/🧠/##/g' -e 's/📁/##/g' -e 's/[│█░↑↓…⚠]/X/g' \
  | awk '{print length}'
}
_trunc() {
  local s="$1" n="$2" v vlen
  v=$(printf '%s' "$s" | sed "s/${ESC}\[[0-9;]*m//g")
  vlen=$(_vlen "$v")
  if [ "$vlen" -le "$n" ]; then printf '%s' "$s"
  else printf '%s…%s' "${v:0:$((n-1))}" "$RST"; fi
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

COLS="${COLUMNS:-80}"; MARGIN=3; USABLE=$(( COLS - MARGIN ))
[ "$USABLE" -lt 20 ] && USABLE=20

_lr() {  # left right -> pinned corners, truncate inner edges (RIGHT keeps priority)
  local left="$1" right="$2" ll rl
  ll=$(_vlen "$left"); rl=$(_vlen "$right")
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

# ── Line 1 LEFT: model │ effort ────────────────────────────────────────────
MODEL=$(_jq '.model.display_name'); [ -z "$MODEL" ] && MODEL="?"
case "$MODEL" in
  *Opus*)   MC="$MAG" ;; *Sonnet*) MC="$BLU" ;; *Haiku*) MC="$GRN" ;; *) MC="$BOLD" ;;
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

# ── Line 1 RIGHT: context ──────────────────────────────────────────────────
CTX_PCT=$(_jq_int '.context_window.used_percentage')
USED=$(_jq_int '.context_window.total_input_tokens')
WIN=$(_jq_int '.context_window.context_window_size')
EXCEEDS=$(_jq '.exceeds_200k_tokens')
if   [ "$EXCEEDS" = "true" ] || [ "$CTX_PCT" -ge 90 ]; then BC="$RED"
elif [ "$CTX_PCT" -ge 70 ]; then BC="$YLW"
elif [ "$CTX_PCT" -ge 50 ]; then BC="$BYLW"
else BC="$GRN"; fi
WARN=""
{ [ "$EXCEEDS" = "true" ] || [ "$CTX_PCT" -ge 90 ]; } && WARN="${RED}⚠ ${RST}"
L1R="${WARN}${DIM}CTX:${RST} ${BC}[$(_bar "$CTX_PCT" 10)]${RST} ${DIM}$(_human "$USED")/$(_human "$WIN")${RST}"
_lr "$L1L" "$L1R"

# ── Line 2 LEFT: path (branch) │ ↑in/↓out ──────────────────────────────────
DIR=$(_jq '.workspace.current_dir // .cwd')
RAWDIR="$DIR"
case "$DIR" in "$HOME"*) DIR="~${DIR#$HOME}" ;; esac
DIR=$(_pathshort "$DIR")
BRANCH=""
[ -n "$RAWDIR" ] && BRANCH=$(git -C "$RAWDIR" branch --show-current 2>/dev/null \
  || git -C "$RAWDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
WT=$(_jq '.workspace.git_worktree')
[ -z "$BRANCH" ] && BRANCH="$WT"
case "$GLYPHS" in emoji) DG="📁 " ;; nerd) DG=$' ' ;; *) DG="" ;; esac
L2L="${DG}${BOLD}${DIR}${RST}"
[ -n "$BRANCH" ] && L2L+=" ${YLW}(${BRANCH})${RST}"
IN=$(_jq_int '.context_window.total_input_tokens')
OUT=$(_jq_int '.context_window.total_output_tokens')
L2L+=" ${DIM}│${RST} ${GRN}↑$(_human "$IN")${RST}/${BLU}↓$(_human "$OUT")${RST}"

# ── Line 2 RIGHT: rate limits (subscriber) OR cost (credit) ────────────────
HAS_RL=$(_jq '.rate_limits')
if [ -n "$HAS_RL" ]; then
  R5=$(_jq '.rate_limits.five_hour.used_percentage' | cut -d. -f1); R5=${R5:-0}
  R7=$(_jq '.rate_limits.seven_day.used_percentage' | cut -d. -f1); R7=${R7:-0}
  if [ "$USABLE" -lt 72 ]; then
    L2R="${DIM}5hr:${RST}${R5}%"
  else
    T5=$(_until "$(_jq '.rate_limits.five_hour.resets_at')")
    T7=$(_until "$(_jq '.rate_limits.seven_day.resets_at')")
    L2R="${DIM}5hr:${RST}[$(_bar "$R5" 4)]${R5}%"; [ -n "$T5" ] && L2R+=" (${T5})"
    L2R+=" ${DIM}│${RST} ${DIM}1wk:${RST}[$(_bar "$R7" 4)]${R7}%"; [ -n "$T7" ] && L2R+=" (${T7})"
  fi
else
  COST=$(_jq '.cost.total_cost_usd // "0"' | awk '{printf "%.2f",$1}')
  L2R="${DIM}\$:${RST} ${COST}"
fi
_lr "$L2L" "$L2R"

# ── Line 3 (optional): permission mode + PR ────────────────────────────────
SIDECAR="${MEKIKI_HOME:-$HOME/.mekiki}/statusline-sidecar.json"
PMODE=""; [ -f "$SIDECAR" ] && PMODE=$(jq -r '.permission_mode // empty' "$SIDECAR" 2>/dev/null || true)
PB=""
case "$PMODE" in
  bypassPermissions) PB="${RED}[bypass]${RST}" ;;
  acceptEdits)       PB="${YLW}[edits]${RST}" ;;
  plan)              PB="${CYN}[plan]${RST}" ;;
  dontAsk)           PB="${YLW}[dontAsk]${RST}" ;;
esac
PR_NUM=$(_jq '.pr.number'); PR_STATE=$(_jq '.pr.review_state'); PRB=""
if [ -n "$PR_NUM" ]; then
  case "$PR_STATE" in
    approved) PC="$GRN" ;; changes_requested) PC="$RED" ;; draft) PC="$DIM" ;; *) PC="$YLW" ;;
  esac
  PRB="${PC}PR#${PR_NUM}${PR_STATE:+ $PR_STATE}${RST}"
fi
L3=""
[ -n "$PB" ]  && L3="$PB"
[ -n "$PRB" ] && L3="${L3:+$L3  }$PRB"
[ -n "$L3" ] && printf '%s\n' "$L3"
exit 0
