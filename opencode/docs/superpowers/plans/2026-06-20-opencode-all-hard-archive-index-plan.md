# opencode-all Hard Archive And Indexed Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `opencode-all` so Active sessions are sourced from `opencode.db`, Archive sessions are sourced from export files, display reads from an in-memory index, Tab switches Active/Archive, pane focus is mouse-only, hard archive/import/delete actions refresh automatically, and the top panes cannot hide the Sessions pane.

**Architecture:** Treat the OpenCode DB as the Active store and `~/.local/share/opencode/tools/opencode-all/exports/*.json` as the Archive store. Build an in-memory session index at startup, update it after lifecycle actions, and use manual `R` refresh for external changes. Keep expensive IO out of cursor movement and tab switching; only action execution, startup indexing, manual refresh, selected metadata, and selected messages read DB/filesystem.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `@opentui/core`, OpenCode CLI (`opencode export`, `opencode import`, `opencode session delete`), Node `fs` APIs, `bun test`.

---

## Locked Product Decisions

- Hard archive: Archive means raw export to `exports/<id>.json`, then delete the session from `opencode.db` using `opencode session delete <id>`.
- Active source: every session currently in `opencode.db` is Active. `time_archived` is no longer used by `opencode-all`.
- Archive source: every JSON file in the default export directory is an Archived session.
- Import: Import means `opencode import exports/<id>.json`, then delete `exports/<id>.json`.
- Delete Active: `opencode session delete <id>`.
- Delete Archive: delete `exports/<id>.json`.
- Tab key switches Active/Archive tabs. It must not change pane focus.
- Pane focus changes only through mouse click inside a pane. Mouse wheel scrolls the focused/clicked pane.
- Archived sessions cannot be opened directly. They must be imported, then opened from Active.
- Search spans Active and Archive and matches session metadata plus message content. Archived search results cannot be opened directly.
- Messages render as truncated one-line rows.
- Metadata and sessions text wrap. Messages do not wrap.
- `R` manually rebuilds the in-memory index from DB and archive files.

## Current Repository Context

Worktree root:

- `/d/Everything/Furaidē/.worktrees/opencode-all/opencode`

Tool root:

- `/d/Everything/Furaidē/.worktrees/opencode-all/opencode/tools/opencode-all`

Target plan path:

- `/d/Everything/Furaidē/.worktrees/opencode-all/opencode/docs/superpowers/plans/2026-06-20-opencode-all-hard-archive-index-plan.md`

Current important files:

- `opencode/tools/opencode-all/src/tui.tsx`: OpenTUI renderer, resize handling, mouse focus/scroll handlers, CLI entrypoint.
- `opencode/tools/opencode-all/src/db.ts`: SQLite reads, export/import/delete helpers, archived message reads.
- `opencode/tools/opencode-all/src/sanitize.ts`: terminal escape sanitizer.
- `opencode/tools/opencode-all/src/dashboard/state.ts`: `UiState`, folder/session visibility, reload logic.
- `opencode/tools/opencode-all/src/dashboard/actions.ts`: key handling, action chips, confirmations, lifecycle actions.
- `opencode/tools/opencode-all/src/dashboard/render.ts`: StyledText render builders.
- `opencode/tools/opencode-all/src/dashboard/layout.ts`: responsive layout model.
- `opencode/tools/opencode-all/tests/actions.test.ts`: action and key tests.
- `opencode/tools/opencode-all/tests/db.test.ts`: DB and filesystem helper tests.
- `opencode/tools/opencode-all/tests/layout.test.ts`: render and layout tests.
- `opencode/tools/opencode-all/tests/state.test.ts`: state/reload tests.
- `opencode/tools/opencode-all/tests/tui.test.tsx`: OpenTUI integration-ish tests.
- `opencode/tools/opencode-all/tests/sanitize.test.ts`: sanitizer tests.

Fresh baseline before this plan was written:

- `bun test`: 147 pass, 0 fail.
- `OPENCODE_ALL_CWD="/d/Everything/Furaidē" bun src/tui.tsx --list`: passed.
- `bunx tsc --noEmit`: still fails on known upstream `@opentui/core` type issue and existing `string` to `RGBA` errors in `src/dashboard/render.ts`; do not claim typecheck passes until those are fixed separately.

## File Structure After This Plan

Create these files:

- `opencode/tools/opencode-all/src/dashboard/session-index.ts`: in-memory Active/Archive index, index build functions, index update functions, directory grouping, indexed lookup helpers.
- `opencode/tools/opencode-all/tests/session-index.test.ts`: tests for index building, filesystem archive parsing, grouping, action-driven index updates, and manual rebuild behavior.

Modify these files:

- `opencode/tools/opencode-all/src/db.ts`: fix OpenCode CLI command paths; add archive filesystem helpers; remove hard dependency on `time_archived` for list semantics; add hard archive/import/delete primitives; add archived detail reader; add active and archived message search helpers.
- `opencode/tools/opencode-all/src/dashboard/state.ts`: store `SessionIndex` in state; read visible rows from index; add `pendingChoice`; add search result state; remove direct DB/filesystem listing from reload display path.
- `opencode/tools/opencode-all/src/dashboard/actions.ts`: make `Tab` switch Active/Archive; remove keyboard focus cycling; add `R`, `E`, `e`, `D`, `Delete`, `I`, `b`, `Backspace`; add two-step choice overlay; wire hard archive/import/delete actions and index updates; block archived opens.
- `opencode/tools/opencode-all/src/dashboard/render.ts`: render folder labels without counts; render truncated message one-liners; render choice overlay; branch metadata active vs archived; render unified search results with Active/Archive markers; update action bar chips.
- `opencode/tools/opencode-all/src/dashboard/layout.ts`: add max/min height constraints to layout model.
- `opencode/tools/opencode-all/src/tui.tsx`: build index at startup; pass index through state; rebuild on `R`; apply layout constraints; set messages pane `wrapMode: "none"`; keep metadata/sessions wrapping; preserve mouse-only focus.
- `opencode/tools/opencode-all/tests/actions.test.ts`: update key/action expectations and lifecycle tests.
- `opencode/tools/opencode-all/tests/db.test.ts`: add command-path tests and archive filesystem helper tests.
- `opencode/tools/opencode-all/tests/layout.test.ts`: add layout constraint and choice overlay render tests.
- `opencode/tools/opencode-all/tests/state.test.ts`: update state tests to use `SessionIndex`.
- `opencode/tools/opencode-all/tests/tui.test.tsx`: update Tab/focus/layout/render tests.
- `opencode/tools/opencode-all/package.json`: add `test:index` script.

Do not modify in this plan:

- `opencode/tools/opencode-all/src/sanitize.ts`, unless a new test proves an archive parsing path is missing sanitizer coverage.
- `opencode/tools/opencode-all/themes/friday.json`, unless render tests reveal a missing token.
- Git history. Any commit/push/PR operations must be delegated to `hanko--git-seal` only after user approval.

## Implementation Invariants

- No action may update the in-memory index before its backing operation succeeds.
- If action step 1 succeeds and step 2 fails, return a status that names the partial state and do not lie through the index.
- Hard archive failure modes:
  - Export fails: DB row remains Active, no index change.
  - Export succeeds, delete fails: DB row remains Active and archive file exists. Status must say `archive exported but delete failed`. Index keeps session Active and must not add Archived.
  - Export succeeds, delete succeeds: remove Active index entry, add Archived index entry.
- Import failure modes:
  - Import fails: file remains Archived, no index change.
  - Import succeeds, file removal fails: DB row is Active and file remains Archived. Status must say `imported but archive file removal failed`; index should add Active and keep Archived to reflect actual duplicate state.
  - Import succeeds, file removal succeeds: remove Archived index entry, add Active index entry.
- Active delete failure: keep Active index unchanged.
- Archived delete failure: keep Archived index unchanged.
- Archived sessions cannot be opened from rows or search results.
- Backspace is back only in normal mode. In search mode Backspace edits the search query.
- `Esc` cancels `pendingChoice`, then `pendingAction`, then search/input mode, then back/root.

---

## Task 1: Add Test Fixtures For Hard Archive Files And Indexing

**Files:**

- Create: `opencode/tools/opencode-all/tests/session-index.test.ts`
- Modify: `opencode/tools/opencode-all/tests/db.test.ts`
- Modify: `opencode/tools/opencode-all/package.json`

- [ ] **Step 1: Add `test:index` script**

Modify `opencode/tools/opencode-all/package.json` scripts to include:

```json
{
  "scripts": {
    "test": "bun test tests",
    "test:sanitize": "bun test tests/sanitize.test.ts",
    "test:db": "bun test tests/db.test.ts",
    "test:tui": "bun test tests/tui.test.tsx",
    "test:index": "bun test tests/session-index.test.ts",
    "install:local": "bash scripts/install.sh"
  }
}
```

