#!/usr/bin/env bash
# Furaidē statusline — 2-line, outer-pinned, width-adaptive (reads $COLUMNS).
# Requires: jq, python3. Claude Code exports COLUMNS before each run (v2.1.153+).
# Re-runs on: new assistant message, /compact, permission/vim mode change, refreshInterval timer.
# Terminal resize is NOT an automatic trigger — refreshInterval is the only mitigation.
#
# Line 1  L: 🧠 <model> │ <effort> │ 🕐 dur (📡api%)   R: ↑inΣ⚡r%/↓outΣ [⑂in/out%] │ CTX: [bar] cur/win/+turn
# Line 2  L: 📁 path (branch) │ +add/-rem        R: 5hr: % (reset) │ 1wk: % (reset) │ $cost
#
# Env: STATUSLINE_GLYPHS=emoji|nerd|text   (default emoji)
# Env: STATUSLINE_STATE_DIR=<dir>          (default ~/.claude/statusline-state; test override)

set -euo pipefail
input=$(cat)

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

COLS="${COLUMNS:-80}"; MARGIN=4; USABLE=$(( COLS - MARGIN ))
[ "$USABLE" -lt 20 ] && USABLE=20

# ── Sidecar state: per-session duration fold across resume ─────────────────
# One JSON file per session: $STATUSLINE_STATE_DIR/<session_id>.json (default
# ~/.claude/statusline-state/). Only the duration fields below are read/written
# here; other keys (transcript_offset, token totals, subagent map — Task 8.2's
# concern) are round-tripped untouched so a later pass can add them safely.
# Fail-open discipline: ANY failure (missing jq, corrupt JSON, permission error,
# absent session_id) must fall back to base=0 / raw payload values, never crash.
SIDECAR_DIR="${STATUSLINE_STATE_DIR:-$HOME/.claude/statusline-state}"
SESSION_ID=$(_jq '.session_id')
SIDECAR_JSON='{}'
FOLD_RESULT=0

_sidecar_prune() {  # delete state files older than 30 days; never fatal
  find "$SIDECAR_DIR" -maxdepth 1 -name '*.json' -mtime +30 -delete 2>/dev/null || true
}
_sidecar_load() {  # path -> sets SIDECAR_JSON on success; returns 1 on missing/corrupt
  local path="$1" raw
  [ -f "$path" ] || return 1
  raw=$(cat "$path" 2>/dev/null) || return 1
  printf '%s' "$raw" | jq -e . >/dev/null 2>&1 || return 1
  SIDECAR_JSON="$raw"
}
_sidecar_save() {  # path json -> atomic write (temp + rename); returns 1 on any failure
  local path="$1" json="$2" tmp
  mkdir -p "$SIDECAR_DIR" 2>/dev/null || return 1
  tmp="${path}.tmp.$$"
  printf '%s' "$json" > "$tmp" 2>/dev/null || return 1
  mv -f "$tmp" "$path" 2>/dev/null || return 1
}
_fold_metric() {  # current base_key last_key -> sets FOLD_RESULT=base+current (folds on reset)
  local current="$1" base_key="$2" last_key="$3" base last
  base=$(printf '%s' "$SIDECAR_JSON" | jq -r ".${base_key} // 0" 2>/dev/null)
  last=$(printf '%s' "$SIDECAR_JSON" | jq -r ".${last_key} // 0" 2>/dev/null)
  case "$base" in ''|*[!0-9]*) base=0 ;; esac
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  [ "$current" -lt "$last" ] && base=$(( base + last ))
  FOLD_RESULT=$(( base + current ))
  SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --argjson b "$base" --argjson l "$current" \
    ".${base_key} = \$b | .${last_key} = \$l" 2>/dev/null)
  [ -n "$SIDECAR_JSON" ] || return 1
}

