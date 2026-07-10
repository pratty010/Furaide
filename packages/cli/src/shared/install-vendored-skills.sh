#!/usr/bin/env bash
# install-vendored-skills.sh — F.R.I.D.A.Y. shared skills installer
#
# Copies skills from skills/ to ~/.agents/skills/ (source of truth).
# For global and project modes, creates symlinks in ~/.claude/skills/ pointing to ~/.agents/.
# Use --relink to replace pre-existing real directories with symlinks.
#
# Skills installed: whatever's under skills/ at repo root, or a subset via --only.
#
# ~/.agents/skills/<name>  ← real copy (source of truth)
# ~/.claude/skills/<name>  → symlink to ~/.agents/skills/<name>
#
# Called by packages/cli/src/targets/claude-code/install.sh and other harness installers.
#
# Usage:
#   bash scripts/install-vendored-skills.sh --global              # → ~/.agents/skills/ + ~/.claude/skills/
#   bash scripts/install-vendored-skills.sh --project <dir>       # → <dir>/.agents/skills/ + <dir>/.claude/skills/
#   bash scripts/install-vendored-skills.sh --custom <path>       # → <path>/skills/
#   bash scripts/install-vendored-skills.sh --list                # print "name<TAB>description" per skill, then exit
#   bash scripts/install-vendored-skills.sh --global --only a,b,c # install only the named skills (default: all)
#
# --list and --only read/match against the skill dirnames under skills/ (this repo's
# vendored pool). Unknown names passed to --only are warned about and skipped, not fatal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$(cd "$SCRIPT_DIR/../../../../skills" && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
GRN=$'\033[32m'; YLW=$'\033[33m'; RED=$'\033[31m'
ok()   { printf '%s\n' "${GRN}[ok]${RST}   $*"; }
warn() { printf '%s\n' "${YLW}[warn]${RST} $*"; }
err()  { printf '%s\n' "${RED}[error]${RST} $*" >&2; exit 1; }

# ── Parse flags ───────────────────────────────────────────────────────────
MODE=""; TARGET=""; RELINK=0; LIST_ONLY=0; ONLY_NAMES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)
      MODE="global"
      shift ;;
    --project)
      MODE="project"
      TARGET="${2:?'--project requires a directory'}"
      shift 2 ;;
    --custom)
      MODE="custom"
      TARGET="${2:?'--custom requires a path'}"
      shift 2 ;;
    --relink)
      RELINK=1
      shift ;;
    --list)
      LIST_ONLY=1
      shift ;;
    --only)
      ONLY_NAMES="${2:?'--only requires a comma-separated skill-name list'}"
      shift 2 ;;
    -h|--help)
      sed -n '2,21p' "$0" | sed 's/^# //; s/^#//'
      exit 0 ;;
    *)
      err "Unknown option: $1" ;;
  esac
done

# ── --list: emit "name<TAB>description" per skill, then exit ───────────────
# Parses SKILL.md frontmatter with python3 (argv-safe, handles quoted YAML
# scalars — e.g. github's description is quoted). Truncates description to
# ~70 chars at a word boundary.
if [[ "$LIST_ONLY" -eq 1 ]]; then
  SKILLS_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../skills" && pwd)"
  python3 - "$SKILLS_SRC" <<'PYEOF'
import sys, os, re

src = sys.argv[1]
FM_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n', re.S)

def parse_frontmatter(text):
    m = FM_RE.match(text)
    if not m:
        return {}
    fields = {}
    key = None
    for line in m.group(1).splitlines():
        kv = re.match(r'^(\w[\w-]*):\s*(.*)$', line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if val.startswith(('"', "'")) and val.endswith(val[0]) and len(val) >= 2:
                val = val[1:-1]
            fields[key] = val
    return fields

def truncate(s, n=70):
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(' ', 1)[0]
    return cut + '…'

for name in sorted(os.listdir(src)):
    skill_md = os.path.join(src, name, 'SKILL.md')
    if not os.path.isfile(skill_md):
        continue
    with open(skill_md, encoding='utf-8') as f:
        fields = parse_frontmatter(f.read())
    desc = truncate(fields.get('description', ''))
    print(f"{name}\t{desc}")
PYEOF
  exit 0
fi

# ── --only: build a lookup set of names to install (empty = install all) ───
declare -A ONLY_SET=()
if [[ -n "$ONLY_NAMES" ]]; then
  IFS=',' read -ra _only_arr <<< "$ONLY_NAMES"
  for n in "${_only_arr[@]}"; do
    [[ -n "$n" ]] && ONLY_SET["$n"]=1
  done
fi
_wanted() {  # _wanted <skill_name> -> 0 if should install, 1 if filtered out
  [[ -z "$ONLY_NAMES" ]] && return 0
  [[ -n "${ONLY_SET[$1]:-}" ]] && return 0
  return 1
}

if [[ -z "$MODE" ]]; then
  printf 'Install shared skills to [g]lobal ~/.agents, [p]roject, or enter custom path? [g/p/path] '
  read -r reply </dev/tty || reply="g"
  case "$reply" in
    g|G) MODE="global" ;;
    p|P)
      printf 'Project directory (default: %s): ' "$PWD"
      read -r dir </dev/tty || dir="$PWD"
      MODE="project"; TARGET="${dir:-$PWD}" ;;
    *)
      MODE="custom"; TARGET="$reply" ;;
  esac