Keep all existing keys and only add `test:index`.

- [ ] **Step 2: Create `tests/session-index.test.ts` with failing index tests**

Create `opencode/tools/opencode-all/tests/session-index.test.ts` with:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  buildSessionIndex,
  removeActiveFromIndex,
  removeArchivedFromIndex,
  addActiveToIndex,
  addArchivedToIndex,
  rowsForTab,
  directoriesForTab,
  type SessionIndex,
} from "../src/dashboard/session-index.ts";

const root = join(import.meta.dir, ".tmp-session-index");
const dbPath = join(root, "opencode.db");
const archiveRoot = join(root, "exports");

function createDb(): void {
  mkdirSync(root, { recursive: true });
  const db = new Database(dbPath);
  db.run(`CREATE TABLE session (
    id TEXT PRIMARY KEY,
    title TEXT,
    directory TEXT,
    path TEXT,
    agent TEXT,
    model TEXT,
    share_url TEXT,
    cost REAL,
    tokens_input INTEGER,
    tokens_output INTEGER,
    time_created INTEGER,
    time_updated INTEGER,
    time_archived INTEGER,
    parent_id TEXT
  )`);
  db.run(`INSERT INTO session VALUES
    ('ses_active_1','Active One','/repo/a','','build','model-a','',1.5,10,20,1000,2000,NULL,NULL),
    ('ses_active_2','Active Two','/repo/b','','plan','model-b','',2.5,30,40,1100,2100,NULL,NULL)
  `);
  db.close();
}

function writeArchive(id: string, directory: string, title = "Archived One"): void {
  mkdirSync(archiveRoot, { recursive: true });
  writeFileSync(join(archiveRoot, `${id}.json`), JSON.stringify({
    info: {
      id,
      title,
      directory,
      path: "",
      agent: "build",
      model: "model-archive",
      share: { url: "" },
      cost: 3.5,
      tokens: { input: 50, output: 60, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1200, updated: 2200 },
      summary: { files: 2, additions: 3, deletions: 4 },
    },
    messages: [
      { info: { role: "user", time: { created: 1300 } }, parts: [{ type: "text", text: "archived user text" }] },
      { info: { role: "assistant", time: { created: 1400 } }, parts: [{ type: "text", text: "archived assistant text" }] },
    ],
  }));
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  createDb();
  writeArchive("ses_archived_1", "/repo/a");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildSessionIndex", () => {
  test("loads active sessions from DB and archived sessions from export files", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    expect(index.active.has("ses_active_1")).toBe(true);
    expect(index.active.has("ses_active_2")).toBe(true);
    expect(index.archived.has("ses_archived_1")).toBe(true);
    expect(index.active.has("ses_archived_1")).toBe(false);
    expect(index.archived.has("ses_active_1")).toBe(false);
  });

  test("groups directories separately for active and archived tabs", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    expect(directoriesForTab(index, "active").map(d => d.directory)).toEqual(["/repo/a", "/repo/b"]);
    expect(directoriesForTab(index, "archived").map(d => d.directory)).toEqual(["/repo/a"]);
  });

  test("rowsForTab returns only current tab sessions", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    expect(rowsForTab(index, "active").map(s => s.id)).toEqual(["ses_active_2", "ses_active_1"]);
    expect(rowsForTab(index, "archived").map(s => s.id)).toEqual(["ses_archived_1"]);
  });
});

describe("index updates", () => {
  test("removeActiveFromIndex removes active row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    removeActiveFromIndex(index, "ses_active_1");
    expect(index.active.has("ses_active_1")).toBe(false);
    expect(index.activeByDir.get("/repo/a")?.has("ses_active_1")).toBe(false);
  });

  test("addArchivedToIndex adds archived row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    const row = index.active.get("ses_active_1");
    if (!row) throw new Error("missing test row");
    addArchivedToIndex(index, { ...row, timeArchived: 9999 });
    expect(index.archived.has("ses_active_1")).toBe(true);
    expect(index.archivedByDir.get("/repo/a")?.has("ses_active_1")).toBe(true);
  });

  test("removeArchivedFromIndex removes archived row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    removeArchivedFromIndex(index, "ses_archived_1");
    expect(index.archived.has("ses_archived_1")).toBe(false);
    expect(index.archivedByDir.get("/repo/a")?.has("ses_archived_1")).toBe(false);
  });

  test("addActiveToIndex adds active row and directory group entry", () => {
    const index = buildSessionIndex({ dbPath, archiveRoot, cwd: "/repo" });
    const row = index.archived.get("ses_archived_1");
    if (!row) throw new Error("missing archived test row");
    addActiveToIndex(index, { ...row, timeArchived: null });
    expect(index.active.has("ses_archived_1")).toBe(true);
    expect(index.activeByDir.get("/repo/a")?.has("ses_archived_1")).toBe(true);
  });
});
```

- [ ] **Step 3: Add failing DB helper tests for real CLI command paths**

Append this block to `opencode/tools/opencode-all/tests/db.test.ts`. Use `process.env.OPENCODE_ALL_OPENCODE_BIN` to point at a test shell script so no real OpenCode command runs.

```typescript
describe("hard archive CLI helpers", () => {
  test("exportSessionToFile calls top-level opencode export and writes stdout to archive file", () => {
    process.env.XDG_DATA_HOME = root;
    const bin = join(root, "fake-opencode-export.sh");
    writeFileSync(bin, `#!/usr/bin/env bash\nif [ "$1" != "export" ]; then echo "bad command: $*" >&2; exit 9; fi\nif [ "$2" != "ses_safe" ]; then echo "bad id: $2" >&2; exit 8; fi\nprintf '{"info":{"id":"ses_safe","title":"Safe","directory":"/repo"},"messages":[]}'\n`, { mode: 0o755 });
    process.env.OPENCODE_ALL_OPENCODE_BIN = bin;

    const res = exportSessionToFile("ses_safe");
    expect(res.ok).toBe(true);
    expect(readFileSync(defaultArchivePath("ses_safe"), "utf8")).toContain('"id":"ses_safe"');

    delete process.env.OPENCODE_ALL_OPENCODE_BIN;
    delete process.env.XDG_DATA_HOME;
  });

  test("importSessionFromFile calls top-level opencode import", () => {
    process.env.XDG_DATA_HOME = root;
    const file = defaultArchivePath("ses_safe");
    mkdirSync(join(root, "opencode", "tools", "opencode-all", "exports"), { recursive: true });
    writeFileSync(file, JSON.stringify({ info: { id: "ses_safe" }, messages: [] }));
    const bin = join(root, "fake-opencode-import.sh");
    writeFileSync(bin, `#!/usr/bin/env bash\nif [ "$1" != "import" ]; then echo "bad command: $*" >&2; exit 9; fi\nif [ "$2" != "${file}" ]; then echo "bad file: $2" >&2; exit 8; fi\nexit 0\n`, { mode: 0o755 });
    process.env.OPENCODE_ALL_OPENCODE_BIN = bin;

    const res = importSessionFromFile("ses_safe");
    expect(res.ok).toBe(true);

    delete process.env.OPENCODE_ALL_OPENCODE_BIN;
    delete process.env.XDG_DATA_HOME;
  });
});
```

Add `readFileSync` to the existing `node:fs` import in `tests/db.test.ts`:

```typescript
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

Add `exportSessionToFile` and `importSessionFromFile` to the existing `../src/db.ts` import.

- [ ] **Step 4: Run failing tests**

Run:

```bash
bun test tests/session-index.test.ts tests/db.test.ts
```

Expected before implementation:

- `tests/session-index.test.ts` fails because `src/dashboard/session-index.ts` does not exist.
- `tests/db.test.ts` fails because export/import helpers still call the old `opencode session export/import` paths.

If a different failure appears, read the failure and adjust only the test fixture if the fixture is wrong.

---

## Task 2: Implement Session Index Core

**Files:**

- Create: `opencode/tools/opencode-all/src/dashboard/session-index.ts`
- Modify: `opencode/tools/opencode-all/src/db.ts`
- Test: `opencode/tools/opencode-all/tests/session-index.test.ts`

- [ ] **Step 1: Add DB/archive row helpers to `src/db.ts`**

Add these exports near the existing archive path helpers in `opencode/tools/opencode-all/src/db.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
```

Replace the current `node:fs` import, keeping all existing symbols and adding `readdirSync` and `writeFileSync`.

Add this exported helper after `defaultArchivePath`:

```typescript
export function defaultArchiveRoot(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all", "exports");
}
```

Add this type after `SessionRow`:

```typescript
export type ArchiveFileRow = SessionRow & {
  archivePath: string;
  archiveBytes: number;
};
```

