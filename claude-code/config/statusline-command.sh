#!/usr/bin/env bash
# Furaidē statusline — 2-line, outer-pinned, width-adaptive (reads $COLUMNS).
# Requires: jq, python3. Claude Code exports COLUMNS before each run (v2.1.153+).
# Re-runs on: new assistant message, /compact, permission/vim mode change, refreshInterval timer.
# Terminal resize is NOT an automatic trigger — refreshInterval is the only mitigation.
#
# Line 1  L: 🧠 <model> │ <effort> │ 🕐 time   R: ↑in⚡cache%/↓out │ [⚠ ]CTX: [bar] used/win
# Line 2  L: 📁 path (branch) │ +add/-rem        R: 5hr: % (reset) │ 1wk: % (reset) │ $cost
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
  # Unicode-aware visual width: counts W/F chars as 2, combining marks as 0, rest as 1.
  # Falls back to awk byte-count if python3 absent.
  printf '%s' "$1" | python3 -c "
import sys,re,unicodedata as u
FW=set('⚠')
s=sys.stdin.read()
s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
print(sum(2 if c in FW or u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1) for c in s))
" 2>/dev/null || printf '%s' "$1" | sed "s/${ESC}\[[0-9;]*m//g" | awk '{print length}'
}
_trunc() {
  # Truncate to n visual columns, preserving ANSI color codes.
  # Only appends RST when input contained ANSI. Fallback: plain-text truncation.
  local s="$1" n="$2"
  printf '%s' "$s" | python3 -c "
import sys,re,unicodedata as u
FW=set('⚠')
def vw(c):return 2 if c in FW or u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1)
s=sys.stdin.read(); n=int('$n')
has_ansi=bool(re.search(r'\x1b\[',s))
plain=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
if sum(vw(c) for c in plain)<=n:sys.stdout.write(s);sys.exit()
r,w,i='',0,0
while i<len(s):
    m=re.match(r'\x1b\[[0-9;]*[A-Za-z]',s[i:])
    if m:r+=m.group();i+=len(m.group());continue
    cw=vw(s[i])
    if w+cw>n-1:break
    r+=s[i];w+=cw;i+=1
sys.stdout.write(r+'…'+('\x1b[0m' if has_ansi else ''))
" 2>/dev/null || { local v; v=$(printf '%s' "$s" | sed "s/${ESC}\[[0-9;]*m//g"); printf '%.*s…' "$((n-1))" "$v"; }
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
_dur() {  # ms -> compact h/m (e.g. 3900000 -> "1h5m", 2400000 -> "40m")
  local ms="${1:-0}" tot h m
  tot=$(( ms / 60000 )); h=$(( tot / 60 )); m=$(( tot % 60 ))
  if [ "$h" -gt 0 ]; then printf '%dh%dm' "$h" "$m"; else printf '%dm' "$m"; fi
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

COLS="${COLUMNS:-80}"; MARGIN=4; USABLE=$(( COLS - MARGIN ))
[ "$USABLE" -lt 20 ] && USABLE=20

_lr() {  # left right [pre-ll] [pre-rl] -> outer-pinned line with truncation
  local left="$1" right="$2" ll="${3:-}" rl="${4:-}"
  [ -z "$ll" ] && ll=$(_vlen "$left")
  [ -z "$rl" ] && rl=$(_vlen "$right")
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

# ── Line 1 LEFT: model │ effort │ 🕐 duration ──────────────────────────────
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
DURATION_MS=$(_jq_int '.cost.total_duration_ms')
if [ "$DURATION_MS" -ge 60000 ]; then
  case "$GLYPHS" in emoji) CG="🕐 " ;; nerd) CG=$' ' ;; *) CG="" ;; esac
  L1L+=" ${DIM}│${RST} ${DIM}${CG}$(_dur "$DURATION_MS")${RST}"
fi