# ── Task 8.2: transcript tail pass (token totals + subagent share) ─────────
# Incremental jq pass over the session transcript from the sidecar's
# transcript_offset (byte cursor). Sums main-thread assistant message.usage
# into {in,out,cache_read,cache_creation}_total, and folds in per-subagent
# totals discovered from real Task-tool subagent completions:
#   - A completed Task-tool subagent surfaces in the MAIN transcript as a
#     type:"user" tool_result record whose (recursively flattened) text
#     contains both "agentId: <id>" and a "<usage>subagent_tokens: N ...
#     </usage>" block — this combination (not just "agentId:" alone, which
#     also appears on the *launch* notification) is the "done" signal.
#   - Once an agent id is seen "done" and isn't already recorded in the
#     sidecar, its own full transcript at
#     <transcript-dir>/subagents/agent-<id>.jsonl is fed through the same
#     _sum_assistant_usage_stdin used for the main thread (identical
#     type:"assistant"/message.usage record shape) — this is the primary,
#     accurate source.
#   - subagent_fallback_tokens is the last-resort bucket: used only when the
#     agent id's transcript file is missing/unreadable, in which case the
#     <usage> block's own subagent_tokens: N value (a lump sum with no
#     in/out split) is folded in instead. If neither source is available the
#     agent id is left unmarked (not done) rather than fabricating a count;
#     since the "done" signal is only visible once (it scrolls out of the
#     incremental newdata window after this pass), such an id will not be
#     retried on a later pass — the risk is bounded (a missing/racing
#     subagent transcript file at exactly the point its completion record
#     appears is rare) and preferred over marking done with zero counts.
# Fail-open: any jq/parse failure leaves SIDECAR_JSON and the *_TOTAL
# globals untouched (caller keeps prior values).
_sum_assistant_usage_stdin() {  # stdin: JSONL -> stdout "in out cache_read cache_creation"; returns 1 on failure
  local out
  out=$(jq -r -R -s '
    (split("\n") | map(select(length>0)) | map(try fromjson catch null)
     | map(select(. != null and .type == "assistant"))) as $recs
    | ($recs | map(.message.usage // {})) as $u
    | [ ($u | map(.input_tokens // 0) | add // 0),
        ($u | map(.output_tokens // 0) | add // 0),
        ($u | map(.cache_read_input_tokens // 0) | add // 0),
        ($u | map(.cache_creation_input_tokens // 0) | add // 0) ] | @tsv
  ' 2>/dev/null) || return 1
  [ -z "$out" ] && return 1
  printf '%s' "$out" | tr '\t' ' '
}
_extract_subagent_completions_stdin() {  # stdin: JSONL -> stdout one JSON object/line: {agent_id,fallback_tokens}
  # Real Task-tool subagent completions surface as a type:"user" tool_result
  # record. Flattening all nested .text fields catches the case where the
  # "agentId: <id> (...)" text and the "<usage>subagent_tokens: N ...</usage>"
  # block live in separate content blocks of the same tool_result. Requiring
  # BOTH excludes the earlier launch-acknowledgement record, which mentions
  # agentId but never carries a <usage> block.
  jq -c -R -s '
    (split("\n") | map(select(length>0)) | map(try fromjson catch null)
     | map(select(. != null and .type == "user"))) as $recs
    | $recs[]
    | ([.. | .text? // empty] | join("\n")) as $txt
    | select($txt | test("<usage>"))
    | (try ($txt | capture("agentId:\\s*(?<id>[a-f0-9]+)")) catch null) as $m
    | select($m != null)
    | {
        agent_id: $m.id,
        fallback_tokens: (try ($txt | capture("subagent_tokens:\\s*(?<n>[0-9]+)").n) catch null)
      }
  ' 2>/dev/null
}
_transcript_tail_pass() {  # path -> mutates SIDECAR_JSON + sets *_TOTAL globals; returns 1 on any failure (no mutation)
  local path="$1" offset size newdata usage
  offset=$(printf '%s' "$SIDECAR_JSON" | jq -r '.transcript_offset // 0' 2>/dev/null)
  case "$offset" in ''|*[!0-9]*) offset=0 ;; esac
  size=$(wc -c < "$path" 2>/dev/null | tr -d ' ') || return 1
  case "$size" in ''|*[!0-9]*) return 1 ;; esac
  [ "$offset" -gt "$size" ] && offset=0  # transcript truncated/rotated: restart cursor defensively

  newdata=""
  [ "$offset" -lt "$size" ] && { newdata=$(tail -c +$((offset+1)) "$path" 2>/dev/null) || return 1; }

  local base_in base_out base_cr base_cc base_fb
  base_in=$(printf '%s' "$SIDECAR_JSON" | jq -r '.in_total // 0' 2>/dev/null); case "$base_in" in ''|*[!0-9]*) base_in=0 ;; esac
  base_out=$(printf '%s' "$SIDECAR_JSON" | jq -r '.out_total // 0' 2>/dev/null); case "$base_out" in ''|*[!0-9]*) base_out=0 ;; esac
  base_cr=$(printf '%s' "$SIDECAR_JSON" | jq -r '.cache_read_total // 0' 2>/dev/null); case "$base_cr" in ''|*[!0-9]*) base_cr=0 ;; esac
  base_cc=$(printf '%s' "$SIDECAR_JSON" | jq -r '.cache_creation_total // 0' 2>/dev/null); case "$base_cc" in ''|*[!0-9]*) base_cc=0 ;; esac
  base_fb=$(printf '%s' "$SIDECAR_JSON" | jq -r '.subagent_fallback_tokens // 0' 2>/dev/null); case "$base_fb" in ''|*[!0-9]*) base_fb=0 ;; esac

  local d_in=0 d_out=0 d_cr=0 d_cc=0
  if [ -n "$newdata" ]; then
    usage=$(printf '%s' "$newdata" | _sum_assistant_usage_stdin) || usage="0 0 0 0"
    read -r d_in d_out d_cr d_cc <<<"$usage"
  fi

  IN_TOTAL=$(( base_in + d_in ))
  OUT_TOTAL=$(( base_out + d_out ))
  CACHE_READ_TOTAL=$(( base_cr + d_cr ))
  CACHE_CREATION_TOTAL=$(( base_cc + d_cc ))
  SUBAGENT_FALLBACK_TOTAL="$base_fb"

  SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq \
    --argjson offset "$size" --argjson in "$IN_TOTAL" --argjson out "$OUT_TOTAL" \
    --argjson cr "$CACHE_READ_TOTAL" --argjson cc "$CACHE_CREATION_TOTAL" \
    '.transcript_offset = $offset | .in_total = $in | .out_total = $out
     | .cache_read_total = $cr | .cache_creation_total = $cc
     | .subagents = (.subagents // {}) | .subagent_fallback_tokens = (.subagent_fallback_tokens // 0)' \
    2>/dev/null) || return 1
  [ -n "$SIDECAR_JSON" ] || return 1

  if [ -n "$newdata" ]; then
    local completions line
    completions=$(printf '%s' "$newdata" | _extract_subagent_completions_stdin) || completions=""
    if [ -n "$completions" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        local aid ftok already sub_in=0 sub_out=0 sub_cr=0 sub_cc=0 counted=0 sub_usage subfile
        aid=$(printf '%s' "$line" | jq -r '.agent_id // empty' 2>/dev/null)
        [ -z "$aid" ] && continue
        already=$(printf '%s' "$SIDECAR_JSON" | jq -r --arg t "$aid" '.subagents[$t].done // false' 2>/dev/null)
        [ "$already" = "true" ] && continue
        ftok=$(printf '%s' "$line" | jq -r '.fallback_tokens // empty' 2>/dev/null)

        subfile="$(dirname "$path")/subagents/agent-${aid}.jsonl"
        if [ -r "$subfile" ] && sub_usage=$(_sum_assistant_usage_stdin < "$subfile" 2>/dev/null); then
          read -r sub_in sub_out sub_cr sub_cc <<<"$sub_usage"
          counted=1
        fi

        if [ "$counted" -eq 1 ]; then
          SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$aid" --argjson i "$sub_in" --argjson o "$sub_out" \
            --argjson cr "$sub_cr" --argjson cc "$sub_cc" \
            '.subagents[$t] = {in: $i, out: $o, cache_read: $cr, cache_creation: $cc, done: true}' 2>/dev/null) || continue
        elif [ -n "$ftok" ]; then
          case "$ftok" in ''|*[!0-9]*) ftok=0 ;; esac
          SUBAGENT_FALLBACK_TOTAL=$(( SUBAGENT_FALLBACK_TOTAL + ftok ))
          SIDECAR_JSON=$(printf '%s' "$SIDECAR_JSON" | jq --arg t "$aid" --argjson fb "$SUBAGENT_FALLBACK_TOTAL" \
            '.subagents[$t] = {in: 0, out: 0, done: true} | .subagent_fallback_tokens = $fb' 2>/dev/null) || continue
        fi
        # else: neither the subagent transcript file nor a fallback <usage>
        # token count is available. Leave this agent id unmarked rather than
        # fabricating a zero count; the completion record only appears once
        # in the incremental newdata window so it will not be retried later.
      done <<<"$completions"
    fi
  fi

  SUBAGENT_IN_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.in // 0] | add // 0' 2>/dev/null)
  SUBAGENT_OUT_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.out // 0] | add // 0' 2>/dev/null)
  SUBAGENT_CR_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.cache_read // 0] | add // 0' 2>/dev/null)
  SUBAGENT_CC_TOTAL=$(printf '%s' "$SIDECAR_JSON" | jq -r '[.subagents[]?.cache_creation // 0] | add // 0' 2>/dev/null)
  case "$SUBAGENT_IN_TOTAL" in ''|*[!0-9]*) SUBAGENT_IN_TOTAL=0 ;; esac
  case "$SUBAGENT_OUT_TOTAL" in ''|*[!0-9]*) SUBAGENT_OUT_TOTAL=0 ;; esac
  case "$SUBAGENT_CR_TOTAL" in ''|*[!0-9]*) SUBAGENT_CR_TOTAL=0 ;; esac
  case "$SUBAGENT_CC_TOTAL" in ''|*[!0-9]*) SUBAGENT_CC_TOTAL=0 ;; esac
  return 0
}

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
  if _fold_metric "$RAW_DURATION_MS" base_duration_ms last_duration_ms; then
    FOLDED_DURATION_MS="$FOLD_RESULT"
    if _fold_metric "$RAW_API_MS" base_api_duration_ms last_api_ms; then
      FOLDED_API_MS="$FOLD_RESULT"
      if _sidecar_save "$SIDECAR_PATH" "$SIDECAR_JSON"; then
        DURATION_MS="$FOLDED_DURATION_MS"
        API_MS="$FOLDED_API_MS"
      fi
    fi
  fi
fi

# ── Task 8.2: transcript tail pass (reuses SIDECAR_JSON/SIDECAR_PATH above) ─
TRANSCRIPT_PATH=$(_jq '.transcript_path')
IN_TOTAL=0; OUT_TOTAL=0; CACHE_READ_TOTAL=0; CACHE_CREATION_TOTAL=0
SUBAGENT_IN_TOTAL=0; SUBAGENT_OUT_TOTAL=0; SUBAGENT_FALLBACK_TOTAL=0
SUBAGENT_CR_TOTAL=0; SUBAGENT_CC_TOTAL=0
TAIL_OK=0
if command -v jq >/dev/null 2>&1 && [ -n "$SESSION_ID" ] \
   && [ -n "$TRANSCRIPT_PATH" ] && [ -r "$TRANSCRIPT_PATH" ]; then
  SIDECAR_PATH="${SIDECAR_DIR}/${SESSION_ID}.json"
  if _transcript_tail_pass "$TRANSCRIPT_PATH"; then
    _sidecar_save "$SIDECAR_PATH" "$SIDECAR_JSON" && TAIL_OK=1
  fi
fi

_ramp() {  # pct t1 t2 [t3] -> color code. 3 args: GRN<t1<=YLW<t2<=RED. 4 args: GRN<t1<=YLW<t2<=ORANGE<t3<=RED.
  local pct="$1" t1="$2" t2="$3" t3="${4:-}"
  if [ -n "$t3" ]; then
    if   [ "$pct" -ge "$t3" ]; then printf '%s' "$RED"
    elif [ "$pct" -ge "$t2" ]; then printf '%s' "$ORANGE"
    elif [ "$pct" -ge "$t1" ]; then printf '%s' "$YLW"
    else printf '%s' "$GRN"; fi
  else
    if   [ "$pct" -ge "$t2" ]; then printf '%s' "$RED"
    elif [ "$pct" -ge "$t1" ]; then printf '%s' "$YLW"
    else printf '%s' "$GRN"; fi
  fi
}

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

# ── Line 1 LEFT: model │ effort │ 🕐 dur (📡api%) ──────────────────────────
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
if [ "$DURATION_MS" -ge 60000 ]; then
  case "$GLYPHS" in emoji) CG="🕐 " ;; nerd) CG=$' ' ;; *) CG="" ;; esac
  L1L+=" ${DIM}│${RST} ${DIM}${CG}$(_dur "$DURATION_MS")${RST}"
  if [ "$API_MS" -gt 0 ]; then
    case "$GLYPHS" in emoji) PG="📡" ;; nerd) PG=$'' ;; *) PG="" ;; esac
    L1L+=" ${DIM}(${PG}$(_dur "$API_MS"))${RST}"
  fi