Add this parser after `toRow`:

```typescript
export function archiveInfoToRow(raw: any, archivePath: string, cwdValue: string, archiveTime: number): ArchiveFileRow | null {
  const info = raw?.info;
  if (!info || typeof info !== "object") return null;
  const id = String(info.id || "");
  if (!isSafeSessionId(id)) return null;
  const title = renderSafe(info.title || id);
  const directory = renderSafe(info.directory || "");
  const path = renderSafe(info.path || "");
  const agent = renderSafe(info.agent || "");
  const model = renderSafe(typeof info.model === "string" ? info.model : JSON.stringify(info.model || ""));
  const tokens = info.tokens || {};
  const cache = tokens.cache || {};
  const summary = info.summary || {};
  const stats = statSync(archivePath);
  return {
    id,
    title: capText(title, 240),
    directory: capText(directory, 300),
    path: capText(path, 300),
    agent: capText(agent, 80),
    model: capText(model, 160),
    shareUrl: "",
    cost: Number(info.cost || 0),
    tokensInput: Number(tokens.input || 0),
    tokensOutput: Number(tokens.output || 0),
    timeCreated: Number(info.time?.created || 0),
    timeUpdated: Number(info.time?.updated || 0),
    timeArchived: archiveTime || Math.trunc(stats.mtimeMs),
    isCurrent: directory.startsWith(cwdValue) || path.startsWith(cwdValue),
    suspicious: [info.title, info.directory, info.path, info.agent, info.model].some(hasControlBytes),
    archivePath,
    archiveBytes: stats.size,
  };
}
```

Add this filesystem scanner after `readArchivedMessages`:

```typescript
export function listArchivedSessionFiles(options: { archiveRoot?: string; cwd?: string } = {}): ArchiveFileRow[] {
  const root = options.archiveRoot || defaultArchiveRoot();
  if (!existsSync(root)) return [];
  const cwdValue = options.cwd || process.env.OPENCODE_ALL_CWD || process.cwd();
  const rows: ArchiveFileRow[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!isSafeSessionId(id)) continue;
    const file = join(root, name);
    try {
      const stats = statSync(file);
      if (stats.size > MAX_ARCHIVE_BYTES) continue;
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const row = archiveInfoToRow(raw, file, cwdValue, Math.trunc(stats.mtimeMs));
      if (row) rows.push(row);
    } catch {
      continue;
    }
  }
  return rows.sort((a, b) => b.timeArchived! - a.timeArchived! || b.timeUpdated - a.timeUpdated);
}
```

- [ ] **Step 2: Create `src/dashboard/session-index.ts`**

Create `opencode/tools/opencode-all/src/dashboard/session-index.ts` with:

```typescript
import type { DirectoryRow, SessionRow, Tab } from "../db.ts";
import { listArchivedSessionFiles, listSessions } from "../db.ts";

export type SessionIndex = {
  active: Map<string, SessionRow>;
  archived: Map<string, SessionRow>;
  activeByDir: Map<string, Set<string>>;
  archivedByDir: Map<string, Set<string>>;
};

export type BuildSessionIndexOptions = {
  dbPath?: string;
  archiveRoot?: string;
  cwd: string;
};

function emptyIndex(): SessionIndex {
  return {
    active: new Map(),
    archived: new Map(),
    activeByDir: new Map(),
    archivedByDir: new Map(),
  };
}

function addToGroup(group: Map<string, Set<string>>, row: SessionRow): void {
  const set = group.get(row.directory) || new Set<string>();
  set.add(row.id);
  group.set(row.directory, set);
}

function removeFromGroup(group: Map<string, Set<string>>, row: SessionRow): void {
  const set = group.get(row.directory);
  if (!set) return;
  set.delete(row.id);
  if (set.size === 0) group.delete(row.directory);
}

export function addActiveToIndex(index: SessionIndex, row: SessionRow): void {
  index.active.set(row.id, { ...row, timeArchived: null });
  addToGroup(index.activeByDir, { ...row, timeArchived: null });
}

export function addArchivedToIndex(index: SessionIndex, row: SessionRow): void {
  index.archived.set(row.id, { ...row, timeArchived: row.timeArchived ?? Date.now() });
  addToGroup(index.archivedByDir, { ...row, timeArchived: row.timeArchived ?? Date.now() });
}

export function removeActiveFromIndex(index: SessionIndex, id: string): SessionRow | undefined {
  const row = index.active.get(id);
  if (!row) return undefined;
  index.active.delete(id);
  removeFromGroup(index.activeByDir, row);
  return row;
}

export function removeArchivedFromIndex(index: SessionIndex, id: string): SessionRow | undefined {
  const row = index.archived.get(id);
  if (!row) return undefined;
  index.archived.delete(id);
  removeFromGroup(index.archivedByDir, row);
  return row;
}

export function buildSessionIndex(options: BuildSessionIndexOptions): SessionIndex {
  const index = emptyIndex();
  const active = listSessions({ tab: "active", cwd: options.cwd, dbPath: options.dbPath });
  for (const row of active) addActiveToIndex(index, row);
  const archived = listArchivedSessionFiles({ archiveRoot: options.archiveRoot, cwd: options.cwd });
  for (const row of archived) addArchivedToIndex(index, row);
  return index;
}

export function rowsForTab(index: SessionIndex, tab: Tab, directory?: string, query = ""): SessionRow[] {
  const source = tab === "active" ? index.active : index.archived;
  const lower = query.trim().toLowerCase();
  return [...source.values()]
    .filter(row => !directory || row.directory === directory)
    .filter(row => !lower || [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].some(value => value.toLowerCase().includes(lower)))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.timeUpdated - a.timeUpdated);
}

export function directoriesForTab(index: SessionIndex, tab: Tab): DirectoryRow[] {
  const group = tab === "active" ? index.activeByDir : index.archivedByDir;
  const source = tab === "active" ? index.active : index.archived;
  return [...group.entries()]
    .map(([directory, ids]) => {
      let latestUpdated = 0;
      for (const id of ids) latestUpdated = Math.max(latestUpdated, source.get(id)?.timeUpdated || 0);
      return {
        directory,
        active: tab === "active" ? ids.size : 0,
        archived: tab === "archived" ? ids.size : 0,
        latestUpdated,
      };
    })
    .sort((a, b) => b.latestUpdated - a.latestUpdated || a.directory.localeCompare(b.directory));
}
```

- [ ] **Step 3: Run index tests**

Run:

```bash
bun test tests/session-index.test.ts
```

Expected after implementation:

- 7 pass, 0 fail.

If row ordering differs because `timeUpdated` sort changed, keep descending `timeUpdated` for rows and update only expectations that prove the intended stable ordering.

---

## Task 3: Fix Hard Archive CLI Helpers

**Files:**

- Modify: `opencode/tools/opencode-all/src/db.ts`
- Test: `opencode/tools/opencode-all/tests/db.test.ts`

- [ ] **Step 1: Replace `exportSessionToFile` implementation**

In `opencode/tools/opencode-all/src/db.ts`, replace the current `exportSessionToFile` with:

```typescript
export function exportSessionToFile(id: string): { ok: boolean; code: number; stderr: string } {
  if (!isSafeSessionId(id)) return invalidCliResult(id);
  const file = defaultArchivePath(id);
  mkdirSync(dirname(file), { recursive: true });
  const result = spawnSync(opencodeBin(), ["export", id], { stdio: ["ignore", "pipe", "pipe"] });
  if (result.status === 0) {
    writeFileSync(file, result.stdout || Buffer.from(""), { mode: 0o600 });
  }
  return { ok: result.status === 0, code: result.status ?? 1, stderr: (result.stderr || "").toString() };
}
```

Remove the `raw = false` parameter from the signature and update call sites in later tasks.

- [ ] **Step 2: Replace `importSessionFromFile` implementation**

Replace the current `importSessionFromFile` with:

```typescript
export function importSessionFromFile(id: string): { ok: boolean; code: number; stderr: string } {
  if (!isSafeSessionId(id)) return invalidCliResult(id);
  const file = defaultArchivePath(id);
  if (!existsSync(file)) {
    return { ok: false, code: -1, stderr: `archive file not found at ${file}` };
  }
  const result = spawnSync(opencodeBin(), ["import", file], { stdio: "pipe" });
  return { ok: result.status === 0, code: result.status ?? 1, stderr: (result.stderr || "").toString() };
}
```

- [ ] **Step 3: Keep `deleteSessionById` unchanged**

Confirm this existing implementation remains:

