# opencode-all Standalone TUI Design

**Date:** 2026-06-18

**Status:** Approved design, pending implementation plan execution

**Owner:** Furaide / OpenCode fleet tooling

## Goal

Build `opencode-all` as a standalone binary TUI application for managing OpenCode sessions across all directories. It is not embedded in the OpenCode TUI. It reads OpenCode session metadata directly, performs supported actions, and hands off to `opencode` when the user continues a session.

## Non-Goals

- Do not build this as an OpenCode slash command or in-TUI command.
- Do not add an OpenCode plugin for this tool.
- Do not implement bulk operations in v1.
- Do not implement FTS5 in v1; substring and lightweight fuzzy-subsequence ranking are enough.
- Do not keep the Python `vault.py` as a supported v1 frontend.

## Runtime Model

`opencode-all` is its own process. It launches from the shell, reads OpenCode data, renders its own TUI, and exits or `exec`s `opencode` for continue flows.

Continue behavior:

- `c`: replace the current process with `opencode --session <id>`.
- `C`: replace the current process with `opencode --session <id> --fork`.
- The `opencode-all` TUI and `opencode` TUI are never embedded in one another.

## Install Layout

Source ships in this repository:

```text
opencode/tools/opencode-all/
```

Runtime install layout:

```text
~/.local/share/opencode/tools/opencode-all/
~/.local/bin/opencode-all -> ~/.local/share/opencode/tools/opencode-all/src/tui.tsx
```

Installer behavior:

- `scripts/install.sh` copies the tool directory to `~/.local/share/opencode/tools/opencode-all/`.
- It creates or replaces the symlink at `${OPENCODE_ALL_BIN_DIR:-$HOME/.local/bin}/opencode-all`.
- It makes the executable path executable.
- It prints a warning if the chosen bin directory is not on `PATH`.

Environment overrides:

- `OPENCODE_ALL_BIN_DIR`: directory where the executable symlink is created.
- `OPENCODE_ALL_INSTALL_DIR`: runtime install directory, defaulting to `~/.local/share/opencode/tools/opencode-all`.
- `OPENCODE_ALL_OPENCODE_BIN`: OpenCode binary path, defaulting to `opencode`.

## Source Layout

The v1 layout is intentionally small.

```text
opencode/tools/opencode-all/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── src/
│   ├── db.ts
│   ├── sanitize.ts
│   └── tui.tsx
├── themes/
│   └── friday.json
├── tests/
│   ├── sanitize.test.ts
│   ├── db.test.ts
│   └── tui.test.tsx
└── scripts/
    └── install.sh
```

Responsibilities:

- `src/db.ts`: read OpenCode SQLite data through `bun:sqlite`; provide tiny allowlisted write helpers only for archive/restore by updating `session.time_archived`.
- `src/sanitize.ts`: strip unsafe terminal escapes, cap lengths, and flag suspicious strings.
- `src/tui.tsx`: OpenTUI app entrypoint, UI state, keybinds, process handoff, export/delete command spawning, audit logging, formatting helpers.
- `themes/friday.json`: reduced Friday palette inspired by `pi-agent/themes/friday.json`.
- `scripts/install.sh`: XDG install and symlink setup.

## Data Sources

Primary OpenCode data paths:

- SQLite DB: `~/.local/share/opencode/opencode.db`
- Session diffs: `~/.local/share/opencode/storage/session_diff/{session_id}.json`
- Existing session-vault metadata may be read for compatibility, but v1 does not depend on it as source of truth.

Read path:

1. Open SQLite read-only for list and inspect operations.
2. Query parent sessions (`parent_id IS NULL`) with active/archived/all tab filtering.
3. Sanitize all string fields before they enter TUI state.
4. Render only sanitized strings.

Write/action path:

- Export sanitized: `opencode export <id> --sanitize`
- Export raw: `opencode export <id>` after explicit warning and confirmation
- Delete: `opencode session delete <id>` after explicit confirmation
- Continue: `opencode --session <id>` via process replacement
- Continue fork: `opencode --session <id> --fork` via process replacement
- Archive: direct SQLite update of `session.time_archived = Date.now()` after confirmation
- Restore: direct SQLite update of `session.time_archived = NULL` after confirmation

