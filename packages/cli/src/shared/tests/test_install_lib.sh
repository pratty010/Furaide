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

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