```typescript
export function deleteSessionById(id: string): { ok: boolean; code: number; stderr: string } {
  if (!isSafeSessionId(id)) return invalidCliResult(id);
  const result = spawnSync(opencodeBin(), ["session", "delete", id], { stdio: "pipe" });
  return { ok: result.status === 0, code: result.status ?? 1, stderr: (result.stderr || "").toString() };
}
```

- [ ] **Step 4: Run DB tests**

Run:

```bash
bun test tests/db.test.ts
```

Expected:

- All DB tests pass, including the new hard archive CLI helper tests.

---

## Task 4: Refactor State To Use SessionIndex

**Files:**

- Modify: `opencode/tools/opencode-all/src/dashboard/state.ts`
- Modify: `opencode/tools/opencode-all/tests/state.test.ts`

- [ ] **Step 1: Update `UiState` type**

In `src/dashboard/state.ts`, import the index helpers:

```typescript
import type { SessionIndex } from "./session-index.ts";
import { directoriesForTab, rowsForTab } from "./session-index.ts";
```

Add `index` and `pendingChoice` fields to `UiState`:

```typescript
type PendingChoice = "archive_or_delete" | "delete_or_import" | null;

export type UiState = {
  index: SessionIndex;
  folders: DirectoryRow[];
  allSessions: UiSession[];
  sessions: UiSession[];
  expandedFolders: Set<string>;
  cursor: number;
  listScroll: number;
  detailScroll: number;
  messageScroll: number;
  tab: Tab;
  inputMode: InputMode;
  query: string;
  directory?: string;
  sort: "updated" | "created" | "cost" | "title" | "recency";
  stack: Array<Pick<UiState, "cursor" | "listScroll" | "tab" | "query" | "directory" | "sort" | "expandedFolders">>;
  viewport: Viewport;
  status: string;
  pendingAction: PendingAction;
  pendingChoice: PendingChoice;
  pendingDirectory?: string;
  pendingCount?: number;
  searchSelected: number;
  searchScroll: number;
  focus: PaneFocus;
  messageRows: ArchivedMessageRow[];
};
```

- [ ] **Step 2: Change `createInitialState` signature**

Replace the current `createInitialState(sessions, viewport)` with:

```typescript
export function createInitialState(index: SessionIndex, viewport: Viewport): UiState {
  const folders = sortFolders(directoriesForTab(index, "active"), cwd());
  const sessions = rowsForTab(index, "active");
  return {
    index,
    folders,
    allSessions: [...index.active.values(), ...index.archived.values()],
    sessions,
    expandedFolders: new Set<string>(),
    cursor: 0,
    listScroll: 0,
    detailScroll: 0,
    messageScroll: 0,
    tab: "active",
    inputMode: null,
    query: "",
    sort: "updated",
    stack: [],
    viewport,
    status: "ready",
    pendingAction: null,
    pendingChoice: null,
    searchSelected: 0,
    searchScroll: 0,
    focus: "sessions",
    messageRows: [],
  };
}
```

- [ ] **Step 3: Replace `reloadState` data loading**

Replace `reloadState` with:

```typescript
export function reloadState(state: UiState): UiState {
  const baseCwd = cwd();
  let folders = sortFolders(directoriesForTab(state.index, state.tab), baseCwd);
  if (state.inputMode === "search" && state.query) {
    folders = folders.filter(row => row.directory.toLowerCase().includes(state.query.toLowerCase()));
  }
  const sessions = rowsForTab(state.index, state.tab, state.directory, state.query);
  const visible = getVisibleRows({ ...state, folders, sessions });
  const cursor = Math.min(state.cursor, Math.max(0, visible.length - 1));
  const nextBase = { ...state, folders, sessions, cursor };
  const selected = selectedVisibleSession(nextBase);
  let messageRows: ArchivedMessageRow[] = [];
  if (selected) {
    messageRows = state.tab === "active"
      ? readRecentMessages(selected.id)
      : readArchivedMessages(selected.id);
  }
  return {
    ...state,
    folders,
    sessions,
    allSessions: [...state.index.active.values(), ...state.index.archived.values()],
    cursor,
    listScroll: Math.min(state.listScroll, cursor),
    messageRows,
    messageScroll: 0,
  };
}
```

- [ ] **Step 4: Update state tests to build an index**

In `tests/state.test.ts`, replace direct `createInitialState(sessions, vp)` calls with a test helper:

```typescript
import { addActiveToIndex, addArchivedToIndex, type SessionIndex } from "../src/dashboard/session-index.ts";

function makeIndex(rows = sessions): SessionIndex {
  const index: SessionIndex = {
    active: new Map(),
    archived: new Map(),
    activeByDir: new Map(),
    archivedByDir: new Map(),
  };
  for (const row of rows) {
    if (row.timeArchived == null) addActiveToIndex(index, row);
    else addArchivedToIndex(index, row);
  }
  return index;
}

function makeState(rows = sessions): UiState {
  return createInitialState(makeIndex(rows), vp);
}
```

Then replace:

```typescript
createInitialState(sessions, vp)
```

with:

```typescript
makeState()
```

- [ ] **Step 5: Run state tests**

Run:

```bash
bun test tests/state.test.ts tests/session-index.test.ts
```

Expected:

- State and index tests pass.

---

## Task 5: Implement Layout Constraints And Resize Semantics

**Files:**

- Modify: `opencode/tools/opencode-all/src/dashboard/layout.ts`
- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Modify: `opencode/tools/opencode-all/tests/layout.test.ts`
- Modify: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Extend layout model**

Replace `DashboardLayout` in `src/dashboard/layout.ts` with:

```typescript
export type DashboardLayout = {
  mode: DashboardMode;
  topPercent: number;
  sessionsPercent: number;
  actionRows: number;
  topSplit: TopSplit;
  topMaxHeight: `${number}%`;
  sessionsMinHeight: `${number}%`;
};
```

Replace `dashboardLayout` returns with:

```typescript
export function dashboardLayout(width: number, height: number): DashboardLayout {
  if (width < 82 || height < 22) {
    return { mode: "focused", topPercent: 0, sessionsPercent: 0, actionRows: 1, topSplit: "focused", topMaxHeight: "55%", sessionsMinHeight: "30%" };
  }
  if (width < 110 || height < 30) {
    return { mode: "medium", topPercent: 1, sessionsPercent: 1, actionRows: 2, topSplit: "half", topMaxHeight: "55%", sessionsMinHeight: "30%" };
  }
  return { mode: "wide", topPercent: 1, sessionsPercent: 1, actionRows: 2, topSplit: "half", topMaxHeight: "55%", sessionsMinHeight: "30%" };
}
```

- [ ] **Step 2: Apply layout constraints in `tui.tsx`**

In `rebuildLayout`, replace the non-focused top row and sessions row options with:

```typescript
const topRow = Box({ flexDirection: "row", flexGrow: layout.topPercent, maxHeight: layout.topMaxHeight },
  Box({ flexDirection: "column", flexGrow: 1, border: true, borderColor: tone(state.focus === "messages" ? "listBorderFocus" : "listBorder"), backgroundColor: tone("surface"), title: "Messages" } as any, messagesScroll),
  Box({ flexDirection: "column", flexGrow: 1, border: true, borderColor: tone(state.focus === "metadata" ? "listBorderFocus" : "detailBorder"), backgroundColor: tone("surface"), title: "Metadata" } as any, metadataScroll),
);
const sRow = Box({ flexDirection: "column", flexGrow: layout.sessionsPercent, minHeight: layout.sessionsMinHeight, border: true, borderColor: tone(state.focus === "sessions" ? "listBorderFocus" : "listBorder"), backgroundColor: tone("surface"), title: "Sessions" } as any, sessionsScroll);
```

Keep `onResize` unchanged because it already calls `rebuildLayout`, `refreshPanes`, and `renderer.requestRender`.

- [ ] **Step 3: Set per-pane wrap modes**

Change `makeScrollPane` signature in `tui.tsx`:

```typescript
function makeScrollPane(
  paneRenderer: CliRenderer,
  id: string,
  content: StyledText,
  focus: "messages" | "metadata" | "sessions",
  wrapMode: "none" | "word" = "word",
) {
  const text = new TextRenderable(paneRenderer, { id: `${id}-text`, wrapMode, truncate: wrapMode === "none", content });
```

Update pane creation:

```typescript
const { scrollBox: messagesScroll, text: messagesText } = makeScrollPane(renderer, "messages", buildMessagesContent(state), "messages", "none");
const { scrollBox: metadataScroll, text: metadataText } = makeScrollPane(renderer, "metadata", buildMetadataContent(state), "metadata", "word");
const { scrollBox: sessionsScroll, text: sessionsText } = makeScrollPane(renderer, "sessions", buildSessionsContent(state), "sessions", "word");
```

- [ ] **Step 4: Update layout tests**

In `tests/layout.test.ts`, update the wide/medium layout expectations:

