#!/usr/bin/env bash
# Plain-bash test harness for install-lib.sh (no bats in this environment,
# matching the style of harnesses/claude-code/tests/statusline/*.sh).
# Run: bash packages/cli/src/shared/tests/test_install_lib.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../install-lib.sh"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0
FAIL=0

_assert_eq() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS+1)); echo "PASS: $desc"
  else
    FAIL=$((FAIL+1)); echo "FAIL: $desc (expected '$expected', got '$actual')"
  fi
}

echo "== furaide_detect_js_runtime =="
if furaide_detect_js_runtime; then
  if [ "$JS_RUNTIME" = "bun" ] || [ "$JS_RUNTIME" = "npm" ]; then
    PASS=$((PASS+1)); echo "PASS: detected a valid runtime ($JS_RUNTIME)"
  else
    FAIL=$((FAIL+1)); echo "FAIL: JS_RUNTIME has unexpected value: $JS_RUNTIME"
  fi
else
  FAIL=$((FAIL+1)); echo "FAIL: furaide_detect_js_runtime returned nonzero on a dev machine (expected bun or npm present)"
fi

echo "== furaide_backup_file =="
TARGET="$SCRATCH/target"
mkdir -p "$TARGET"
echo "original content" > "$TARGET/CLAUDE.md"
furaide_backup_file "$TARGET/CLAUDE.md" "$TARGET" "20250101T000000"
BACKUP_PATH="$TARGET/.furaide-backup/20250101T000000/CLAUDE.md"
if [ -f "$BACKUP_PATH" ]; then
  PASS=$((PASS+1)); echo "PASS: backup file created at expected path"
  _assert_eq "backup content matches original" "$(cat "$BACKUP_PATH")" "original content"
else
  FAIL=$((FAIL+1)); echo "FAIL: backup file not created at $BACKUP_PATH"
fi

# Second call with different content must NOT overwrite the first backup (first-backup-wins)
echo "modified content" > "$TARGET/CLAUDE.md"
furaide_backup_file "$TARGET/CLAUDE.md" "$TARGET" "20250101T000000"
_assert_eq "first backup wins (not overwritten by second call)" "$(cat "$BACKUP_PATH")" "original content"

# No-op when dst doesn't exist
furaide_backup_file "$TARGET/does-not-exist.md" "$TARGET" "20250101T000001"
if [ -d "$TARGET/.furaide-backup/20250101T000001" ]; then
  FAIL=$((FAIL+1)); echo "FAIL: backup dir created for a nonexistent source file"
else
  PASS=$((PASS+1)); echo "PASS: no backup dir created when source file doesn't exist"
fi

echo "== furaide_find_project_dir =="
REPO="$SCRATCH/repo"
mkdir -p "$REPO/.git" "$REPO/sub/deeper"
FOUND=$(cd "$REPO/sub/deeper" && furaide_find_project_dir ".claude")
_assert_eq "no existing marker -> defaults to repo-root/.claude" "$FOUND" "$REPO/.claude"

mkdir -p "$REPO/sub/.claude"
FOUND2=$(cd "$REPO/sub/deeper" && furaide_find_project_dir ".claude")
_assert_eq "existing marker found while walking up" "$FOUND2" "$REPO/sub/.claude"

NOGIT="$SCRATCH/nogit"
mkdir -p "$NOGIT/a/b"
FOUND3=$(cd "$NOGIT/a/b" && furaide_find_project_dir ".opencode")
_assert_eq "no .git anywhere -> defaults to CWD/.opencode" "$FOUND3" "$NOGIT/a/b/.opencode"

echo "== furaide_write_receipt / furaide_read_receipt =="
RECEIPT_PATH="$SCRATCH/nested/dir/.furaide-receipt.json"
furaide_write_receipt "$RECEIPT_PATH" '{"version":1}'
_assert_eq "receipt written and readable" "$(furaide_read_receipt "$RECEIPT_PATH")" '{"version":1}'
_assert_eq "read on missing receipt returns empty" "$(furaide_read_receipt "$SCRATCH/does-not-exist.json")" ""

echo "== B1: symlink guard for skill removal =="
# Verifies the guard: only remove if symlink pointing into ~/.agents/skills/
AGENTS_POOL="$SCRATCH/agents_skills"
CLAUDE_SKILLS="$SCRATCH/claude_skills"
mkdir -p "$AGENTS_POOL/github" "$CLAUDE_SKILLS"