fi

# ── Line 1 RIGHT: ↑inΣ⚡r%/↓outΣ [⑂in/out%] │ CTX: [bar] cur/win/+turn ──
# Token totals: prefer Task 8.2's transcript tail-pass sums (whole-session);
# fall back to the payload's own context_window fields when the tail pass
# didn't run (missing/unreadable transcript, no jq, etc — fail-open).
DISPLAY_IN="$IN_TOTAL"; DISPLAY_OUT="$OUT_TOTAL"
DISPLAY_CR="$CACHE_READ_TOTAL"; DISPLAY_CC="$CACHE_CREATION_TOTAL"
SUB_IN_EFF=$(( SUBAGENT_IN_TOTAL + SUBAGENT_FALLBACK_TOTAL ))
DISPLAY_SUB_OUT="$SUBAGENT_OUT_TOTAL"
DISPLAY_SUB_CR="$SUBAGENT_CR_TOTAL"; DISPLAY_SUB_CC="$SUBAGENT_CC_TOTAL"
if [ "$TAIL_OK" -ne 1 ]; then
  DISPLAY_IN=$(_jq_int '.context_window.total_input_tokens')
  DISPLAY_OUT=$(_jq_int '.context_window.total_output_tokens')
  DISPLAY_CR=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
  DISPLAY_CC=0
  SUB_IN_EFF=0; DISPLAY_SUB_OUT=0; DISPLAY_SUB_CR=0; DISPLAY_SUB_CC=0