fi

# ── Resolve destination ───────────────────────────────────────────────────
case "$MODE" in
  global)
    AGENTS_DEST="$HOME/.agents/skills"
    CLAUDE_DEST="$HOME/.claude/skills"
    ;;
  project)
    AGENTS_DEST="$TARGET/.agents/skills"
    CLAUDE_DEST="$TARGET/.claude/skills"
    ;;
  custom)
    AGENTS_DEST="$TARGET/skills"
    CLAUDE_DEST=""
    ;;
esac

printf '\n%s\n' "${BOLD}Installing shared skills from skills/${RST}"
printf '  Source:  %s\n' "$SKILLS_SRC"
printf '  Target:  %s\n' "$AGENTS_DEST"
[[ -n "$CLAUDE_DEST" ]] && printf '  Also:    %s\n\n' "$CLAUDE_DEST"

# ── Validate --only names against what actually exists ─────────────────────
if [[ -n "$ONLY_NAMES" ]]; then
  for n in "${!ONLY_SET[@]}"; do
    [[ -d "$SKILLS_SRC/$n" ]] || warn "  --only: unknown skill '$n' (no such dir in $SKILLS_SRC) — skipped"
  done
fi

# ── Copy skills ───────────────────────────────────────────────────────────
mkdir -p "$AGENTS_DEST"

for skill_dir in "$SKILLS_SRC"/*/; do
  skill_name="$(basename "$skill_dir")"
  _wanted "$skill_name" || continue
  dest="$AGENTS_DEST/$skill_name"

  if [[ -d "$dest" ]]; then
    warn "  $skill_name: already exists at $dest — skipping (delete to reinstall)"
    printf 'INSTALLED: %s\n' "$skill_name"
  else
    cp -rL "$skill_dir" "$dest"
    ok "  $skill_name → $dest"
    printf 'INSTALLED: %s\n' "$skill_name"
  fi
done

# ── Symlink into Claude Code skills dir ───────────────────────────────────
if [[ -n "$CLAUDE_DEST" ]]; then
  mkdir -p "$CLAUDE_DEST"
  for skill_dir in "$SKILLS_SRC"/*/; do
    skill_name="$(basename "$skill_dir")"
    _wanted "$skill_name" || continue
    src="$AGENTS_DEST/$skill_name"
    link="$CLAUDE_DEST/$skill_name"
    if [[ -L "$link" ]]; then
      if [[ -e "$link" ]]; then
        warn "  $skill_name: symlink exists — skipping (use --relink to replace)"
      else
        warn "  $skill_name: broken symlink at $link — pass --relink to fix"
      fi
    elif [[ -e "$link" ]] && [[ "$RELINK" -eq 0 ]]; then
      warn "  $skill_name: real dir at $link — pass --relink to replace with symlink"
    elif [[ -e "$link" ]] && [[ "$RELINK" -eq 1 ]]; then
      if [[ ! -d "$src" ]]; then
        warn "  $skill_name: agents copy missing at $src — re-run to fix"
        continue
      fi
      rm -rf "$link"
      ln -s "$src" "$link"
      ok "  $skill_name → $link ⇒ $src (relinked)"
    else
      if [[ ! -d "$src" ]]; then
        warn "  $skill_name: agents copy missing at $src — re-run to fix"
        continue
      fi
      ln -s "$src" "$link"
      ok "  $skill_name → $link ⇒ $src"
    fi
  done
fi

printf '\n%s\n' "${GRN}Done.${RST} Common skills installed."
printf '%s\n' "${DIM}To update: re-run this script.${RST}"
if [[ -n "${CLAUDE_DEST:-}" ]]; then
  printf '%s\n' "${DIM}To switch copies to symlinks: re-run with --relink.${RST}"
fi
exit 0