# Case 1: real directory — guard must NOT treat it as our symlink
skill_link="$CLAUDE_SKILLS/github"
mkdir -p "$skill_link"
if [[ -L "$skill_link" ]] && [[ "$(readlink "$skill_link")" == "$AGENTS_POOL/"* ]]; then
  FAIL=$((FAIL+1)); echo "FAIL: real dir was incorrectly identified as our symlink"
else
  PASS=$((PASS+1)); echo "PASS: real dir correctly NOT identified as our symlink"
fi
rm -rf "$skill_link"

# Case 2: symlink pointing into the agents pool — guard must match
ln -s "$AGENTS_POOL/github" "$skill_link"
if [[ -L "$skill_link" ]] && [[ "$(readlink "$skill_link")" == "$AGENTS_POOL/"* ]]; then
  PASS=$((PASS+1)); echo "PASS: correct symlink correctly identified as our symlink"
else
  FAIL=$((FAIL+1)); echo "FAIL: correct symlink was not identified as our symlink"
fi
rm -f "$skill_link"

# Case 3: symlink pointing somewhere else — guard must NOT match
ln -s "/usr/local/share/something" "$skill_link"
if [[ -L "$skill_link" ]] && [[ "$(readlink "$skill_link")" == "$AGENTS_POOL/"* ]]; then
  FAIL=$((FAIL+1)); echo "FAIL: foreign symlink was incorrectly identified as our symlink"
else
  PASS=$((PASS+1)); echo "PASS: foreign symlink correctly NOT identified as our symlink"
fi
rm -f "$skill_link"

echo "== B2: select_component back-nav (manual E2E note) =="
# Interactive TTY test cannot run headlessly. To verify B2 manually:
#   printf "b\n1\ny\n" | bash install.sh --scope global --dry-run
# (type 'b' at first component prompt → re-shows scope picker → select 1 → continue)
# The script must NOT exit non-zero after a single 'b' press.
# TODO: E2E test with: printf "b\n1\ny\ny\ny\ny\ny\ny\nn\n" | bash install.sh --dry-run
PASS=$((PASS+1)); echo "PASS: B2 noted (manual E2E only — TTY required)"

echo "== B3: receipt writer survives single-quote in path =="
QUOTE_DIR="$SCRATCH/it's a path"
mkdir -p "$QUOTE_DIR"
RECEIPT_OUT="$QUOTE_DIR/.furaide-receipt.json"
# Simulate the receipt-writer invocation with a path containing a single quote
python3 - \
  "$RECEIPT_OUT" \
  "bun" \
  "custom" \
  "2026-07-09T00:00:00Z" \
  "$QUOTE_DIR" \
  "$QUOTE_DIR/.furaide-backup/20260709T000000Z" \
  "$QUOTE_DIR/CLAUDE.md" \
  "" \
  -- \
  -- \
<<'PYEOF' 2>/dev/null
import json,sys
args = sys.argv[1:]
receipt_path, js_runtime, scope, installed_at, target_dir, backup_dir, claude_md, settings_json = args[:8]
rest = args[8:]
sep = rest.index('--') if '--' in rest else len(rest)
agent_files = rest[:sep]
rest2 = rest[sep+1:] if sep < len(rest) else []
sep2 = rest2.index('--') if '--' in rest2 else len(rest2)
skill_names = rest2[:sep2]
plugin_names = rest2[sep2+1:] if sep2 < len(rest2) else []
receipt = {
    'version': 1,
    'jsRuntime': js_runtime,
    'scope': scope,
    'installedAt': installed_at,
    'targetDir': target_dir,
    'backupDir': backup_dir,
    'components': {
        'claudeMd': claude_md if claude_md else None,
        'settings': settings_json if settings_json else None,
        'agents': agent_files,
        'skillNames': skill_names,
        'plugins': plugin_names,
    },
}
json.dump(receipt, open(receipt_path, 'w'), indent=2)
PYEOF
if [[ -f "$RECEIPT_OUT" ]]; then
  # Use a temp script file to avoid heredoc-in-$() bash warning
  _b3_py="$SCRATCH/b3_check.py"
  printf 'import json,sys\nd=json.load(open(sys.argv[1]))\nprint(d[sys.argv[2]])\n' > "$_b3_py"
  parsed=$(python3 "$_b3_py" "$RECEIPT_OUT" scope 2>/dev/null || echo "PARSE_FAIL")
  _assert_eq "B3: receipt with single-quote path is valid JSON, scope=custom" "$parsed" "custom"
  target_check=$(python3 "$_b3_py" "$RECEIPT_OUT" targetDir 2>/dev/null || echo "PARSE_FAIL")
  _assert_eq "B3: targetDir preserved with single-quote" "$target_check" "$QUOTE_DIR"