fi
GRAND_TOTAL_IN=$(( DISPLAY_IN + DISPLAY_CR + DISPLAY_CC + SUB_IN_EFF + DISPLAY_SUB_CR + DISPLAY_SUB_CC ))
GRAND_TOTAL_OUT=$(( DISPLAY_OUT + DISPLAY_SUB_OUT ))
IN_STR="${GRN}↑$(_human "$GRAND_TOTAL_IN")${RST}"
READ_TOTAL=$(( DISPLAY_CR + DISPLAY_SUB_CR ))
if [ "$GRAND_TOTAL_IN" -gt 0 ] && [ "$READ_TOTAL" -gt 0 ]; then
  READ_PCT=$(( READ_TOTAL * 100 / GRAND_TOTAL_IN ))
  IN_STR="${IN_STR} ${DIM}⚡${READ_PCT}%${RST}"
fi
OUT_STR="${BLU}↓$(_human "$GRAND_TOTAL_OUT")${RST}"
TOK="${IN_STR} ${DIM}/${RST}${OUT_STR}"

# Subagent share: real per-task sums (SUBAGENT_IN_TOTAL/SUBAGENT_OUT_TOTAL)
# plus SUBAGENT_FALLBACK_TOTAL folded in as best-effort (the fallback lump has
# no in/out split, so it is conservatively counted against the input side).
# Omit the whole segment when there is no subagent activity at all.
SUB_OUT_EFF="$SUBAGENT_OUT_TOTAL"
SUB_SEG=""
if [ "$SUB_IN_EFF" -gt 0 ] || [ "$SUB_OUT_EFF" -gt 0 ]; then
  IN_SHARE=0
  [ "$GRAND_TOTAL_IN" -gt 0 ] && IN_SHARE=$(( SUB_IN_EFF * 100 / GRAND_TOTAL_IN ))
  OUT_SHARE=0
  [ "$GRAND_TOTAL_OUT" -gt 0 ] && OUT_SHARE=$(( SUB_OUT_EFF * 100 / GRAND_TOTAL_OUT ))
  SUB_SEG=" ${DIM}[⑂${IN_SHARE}%/${OUT_SHARE}%]${RST}"
