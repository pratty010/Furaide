#!/usr/bin/env bash
# statusline-lib/display.sh — width setup, ramp/outer-pin helpers, and all
# Line 1 / Line 2 rendering logic. Moved from the pre-split
# statusline-command.sh (Task 1 modularization). The former top-level
# "Line 1 LEFT" onward code is wrapped in _render_statusline() so sourcing
# this file has no side effects — the entry script calls the function
# explicitly, in render mode only, after the sidecar fold + transcript tail
# pass have already set the globals this reads (DURATION_MS, API_MS, COST,
# SUB_COST, TAIL_OK, SIDECAR_JSON, the *_TOTAL accumulators, etc).
# Depends on: util.sh (colors/glyphs/_jq/_jq_int/_human/_until/_dur/_bar/
# _pathshort/_vlen/_trunc), pricing.sh (_PRICE_JQ_LIB/PRICING_JSON/TODAY).

COLS="${COLUMNS:-80}"; MARGIN=4; USABLE=$(( COLS - MARGIN ))
[ "$USABLE" -lt 20 ] && USABLE=20

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

_render_statusline() {  # renders and prints both statusline lines; reads the render-mode globals set by the entry script
  # ── Line 1 LEFT: model │ effort │ 🕐 dur(📡 api-dur) ─────────────────────────
  MODEL=$(_jq '.model.display_name'); [ -z "$MODEL" ] && MODEL="?"
  case "$MODEL" in
    *Opus*)   MC="$MAG" ;; *Sonnet*) MC="$BLU" ;; *Haiku*) MC="$GRN" ;;
    *Fable*|*Mythos*) MC="$ORANGE" ;; *) MC="$BOLD" ;;
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
      # D2: keep the space inside the glyph var so emoji shows "(📡 ", nerd
      # shows "( ", and text shows "(...)" with no stray leading space.
      case "$GLYPHS" in emoji) PG="📡 " ;; nerd) PG=$' ' ;; *) PG="" ;; esac
      L1L+="${DIM}(${PG}$(_dur "$API_MS"))${RST}"
    fi
  fi

  # ── Line 1 RIGHT: ↑inΣ⚡r% /↓outΣ[turn] [⫂ subin/subout] ~est(n) │ CTX: [bar] cur/win ──
  # Token totals: prefer the transcript tail-pass sums (whole-session, deduped
  # by message.id); fall back to the payload's own context_window fields when
  # the tail pass didn't run (missing/unreadable transcript, no jq — fail-open).
  # current_usage is read first because its output_tokens feeds the [turn]
  # bracket on the ↓ figure. Documented quirk: current_usage can be null before
  # the first response or right after /compact — CUR then falls back to the
  # session-total input field and the [turn] bracket is omitted.
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
    CUR=$(_jq_int '.context_window.total_input_tokens')
    TURN_OUT=0
    HAVE_TURN_OUT=0
  fi

  DISPLAY_IN="$IN_TOTAL"; DISPLAY_OUT="$OUT_TOTAL"
  DISPLAY_CR="$CACHE_READ_TOTAL"; DISPLAY_CC="$CACHE_CREATION_TOTAL"
  if [ "$TAIL_OK" -ne 1 ]; then
    DISPLAY_IN=$(_jq_int '.context_window.total_input_tokens')
    DISPLAY_OUT=$(_jq_int '.context_window.total_output_tokens')
    DISPLAY_CR=$(_jq_int '.context_window.current_usage.cache_read_input_tokens')
    DISPLAY_CC=0
    SUBAGENT_IN_TOTAL=0; SUBAGENT_OUT_TOTAL=0; SUBAGENT_CR_TOTAL=0; SUBAGENT_CC_TOTAL=0
    SUBAGENT_FALLBACK_TOTAL=0; PENDING_COUNT=0
  fi
  # The subagent "in" figure folds its own cache reads/writes (mirroring how
  # the grand ↑ figure folds the main thread's) plus the legacy fallback lump
  # from pre-pending sidecars. Pending estimates stay out of confirmed sums.
  SUB_IN_EFF=$(( SUBAGENT_IN_TOTAL + SUBAGENT_CR_TOTAL + SUBAGENT_CC_TOTAL + SUBAGENT_FALLBACK_TOTAL ))
  SUB_OUT_EFF="$SUBAGENT_OUT_TOTAL"
  GRAND_TOTAL_IN=$(( DISPLAY_IN + DISPLAY_CR + DISPLAY_CC + SUB_IN_EFF ))
  GRAND_TOTAL_OUT=$(( DISPLAY_OUT + SUB_OUT_EFF ))
  # Token glyphs honor STATUSLINE_GLYPHS: emoji (default) keeps the compact
  # unicode set; nerd swaps the subagent glyph for the git-branch icon; text
  # degrades to pure-ASCII labels.
  case "$GLYPHS" in
    text) TG_IN="in:"; TG_CACHE=" cache:"; TG_OUT="out:"; TG_SUB="sub " ;;
    nerd) TG_IN="↑"; TG_CACHE="⚡"; TG_OUT="↓"; TG_SUB=$' ' ;;
    *)    TG_IN="↑"; TG_CACHE="⚡"; TG_OUT="↓"; TG_SUB="⫂ " ;;
  esac
  IN_STR="${GRN}${TG_IN}$(_human "$GRAND_TOTAL_IN")${RST}"
  # D3: cache-hit % is the unweighted average of each turn's own read rate.
  # When we have transcript-derived sidecar data, compute from per-turn rate_sum
  # and rate_turns (main + done subagents); otherwise fall back to the legacy
  # cumulative token-weighted ratio (no per-turn data available).
  if [ "$TAIL_OK" -eq 1 ]; then
    READ_PCT=$(printf '%s' "$SIDECAR_JSON" | jq -r '
      ((.rate_sum // 0) + (.subagent_rate_sum // 0)) as $rs
      | ((.rate_turns // 0) + (.subagent_rate_turns // 0)) as $rt
      | if $rt > 0 and $rs > 0 then ((100 * $rs / $rt) | floor) else 0 end' 2>/dev/null)
    case "$READ_PCT" in ''|*[!0-9]*) READ_PCT=0 ;; esac
    if [ "$READ_PCT" -gt 0 ]; then
      IN_STR+="${DIM}${TG_CACHE}${READ_PCT}%${RST}"
    fi
  else
    READ_TOTAL=$(( DISPLAY_CR + SUBAGENT_CR_TOTAL ))
    if [ "$GRAND_TOTAL_IN" -gt 0 ] && [ "$READ_TOTAL" -gt 0 ]; then
      READ_PCT=$(( READ_TOTAL * 100 / GRAND_TOTAL_IN ))
      IN_STR+="${DIM}${TG_CACHE}${READ_PCT}%${RST}"
    fi
  fi
  OUT_STR="${BLU}${TG_OUT}$(_human "$GRAND_TOTAL_OUT")${RST}"
  [ "$HAVE_TURN_OUT" -eq 1 ] && OUT_STR+="${DIM}[$(_human "$TURN_OUT")]${RST}"
  # Pending-subagent marker: a dim "~" prefix on the main token composite when
  # PENDING_COUNT > 0. The grand totals above (GRAND_TOTAL_IN/OUT via
  # SUB_IN_EFF/SUB_OUT_EFF) only ever roll in CONFIRMED subagent data — never
  # PENDING_EST_TOTAL — so this "~" means "still catching up, more may land,"
  # not "this number is wrong."
  TOK_PREFIX=""
  [ "${PENDING_COUNT:-0}" -gt 0 ] && TOK_PREFIX="${DIM}~${RST}"
  TOK="${TOK_PREFIX}${IN_STR} ${DIM}/${RST}${OUT_STR}"

  # Subagent segment: confirmed raw counts as [⫂ in/out]. Pending (still
  # unresolved) subagents no longer render a separate trailing ~est(n) clause
  # here — see the TOK_PREFIX/COST_PREFIX "~" markers instead.
  SUB_SEG=""
  if [ "$SUB_IN_EFF" -gt 0 ] || [ "$SUB_OUT_EFF" -gt 0 ]; then
    SUB_SEG=" ${DIM}[${TG_SUB}$(_human "$SUB_IN_EFF")/$(_human "$SUB_OUT_EFF")]${RST}"
  fi

  # CTX: window-aware ramp tiers (>300K tier: 20/50; <=300K tier: 50/75).
  WIN=$(_jq_int '.context_window.context_window_size')
  CTX_PCT_RAW=$(_jq '.context_window.used_percentage')
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
  CTX_SEG="${DIM}CTX:${RST} ${CTXC}[$(_bar "$CTX_PCT" 10)]${RST} ${DIM}$(_human "$CUR")/$(_human "$WIN")${RST}"

  L1R="${TOK}${SUB_SEG} ${DIM}│${RST} ${CTX_SEG}"

  # ── Line 2 LEFT: path (branch) │ +add/-rem ────────────────────────────────
  DIR=$(_jq '.workspace.current_dir // .cwd')
  RAWDIR="$DIR"
  case "$DIR" in "$HOME"*) DIR="~${DIR#"$HOME"}" ;; esac
  DIR=$(_pathshort "$DIR")
  BRANCH=""
  [ -n "$RAWDIR" ] && BRANCH=$(git -C "$RAWDIR" branch --show-current 2>/dev/null \
    || git -C "$RAWDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  WT=$(_jq '.workspace.git_worktree')
  [ -z "$BRANCH" ] && BRANCH="$WT"
  case "$GLYPHS" in emoji) DG="📁 " ;; nerd) DG=$' ' ;; *) DG="" ;; esac
  case "$GLYPHS" in nerd) BG=$' ' ;; *) BG="" ;; esac  # powerline branch glyph, nerd mode only
  L2L="${DG}${BOLD}${DIR}${RST}"
  [ -n "$BRANCH" ] && L2L+=" ${YLW}(${BG}${BRANCH})${RST}"
  LINES_ADD=$(_jq_int '.cost.total_lines_added')
  LINES_REM=$(_jq_int '.cost.total_lines_removed')
  if [ "$LINES_ADD" -gt 0 ] || [ "$LINES_REM" -gt 0 ]; then
    L2L+=" ${DIM}│${RST} ${GRN}+${LINES_ADD}${RST}/${RED}-${LINES_REM}${RST}"
  fi

  # ── Line 2 RIGHT: rate limits (each window independently optional) │ $: cost [subcost] ──
  # If the sidecar fold ran, COST was already set to the folded dollars (the
  # authoritative live payload total). Fail-open path (no jq/session_id): read
  # the raw payload value directly. E4: when neither source produced a
  # non-zero figure (no live cost payload ever seen for this session), fall
  # back to the sidecar's own estimated_cost_cents (our token x pricing
  # estimate — the only source available for recompute-only sessions). No
  # special "this is an estimate" marker, same convention as SUB_COST below.
  if [ -z "${COST:-}" ]; then
    COST=$(_jq '.cost.total_cost_usd // empty')
    [ -n "$COST" ] && COST=$(printf '%s' "$COST" | awk '{printf "%.2f",$1}')
  fi
  NEED_EST_FALLBACK=0
  if [ -z "${COST:-}" ]; then
    NEED_EST_FALLBACK=1
  else
    awk -v c="$COST" 'BEGIN{exit !(c==0)}' && NEED_EST_FALLBACK=1
  fi
  if [ "$NEED_EST_FALLBACK" -eq 1 ]; then
    EST_COST_CENTS=""
    if [ "$TAIL_OK" -eq 1 ]; then
      EST_COST_CENTS=$(printf '%s' "$SIDECAR_JSON" | jq -r '.estimated_cost_cents // 0' 2>/dev/null)
      case "$EST_COST_CENTS" in ''|*[!0-9]*) EST_COST_CENTS=0 ;; esac
    fi
    if [ -n "$EST_COST_CENTS" ] && [ "$EST_COST_CENTS" -gt 0 ]; then
      COST=$(awk -v c="$EST_COST_CENTS" 'BEGIN{printf "%.2f", c/100}')
    fi
  fi
  # Subagent cost estimate: per-model token buckets × the E2 pricing-JSON
  # lookup (exact model -> longest family prefix -> default; date-aware Sonnet
  # 5; explicit cache_5m/cache_1h/cache_read values; geo_us/fast modifiers
  # applied session-wide per the sidecar's sticky flags). No per-call cost
  # exists anywhere in the harness data (total_cost_usd is one session-wide
  # number), so this is a computed ESTIMATE by design — do not try to
  # reconcile it against the harness total. E3: reads the cumulative
  # subagent_models bucket + pending_subagents fallbacks, not a per-agent map.
  SUB_COST=""
  if [ "$TAIL_OK" -eq 1 ]; then
    # shellcheck disable=SC2016  # single-quoted continuation: jq's own $vars, not bash
    SUB_COST_PROG="$_PRICE_JQ_LIB"'
      ((.inference_geo_us // false)) as $geo
      | ((.speed_fast // false)) as $fast
      | ( [ (.subagent_models // {}) | to_entries[] | bcost(.key; .value; $geo; $fast) ] | add // 0 )
        + ( [ (.pending_subagents // {}) | to_entries[] | fbcost(.value.model // "unknown"; .value.fallback_estimate // 0; $geo) ] | add // 0 )
        + fbcost("unknown"; (.subagent_fallback_tokens // 0); $geo)
      | if . > 0 then tostring else empty end
    '
    SUB_COST=$(printf '%s' "$SIDECAR_JSON" | jq -r --argjson PR "$PRICING_JSON" --arg TODAY "$TODAY" "$SUB_COST_PROG" 2>/dev/null) || SUB_COST=""
    [ -n "$SUB_COST" ] && SUB_COST=$(printf '%s' "$SUB_COST" | awk '{printf "%.2f",$1}')
  fi
  R5_RAW=$(_jq '.rate_limits.five_hour.used_percentage')
  R7_RAW=$(_jq '.rate_limits.seven_day.used_percentage')
  L2R=""
  if [ -n "$R5_RAW" ] && [ -n "$R7_RAW" ]; then
    # Both windows present: one shared "5hr/1wk:" label, each side keeping its
    # own independently-ramped color — joined by "/", no "│" divider (they're
    # one composite unit now, not two independent segments).
    R5=$(printf '%s' "$R5_RAW" | cut -d. -f1); [ -z "$R5" ] && R5=0
    R5C=$(_ramp "$R5" 50 75 90)
    T5=$(_until "$(_jq '.rate_limits.five_hour.resets_at')")
    R7=$(printf '%s' "$R7_RAW" | cut -d. -f1); [ -z "$R7" ] && R7=0
    R7C=$(_ramp "$R7" 50 75 90)
    T7=$(_until "$(_jq '.rate_limits.seven_day.resets_at')")
    L2R+="${DIM}5hr/1wk:${RST} ${R5C}${R5}%${RST}"; [ -n "$T5" ] && L2R+="(${T5})"
    L2R+="${DIM}/${RST}${R7C}${R7}%${RST}"; [ -n "$T7" ] && L2R+="(${T7})"
  else
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
  fi
  # Cost magnitude ramp (total only; the [sub] estimate stays dim):
  # dim < $5 <= yellow < $25 <= orange < $50 <= red.
  COST_C="$DIM"
  COST_INT=$(printf '%s' "${COST:-0}" | cut -d. -f1)
  case "$COST_INT" in ''|*[!0-9]*) COST_INT=0 ;; esac
  if   [ "$COST_INT" -ge 50 ]; then COST_C="$RED"
  elif [ "$COST_INT" -ge 25 ]; then COST_C="$ORANGE"
  elif [ "$COST_INT" -ge 5 ];  then COST_C="$YLW"
  fi
  [ -n "$L2R" ] && L2R+=" ${DIM}│${RST} "
  # Pending-subagent marker on the cost composite: the estimated_cost_cents
  # fallback (see NEED_EST_FALLBACK above) genuinely folds pending_subagents'
  # fallback estimates into its total_est_cost (pricing.sh), so here "~"
  # means "this figure is a guess," a different reason than the token-side
  # TOK_PREFIX above even though both share the same PENDING_COUNT trigger.
  COST_PREFIX=""
  [ "${PENDING_COUNT:-0}" -gt 0 ] && COST_PREFIX="${DIM}~${RST}"
  L2R+="${COST_PREFIX}${DIM}\$:${RST} ${COST_C}${COST:-0.00}${RST}"
  # D4: subagent cost is displayed as a % of the (folded) session total, not as
  # dollars. SUB_COST is an independent estimate against the harness total, so
  # the % can legitimately exceed 100 — do not clamp it.
  SUB_COST_PCT=""
  if [ -n "$SUB_COST" ] && [ -n "${COST:-}" ]; then
    SUB_COST_PCT=$(awk -v s="$SUB_COST" -v t="$COST" 'BEGIN{ if (t+0 > 0) printf "%d", (s*100)/t }')
  fi
  [ -n "$SUB_COST_PCT" ] && L2R+=" ${DIM}[${SUB_COST_PCT}%]${RST}"

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
}