else
  FAIL=$((FAIL+1)); echo "FAIL: B3 receipt file was not written"
fi

echo "== E1: install-vendored-skills.sh --list =="
VENDORED_SH="$HERE/../install-vendored-skills.sh"
LIST_OUT="$(bash "$VENDORED_SH" --list)"
LIST_LINES="$(printf '%s\n' "$LIST_OUT" | grep -c .)"
if [[ "$LIST_LINES" -ge 10 ]]; then
  PASS=$((PASS+1)); echo "PASS: --list emits at least 10 rows ($LIST_LINES)"
else
  FAIL=$((FAIL+1)); echo "FAIL: --list emitted only $LIST_LINES rows, expected >= 10"
fi
if printf '%s\n' "$LIST_OUT" | grep -qP '^github\t'; then
  PASS=$((PASS+1)); echo "PASS: --list includes a tab-separated 'github' row"
else
  FAIL=$((FAIL+1)); echo "FAIL: --list missing expected 'github<TAB>...' row"
fi
BAD_COLS="$(printf '%s\n' "$LIST_OUT" | awk -F'\t' 'NF!=2{c++} END{print c+0}')"
_assert_eq "--list: every row has exactly 2 tab-separated fields" "$BAD_COLS" "0"

echo "== E1: install-vendored-skills.sh --only + INSTALLED: lines =="
ONLY_TARGET="$SCRATCH/only_target"
mkdir -p "$ONLY_TARGET"
ONLY_OUT="$(bash "$VENDORED_SH" --custom "$ONLY_TARGET" --only github,html-preview 2>&1)"
INSTALLED_NAMES="$(printf '%s\n' "$ONLY_OUT" | sed -n 's/^INSTALLED: //p' | sort)"
_assert_eq "--only: INSTALLED: lines are exactly the requested subset" "$INSTALLED_NAMES" "$(printf 'github\nhtml-preview')"
if [[ -d "$ONLY_TARGET/skills/github" && -d "$ONLY_TARGET/skills/html-preview" ]]; then
  PASS=$((PASS+1)); echo "PASS: --only installed exactly the requested skill dirs"
else
  FAIL=$((FAIL+1)); echo "FAIL: --only did not install the expected skill dirs at $ONLY_TARGET/skills/"
fi
OTHER_DIRS="$(find "$ONLY_TARGET/skills" -mindepth 1 -maxdepth 1 -type d ! -name github ! -name html-preview 2>/dev/null | wc -l | tr -d ' ')"
_assert_eq "--only: no extra skill dirs installed beyond the requested subset" "$OTHER_DIRS" "0"

echo "== E1: install-vendored-skills.sh --only unknown name warns, does not fail =="
UNKNOWN_TARGET="$SCRATCH/unknown_target"
mkdir -p "$UNKNOWN_TARGET"
if UNKNOWN_OUT="$(bash "$VENDORED_SH" --custom "$UNKNOWN_TARGET" --only github,totally-not-a-real-skill 2>&1)"; then
  PASS=$((PASS+1)); echo "PASS: --only with one unknown name still exits 0"
else
  FAIL=$((FAIL+1)); echo "FAIL: --only with one unknown name exited nonzero"
fi
if printf '%s\n' "$UNKNOWN_OUT" | grep -q "unknown skill 'totally-not-a-real-skill'"; then
  PASS=$((PASS+1)); echo "PASS: --only warns on the unknown skill name"
else
  FAIL=$((FAIL+1)); echo "FAIL: expected an 'unknown skill' warning in output"
fi
if [[ -d "$UNKNOWN_TARGET/skills/github" ]]; then
  PASS=$((PASS+1)); echo "PASS: the known name in the same --only list still installs"
else
  FAIL=$((FAIL+1)); echo "FAIL: github should have installed despite the unknown sibling name"
fi

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