fi

# CTX: window-aware ramp tiers (>300K tier: 20/50; <=300K tier: 50/75).
WIN=$(_jq_int '.context_window.context_window_size')
CTX_PCT_RAW=$(_jq '.context_window.used_percentage')
CU_PRESENT=$(_jq '.context_window.current_usage')
if [ -n "$CU_PRESENT" ] && [ "$CU_PRESENT" != "null" ]; then
  CUR_IN=$(_jq_int '.context_window.current_usage.input_tokens')
  CUR_OUT_T=$(_jq_int '.context_window.current_usage.output_tokens')
  CUR_CR=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
  CUR_CC=$(_jq_int '.context_window.current_usage.cache_creation_input_tokens')
  CUR=$(( CUR_IN + CUR_OUT_T + CUR_CR + CUR_CC ))
  TURN_OUT="$CUR_OUT_T"
  HAVE_TURN_OUT=1
else
  # documented quirk: current_usage can be null before the first response or
  # right after /compact — fall back to the session-total input field.
  CUR=$(_jq_int '.context_window.total_input_tokens')
  HAVE_TURN_OUT=0
fi
if [ -n "$CTX_PCT_RAW" ]; then
  CTX_PCT=$(printf '%s' "$CTX_PCT_RAW" | cut -d. -f1)
