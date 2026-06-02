#!/usr/bin/env bash
# install-skills.sh — F.R.I.D.A.Y. skill installer
#
# Installs Claude Code workflow skills from skills-manifest.json.
# Creates symlinks in ~/.claude/skills/ (and optionally ~/.agents/skills/).
#
# Usage:
#   bash scripts/install-skills.sh               # interactive
#   bash scripts/install-skills.sh --all          # install all non-builtin sets without prompts
#   bash scripts/install-skills.sh --list         # show what would be installed, then exit
#   bash scripts/install-skills.sh --project      # install into ./.claude/skills/ (project-local)
#   bash scripts/install-skills.sh --agents-only  # only link into ~/.agents/skills/, skip ~/.claude/
#
# Symlink chain:
#   ~/.agents/skill-repos/<source>/   ← cloned git repos (source of truth)
#   ~/.agents/skills/<name>           ← per-skill symlink (aggregated view)
#   ~/.claude/skills/<name>           ← Claude Code view  (or .claude/skills/ for --project)
#
# Requirements: bash 4+, git, jq

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/../skills-manifest.json"
REPOS_DIR="${AGENTS_SKILL_REPOS:-$HOME/.agents/skill-repos}"
AGENTS_DIR="${AGENTS_SKILLS:-$HOME/.agents/skills}"
CLAUDE_DIR="${CLAUDE_SKILLS:-$HOME/.claude/skills}"
PROJECT_CLAUDE_DIR="${PROJECT_CLAUDE_SKILLS:-./.claude/skills}"

# ── Flags ─────────────────────────────────────────────────────────────────
OPT_ALL=0; OPT_LIST=0; OPT_PROJECT=0; OPT_AGENTS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --all)          OPT_ALL=1 ;;
    --list)         OPT_LIST=1 ;;
    --project)      OPT_PROJECT=1 ;;
    --agents-only)  OPT_AGENTS_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# //; s/^#//'
      exit 0 ;;
  esac
done

# ── Colors ────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'
MAG=$'\033[35m'; CYN=$'\033[36m'; RED=$'\033[31m'

# ── Helpers ───────────────────────────────────────────────────────────────
info()    { printf '%s\n' "${BLU}[info]${RST} $*"; }
ok()      { printf '%s\n' "${GRN}[ok]${RST}   $*"; }
skip()    { printf '%s\n' "${DIM}[skip]${RST} $*"; }
warn()    { printf '%s\n' "${YLW}[warn]${RST} $*"; }
section() { printf '\n%s\n' "${BOLD}${MAG}=== $* ===${RST}"; }

ask_yn() {
  # ask_yn "prompt" default_y_or_n → returns 0 (yes) or 1 (no)
  local prompt="$1" default="${2:-n}"
  if [ "$OPT_ALL" -eq 1 ]; then return 0; fi
  local hint="[y/N]"; [ "$default" = "y" ] && hint="[Y/n]"
  printf '%s %s ' "$prompt" "$hint"
  read -r reply </dev/tty
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy] ]]
}

# ── Validate manifest ─────────────────────────────────────────────────────
if [ ! -f "$MANIFEST" ]; then
  printf '%s\n' "${RED}[error]${RST} skills-manifest.json not found at: $MANIFEST"
  exit 1
fi
if ! jq empty "$MANIFEST" 2>/dev/null; then
  printf '%s\n' "${RED}[error]${RST} skills-manifest.json is not valid JSON"
  exit 1
fi

# ── Show header ───────────────────────────────────────────────────────────
printf '\n%s\n' "${BOLD}F.R.I.D.A.Y. Skill Installer${RST}"
printf '%s\n' "Installs Claude Code workflow skills defined in skills-manifest.json."
printf '%s\n' "Skills are cloned once to ~/.agents/skill-repos/ and linked from there."

if [ "$OPT_LIST" -eq 1 ]; then
  section "Skill sets"
  jq -r '
    .skill_sets | to_entries[] |
    select(.value.install_target != "none" and .value.install_target != "plugin") |
    "  \(.value.label)\n    " + (.value.skills | map("  \(.name) [\(.source)]") | join("\n    "))
  ' "$MANIFEST"
  exit 0
fi

# ── Determine install target dirs ─────────────────────────────────────────
if [ "$OPT_PROJECT" -eq 1 ]; then
  CLAUDE_TARGET="$PROJECT_CLAUDE_DIR"
  printf '\n%s\n' "${YLW}Installing into project-local .claude/skills/ (current dir: $(pwd))${RST}"
else
  CLAUDE_TARGET="$CLAUDE_DIR"
  printf '\n%s\n' "Global install targets:"
  printf '  ~/.agents/skill-repos/  %s\n' "(source repos)"
  printf '  ~/.agents/skills/       %s\n' "(aggregated symlinks)"
  [ "$OPT_AGENTS_ONLY" -eq 0 ] && printf '  ~/.claude/skills/       %s\n' "(Claude Code)"
fi

printf '\n'
if ! ask_yn "Proceed?" "y"; then
  info "Aborted."
  exit 0
fi

