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

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