elif [ "$WIN" -gt 0 ]; then
  CTX_PCT=$(( CUR * 100 / WIN ))
else
  CTX_PCT=0
fi
if [ "$WIN" -gt 300000 ]; then CTXC=$(_ramp "$CTX_PCT" 20 50)
else CTXC=$(_ramp "$CTX_PCT" 50 75)
fi
CTX_SEG="${DIM}CTX:${RST} ${CTXC}[$(_bar "$CTX_PCT" 10)]${RST} ${DIM}$(_human "$CUR")/$(_human "$WIN")"
[ "$HAVE_TURN_OUT" -eq 1 ] && CTX_SEG+="/+$(_human "$TURN_OUT")"
CTX_SEG+="${RST}"

L1R="${TOK}${SUB_SEG} ${DIM}│${RST} ${CTX_SEG}"

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

# ── Line 2 RIGHT: rate limits (each window independently optional) │ cost ──
COST=$(_jq '.cost.total_cost_usd // empty')
[ -n "$COST" ] && COST=$(echo "$COST" | awk '{printf "%.2f",$1}')
R5_RAW=$(_jq '.rate_limits.five_hour.used_percentage')
R7_RAW=$(_jq '.rate_limits.seven_day.used_percentage')
L2R=""
if [ -n "$R5_RAW" ]; then
  R5=$(printf '%s' "$R5_RAW" | cut -d. -f1); [ -z "$R5" ] && R5=0
  R5C=$(_ramp "$R5" 50 75 90)
  T5=$(_until "$(_jq '.rate_limits.five_hour.resets_at')")
  L2R+="${DIM}5hr:${RST} ${R5C}${R5}%${RST}"; [ -n "$T5" ] && L2R+=" (${T5})"
fi
if [ -n "$R7_RAW" ]; then
  R7=$(printf '%s' "$R7_RAW" | cut -d. -f1); [ -z "$R7" ] && R7=0
  R7C=$(_ramp "$R7" 50 75 90)
  T7=$(_until "$(_jq '.rate_limits.seven_day.resets_at')")
  [ -n "$L2R" ] && L2R+=" ${DIM}│${RST} "
  L2R+="${DIM}1wk:${RST} ${R7C}${R7}%${RST}"; [ -n "$T7" ] && L2R+=" (${T7})"
fi
[ -n "$L2R" ] && L2R+=" ${DIM}│${RST} "
L2R+="${DIM}\$:${RST} ${COST:-0.00}"

# ── Batch width computation → render both lines ────────────────────────────
read -r _w1l _w1r _w2l _w2r < <(
  printf '%s\n%s\n%s\n%s\n' "$L1L" "$L1R" "$L2L" "$L2R" \
  | python3 -c "
import sys,re,unicodedata as u
FW=set()
def vw(s):
    s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',s)
    return sum(2 if c in FW or u.east_asian_width(c) in('W','F') else(0 if u.category(c)=='Mn' else 1) for c in s)
for line in sys.stdin: print(vw(line.rstrip('\n')), end=' ')
" 2>/dev/null) || true
_lr "$L1L" "$L1R" "${_w1l:-}" "${_w1r:-}"
_lr "$L2L" "$L2R" "${_w2l:-}" "${_w2r:-}"

exit 0