```typescript
expect(layout.topMaxHeight).toBe("55%");
expect(layout.sessionsMinHeight).toBe("30%");
expect(layout.actionRows).toBe(2);
```

Add this test:

```typescript
test("dashboardLayout includes resize-safe top max and sessions min constraints", () => {
  for (const [width, height] of [[120, 40], [100, 28], [80, 20]] as const) {
    const layout = dashboardLayout(width, height);
    expect(layout.topMaxHeight).toBe("55%");
    expect(layout.sessionsMinHeight).toBe("30%");
  }
});
```

- [ ] **Step 5: Run layout/TUI tests**

Run:

```bash
bun test tests/layout.test.ts tests/tui.test.tsx
```

Expected:

- Layout and TUI tests pass after updating expected action row count and pane construction assumptions.

---

## Task 6: Update Rendering For Folder Labels, Messages, Archived Metadata, And Choice Overlay

**Files:**

- Modify: `opencode/tools/opencode-all/src/dashboard/render.ts`
- Modify: `opencode/tools/opencode-all/src/db.ts`
- Modify: `opencode/tools/opencode-all/tests/layout.test.ts`

- [ ] **Step 1: Add archived detail reader to `db.ts`**

Add after `readArchivedMessages`:

```typescript
export function getArchivedSessionDetail(id: string): (SessionDetail & { archivePath?: string; archiveBytes?: number }) | null {
  if (!isSafeSessionId(id)) return null;
  const file = defaultArchivePath(id);
  if (!existsSync(file)) return null;
  try {
    const stats = statSync(file);
    if (stats.size > MAX_ARCHIVE_BYTES) return null;
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const row = archiveInfoToRow(raw, file, process.env.OPENCODE_ALL_CWD || process.cwd(), Math.trunc(stats.mtimeMs));
    if (!row) return null;
    const messages = Array.isArray(raw?.messages) ? raw.messages.length : 0;
    return {
      ...row,
      messages,
      diffPath: null,
      diffBytes: null,
      partCounts: {},
      toolCounts: [],
      recentText: readArchivedMessages(id, 4).map(m => ({ role: m.role, timeCreated: m.time, text: m.text })),
      tokensReasoning: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      summaryFiles: Number(raw?.info?.summary?.files || 0),
      summaryAdditions: Number(raw?.info?.summary?.additions || 0),
      summaryDeletions: Number(raw?.info?.summary?.deletions || 0),
      archivePath: file,
      archiveBytes: stats.size,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Branch metadata rendering**

In `render.ts`, import `getArchivedSessionDetail`:

```typescript
import { getArchivedSessionDetail, getSessionDetail } from "../db.ts";
```

Replace `selectedDetail` with:

```typescript
export function selectedDetail(state: UiState): (SessionDetail & { archivePath?: string; archiveBytes?: number }) | null {
  const selected = currentSession(state);
  if (!selected) return null;
  return state.tab === "archived"
    ? getArchivedSessionDetail(selected.id)
    : getSessionDetail({ id: selected.id, cwd: cwd() });
}
```

In `buildMetadataContent`, after the `time` line, add archive-specific file info:

```typescript
if (state.tab === "archived" && "archivePath" in d) {
  chunks.push({ text: `archive file: ${d.archivePath || "-"}\n`, fg: tone("detailValue") });
  chunks.push({ text: `archive bytes: ${d.archiveBytes || 0}\n`, fg: tone("detailTokens") });
}
```

Only render diff path for Active:

```typescript
if (state.tab === "active") {
  chunks.push({ text: `📎 ${d.diffPath ? `${d.diffPath} (${d.diffBytes || 0}b)` : "-"}\n`, fg: tone("detailValue") });
}
```

- [ ] **Step 3: Remove folder counts**

In `buildSessionsContent`, replace folder label creation with:

```typescript
const label = `${marker}${cwdMark}${prefix} ${dir.directory}`;
```

Do not render `(${dir.active} active, ${dir.archived} archived)`.

- [ ] **Step 4: Render truncated message one-liners**

In `buildMessagesContent`, replace the message loop with:

```typescript
const rowWidth = Math.max(20, state.viewport.width - 12);
for (const m of visible) {
  const prefix = m.role === "user" ? "U" : "A";
  const text = clip(m.text.replace(/\s+/g, " ").trim(), rowWidth);
  chunks.push({
    text: `${formatTime(m.time).slice(0, 5)} ${prefix} ${text}\n`,
    fg: m.role === "user" ? tone("cyan") : tone("text"),
  });
}
```

- [ ] **Step 5: Add choice overlay render builder**

Add to `render.ts`:

```typescript
export function buildChoiceOverlay(state: UiState): StyledText {
  const chunks: TextChunk[] = [];
  if (!state.pendingChoice) return new StyledText(chunks);
  const boxWidth = Math.max(60, Math.min(100, state.viewport.width - 6));
  const inner = boxWidth - 4;
  const selected = currentSession(state);
  const title = state.pendingChoice === "archive_or_delete" ? "CHOOSE ACTION" : "IMPORT OR DELETE";
  chunks.push({ text: "┌" + "─".repeat(boxWidth - 2) + "┐\n", fg: tone("modalBorder") });
  chunks.push({ text: `│ ${clip(title, inner).padEnd(inner)} │\n`, fg: tone("modalFg"), bg: tone("modalBg"), bold: true });
  chunks.push({ text: `│ ${clip(selected ? `For ${selected.title} (${selected.id})` : `For ${state.pendingDirectory || "selected directory"}`, inner).padEnd(inner)} │\n`, fg: tone("detailValue"), bg: tone("modalBg") });
  if (state.pendingChoice === "archive_or_delete") {
    chunks.push({ text: `│ ${clip("[a] archive/export + remove from DB", inner).padEnd(inner)} │\n`, fg: tone("accent"), bg: tone("modalBg"), bold: true });
    chunks.push({ text: `│ ${clip("[d] delete permanently", inner).padEnd(inner)} │\n`, fg: tone("danger"), bg: tone("modalBg"), bold: true });
  } else {
    chunks.push({ text: `│ ${clip("[i] import to Active", inner).padEnd(inner)} │\n`, fg: tone("accent"), bg: tone("modalBg"), bold: true });
    chunks.push({ text: `│ ${clip("[d] delete archive file", inner).padEnd(inner)} │\n`, fg: tone("danger"), bg: tone("modalBg"), bold: true });
  }
  chunks.push({ text: `│ ${clip("[Esc] cancel", inner).padEnd(inner)} │\n`, fg: tone("dim"), bg: tone("modalBg") });
  chunks.push({ text: "└" + "─".repeat(boxWidth - 2) + "┘\n", fg: tone("modalBorder") });
  return new StyledText(chunks);
}
```

- [ ] **Step 6: Add render tests**

In `tests/layout.test.ts`, add tests:

```typescript
test("buildSessionsContent renders folder labels without active/archive counts", () => {
  const state = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
  const text = flatText(buildSessionsContent(state));
  expect(text).toContain("/repo/current");
  expect(text).not.toContain("active,");
  expect(text).not.toContain("archived)");
});

test("buildMessagesContent renders truncated one-line messages", () => {
  const state = {
    ...createInitialState(makeIndex(sessions), { height: 20, width: 40 }),
    messageRows: [{ role: "user" as const, time: 1000, text: "this is a very long user message that should be clipped to one row only" }],
  };
  const text = flatText(buildMessagesContent(state));
  expect(text).toContain("00:01 U");
  expect(text.split("\n").filter(Boolean)).toHaveLength(1);
});
```

Also import `buildChoiceOverlay` and add:

```typescript
test("buildChoiceOverlay renders archive/delete choices", () => {
  const state = { ...createInitialState(makeIndex(sessions), { height: 20, width: 100 }), pendingChoice: "archive_or_delete" as const };
  const text = flatText(buildChoiceOverlay(state));
  expect(text).toContain("[a] archive");
  expect(text).toContain("[d] delete");
});
```

- [ ] **Step 7: Run layout tests**

Run:

```bash
bun test tests/layout.test.ts
```

Expected:

- Layout tests pass.

---

## Task 7: Rework Actions For Tab Switching, Mouse-Only Focus, Choices, And Hard Lifecycle

**Files:**

- Modify: `opencode/tools/opencode-all/src/dashboard/actions.ts`
- Modify: `opencode/tools/opencode-all/tests/actions.test.ts`

- [ ] **Step 1: Remove keyboard focus cycling**

In `actions.ts`, delete:

```typescript
const FOCUS_CYCLE: PaneFocus[] = ["messages", "metadata", "sessions"];
function nextFocus(...)
function prevFocus(...)
```

Remove `Tab` and `S-Tab` logic that changes `state.focus`.

- [ ] **Step 2: Make Tab switch Active/Archive**

Replace current `t` logic with:

```typescript
if (key === "Tab") {
  if (state.inputMode || state.pendingAction || state.pendingChoice) return state;
  const nextTab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length];
  return clampCursor(reloadState({ ...state, tab: nextTab, cursor: 0, listScroll: 0, focus: "sessions", status: `${nextTab} tab` }));
}
```

Remove or no-op `t`:

```typescript
if (key === "t") return { ...state, status: "use Tab to switch Active/Archive" };
```

- [ ] **Step 3: Add `R`, `E`, `e`, `b`, `Backspace`**

Add near the normal-mode global key handling:

```typescript
if (key === "R") {
  return clampCursor(reloadState({ ...state, status: "index refresh requested" }));
}

