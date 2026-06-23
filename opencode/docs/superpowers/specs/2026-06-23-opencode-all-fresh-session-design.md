# opencode-all: Start Fresh Session in Directory

**Date:** 2026-06-23

**Status:** Approved design, ready for implementation plan

**Owner:** Furaide / OpenCode fleet tooling

**Scope:** This spec covers two areas: (1) the "start a fresh session in directory" UX feature, and (2) approved performance improvements for `opencode-all`. The performance improvements will be implemented after the fresh-session feature.

---

## 1. Goal

Let a user start a brand-new OpenCode session in a directory directly from the `opencode-all` dashboard, without leaving the TUI or typing a shell command.

---

## 2. Background

Today `opencode-all` only continues existing sessions. A user who wants to start work in a project must exit the dashboard and run `opencode <directory>` from a shell. This feature closes that gap.

---

## 3. Requirements

### 3.1 Functional

- In the Active tab, pressing `N` or `Alt+Enter` on a folder row starts a fresh OpenCode session in that folder.
- In the Active tab, pressing `N` or `Alt+Enter` on an active session row starts a fresh session in that session's directory.
- The action is disabled in the Archived tab. Pressing the keys there shows a status message.
- The action uses the OpenCode default agent and model. No agent/model inheritance.
- The action spawns `opencode <directory>` with `stdio: "inherit"`.
- The dashboard suspends its renderer while the child session runs, then resumes and refreshes the index.
- The cursor stays on the same row after the child exits. The new session appears if the folder is expanded.
- If the target directory does not exist, the dashboard shows a status message and does not spawn.
- Add a CLI flag `opencode-all --new <directory>` that validates the directory and spawns `opencode <directory>` directly (no TUI).

### 3.2 Non-Functional

- No confirmation modal. The common case must be one keystroke.
- The feature must not block the main TUI thread when checking directory existence.
- The feature must be testable with mocked `spawn`.

### 3.3 Out of Scope

- Inheriting agent or model from existing sessions.
- Starting sessions from the Archived tab.
- Confirmation modals for directories outside the current working directory.
- Bulk fresh-session creation.
- A `--prompt` or `--agent` override on the new session.

---

## 4. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OpenCode CLI invocation | `opencode <directory>` (positional `project` argument) | Confirmed via `opencode help`. The default command starts the TUI in the given directory. |
| Triggers | `N` and `Alt+Enter` | `N` is a direct mnemonic. `Alt+Enter` mirrors the existing `Enter`-to-open pattern with a modifier. |
| Target inference | Folder row uses `row.directory`; session row uses `session.directory` | The action is semantically "new session in this directory." |
| Tab restriction | Active tab only | Archived sessions are read-only imports in this dashboard. |
| Confirmation | None | The user chose speed over safety for this workflow. |
| Agent/model inheritance | None | Keeps the first implementation simple and avoids surprising model/agent choices. |
| Refresh after exit | Keep cursor, rebuild index | Least surprising return behavior. |
| Directory existence check | `existsSync` before spawn | Cleaner UX than letting OpenCode fail on its own. |
| CLI flag | `opencode-all --new <directory>` | Thin wrapper requested by the user. |

---

## 5. Architecture

### 5.1 New File

`src/session-runner.ts`

Responsibilities:
- Determine the OpenCode binary path from `OPENCODE_ALL_OPENCODE_BIN` or default to `opencode`.
- Suspend and resume the renderer around the child process.
- Write audit log entries.
- Export `runChildSession(renderer, req)` (moved from `tui.tsx`).
- Export `runFreshSession(renderer, directory, spawnImpl?)`.

Shared internal helpers:
- `opencodeBin()`
- `audit(action, target, status)`
- `dataDir()`

### 5.2 Modified Files

- `src/tui.tsx`
  - Import `runChildSession` and `runFreshSession` from `src/session-runner.ts`.
  - Remove the local `runChildSession` function.
  - Add handling for `state.freshDirectory` in the main loop.
  - Parse `--new <directory>` in `main()`.
- `src/dashboard/state.ts`
  - Add `freshDirectory?: string` to `UiState`.
- `src/dashboard/actions.ts`
  - Handle `N` and `Alt+Enter` keys.
  - Infer directory from folder row or session row.
  - Update `actionChips` to show `N new` for folder and active-session rows.
  - Return status messages for missing directory and archived-tab misuse.
- `src/dashboard/render.ts`
  - No structural changes; `actionChips` drives the action bar.
- `README.md`
  - Add keybindings and CLI usage.

### 5.3 Module Boundary

```text
src/tui.tsx           ->  src/session-runner.ts  (spawn logic)
src/dashboard/actions.ts  ->  src/tui.tsx            (via state.freshDirectory)
```

---

## 6. Data Flows

### 6.1 TUI Fresh Session