Archive/restore are the only direct DB writes because the current `opencode session --help` exposes list and delete but not archive/restore. The write helper is allowlisted to one column, one table, and one session id.

## TUI Layout

The app uses a persistent three-pane layout:

```text
┌─ Sessions ───────────────┬─ Detail ────────────────────────────────┐
│ header + tab/search info │ selected session metadata                │
│ scrollable session list  │ scrollable detail content                │
│ scrollbar + row counter  │ scrollbar + section counter              │
├──────────────────────────┴─────────────────────────────────────────┤
│ status / action hints / warnings / last action                       │
└─────────────────────────────────────────────────────────────────────┘
```

Pane behavior:

- List pane is always scrollable.
- Detail pane is scrollable when content overflows.
- Modals scroll their body area when content overflows.
- Status pane is fixed at one row.
- Mouse wheel scrolls three rows per tick.
- Scrollbars are hidden when content fits.

## Sorting And Priority

Default sort order:

1. Sessions in the current cwd/workspace first.
2. Within the cwd group, sort by `time_updated DESC`.
3. Sessions outside the cwd group next, sorted by `time_updated DESC`.

Current group detection:

- A session is current if `session.directory` starts with `process.cwd()`.
- A session is also current if `session.workspace` starts with `process.cwd()`.
- `OPENCODE_ALL_CWD` overrides `process.cwd()`.

Sort cycle (`s`):

1. updated descending, cwd-first
2. created descending, cwd-first
3. cost descending, cwd-first
4. title ascending, cwd-first
5. recency-only without cwd boost

## Tabs

`Tab` cycles list views:

| Tab | Query | Default sort |
|---|---|---|
| Active | `parent_id IS NULL AND time_archived IS NULL` | updated descending, cwd-first |
| Archived | `parent_id IS NULL AND time_archived IS NOT NULL` | `time_archived DESC`, cwd-first |
| All | `parent_id IS NULL` | updated descending, cwd-first |

Archived rows show an `[A]` prefix and warning color.

## Search And Drill-Down

The app supports two search flows.

### Substring Live Filter

`/` opens an inline search field in the list pane.

Search fields:

- title
- directory
- path
- agent
- model
- share_url

Ranking:

1. exact prefix matches
2. substring matches
3. fuzzy subsequence matches

`Enter` accepts the filter. `Esc` clears it.

### Directory Drill-Down

