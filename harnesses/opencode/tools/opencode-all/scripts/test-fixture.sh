#!/usr/bin/env bash
# Test fixture: create a small throwaway opencode.db in $TMPDIR (or $1)
# and print the export commands to run the TUI against it.
#
# Usage:
#   bash scripts/test-fixture.sh           # uses $TMPDIR/opencode-all-test
#   bash scripts/test-fixture.sh /path/to  # uses /path/to/opencode-all-test
#
# Tear down:
#   rm -rf "$FIXTURE_DIR"                  # safe; nothing real is touched
#
# Real data: NEVER read or written by this script. The fixture is a fresh,
# synthetic DB at $FIXTURE_DIR/opencode.db.

set -euo pipefail

FIXTURE_DIR="${1:-${TMPDIR:-/tmp}/opencode-all-test}"
FIXTURE_DB="$FIXTURE_DIR/opencode.db"

mkdir -p "$FIXTURE_DIR"
rm -f "$FIXTURE_DB"

# Schema mirrors the real opencode.db shape; columns used by opencode-all are populated.
sqlite3 "$FIXTURE_DB" <<'SQL'
CREATE TABLE session (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  parent_id text,
  slug text NOT NULL,
  directory text NOT NULL,
  title text NOT NULL,
  version text NOT NULL,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_archived integer,
  workspace_id text,
  path text,
  agent text,
  model text,
  cost real DEFAULT 0 NOT NULL,
  tokens_input integer DEFAULT 0 NOT NULL,
  tokens_output integer DEFAULT 0 NOT NULL
);
CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer, data text);

-- 5 sessions: 3 active in current dir, 1 active elsewhere, 1 archived.
INSERT INTO session VALUES
  ('ses_alpha',   'p', NULL, 'a', '/tmp/test-cwd',           'Alpha in cwd',     'v', NULL, 12, 3, 1, 1000, 5000, NULL, NULL, '', 'build',  'kimi-k2.6', 0.42, 1200, 600),
  ('ses_bravo',   'p', NULL, 'b', '/tmp/test-cwd/sub',       'Bravo in cwd sub', 'v', NULL,  5, 1, 2, 1000, 4500, NULL, NULL, '', 'general','gpt-5.4',   1.20, 8000, 900),
  ('ses_charlie', 'p', NULL, 'c', '/tmp/test-cwd',           'Charlie in cwd',   'v', NULL,  0, 0, 0, 1000, 4000, NULL, NULL, '', 'plan',   'qwen3.6',    0.05, 200,  100),
  ('ses_delta',   'p', NULL, 'd', '/tmp/test-elsewhere',     'Delta elsewhere',  'v', NULL, 30, 7, 4, 1000, 3500, NULL, NULL, '', 'build',  'kimi-k2.6', 2.10, 15000, 2000),
  ('ses_echo',    'p', NULL, 'e', '/tmp/test-elsewhere',     'Echo archived',    'v', NULL,  0, 0, 0, 1000, 3000, 6000, NULL, '', 'build',  'gpt-5.4',   0.00, 50,   10);

INSERT INTO message VALUES
  ('msg_1', 'ses_alpha', 1000, '{"role":"user"}'),
  ('msg_2', 'ses_alpha', 1001, '{"role":"assistant"}'),
  ('msg_3', 'ses_bravo', 1000, '{"role":"user"}');
SQL

# Sanity check
COUNT=$(sqlite3 "$FIXTURE_DB" "SELECT COUNT(*) FROM session WHERE parent_id IS NULL")
if [ "$COUNT" -ne 5 ]; then
  echo "fixture creation failed: expected 5 sessions, got $COUNT" >&2
  exit 1
fi

# Print the launch commands. Note: also redirect the audit log so the test
# never touches the user's real audit log.
cat <<EOF

=== opencode-all test fixture ready ===

Fixture DB:    $FIXTURE_DB
Audit log:     $FIXTURE_DIR/audit.log
Tear down:     rm -rf "$FIXTURE_DIR"

To run the TUI in this terminal (cwd /tmp/test-cwd recommended so cwd-boost groups Alpha+Charlie+sub-Bravo first):

  export OPENCODE_ALL_DB_PATH="$FIXTURE_DB"
  export XDG_DATA_HOME="$FIXTURE_DIR/xdg"
  mkdir -p "\$XDG_DATA_HOME"
  cd /tmp/test-cwd
  opencode-all

To list sessions headlessly (no TTY required):

  OPENCODE_ALL_DB_PATH="$FIXTURE_DB" XDG_DATA_HOME="$FIXTURE_DIR/xdg" opencode-all --list

When done, restore your real environment:

  unset OPENCODE_ALL_DB_PATH XDG_DATA_HOME
  rm -rf "$FIXTURE_DIR"
EOF
