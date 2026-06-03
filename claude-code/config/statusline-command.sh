#!/usr/bin/env bash
# Satori statusline — 2-line layout with left/right split
# Requires: jq (https://jqlang.github.io/jq/)
#
# Line 1  LEFT : [Model]  repo (branch)
#          RIGHT: effort:X  PR#N state  @agent  [pmode]
# Line 2  LEFT : [context bar] %
#          RIGHT: $cost  +add/-rem  5h:X%  7d:X%  /last-skill

set -euo pipefail
input=$(cat)

# ── ANSI ─────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'
BLU=$'\033[34m'; MAG=$'\033[35m'; CYN=$'\033[36m'
BYLW=$'\033[93m'

# ── Helpers ───────────────────────────────────────────────────────────────
_jq()     { echo "$input" | jq -r "${1} // empty" 2>/dev/null || true; }
_jq_int() { echo "$input" | jq -r "${1} // 0"     2>/dev/null | cut -d. -f1; }

# Strip ANSI escapes to measure visible width
ESC=$'\033'
_vlen() { printf '%s' "$1" | sed "s/${ESC}\[[0-9;]*m//g" | awk '{print length($0)}'; }

# Build a line with LEFT flush-left, RIGHT flush-right, padded to $COLUMNS
_lr() {
  local left="$1" right="$2" cols="${COLUMNS:-80}"
  local pad=$(( cols - $(_vlen "$left") - $(_vlen "$right") ))
  [ "$pad" -lt 1 ] && pad=1
  printf '%s%*s%s\n' "$left" "$pad" '' "$right"
}

# ── Model / session ───────────────────────────────────────────────────────
MODEL=$(_jq '.model.display_name')
EFFORT=$(_jq '.effort.level')
AGENT=$(_jq  '.agent.name')

# ── Workspace ─────────────────────────────────────────────────────────────
REPO=$(_jq '.workspace.repo.name')
DIR=$(_jq  '.workspace.current_dir // .cwd')
WORKTREE=$(_jq '.workspace.git_worktree')
BRANCH=""
if [ -n "$WORKTREE" ]; then
  BRANCH="$WORKTREE"
elif [ -n "$DIR" ]; then
  BRANCH=$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
fi

# ── PR ────────────────────────────────────────────────────────────────────
PR_NUM=$(_jq '.pr.number')
PR_STATE=$(_jq '.pr.review_state')

# ── Context window ────────────────────────────────────────────────────────
CTX_PCT=$(_jq_int '.context_window.used_percentage')
CTX_PCT=${CTX_PCT:-0}
EXCEEDS=$(_jq '.exceeds_200k_tokens')

BAR_W=14
FILLED=$(( CTX_PCT * BAR_W / 100 ))
EMPTY=$(( BAR_W - FILLED ))
BAR=""
for ((i=0; i<FILLED; i++)); do BAR="${BAR}█"; done
for ((i=0; i<EMPTY;  i++)); do BAR="${BAR}░"; done

if   [ "$EXCEEDS" = "true" ] || [ "$CTX_PCT" -ge 90 ]; then BAR_C="$RED"
elif [ "$CTX_PCT" -ge 70 ];                              then BAR_C="$YLW"
elif [ "$CTX_PCT" -ge 50 ];                              then BAR_C="$BYLW"
else                                                          BAR_C="$GRN"
fi

# ── Cost / velocity ───────────────────────────────────────────────────────
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0' 2>/dev/null \
       | awk '{printf "%.2f", $1}')
LADD=$(_jq_int '.cost.total_lines_added')
LREM=$(_jq_int '.cost.total_lines_removed')

# ── Rate limits ───────────────────────────────────────────────────────────
RATE5=$(_jq '.rate_limits.five_hour.used_percentage  // empty' | cut -d. -f1)
RATE7=$(_jq '.rate_limits.seven_day.used_percentage  // empty' | cut -d. -f1)

# ── Sidecar (written by hooks) ────────────────────────────────────────────
SIDECAR="${MEKIKI_HOME:-$HOME/.mekiki}/statusline-sidecar.json"
PMODE=""; LAST_SKILL=""
if [ -f "$SIDECAR" ]; then
  PMODE=$(jq -r      '.permission_mode // empty' "$SIDECAR" 2>/dev/null || true)
  LAST_SKILL=$(jq -r '.last_skill      // empty' "$SIDECAR" 2>/dev/null || true)
fi

# ── Badges ────────────────────────────────────────────────────────────────
PR_BADGE=""
if [ -n "$PR_NUM" ]; then
  case "${PR_STATE:-}" in
    approved)          PC="$GRN"  ;;
    changes_requested) PC="$RED"  ;;
    draft)             PC="$DIM"  ;;
    *)                 PC="$YLW"  ;;
  esac
  PR_BADGE="${PC}PR#${PR_NUM}$([ -n "$PR_STATE" ] && printf ' %s' "$PR_STATE")${RST}"
fi

PMODE_BADGE=""
case "${PMODE:-}" in
  bypassPermissions) PMODE_BADGE="${RED}[bypass]${RST}"  ;;
  acceptEdits)       PMODE_BADGE="${YLW}[edits]${RST}"   ;;
  plan)              PMODE_BADGE="${CYN}[plan]${RST}"    ;;
  dontAsk)           PMODE_BADGE="${YLW}[dontAsk]${RST}" ;;
esac

# ── Line 1 ────────────────────────────────────────────────────────────────
# LEFT: identity — what project, which model
L1L="${BOLD}${MAG}[${MODEL:-?}]${RST}"
[ -n "$REPO"   ] && L1L+="  ${BOLD}${BLU}${REPO}${RST}"
[ -n "$BRANCH" ] && L1L+=" ${YLW}(${BRANCH})${RST}"

# RIGHT: session state — how you're working, any gates
L1R=""
[ -n "$EFFORT"      ] && L1R+="${DIM}effort:${EFFORT}${RST}"
[ -n "$PR_BADGE"    ] && L1R+="${L1R:+  }${PR_BADGE}"
[ -n "$AGENT"       ] && L1R+="${L1R:+  }${MAG}@${AGENT}${RST}"
[ -n "$PMODE_BADGE" ] && L1R+="${L1R:+  }${PMODE_BADGE}"

_lr "$L1L" "$L1R"

# ── Line 2 ────────────────────────────────────────────────────────────────
# LEFT: context pressure — the single most actionable number
L2L="${BAR_C}[${BAR}]${RST} ${CTX_PCT}%"

# RIGHT: cost, velocity, rate limits, last skill
L2R="${DIM}\$${COST}${RST}"
if [ "${LADD:-0}" -gt 0 ] || [ "${LREM:-0}" -gt 0 ]; then
  L2R+="  ${GRN}+${LADD:-0}${RST}/${RED}-${LREM:-0}${RST}"
fi
[ -n "$RATE5"      ] && L2R+="  ${DIM}5h:${RATE5}%${RST}"
[ -n "$RATE7"      ] && L2R+="  ${DIM}7d:${RATE7}%${RST}"
[ -n "$LAST_SKILL" ] && L2R+="  ${DIM}/${LAST_SKILL}${RST}"

_lr "$L2L" "$L2R"