if (key === "b" || key === "Backspace") {
  return popStack(state);
}

if (key === "E") {
  const nextSet = new Set<string>();
  state.folders.forEach(f => { nextSet.add(f.directory); });
  return clampCursor(reloadState({ ...state, expandedFolders: nextSet, status: "expanded all" }));
}

if (key === "e") {
  return applyKey(state, "Enter", onContinue);
}
```

Ensure Backspace stays query editing inside `state.inputMode === "search"` block before normal-mode handling.

- [ ] **Step 4: Add pendingChoice routing**

Before `pendingAction` handling, add:

```typescript
if (state.pendingChoice) {
  if (key === "Escape" || key === "Esc") return { ...state, status: "cancelled", pendingChoice: null, pendingDirectory: undefined, pendingCount: undefined };
  if (state.pendingChoice === "archive_or_delete") {
    if (key === "a") return { ...state, pendingChoice: null, pendingAction: state.pendingDirectory ? "bulk_archive" : "archive", status: confirmOverlayText({ ...state, pendingAction: state.pendingDirectory ? "bulk_archive" : "archive" }) };
    if (key === "d") return { ...state, pendingChoice: null, pendingAction: state.pendingDirectory ? "bulk_delete" : "delete", status: confirmOverlayText({ ...state, pendingAction: state.pendingDirectory ? "bulk_delete" : "delete" }) };
  }
  if (state.pendingChoice === "delete_or_import") {
    if (key === "i" || key === "I") return { ...state, pendingChoice: null, pendingAction: state.pendingDirectory ? "bulk_restore" : "import", status: confirmOverlayText({ ...state, pendingAction: state.pendingDirectory ? "bulk_restore" : "import" }) };
    if (key === "d") return { ...state, pendingChoice: null, pendingAction: state.pendingDirectory ? "bulk_delete" : "delete", status: confirmOverlayText({ ...state, pendingAction: state.pendingDirectory ? "bulk_delete" : "delete" }) };
  }
  return state;
}
```

- [ ] **Step 5: Replace folder/session action keys**

For folder rows:

```typescript
if (ctx.isFolder && folder) {
  if (key === "D" || key === "Delete") {
    const count = state.tab === "active"
      ? state.index.activeByDir.get(folder.directory)?.size || 0
      : state.index.archivedByDir.get(folder.directory)?.size || 0;
    if (count === 0) return { ...state, status: "no sessions in this folder" };
    return {
      ...state,
      pendingChoice: state.tab === "active" ? "archive_or_delete" : "delete_or_import",
      pendingDirectory: folder.directory,
      pendingCount: count,
      status: "choose action",
    };
  }
  if (key === "I" && state.tab === "archived") {
    const count = state.index.archivedByDir.get(folder.directory)?.size || 0;
    if (count === 0) return { ...state, status: "no archived sessions to import" };
    return { ...state, pendingAction: "bulk_restore", pendingDirectory: folder.directory, pendingCount: count, status: `confirm import ${count} archived sessions` };
  }
  return state;
}
```

For session rows:

```typescript
if (ctx.isSession && session) {
  if (state.tab === "archived") {
    if (key === "Enter") return { ...state, status: "Archived sessions can't be opened directly. Press I to import first." };
    if (key === "I") return { ...state, status: `confirm import ${session.id}`, pendingAction: "import" };
    if (key === "D" || key === "Delete") return { ...state, pendingChoice: "delete_or_import", status: "choose action" };
    if (key === "a") return { ...state, status: "archive only applies to active sessions" };
  } else {
    if (key === "D" || key === "Delete") return { ...state, pendingChoice: "archive_or_delete", status: "choose action" };
    if (key === "r" || key === "I") return { ...state, status: "import only applies to archived sessions" };
  }
}
```

- [ ] **Step 6: Update action chips**

For folder rows in `actionChips`:

Active tab labels:

```typescript
[
  { id: "expand", label: "Enter/e expand", key: "Enter|e" },
  { id: "expand-all", label: "E expand-all", key: "E" },
  { id: "choose", label: "D actions", key: "D", danger: true },
  { id: "search", label: "/ search", key: "/" },
  { id: "tab", label: "Tab archive", key: "Tab" },
  { id: "refresh", label: "R refresh", key: "R" },
  { id: "back", label: "b/Esc back", key: "b|Esc" },
  { id: "quit", label: "q quit", key: "q" },
  { id: "wheel", label: "wheel scroll", mouse: true },
]
```

Archive tab labels should use `Tab active` and include `I import-all` when folder selected.

For session rows, Active labels include `Enter open`, `D actions`, `/ search`, `Tab archive`, `R refresh`, `b/Esc back`, `q quit`, `wheel scroll`. Archived labels include `I import`, `D actions`, `/ search`, `Tab active`, `R refresh`, `b/Esc back`, `q quit`, `wheel scroll`; do not include `Enter open`.

- [ ] **Step 7: Update action tests**

Update `tests/actions.test.ts` expectations:

- Tab switches `state.tab`, not `state.focus`.
- `S-Tab` does nothing or returns same state.
- `t` returns status `use Tab to switch Active/Archive`.
- `D` on active session sets `pendingChoice: "archive_or_delete"`.
- `D` on archived session sets `pendingChoice: "delete_or_import"`.
- `I` on archived session sets `pendingAction: "import"`.
- `Enter` on archived session does not call continue and returns blocked status.
- `E` expands all folders.
- `Backspace` in normal mode calls back.
- `Backspace` in search mode edits query.

Add this representative test:

```typescript
test("Tab switches active/archive tabs and does not change pane focus", () => {
  let state = createInitialState(makeIndex(sessions), vp);
  state = { ...state, focus: "metadata" as const };
  const next = applyKey(state, "Tab");
  expect(next.tab).toBe("archived");
  expect(next.focus).toBe("sessions");
});
```

- [ ] **Step 8: Run actions tests**

Run:

```bash
bun test tests/actions.test.ts
```

Expected:

- Actions tests pass.

---

## Task 8: Implement Hard Lifecycle Execution And Index Updates

**Files:**

- Modify: `opencode/tools/opencode-all/src/dashboard/actions.ts`
- Modify: `opencode/tools/opencode-all/src/db.ts`
- Modify: `opencode/tools/opencode-all/tests/actions.test.ts`
- Modify: `opencode/tools/opencode-all/tests/db.test.ts`

- [ ] **Step 1: Import index update helpers in `actions.ts`**

Add:

```typescript
import {
  addActiveToIndex,
  addArchivedToIndex,
  removeActiveFromIndex,
  removeArchivedFromIndex,
  rowsForTab,
} from "./session-index.ts";
```

- [ ] **Step 2: Rewrite single archive execution**

In `executePendingAction`, replace the `archive` branch with:

```typescript
if (state.pendingAction === "archive") {
  const res = exportSessionToFile(selected.id);
  if (!res.ok) {
    return { ...state, pendingAction: null, status: `archive export failed (exit ${res.code}): ${res.stderr.slice(-160)}` };
  }
  const del = deleteSessionById(selected.id);
  if (!del.ok) {
    return { ...state, pendingAction: null, status: `archive exported but delete failed (exit ${del.code}): ${del.stderr.slice(-160)}` };
  }
  const removed = removeActiveFromIndex(state.index, selected.id) || selected;
  addArchivedToIndex(state.index, { ...removed, timeArchived: Date.now() });
  return clampCursor(reloadState({ ...state, pendingAction: null, status: `archived ${selected.id}` }));
}
```

- [ ] **Step 3: Rewrite single import execution**

Replace the `import` branch with:

```typescript
if (state.pendingAction === "import") {
  const imp = importSessionFromFile(selected.id);
  if (!imp.ok) {
    return { ...state, pendingAction: null, status: imp.code === -1 ? imp.stderr : `import failed (exit ${imp.code}): ${imp.stderr.slice(-160)}` };
  }
  const removed = removeArchivedFromIndex(state.index, selected.id) || selected;
  addActiveToIndex(state.index, { ...removed, timeArchived: null });
  const rem = removeArchiveFile(selected.id);
  if (!rem.ok) {
    addArchivedToIndex(state.index, removed);
    return clampCursor(reloadState({ ...state, pendingAction: null, tab: "active", cursor: 0, listScroll: 0, status: `imported but archive file removal failed: ${rem.err}` }));
  }
  return clampCursor(reloadState({ ...state, pendingAction: null, tab: "active", cursor: 0, listScroll: 0, status: `imported ${selected.id}` }));
}
```

- [ ] **Step 4: Rewrite delete execution by tab**

Replace the `delete` branch with:

```typescript
if (state.pendingAction === "delete") {
  if (state.tab === "archived") {
    const rem = removeArchiveFile(selected.id);
    if (!rem.ok) return { ...state, pendingAction: null, status: `archive delete failed: ${rem.err}` };
    removeArchivedFromIndex(state.index, selected.id);
    return clampCursor(reloadState({ ...state, pendingAction: null, status: `deleted archive ${selected.id}` }));
  }
  const del = deleteSessionById(selected.id);
  if (!del.ok) {
    return { ...state, pendingAction: null, status: `delete failed: ${del.stderr.slice(-160)}` };
  }
  removeActiveFromIndex(state.index, selected.id);
  removeArchiveFile(selected.id);
  return clampCursor(reloadState({ ...state, pendingAction: null, status: `deleted ${selected.id}` }));
}
```

- [ ] **Step 5: Rewrite bulk branches**

Implement bulk by iterating ids from the index, not live DB/filesystem listing:

```typescript
function sessionRowsInDirectory(state: UiState, directory: string): UiSession[] {
  return rowsForTab(state.index, state.tab, directory);
}
```

Bulk archive:

```typescript
if (state.pendingAction === "bulk_archive" && state.pendingDirectory) {
  const rows = rowsForTab(state.index, "active", state.pendingDirectory);
  let ok = 0;
  let failed = 0;
  let lastError = "";
  for (const row of rows) {
    const exp = exportSessionToFile(row.id);
    if (!exp.ok) { failed += 1; lastError = exp.stderr.slice(-160); continue; }
    const del = deleteSessionById(row.id);
    if (!del.ok) { failed += 1; lastError = del.stderr.slice(-160); continue; }
    removeActiveFromIndex(state.index, row.id);
    addArchivedToIndex(state.index, { ...row, timeArchived: Date.now() });
    ok += 1;
  }
  const status = `bulk archived ${ok}/${rows.length}` + (failed ? `, ${failed} failed: ${lastError}` : "");
  return clampCursor(reloadState({ ...state, pendingAction: null, pendingDirectory: undefined, pendingCount: undefined, status }));
}
```

Bulk import and delete follow the same pattern using `rowsForTab(state.index, "archived", directory)`.

- [ ] **Step 6: Run lifecycle tests**

Run:

```bash
bun test tests/actions.test.ts tests/db.test.ts tests/session-index.test.ts
```

Expected:

- Tests pass after updating old soft-archive expectations.

---

## Task 9: Wire Index And Choice Overlay Into TUI

**Files:**

- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Modify: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Build index at startup**

In `tui.tsx`, import:

```typescript
import { buildSessionIndex } from "./dashboard/session-index.ts";
```

Replace state initialization in `startInteractiveTui`:

```typescript
const initialIndex = buildSessionIndex({ cwd: cwd() });
let state = createInitialState(initialIndex, { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
state = reloadState(state);
```

Replace fallback/non-TUI initialization similarly.

- [ ] **Step 2: Wire manual refresh**

In keypress handler, before `applyKey`, add:

```typescript
if (mapped === "R" && !state.inputMode && !state.pendingAction && !state.pendingChoice) {
  state = reloadState({ ...state, index: buildSessionIndex({ cwd: cwd() }), status: "index refreshed", cursor: 0, listScroll: 0 });
  refreshPanes();
  renderer.requestRender();
  return;
}
```

- [ ] **Step 3: Add choice overlay renderable**

Import `buildChoiceOverlay` from `render.ts`.

Create a renderable after confirm overlay:

```typescript
const choiceOverlay = new TextRenderable(renderer, {
  id: "choice-overlay", position: "absolute", top: "32%", left: "15%", right: "15%", height: "36%", zIndex: 105, visible: false,
  content: buildChoiceOverlay(state),
});
```

Add it to root:

```typescript
renderer.root.add(choiceOverlay);
```

Update `refreshPanes`:

```typescript
choiceOverlay.content = buildChoiceOverlay(state);
choiceOverlay.visible = !!state.pendingChoice;
```

- [ ] **Step 4: Keep mouse-only pane focus**

Ensure only `onMouseDown` mutates `state.focus`. No key in `applyKey` should change focus except state initialization/reset after tab switch to sessions.

- [ ] **Step 5: Update TUI tests**

Update `tests/tui.test.tsx`:

- `createInitialState` now takes `makeIndex(sessions)`.
- Tab tests expect tab switching, not focus cycling.
- Focus tests assert mouse-only intent by checking `applyKey(state, "Tab")` does not cycle focus.
- Render tree test includes `choice-overlay` if it inspects overlays.
- Messages render test expects `wrapMode: "none"` for messages text if directly constructed.

- [ ] **Step 6: Run TUI tests**

Run:

```bash
bun test tests/tui.test.tsx
```

Expected:

- TUI tests pass.

---

## Task 10: Implement Unified Search Across Active, Archive, And Message Text

**Files:**

- Modify: `opencode/tools/opencode-all/src/db.ts`
- Modify: `opencode/tools/opencode-all/src/dashboard/state.ts`
- Modify: `opencode/tools/opencode-all/src/dashboard/actions.ts`
- Modify: `opencode/tools/opencode-all/src/dashboard/render.ts`
- Modify: `opencode/tools/opencode-all/tests/actions.test.ts`
- Modify: `opencode/tools/opencode-all/tests/layout.test.ts`
- Modify: `opencode/tools/opencode-all/tests/db.test.ts`

- [ ] **Step 1: Add search result types**

In `state.ts`, add:

```typescript
export type SearchMatch = "metadata" | "messages";

export type SearchResult = {
  session: UiSession;
  tab: Tab;
  matchIn: SearchMatch;
};
```

Add to `UiState`:

```typescript
searchResults: SearchResult[];
```

Initialize in `createInitialState`:

```typescript
searchResults: [],
```

- [ ] **Step 2: Add DB active message search helper**

In `db.ts`, add:

```typescript
export function activeSessionsMatchingText(query: string, maxResults = 50, dbPath = defaultDbPath(), cwdValue = process.env.OPENCODE_ALL_CWD || process.cwd()): SessionRow[] {
  const q = `%${query.toLowerCase()}%`;
  const db = openDb(dbPath);
  try {
    const rows = db.query(`
      SELECT DISTINCT s.id, s.title, s.directory, COALESCE(s.path, '') AS path, COALESCE(s.agent, '') AS agent,
             COALESCE(s.model, '') AS model, COALESCE(s.share_url, '') AS share_url,
             s.cost, s.tokens_input, s.tokens_output, s.time_created, s.time_updated, s.time_archived
      FROM session s
      LEFT JOIN message m ON m.session_id = s.id
      LEFT JOIN part p ON p.message_id = m.id
      WHERE parent_id IS NULL
        AND (
          lower(s.title) LIKE ? OR lower(s.directory) LIKE ? OR lower(COALESCE(s.path, '')) LIKE ?
          OR lower(COALESCE(s.agent, '')) LIKE ? OR lower(COALESCE(s.model, '')) LIKE ?
          OR lower(json_extract(p.data, '$.text')) LIKE ?
        )
      ORDER BY s.time_updated DESC
      LIMIT ?
    `).all(q, q, q, q, q, q, maxResults) as SessionRawRow[];
    return rows.map(raw => toRow(raw, cwdValue));
  } finally {
    db.close();
  }
}
```

If `SessionRawRow` is not exported, keep this function inside `db.ts` so it can use the private type.

- [ ] **Step 3: Add unified search function in `actions.ts`**

Import `SearchResult` and `activeSessionsMatchingText`.

Add:

```typescript
function archivedMatchesMessage(id: string, query: string): boolean {
  const lower = query.toLowerCase();
  return readArchivedMessages(id, 500).some(row => row.text.toLowerCase().includes(lower));
}

export function searchResultsFor(state: UiState): SearchResult[] {
  const query = state.query.trim().toLowerCase();
  if (!query) {
    return [
      ...[...state.index.active.values()].slice(0, 20).map(session => ({ session, tab: "active" as const, matchIn: "metadata" as const })),
      ...[...state.index.archived.values()].slice(0, 20).map(session => ({ session, tab: "archived" as const, matchIn: "metadata" as const })),
    ].slice(0, 50);
  }
  const activeById = new Map<string, SearchResult>();
  for (const session of activeSessionsMatchingText(query, 50)) {
    activeById.set(session.id, { session, tab: "active", matchIn: "messages" });
  }
  for (const session of state.index.active.values()) {
    if ([session.title, session.directory, session.path, session.agent, session.model, session.shareUrl].some(v => v.toLowerCase().includes(query))) {
      activeById.set(session.id, { session, tab: "active", matchIn: "metadata" });
    }
  }
  const archived: SearchResult[] = [];
  for (const session of state.index.archived.values()) {
    const meta = [session.title, session.directory, session.path, session.agent, session.model, session.shareUrl].some(v => v.toLowerCase().includes(query));
    if (meta) archived.push({ session, tab: "archived", matchIn: "metadata" });
    else if (archivedMatchesMessage(session.id, query)) archived.push({ session, tab: "archived", matchIn: "messages" });
  }
  return [...activeById.values(), ...archived].slice(0, 50);
}
```

- [ ] **Step 4: Update search Enter behavior**

In search mode Enter handling:

```typescript
if (key === "Enter") {
  const results = searchResultsFor(state);
  const result = results[state.searchSelected];
  if (!result) return state;
  if (result.tab === "archived") {
    return { ...state, status: "Archived sessions can't be opened directly. Press I to import first." };
  }
  return openSessionInOpencode({ ...state, inputMode: null, query: "", searchSelected: 0, searchScroll: 0 }, result.session.id, onContinue);
}
```

- [ ] **Step 5: Update search overlay rendering**

In `buildSearchOverlay`, render `SearchResult[]` with markers:

```typescript
const marker = r.tab === "active" ? "[A]" : "[a]";
const match = r.matchIn === "messages" ? "msg" : "meta";
const row = `│ ${isSelected ? "❯" : " "} ${marker} ${left.padEnd(titleWidth)} ${match.padEnd(4)} ${clip(r.session.directory, dirWidth).padEnd(dirWidth)} │\n`;
```

Footer:

```typescript
const footer = "↑↓ select · Enter open active only · Esc cancel";
```

- [ ] **Step 6: Add search tests**

In `tests/actions.test.ts`, add:

```typescript
test("search returns active and archived session metadata matches", () => {
  let state = createInitialState(makeIndex([...sessions, ...archivedSessions]), vp);
  state = applyKey(state, "/");
  state = applyKey(state, "type:Session");
  const results = searchResultsFor(state);
  expect(results.some(r => r.tab === "active")).toBe(true);
  expect(results.some(r => r.tab === "archived")).toBe(true);
});

test("Enter on archived search result is blocked", () => {
  let state = createInitialState(makeIndex(archivedSessions), vp);
  state = applyKey({ ...state, inputMode: "search", query: "Session", searchSelected: 0 }, "Enter");
  expect(state.status).toContain("can't be opened directly");
});
```

- [ ] **Step 7: Run search-related tests**

Run:

```bash
bun test tests/actions.test.ts tests/layout.test.ts tests/db.test.ts
```

Expected:

- Search tests pass.

---

## Task 11: Update Fallback List And Non-TUI Paths

**Files:**

- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Modify: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Update `printFallbackList`**

Replace:

```typescript
const rows = listSessions({ tab: "active", cwd: cwd() });
```

with:

```typescript
const index = buildSessionIndex({ cwd: cwd() });
const rows = [...index.active.values()].sort((a, b) => b.timeUpdated - a.timeUpdated);
```

Keep list output format:

```typescript
for (const row of rows) console.log(`${row.id}\t${row.title}\t${row.directory}`);
```

- [ ] **Step 2: Update non-TUI fallback render**

Replace fallback state creation with:

```typescript
const state = createInitialState(buildSessionIndex({ cwd: cwd() }), { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
```

- [ ] **Step 3: Run smoke list**

Run:

```bash
OPENCODE_ALL_CWD="/d/Everything/Furaidē" bun src/tui.tsx --list
```

Expected:

- Prints active DB sessions as tab-separated `id title directory` rows.

---

## Task 12: Full Verification And Manual Smoke

**Files:**

- No source edits unless verification reveals a bug.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test tests/session-index.test.ts
bun test tests/db.test.ts
bun test tests/state.test.ts
bun test tests/actions.test.ts
bun test tests/layout.test.ts
bun test tests/tui.test.tsx
bun test tests/sanitize.test.ts
```

Expected:

- Every command exits 0.
- No failing tests.

- [ ] **Step 2: Run full test suite**

Run:

```bash
bun test
```

Expected:

- All tests pass.

- [ ] **Step 3: Run list smoke**

Run:

```bash
OPENCODE_ALL_CWD="/d/Everything/Furaidē" bun src/tui.tsx --list
```

Expected:

- Prints active sessions.
- No exception.

- [ ] **Step 4: Run interactive smoke manually**

Run:

```bash
OPENCODE_ALL_CWD="/d/Everything/Furaidē" bun src/tui.tsx
```

Manual checks:

- Resize terminal smaller and larger; Messages/Metadata top row never hides Sessions.
- Metadata and Sessions text wrap where needed.
- Messages remain truncated one-line rows.
- Mouse click inside Messages/Metadata/Sessions changes focus for wheel scroll.
- `Tab` switches Active/Archive tabs.
- `Tab` does not cycle pane focus.
- `E` expands all folders.
- `Enter` or `e` expands current folder.
- `D` on Active session opens archive/delete choice overlay.
- `D` on Archive session opens import/delete choice overlay.
- `I` on Archive session asks to import.
- `Enter` on Archive session is blocked with the import-first status.
- `R` rebuilds the index and status says refreshed.
- `/` searches active and archived metadata.

- [ ] **Step 5: Typecheck status**

Run:

```bash
bunx tsc --noEmit
```

Expected current status:

- It may still fail on the known upstream `@opentui/core` `KeyHandler.d.ts` issue and existing `string` to `RGBA` errors in `src/dashboard/render.ts` unless this implementation also fixes those separately.
- Do not report typecheck as passing unless it exits 0.

- [ ] **Step 6: Git checkpoint if requested**

If the user asks to commit, delegate all git work to `hanko--git-seal`. Do not run `git commit`, `git push`, or `gh` from the main agent.

---

## Self-Review Checklist

### Spec Coverage

- Layout top max and sessions min: Task 5.
- Resize-respecting boundaries: Task 5 keeps `onResize` and percentage constraints.
- Metadata/sessions wrap and message one-liners: Task 5 and Task 6.
- Mouse wheel scroll content outside screen: Task 5 preserves ScrollBoxRenderable `scrollY` and mouse scroll handler.
- DB = Active, export files = Archive: Task 2, Task 4, Task 8.
- In-memory index for both sets: Task 2 and Task 4.
- Index updates after actions: Task 8.
- Manual index refresh: Task 7 and Task 9.
- Active tab only active sessions: Task 4.
- Archive tab only export-file sessions: Task 2 and Task 4.
- Folder labels without counts: Task 6.
- Tab key switches Active/Archive: Task 7.
- No Tab focus changes: Task 7 and Task 9.
- Mouse-only pane focus: Task 7 and Task 9.
- Directory-level keys: Task 7.
- Session-level keys: Task 7.
- Hard archive/export/delete flow: Task 8.
- Import flow: Task 8.
- Auto-refresh after actions: Task 8.
- Search across Active and Archive plus message content: Task 10.
- Archived search result Enter blocked: Task 10.
- Archived metadata from export file: Task 6.
- CLI path fixes (`opencode export`, `opencode import`): Task 3.
- Raw export/no sanitize: Task 3.
- Two-phase implementation: Tasks 1-9 are Phase 1 core; Task 10+ are Phase 2 search/polish.

### Placeholder Scan

This plan intentionally avoids ambiguous executor instructions. All changed files, functions, commands, and expected outcomes are named explicitly. If an implementer discovers an existing test helper name differs from snippets in this plan, they should adapt the snippet mechanically while preserving the behavior and assertions described here.

### Type Consistency

- `SessionIndex` is defined in `src/dashboard/session-index.ts` and imported by `state.ts`, tests, and TUI.
- `pendingChoice` is defined in `UiState` and consumed by `actions.ts`, `render.ts`, and `tui.tsx`.
- Active/Archive tab values remain the existing `Tab = "active" | "archived"` type.
- Archive file rows are represented as `ArchiveFileRow extends SessionRow` in `db.ts`.
- Search results are represented as `SearchResult` in `state.ts`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-opencode-all-hard-archive-index-plan.md`.

Two execution options after user approval:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.