# ── Line 1 RIGHT: ↑tokens⚡cache/↓out │ [⚠ ]CTX bar ──────────────────────
CTX_PCT=$(_jq_int '.context_window.used_percentage')
IN=$(_jq_int '.context_window.total_input_tokens')
OUT=$(_jq_int '.context_window.total_output_tokens')
WIN=$(_jq_int '.context_window.context_window_size')
EXCEEDS=$(_jq '.exceeds_200k_tokens')
if   [ "$EXCEEDS" = "true" ] || [ "$CTX_PCT" -ge 90 ]; then BC="$RED"
elif [ "$CTX_PCT" -ge 70 ]; then BC="$YLW"
elif [ "$CTX_PCT" -ge 50 ]; then BC="$BYLW"
else BC="$GRN"; fi
WARN=""
{ [ "$EXCEEDS" = "true" ] || [ "$CTX_PCT" -ge 90 ]; } && WARN="${RED}⚠ ${RST}"
CACHE_HIT=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
IN_STR="${GRN}↑$(_human "$IN")${RST}"
if [ "$IN" -gt 0 ] && [ "$CACHE_HIT" -gt 0 ]; then
  CACHE_PCT=$(( CACHE_HIT * 100 / IN ))
  IN_STR="${GRN}↑$(_human "$IN")${DIM}⚡${CACHE_PCT}%${RST}"
fi
TOK="${IN_STR}/${BLU}↓$(_human "$OUT")${RST} ${DIM}│${RST} "
L1R="${TOK}${WARN}${DIM}CTX:${RST} ${BC}[$(_bar "$CTX_PCT" 10)]${RST} ${DIM}$(_human "$IN")/$(_human "$WIN")${RST}"

# ── Line 2 LEFT: path (branch) │ +add/-rem ────────────────────────────────
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
LINES_ADD=$(_jq_int '.cost.total_lines_added')
LINES_REM=$(_jq_int '.cost.total_lines_removed')
if [ "$LINES_ADD" -gt 0 ] || [ "$LINES_REM" -gt 0 ]; then
  L2L+=" ${DIM}│${RST} ${GRN}+${LINES_ADD}${RST}/${RED}-${LINES_REM}${RST}"
fi

# ── Line 2 RIGHT: rate limits (subscriber) OR cost (credit) ────────────────
HAS_RL=$(_jq '.rate_limits')
COST=$(_jq '.cost.total_cost_usd // empty')
[ -n "$COST" ] && COST=$(echo "$COST" | awk '{printf "%.2f",$1}')
if [ -n "$HAS_RL" ]; then
  R5=$(_jq '.rate_limits.five_hour.used_percentage' | cut -d. -f1); R5=${R5:-0}
  R7=$(_jq '.rate_limits.seven_day.used_percentage' | cut -d. -f1); R7=${R7:-0}
  T5=$(_until "$(_jq '.rate_limits.five_hour.resets_at')")
  T7=$(_until "$(_jq '.rate_limits.seven_day.resets_at')")
  L2R="${DIM}5hr:${RST} ${R5}%"; [ -n "$T5" ] && L2R+=" (${T5})"
  L2R+=" ${DIM}│${RST} ${DIM}1wk:${RST} ${R7}%"; [ -n "$T7" ] && L2R+=" (${T7})"
  L2R+=" ${DIM}│${RST} ${DIM}\$:${RST} ${COST:-0.00}"
else
  L2R="${DIM}\$:${RST} ${COST:-0.00}"
fi

# ── Batch width computation → render both lines ────────────────────────────
read -r _w1l _w1r _w2l _w2r < <(
  printf '%s\n%s\n%s\n%s\n' "$L1L" "$L1R" "$L2L" "$L2R" \
  | python3 -c "
import sys,re,unicodedata as u
FW=set('⚠')
def vw(s):
    s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
    return sum(2 if c in FW or u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1) for c in s)
for line in sys.stdin: print(vw(line.rstrip('\n')), end=' ')
" 2>/dev/null) || true
_lr "$L1L" "$L1R" "${_w1l:-}" "${_w1r:-}"
_lr "$L2L" "$L2R" "${_w2l:-}" "${_w2r:-}"

exit 0