1. User highlights a folder row or active session row in the Active tab.
2. User presses `N` or `Alt+Enter`.
3. `applyKey` in `src/dashboard/actions.ts` resolves the target directory.
4. If `existsSync(directory)` is false, return state with status `directory not found: <path>`.
5. Set `state.freshDirectory = directory` and status `opening <directory>`.
6. The main loop in `src/tui.tsx` sees `freshDirectory`, clears it, sets `childRunning = true`, and awaits `runFreshSession(renderer, directory)`.
7. `runFreshSession` suspends the renderer, spawns `opencode <directory>` with `stdio: "inherit"`, waits for exit, resumes the renderer, and audits the result.
8. The main loop calls `refreshStateFromDisk(state, "back from session")`.
9. The dashboard shows the same row; the new session appears if the folder is expanded.

### 6.2 CLI `--new` Flag

1. `main(argv)` sees `--new`.
2. Read the next positional argument as `directory`.
3. If `directory` is missing or `existsSync(directory)` is false, print to stderr and exit `1`.
4. Spawn `opencode <directory>` with `stdio: "inherit"`.
5. Exit with the child's exit code.

---

## 7. Keybindings and Action Bar

### 7.1 New Keybindings

| Key | Context | Action |
|-----|---------|--------|
| `N` | Active tab, folder or active session row selected | Start fresh session in that directory |
| `Alt+Enter` | Active tab, folder or active session row selected | Start fresh session in that directory |

### 7.2 Action Bar Chips

- Folder row in Active tab: existing chips plus `N new`.
- Active session row: existing chips plus `N new`.
- Archived tab: no `N` chip.

### 7.3 Status Messages

- `opening /path/to/dir`
- `directory not found: /path/to/dir`
- `new sessions only start from the Active tab`

---

## 8. Error Handling

- Missing directory: checked before spawn in both TUI and CLI paths. No terminal flash.
- Missing OpenCode CLI: catch spawn error, write audit entry `open_session_fresh` with status `error <message>`, resume renderer, dashboard stays usable.
- Signal exit: audit status is `signal <signal>`.
- Non-zero exit: audit status is `exit <code>`.

---

## 9. Testing

- `tests/actions.test.ts`: add cases for `N` and `Alt+Enter` on folder rows, active session rows, archived rows, and missing directories.
- `tests/session-runner.test.ts` (new): mock `spawn` to verify:
  - `runChildSession` still spawns `opencode --session <id> [--fork]`.
  - `runFreshSession` spawns `opencode <directory>`.
  - Missing CLI error path writes audit status `error <message>`.
  - Renderer suspend/resume calls are invoked.
- `tests/tui.test.tsx`: verify `N new` chip appears for folder and active-session rows in the Active tab, and is absent in the Archived tab.
- CLI integration: test `--new <directory>` flag parsing and exists check.

---

## 10. README Updates

Update `opencode/tools/opencode-all/README.md`:

- Features section: add "start fresh session in directory".
- Keybindings table: add `N` and `Alt+Enter` rows in the Active context.
- CLI usage section: add `opencode-all --new <directory>` example.

---

## 11. Verification

After implementation:

1. `bun test` passes.
2. `bunx tsc --noEmit` passes.
3. `bash scripts/test-fixture.sh` smoke test passes.
4. Manual test: open TUI, select a directory, press `N`, confirm OpenCode starts in that directory, exit, confirm dashboard refreshed.

---

## 12. Performance Improvements (Approved for Later Implementation)

This section records performance improvements approved during the same design session. They are out of scope for the fresh-session implementation but will be implemented afterward.

### 12.1 Incremental / Hybrid Session Index

**Status:** Approved, hybrid approach.

**Problem:** `buildSessionIndex` rebuilds the entire session index from scratch on every refresh, re-reading the SQLite DB and every archive file even when nothing changed.

**Approved approach (hybrid):**

1. Cache the full index and invalidate only when the `opencode.db` or archive directory mtime changes. This gives near-instant `R` refreshes when nothing changed.
2. Fetch directory list live from SQLite instead of deriving it from the cached index, so the dashboard renders quickly without waiting for a full rebuild.
3. Cache per-directory session lists with mtime-based invalidation, so expanding a recently viewed folder is instant.
4. Fetch archived sessions lazily: only scan archive files when the user switches to the Archived tab or searches archived sessions.

**Files:** `src/dashboard/session-index.ts`, `src/dashboard/state.ts`, `src/tui.tsx`, `src/dashboard/actions.ts`.

**Rationale:** The current architecture is built around an in-memory index. A pure lazy fetch would require a large refactor. The hybrid keeps the existing structure, removes the biggest repeated cost (full rebuild on every refresh), and bounds memory growth by lazily loading archives.

### 12.2 Archive Metadata Cache

**Status:** Approved.

**Problem:** `listArchivedSessionFiles` reads and parses every `.json` archive file to extract a few metadata fields. Archive files can be large because they contain full message histories.

**Approved approach:**

Maintain a sidecar `.meta` file next to each archive. The meta file contains only `raw.info` (title, directory, timestamps, cost, tokens, summary). On refresh, read only the small meta file. If the meta file is missing or older than the archive, build it from the full archive and write it.

**Files:** `src/db.ts`.

