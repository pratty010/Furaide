#!/usr/bin/env bash
# statusline-lib/util.sh — ANSI colors, glyph-mode setup, jq helpers, and
# width/format primitives shared by every other lib file.
# Moved as-is from the pre-split statusline-command.sh (Task 1 modularization).
#
# shellcheck disable=SC2034,SC2154
# SC2034 (appears unused): the colors/GLYPHS below are consumed by
# display.sh and other sourced lib files, not this one — a per-file lint
# pass can't see the cross-file usage a source-based split introduces.
# SC2154 (referenced but not assigned): `input` is set by the entry script
# (statusline-command.sh) before any lib file is sourced.

# ── ANSI ──────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'
BLU=$'\033[34m'; MAG=$'\033[35m'; CYN=$'\033[36m'; BYLW=$'\033[93m'
ORANGE=$'\033[38;5;208m'  # 256-color; modern terminals overwhelmingly support it (see README)
GLYPHS="${STATUSLINE_GLYPHS:-emoji}"

# ── jq helpers ─────────────────────────────────────────────────────────────
_jq()     { echo "$input" | jq -r "${1} // empty" 2>/dev/null || true; }
_jq_int() { echo "$input" | jq -r "${1} // 0" 2>/dev/null | cut -d. -f1 || true; }

# ── width / format helpers ─────────────────────────────────────────────────
ESC=$'\033'
_vlen() {
  # Unicode-aware visual width: counts W/F chars as 2, combining marks as 0, rest as 1.
  # Falls back to awk byte-count if python3 absent.
  printf '%s' "$1" | python3 -c "
import sys,re,unicodedata as u
FW=set()
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
FW=set()
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
_dur() {  # ms -> compact h/m/s (e.g. 3900000 -> "1h5m", 2400000 -> "40m", 3000 -> "3s")
  local ms="${1:-0}" tot h m s
  if [ "$ms" -lt 60000 ]; then
    s=$(( ms / 1000 )); printf '%ds' "$s"; return
  fi
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