# ── Clone/update a source repo ────────────────────────────────────────────
_sync_source() {
  local name="$1" url="$2" dest="$3"
  dest="${dest/#\~/$HOME}"
  if [ -d "$dest/.git" ]; then
    info "Updating $name repo…"
    git -C "$dest" pull --ff-only --quiet 2>/dev/null || warn "Could not update $name — using cached copy."
  else
    info "Cloning $name from $url…"
    mkdir -p "$(dirname "$dest")"
    git clone --depth=1 --quiet "$url" "$dest"
    ok "Cloned $name"
  fi
}

# ── Install one skill ─────────────────────────────────────────────────────
_install_skill() {
  local skill_name="$1" source_name="$2"

  # Resolve source repo path
  local repo_dest skills_sub
  repo_dest=$(jq -r --arg s "$source_name" '.sources[$s].clone_to // empty' "$MANIFEST")
  repo_dest="${repo_dest/#\~/$HOME}"
  skills_sub=$(jq -r --arg s "$source_name" '.sources[$s].skills_dir // "skills"' "$MANIFEST")

  local skill_src="$repo_dest/$skills_sub/$skill_name"

  if [ ! -d "$skill_src" ]; then
    warn "  $skill_name: source dir not found at $skill_src — skipping"
    return 0
  fi

  # Link into ~/.agents/skills/
  local agents_target="$AGENTS_DIR/$skill_name"
  mkdir -p "$AGENTS_DIR"
  if [ -L "$agents_target" ] || [ -d "$agents_target" ]; then
    skip "  $skill_name: already in ~/.agents/skills/"
  else
    ln -sfn "$skill_src" "$agents_target"
    ok "  $skill_name -> ~/.agents/skills/"
  fi

  # Link into Claude target (global or project)
  if [ "$OPT_AGENTS_ONLY" -eq 0 ]; then
    mkdir -p "$CLAUDE_TARGET"
    local claude_target="$CLAUDE_TARGET/$skill_name"
    if [ -L "$claude_target" ] || [ -d "$claude_target" ]; then
      skip "  $skill_name: already in $CLAUDE_TARGET/"
    else
      ln -sfn "$agents_target" "$claude_target"
      ok "  $skill_name -> $CLAUDE_TARGET/"
    fi
  fi
}

# ── Process each installable skill set ───────────────────────────────────
INSTALLABLE=$(jq -c '
  .skill_sets | to_entries[] |
  select(.value.install_target != "none" and .value.install_target != "plugin")
' "$MANIFEST")

# Track which sources need cloning
declare -A SOURCES_NEEDED=()

while IFS= read -r set_entry; do
  set_key=$(echo "$set_entry"   | jq -r '.key')
  set_label=$(echo "$set_entry" | jq -r '.value.label')
  set_desc=$(echo "$set_entry"  | jq -r '.value.description')

  section "$set_label"
  printf '%s\n' "${DIM}${set_desc}${RST}"

  # List skills in this set
  mapfile -t skill_names < <(echo "$set_entry" | jq -r '.value.skills[].name')
  mapfile -t skill_sources < <(echo "$set_entry" | jq -r '.value.skills[].source')

  for i in "${!skill_names[@]}"; do
    local_desc=$(echo "$set_entry" | jq -r --argjson i "$i" '.value.skills[$i].description')
    printf '  %-35s %s\n' "${skill_names[$i]}" "${DIM}${local_desc}${RST}"
    src="${skill_sources[$i]}"
    src_type=$(jq -r --arg s "$src" '.sources[$s].type // "git"' "$MANIFEST")
    [ "$src_type" = "git" ] && SOURCES_NEEDED["$src"]=1
  done

  if ask_yn "  Install this set?"; then
    # Clone/update needed sources first (once per source, not per skill)
    for src_name in "${!SOURCES_NEEDED[@]}"; do
      src_url=$(jq -r --arg s "$src_name" '.sources[$s].url // empty' "$MANIFEST")
      src_dest=$(jq -r --arg s "$src_name" '.sources[$s].clone_to // empty' "$MANIFEST")
      [ -n "$src_url" ] && _sync_source "$src_name" "$src_url" "$src_dest"
    done
    SOURCES_NEEDED=()  # reset after clone so we don't re-clone for next set

    for i in "${!skill_names[@]}"; do
      src="${skill_sources[$i]}"
      src_type=$(jq -r --arg s "$src" '.sources[$s].type // "git"' "$MANIFEST")
      if [ "$src_type" = "builtin" ]; then
        skip "  ${skill_names[$i]}: built-in, no install needed"
      else
        _install_skill "${skill_names[$i]}" "$src"
      fi
    done
  else
    info "  Skipped."
  fi
done <<< "$INSTALLABLE"

# ── Summary ───────────────────────────────────────────────────────────────
section "Done"
info "Restart Claude Code for newly linked skills to appear."
[ "$OPT_AGENTS_ONLY" -eq 0 ] && info "Skills are in: $CLAUDE_TARGET"
info "Source of truth: $AGENTS_DIR"
printf '\n%s\n' "${DIM}To update all skills later: git -C ~/.agents/skill-repos/<source> pull${RST}"