**Rationale:** This is the biggest I/O win for the Archive tab. It is self-invalidating by mtime and requires no changes outside `db.ts`.

### 12.3 Debounce Selection / Metadata Loading

**Status:** Approved.

**Problem:** Every cursor movement (`j`/`k`/`ArrowDown`/`ArrowUp`) triggers `reloadState`, which calls `readRecentMessages` or `readArchivedMessages` on every keypress. Rapid scrolling thrashes the DB and slows the UI.

**Approved approach:**

Split `reloadState` into two phases:

1. **Fast phase** (immediate): update cursor, folder expansion, visible rows. No DB queries.
2. **Slow phase** (debounced): load messages and metadata only after the cursor settles for 150ms.

**Files:** `src/dashboard/state.ts`, `src/tui.tsx`, `tests/state.test.ts`.

**Rationale:** The 150ms debounce window is imperceptible to the user but eliminates most unnecessary queries during rapid scrolling.

### 12.4 Debounce Search Typing

**Status:** Approved, 150ms debounce based on industry research.

**Problem:** Every keystroke in the search box triggers `applyKey` then `reloadState`, which runs the full search/filter on every character.

**Approved approach:**

Update the input field immediately on every keystroke (so the user sees what they typed). Debounce only the search/filter execution by 150ms using `setTimeout`/`clearTimeout`. This is the consensus pattern across TUI libraries: `broll` (150ms), `ink-autocomplete` (150ms), PI agent toolkit (150ms), `irg` (200ms), Nushell explorer (300ms).

**Files:** `src/tui.tsx`, `tests/tui.test.tsx`.

**Rationale:** 150ms is the sweet spot for terminal users who type at 40-60 WPM. Input feels instant; search results appear 150ms after the last keystroke. Over 300ms is universally considered too slow.

### 12.5 Virtualize Session List Rendering

**Status:** Approved.

**Problem:** `buildSessionsContent` renders every row in the visible list, creating O(n) `StyledText` chunks even when the terminal only shows 20-30 rows.

**Approved approach:**

Calculate the visible window from `state.listScroll` and viewport height, then render only that slice plus a small overscroll buffer (2 rows).

**Files:** `src/dashboard/render.ts`, `tests/tui.test.tsx`.

**Rationale:** OpenTUI has fewer objects to lay out and paint. Cursor and scroll logic already track `listScroll`, so this is a natural fit.

### 12.6 Memoize Derived State

**Status:** Approved.

**Problem:** `getVisibleRows`, `searchResultsFor`, and `actionChips` recompute on every render even when their inputs have not changed. These are called from `refreshPanes()` on every keypress, scroll event, and state change.

**Approved approach:**

Add simple string-keyed memoization to each function. Cache result alongside a key built from the inputs that matter. Return cached result if key matches.

**Files:** `src/dashboard/state.ts`, `src/dashboard/actions.ts`, `tests/`.

**Rationale:** No external dependencies. Helps most when the user is scrolling through messages or metadata (sessions list unchanged). Manual cache invalidation is acceptable because mutations already go through explicit action handlers.

### 12.7 Lazy Stream Large Archives

**Status:** Approved.

**Problem:** `readArchivedMessages` loads entire archive files into memory to show the last 4 messages in the metadata pane. Archives with thousands of messages waste memory and time.

**Approved approach:**

For archives above a threshold (1MB), do not read messages at all. Show a placeholder in the metadata pane. Metadata (title, directory, cost, timestamps) comes from the `.meta` sidecar file (improvement #2). A future version could use a streaming JSON parser.

**Files:** `src/db.ts`, `tests/db.test.ts`.

**Rationale:** Combined with the meta sidecar, the metadata pane never needs to parse the full archive. The simple "skip" approach avoids adding a streaming JSON parser dependency.

### 12.8 Move DB/Index Work Off Main Thread

**Status:** Approved.

**Problem:** The main TUI thread handles everything: render UI, handle keypresses, read SQLite, parse archive files. Heavy DB queries or archive scans block the UI.

**Approved approach:**

Create a Bun Worker (`src/workers/index-worker.ts`) that owns the DB connection and index. The main thread sends messages like `{ type: "refresh" }` and receives results asynchronously. `SessionIndex` uses `Map` objects which must be serialized to arrays for transfer.

**Files:** `src/workers/index-worker.ts` (new), `src/tui.tsx`, `src/dashboard/session-index.ts`, `tests/`.

**Rationale:** Main thread never blocks on DB queries or archive scans. UI stays responsive during heavy operations. Prepares the architecture for future features like background index updates.

## 13. Deferred Performance Improvements

The following improvements were discussed but deferred to a later version:

- **Reuse SQLite connection and prepared statements.** Deferred because `opencode-all` does not query the DB frequently enough in normal use to justify the added lifecycle complexity and test hygiene requirements.

## 14. Open Questions / Future Work

- Should the feature inherit the last-used agent/model for a directory? Deferred; start with defaults.
- Should the Archived tab eventually allow starting fresh sessions? Deferred.
- Should `opencode-all --new` support `--agent` or `-m` overrides? Deferred.