`\` opens a directory browser modal.

Flow:

1. Type a path prefix.
2. The modal shows unique directories with session counts.
3. Pick a directory by Enter or click.
4. The list filters to sessions in that directory.

The detail pane also exposes clickable `Directory` and `Workspace` fields. Clicking one drills into that path.

Drill state:

- Each drill pushes `{tab, query, filter, sort, scroll}` onto a stack.
- `b`, `Alt+Left`, or the header back arrow pops one level.
- `B` clears all drill stack entries and returns to the initial view.
- Sort/tab changes inside a drilled view preserve the drill stack.

## Keybinds

| Key | Action |
|---|---|
| `j` / Down | Move down |
| `k` / Up | Move up |
| `gg` | Top |
| `G` | Bottom |
| `H` / `M` / `L` | Cursor to top/middle/bottom of viewport |
| `Ctrl+D` / `Ctrl+U` | Half-page down/up |
| `PgDn` / `PgUp` | Page down/up |
| Mouse wheel | Scroll focused pane |
| Click row | Select row |
| Double-click row | Open detail |
| Click Directory/Workspace | Drill into that path |
| `b` / `Alt+Left` / header back arrow | Back one drill level |
| `B` | Clear drill stack |
| Enter / `l` / Right | Open detail or focus right pane |
| Esc / `h` / Left | Back or clear search |
| `/` | Substring live filter |
| `\` | Directory drill-down |
| `f` | Filter menu |
| `Tab` | Active/Archived/All tab cycle |
| `s` | Sort cycle |
| `e` / `E` | Export sanitized/raw |
| `a` | Archive |
| `r` | Restore |
| `d` | Delete |
| `c` / `C` | Continue / continue with fork |
| `R` | Refresh |
| `V` | View raw export in pager |
| `?` | Help |
| `q` / Ctrl+C | Quit |

## Actions

All destructive actions require confirmation. Confirmation defaults to no.

| Action | Confirmation | Implementation |
|---|---|---|
| inspect | no | SQLite read + detail pane |
| export sanitized | yes, path confirmation | `opencode export <id> --sanitize` |
| export raw | yes, DLP warning + path confirmation | `opencode export <id>` |
| archive | yes | set `time_archived` |
| restore | yes | clear `time_archived` |
| delete | yes, irreversible wording | `opencode session delete <id>` |
| continue | no | exec `opencode --session <id>` |
| continue fork | no | exec `opencode --session <id> --fork` |
| refresh | no | reload DB data |
| view raw export | no after export exists | open `$PAGER`, fallback to `less -R` or `more` |

## DLP Strategy

The TUI treats all DB-sourced content as untrusted.

Protections:

- Ingest warnings for control bytes in title/path/model/agent/share fields.
- Render-time stripping for ESC, OSC, DCS, APC, PM, SOS, and non-SGR CSI.
- SGR color codes are allowed only when produced by the app/theme, not from DB strings.
- No OSC 52 is emitted by the app.
- Detail pane uses alternate screen behavior so long content does not fill normal scrollback.
- Titles and paths are capped in list view.
- Long message previews are capped and require explicit `V`/pager flow for raw viewing.
- Audit log stores action metadata only, never session content.

Audit path:

```text
~/.local/share/opencode/tools/opencode-all/audit.log
```

Audit line shape:

```json
{"ts":"2026-06-18T16:21:00.000Z","action":"archive","session_id":"ses_...","status":"ok"}
```

## Theme

Use a reduced Friday theme inspired by `pi-agent/themes/friday.json`.

Palette slots:

- `bg`
- `surface`
- `surfaceAlt`
- `accent`
- `violet`
- `success`
- `warning`
- `error`
- `muted`
- `dim`
- `text`
- `cyan`

The theme controls all terminal color. DB strings never carry terminal escapes into the renderer.

## Error Handling

The app must not crash for normal operational errors.

Categories:

- DB not found: show empty list with retry hint.
- DB locked: retry with 500 ms backoff up to 5 seconds.
- DB read error: skip bad row and show status warning.
- No matches: show empty-state row.
- OpenCode CLI missing: disable mutating actions and show setup hint.
- OpenCode CLI non-zero: show stderr tail in modal.
- CLI timeout: show timeout modal and allow retry.
- Audit log not writable: warn and continue.
- Sanitization warning: show status warning.
- Pager missing: show exported path.
- TTY lost: restore cursor and print error to stderr.
- Resize: recompute layout.
- Large detail content: page/virtualize; never load unbounded message bodies into the pane.

## Testing Requirements

Use `bun test`.

Test groups:

- `sanitize.test.ts`: control sequence stripping, length caps, ingest warnings.
- `db.test.ts`: synthetic SQLite fixture, list/inspect/archive/restore/sort/search/drill queries.
- `tui.test.tsx`: headless state tests for navigation, scrolling, tabs, search, directory drill, confirmations, errors.

Security regression cases:

- OSC 52 stripped.
- OSC 0 title spoof stripped.
- OSC 8 hyperlink wrapper stripped while text remains.
- CSI clear-screen stripped.
- DCS/iTerm/WezTerm proprietary sequences stripped.
- Long hostile title capped and does not crash rendering.
- Directory with control bytes cannot execute a terminal command or alter click handling.

Verification commands:

```bash
bun test opencode/tools/opencode-all/tests
bun test opencode/tools/opencode-all/tests/sanitize.test.ts
bun test opencode/tools/opencode-all/tests/db.test.ts
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

## Acceptance Criteria

- Running `opencode-all` starts the standalone TUI from the shell.
- Current-directory sessions appear before other sessions by default.
- Active/Archived/All tabs work; archived sessions sort by archive time.
- Search filters sessions by title/path/agent/model/share URL.
- Directory drill-down works from both the modal and clickable Directory/Workspace fields.
- Back navigation restores previous filter state.
- List and detail panes scroll independently.
- Export sanitized/raw, archive, restore, delete, continue, fork, and refresh actions work.
- Destructive actions confirm before running.
- DB-sourced escape sequences never reach the terminal renderer.
- `scripts/install.sh` installs to XDG defaults and supports custom symlink path.
- `bun test opencode/tools/opencode-all/tests` passes.
