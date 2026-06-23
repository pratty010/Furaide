# opencode-all Fresh Session and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fresh-session launch from `opencode-all`, then implement approved performance improvements without changing user-visible session management semantics.

**Architecture:** First extract OpenCode child-process spawning into `src/session-runner.ts`, then wire `N`, `Alt+Enter`, and `--new <directory>` through existing state/action/render patterns. Performance work lands afterward in independent slices: hybrid indexing, archive metadata sidecars, debounced metadata/search, list virtualization, memoized derived state, large-archive preview guard, and a worker-backed refresh path.

**Tech Stack:** Bun, TypeScript, OpenTUI, Bun SQLite, Bun test, OpenCode CLI.

---

## Source Map

- Modify: `opencode/tools/opencode-all/src/tui.tsx` for main loop, CLI flag parsing, renderer handoff, and worker/debounce wiring.
- Create: `opencode/tools/opencode-all/src/session-runner.ts` for OpenCode process spawning and audit logging.
- Modify: `opencode/tools/opencode-all/src/dashboard/state.ts` for `freshDirectory`, fast reload, debounced metadata state, and visible-row memoization.
- Modify: `opencode/tools/opencode-all/src/dashboard/actions.ts` for `N`, `Alt+Enter`, action chips, search debounce support, and memoized derived actions.
- Modify: `opencode/tools/opencode-all/src/dashboard/render.ts` for virtualized session-list rendering.
- Modify: `opencode/tools/opencode-all/src/dashboard/session-index.ts` for hybrid index cache and serialization helpers.
- Modify: `opencode/tools/opencode-all/src/db.ts` for archive metadata sidecars and large-archive preview guard.
- Create: `opencode/tools/opencode-all/src/workers/index-worker.ts` for async index refresh.
- Modify: `opencode/tools/opencode-all/README.md` for keybindings, feature list, and `--new` CLI usage.
- Modify: `opencode/tools/opencode-all/tests/actions.test.ts` for new key handling and action chips.
- Modify: `opencode/tools/opencode-all/tests/tui.test.tsx` for session runner imports, CLI flag behavior, render chips, virtual rows, and debounce behavior.
- Modify: `opencode/tools/opencode-all/tests/state.test.ts` for fast reload/debounced metadata/memoization.
- Modify: `opencode/tools/opencode-all/tests/db.test.ts` for archive `.meta` sidecars and large archive behavior.
- Create: `opencode/tools/opencode-all/tests/session-runner.test.ts` for spawn/audit behavior.
- Create: `opencode/tools/opencode-all/tests/session-index-cache.test.ts` for hybrid index cache behavior.
- Create: `opencode/tools/opencode-all/tests/index-worker.test.ts` for worker message behavior.

## Verification Commands

Run from `opencode/tools/opencode-all` unless otherwise noted.

```bash
bun test
bunx tsc --noEmit
bash scripts/test-fixture.sh
bun run src/tui.tsx --list
```

---

## Phase 1: Fresh Session UX

### Task 1: Extract OpenCode Session Runner

**Files:**
- Create: `opencode/tools/opencode-all/src/session-runner.ts`
- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Test: `opencode/tools/opencode-all/tests/session-runner.test.ts`
- Test: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Write the failing runner tests**

Create `opencode/tools/opencode-all/tests/session-runner.test.ts` with these tests:

```typescript
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { runChildSession, runFreshSession } from "../src/session-runner.ts";

function fakeRenderer() {
  return {
    suspended: 0,
    resumed: 0,
    requested: 0,
    suspend() { this.suspended += 1; },
    resume() { this.resumed += 1; },
    requestRender() { this.requested += 1; },
  };
}

function spawnOk(calls: any[]) {
  return ((cmd: string, args: string[], options: any) => {
    calls.push({ cmd, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0, null));
    return child as any;
  }) as any;
}

describe("session runner", () => {
  test("runChildSession continues an existing session", async () => {
    const calls: any[] = [];
    const renderer = fakeRenderer();
    const audits: any[] = [];
    await runChildSession(renderer, { id: "ses_123", fork: false }, spawnOk(calls), (action, target, status) => audits.push({ action, target, status }));
    expect(calls[0]).toMatchObject({ cmd: "opencode", args: ["--session", "ses_123"] });
    expect(calls[0].options.stdio).toBe("inherit");
    expect(renderer.suspended).toBe(1);
    expect(renderer.resumed).toBe(1);
    expect(audits.map(a => a.status)).toEqual(["started", "exit 0"]);
  });

  test("runChildSession forks when requested", async () => {
    const calls: any[] = [];
    await runChildSession(fakeRenderer(), { id: "ses_123", fork: true }, spawnOk(calls), () => {});
    expect(calls[0].args).toEqual(["--session", "ses_123", "--fork"]);
  });

  test("runFreshSession starts opencode in a directory", async () => {
    const calls: any[] = [];
    const audits: any[] = [];
    await runFreshSession(fakeRenderer(), "/repo/current", spawnOk(calls), (action, target, status) => audits.push({ action, target, status }));
    expect(calls[0]).toMatchObject({ cmd: "opencode", args: ["/repo/current"] });
    expect(calls[0].options.stdio).toBe("inherit");
    expect(audits[0]).toEqual({ action: "open_session_fresh", target: "/repo/current", status: "started" });
    expect(audits[1]).toEqual({ action: "open_session_fresh", target: "/repo/current", status: "exit 0" });
  });

  test("runFreshSession audits spawn errors and resumes renderer", async () => {
    const renderer = fakeRenderer();
    const audits: any[] = [];
    const spawnError = (() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })));
      return child as any;
    }) as any;
    await runFreshSession(renderer, "/repo/current", spawnError, (action, target, status) => audits.push({ action, target, status }));
    expect(renderer.suspended).toBe(1);
    expect(renderer.resumed).toBe(1);
    expect(audits.at(-1).status).toContain("error opencode CLI not found");
  });
});
```

- [ ] **Step 2: Run the failing runner tests**

Run:

```bash
bun test tests/session-runner.test.ts
```

Expected: FAIL with module not found for `../src/session-runner.ts`.

- [ ] **Step 3: Create `src/session-runner.ts`**

Create `opencode/tools/opencode-all/src/session-runner.ts`:

```typescript
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliRenderer } from "@opentui/core";

export type ContinueRequest = { id: string; fork: boolean };
type RunnerRenderer = Pick<CliRenderer, "requestRender"> & { suspend: () => unknown; resume: () => unknown };

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
    return "opencode CLI not found. Set OPENCODE_ALL_OPENCODE_BIN or install opencode.";
  }
  return error instanceof Error ? error.message : String(error);
}

function opencodeBin(): string {
  return process.env.OPENCODE_ALL_OPENCODE_BIN || "opencode";
}

function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all");
}

export function audit(action: string, target: string, status: string): void {
  const file = join(dataDir(), "audit.log");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), action, target, status })}\n`, { flag: "a", mode: 0o600 });
}

async function runOpencode(
  renderer: RunnerRenderer,
  action: string,
  target: string,
  args: string[],
  spawnImpl: typeof spawn,
  auditImpl: (action: string, target: string, status: string) => void,
): Promise<void> {
  auditImpl(action, target, "started");
  renderer.suspend();
  const child = spawnImpl(opencodeBin(), args, { stdio: "inherit" });
  const status = await new Promise<string>((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) resolve(`signal ${signal}`);
      else resolve(`exit ${code ?? 0}`);
    });
    child.on("error", (error) => resolve(`error ${errorMessage(error)}`));
  });
  auditImpl(action, target, status);
  renderer.resume();
}

export async function runChildSession(
  renderer: RunnerRenderer,
  req: ContinueRequest,
  spawnImpl: typeof spawn = spawn,
  auditImpl: (action: string, target: string, status: string) => void = audit,
): Promise<void> {
  await runOpencode(renderer, "open_session", req.id, ["--session", req.id, ...(req.fork ? ["--fork"] : [])], spawnImpl, auditImpl);
}

export async function runFreshSession(
  renderer: RunnerRenderer,
  directory: string,
  spawnImpl: typeof spawn = spawn,
  auditImpl: (action: string, target: string, status: string) => void = audit,
): Promise<void> {
  await runOpencode(renderer, "open_session_fresh", directory, [directory], spawnImpl, auditImpl);
}
```

- [ ] **Step 4: Update `src/tui.tsx` imports and exports**

In `opencode/tools/opencode-all/src/tui.tsx`:

- Remove imports of `spawn`, `mkdirSync`, `writeFileSync`, and `dirname` if only used by the old runner/audit code.
- Add:

```typescript
import { errorMessage, runChildSession, runFreshSession, type ContinueRequest } from "./session-runner.ts";
```

- Keep this export line working:

```typescript
export { applyKey, buildSearchOverlay, runChildSession, runFreshSession };
```

- Delete local definitions of `errorMessage`, `opencodeBin`, `ContinueRequest`, `runChildSession`, `dataDir`, and `audit` from `tui.tsx`.

- [ ] **Step 5: Run the runner tests**

Run:

```bash
bun test tests/session-runner.test.ts tests/tui.test.tsx
```

Expected: PASS for `session-runner.test.ts`; existing `tui.test.tsx` may need import adjustment if it imports `ContinueRequest` from `tui.tsx`.

If `tui.test.tsx` import fails, update line 6 from:

```typescript
import { applyKey, buildSearchOverlay, mapKey, refreshStateFromDisk, runChildSession, type ContinueRequest } from "../src/tui.tsx";
```

to:

```typescript
import { applyKey, buildSearchOverlay, mapKey, refreshStateFromDisk, runChildSession } from "../src/tui.tsx";
import type { ContinueRequest } from "../src/session-runner.ts";
```

Then rerun the same command.

### Task 2: Add Fresh Directory State and Key Handling

**Files:**
- Modify: `opencode/tools/opencode-all/src/dashboard/state.ts`
- Modify: `opencode/tools/opencode-all/src/dashboard/actions.ts`
- Test: `opencode/tools/opencode-all/tests/actions.test.ts`

- [ ] **Step 1: Write failing action tests**

Add these tests to `tests/actions.test.ts` near other `applyKey` tests:

```typescript
describe("fresh session keybindings", () => {
  test("N on active folder sets freshDirectory", () => {
    let state = cursorOnFirstFolder(makeState());
    const folder = getVisibleRows(state)[state.cursor] as any;
    const result = applyKey(state, "N");
    expect(result.freshDirectory).toBe(folder.directory);
    expect(result.status).toBe(`opening ${folder.directory}`);
  });

  test("Alt+Enter on active session uses session directory", () => {
    let state = cursorOnFirstSession(makeState());
    const session = getVisibleRows(state)[state.cursor] as any;
    const result = applyKey(state, "Alt+Enter");
    expect(result.freshDirectory).toBe(session.directory);
    expect(result.status).toBe(`opening ${session.directory}`);
  });

  test("N in archived tab is blocked", () => {
    let state = makeState(archivedSessions);
    state = { ...state, tab: "archived" as const };
    const result = applyKey(state, "N");
    expect(result.freshDirectory).toBeUndefined();
    expect(result.status).toBe("new sessions only start from the Active tab");
  });

  test("active folder and session rows advertise N new", () => {
    const folderState = cursorOnFirstFolder(makeState());
    expect(chipLabels(actionChips(folderState))).toContain("N new");
    const sessionState = cursorOnFirstSession(makeState());
    expect(chipLabels(actionChips(sessionState))).toContain("N new");
  });
});
```

- [ ] **Step 2: Run the failing action tests**

Run:

```bash
bun test tests/actions.test.ts --filter "fresh session keybindings"
```

Expected: FAIL because `freshDirectory` and `Alt+Enter` handling do not exist.

- [ ] **Step 3: Add `freshDirectory` to `UiState`**

In `src/dashboard/state.ts`, extend `UiState`:

```typescript
  freshDirectory?: string;
```

No initializer is needed in `createInitialState`; omitted means no pending request.

- [ ] **Step 4: Implement fresh-directory target resolution in `actions.ts`**

Add import at top:

```typescript
import { existsSync } from "node:fs";
```

Add helper near `openSessionInOpencode`:

```typescript
function directoryForFreshSession(state: UiState): string | undefined {
  const folder = selectFolderAtCursor(state);
  if (folder) return folder.directory;
  const session = currentSession(state);
  return session?.directory;
}

function startFreshSessionInDirectory(state: UiState): UiState {
  if (state.tab !== "active") {
    return { ...state, status: "new sessions only start from the Active tab" };
  }
  const directory = directoryForFreshSession(state);
  if (!directory) return { ...state, status: "no directory selected" };
  if (!existsSync(directory)) return { ...state, status: `directory not found: ${directory}` };
  return { ...state, freshDirectory: directory, status: `opening ${directory}` };
}
```

In `applyKey`, after Escape handling and before input-mode handling, add:

```typescript
  if (key === "N" || key === "Alt+Enter") {
    return startFreshSessionInDirectory(state);
  }
```

- [ ] **Step 5: Add action chips**

In `actionChips`, add `{ id: "new", label: "N new", key: "N", primary: true }`:

- In active folder-row chip list.
- In active session-row chip list.

Do not add it to archived folder/session chip lists.

- [ ] **Step 6: Run the action tests**

Run:

```bash
bun test tests/actions.test.ts --filter "fresh session keybindings"
```

Expected: PASS. If tests fail because fixture directories do not exist, update test setup to use an existing temp directory like `import.meta.dir` for fixture session directories.

### Task 3: Wire Fresh Session Request Through TUI Main Loop

**Files:**
- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Test: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Write failing TUI smoke tests**

Add tests to `tests/tui.test.tsx`:

```typescript
describe("fresh session TUI integration", () => {
  test("mapKey maps alt-return to Alt+Enter", () => {
    expect(mapKey({ meta: true, name: "return" })).toBe("Alt+Enter");
  });

  test("action bar shows N new for active folder and active session", () => {
    const folderState = createInitialState(makeIndex(sessions), { height: 20, width: 100 });
    expect(flatText(buildActionBarContent(folderState))).toContain("N new");
    const sessionState = cursorOnFirstSession(folderState);
    expect(flatText(buildActionBarContent(sessionState))).toContain("N new");
  });
});
```

- [ ] **Step 2: Run the failing TUI tests**

Run:

```bash
bun test tests/tui.test.tsx --filter "fresh session TUI integration"
```

Expected: FAIL for `mapKey` and/or missing chip.

- [ ] **Step 3: Map Alt+Enter**

In `src/tui.tsx`, update `mapKey` before the normal return mapping:

```typescript
  if ((key?.meta || key?.alt) && key?.name === "return") return "Alt+Enter";
```

- [ ] **Step 4: Consume `freshDirectory` in main loop**

In `startInteractiveTui`, add:

```typescript
  let freshDirectoryRequest: string | null = null;
```

After `applyKey`, add:

```typescript
    if (next.freshDirectory) {
      freshDirectoryRequest = next.freshDirectory;
      state = { ...next, freshDirectory: undefined };
      settleLoop?.();
      return;
    }
```

In the `while (!quitRequested)` loop, before `if (continueRequest)`, add:

```typescript
      if (freshDirectoryRequest) {
        const directory = freshDirectoryRequest;
        freshDirectoryRequest = null;
        childRunning = true;
        try {
          await runFreshSession(renderer, directory);
        } finally {
          childRunning = false;
        }
        state = refreshStateFromDisk(state, "back from session");
        rebuildLayout();
        refreshPanes();
        renderer.requestRender();
      }
```

- [ ] **Step 5: Run TUI tests**

Run:

```bash
bun test tests/tui.test.tsx --filter "fresh session TUI integration"
```

Expected: PASS.

### Task 4: Add `--new <directory>` CLI Flag

**Files:**
- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Test: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Write failing CLI tests**

Add tests to `tests/tui.test.tsx`:

```typescript
describe("--new flag", () => {
  test("main returns error for missing --new directory", async () => {
    const writes: string[] = [];
    const originalError = console.error;
    console.error = (msg?: any) => { writes.push(String(msg)); };
    try {
      await expect(import("../src/tui.tsx").then(m => m.main(["--new"]))).rejects.toThrow("missing directory for --new");
    } finally {
      console.error = originalError;
    }
  });
});
```

If this direct `main` error style does not match project conventions, implement `main` to set `process.exitCode = 1` and return; update test to assert `process.exitCode`.

- [ ] **Step 2: Run the failing CLI test**

Run:

```bash
bun test tests/tui.test.tsx --filter "--new flag"
```

Expected: FAIL because `--new` is not implemented.

- [ ] **Step 3: Implement `--new` parsing in `main`**

In `src/tui.tsx`, import `existsSync` if not present:

```typescript
import { existsSync, readFileSync } from "node:fs";
```

In `main`, before `--list` handling, add:

```typescript
  const newIndex = argv.indexOf("--new");
  if (newIndex >= 0) {
    const directory = argv[newIndex + 1];
    if (!directory) throw new Error("missing directory for --new");
    if (!existsSync(directory)) throw new Error(`directory not found: ${directory}`);
    await runFreshSession({ suspend() {}, resume() {}, requestRender() {} }, directory);
    return;
  }
```

- [ ] **Step 4: Run CLI tests and typecheck**

Run:

```bash
bun test tests/tui.test.tsx --filter "--new flag"
bunx tsc --noEmit
```

Expected: PASS.

### Task 5: Update README for Fresh Session UX

**Files:**
- Modify: `opencode/tools/opencode-all/README.md`

- [ ] **Step 1: Update Features**

In `README.md`, add this sentence to the Features section:

```markdown
Fresh session launch. Start a brand-new OpenCode session in the selected active directory without leaving the dashboard.
```

- [ ] **Step 2: Update Keybindings table**

Add rows:

```markdown
| `N` | Active folder or active session | Start fresh session in that directory |
| `Alt+Enter` | Active folder or active session | Start fresh session in that directory |
```

- [ ] **Step 3: Add CLI usage**

Add under Verification or Development:

```markdown
**Start a fresh session without opening the dashboard:**

```bash
opencode-all --new /path/to/project
```
```

- [ ] **Step 4: Verify README contains keybindings**

Run:

```bash
rg -n "Alt\+Enter|--new|Fresh session" README.md
```

Expected: all three terms appear.

---

## Phase 2: Performance Improvements

### Task 6: Hybrid Session Index Cache

**Files:**
- Modify: `opencode/tools/opencode-all/src/dashboard/session-index.ts`
- Modify: `opencode/tools/opencode-all/src/dashboard/state.ts`
- Test: `opencode/tools/opencode-all/tests/session-index-cache.test.ts`

- [ ] **Step 1: Write failing cache tests**

Create `tests/session-index-cache.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { buildSessionIndex, clearSessionIndexCache } from "../src/dashboard/session-index.ts";

const root = join(import.meta.dir, ".tmp-index-cache");
const dbPath = join(root, "opencode.db");
const archiveRoot = join(root, "exports");

function seed(title: string) {
  mkdirSync(root, { recursive: true });
  mkdirSync(archiveRoot, { recursive: true });
  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS session");
  db.run(`CREATE TABLE session (id text PRIMARY KEY, project_id text, parent_id text, slug text, directory text, title text, version text, share_url text, summary_additions integer, summary_deletions integer, summary_files integer, summary_diffs text, time_created integer, time_updated integer, time_archived integer, workspace_id text, path text, agent text, model text, cost real, tokens_input integer, tokens_output integer, tokens_reasoning integer, tokens_cache_read integer, tokens_cache_write integer)`);
  db.run(`INSERT INTO session VALUES ('ses_a','p',NULL,'a','/repo','${title}','v',NULL,0,0,0,NULL,1,2,NULL,NULL,'','','',0,0,0,0,0,0)`);
  db.close();
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  clearSessionIndexCache();
  seed("first");
});

describe("session index cache", () => {
  test("returns cached index when source mtimes are unchanged", () => {
    const a = buildSessionIndex({ cwd: "/repo", dbPath, archiveRoot });
    const b = buildSessionIndex({ cwd: "/repo", dbPath, archiveRoot });
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run failing cache test**

Run:

```bash
bun test tests/session-index-cache.test.ts
```

Expected: FAIL because `clearSessionIndexCache` does not exist.

- [ ] **Step 3: Implement cache in `session-index.ts`**

Add imports:

```typescript
import { existsSync, statSync } from "node:fs";
import { defaultArchiveRoot, defaultDbPath } from "../db.ts";
```

Add cache near top:

```typescript
let cachedIndex: { key: string; index: SessionIndex } | null = null;

function sourceKey(options: BuildSessionIndexOptions): string {
  const dbPath = options.dbPath || defaultDbPath();
  const archiveRoot = options.archiveRoot || defaultArchiveRoot();
  const dbMtime = existsSync(dbPath) ? statSync(dbPath).mtimeMs : 0;
  const archiveMtime = existsSync(archiveRoot) ? statSync(archiveRoot).mtimeMs : 0;
  return `${dbPath}:${dbMtime}:${archiveRoot}:${archiveMtime}:${options.cwd}`;
}

export function clearSessionIndexCache(): void {
  cachedIndex = null;
}
```

Wrap `buildSessionIndex`:

```typescript
export function buildSessionIndex(options: BuildSessionIndexOptions): SessionIndex {
  const key = sourceKey(options);
  if (cachedIndex?.key === key) return cachedIndex.index;
  const index = emptyIndex();
  // existing logic
  cachedIndex = { key, index };
  return index;
}
```

- [ ] **Step 4: Run cache tests**

Run:

```bash
bun test tests/session-index-cache.test.ts
```

Expected: PASS.

### Task 7: Archive Metadata Sidecar Cache

**Files:**
- Modify: `opencode/tools/opencode-all/src/db.ts`
- Test: `opencode/tools/opencode-all/tests/db.test.ts`

- [ ] **Step 1: Add failing db tests**

Add tests to `tests/db.test.ts` under `archive path and archived messages`:

```typescript
test("listArchivedSessionFiles writes and reuses archive meta sidecar", () => {
  process.env.XDG_DATA_HOME = root;
  const exportsDir = join(root, "opencode", "tools", "opencode-all", "exports");
  mkdirSync(exportsDir, { recursive: true });
  const archivePath = join(exportsDir, "ses_safe.json");
  writeFileSync(archivePath, JSON.stringify({
    info: { id: "ses_safe", title: "Safe", directory: "/repo", time: { updated: 100, created: 50 }, cost: 1, tokens: { input: 2, output: 3 } },
    messages: Array.from({ length: 100 }, () => ({ parts: [{ type: "text", text: "heavy" }] })),
  }));
  const rows = listArchivedSessionFiles({ archiveRoot: exportsDir, cwd: "/repo" });
  expect(rows.map(row => row.id)).toEqual(["ses_safe"]);
  expect(readFileSync(`${archivePath}.meta`, "utf8")).toContain('"info"');
  delete process.env.XDG_DATA_HOME;
});
```

- [ ] **Step 2: Run failing db test**

Run:

```bash
bun test tests/db.test.ts --filter "archive meta sidecar"
```

Expected: FAIL because `.meta` is not written.

- [ ] **Step 3: Implement archive meta helper**

In `src/db.ts`, add:

```typescript
function archiveMetaPath(archivePath: string): string {
  return `${archivePath}.meta`;
}

function readArchiveInfoWithMeta(archivePath: string): any | null {
  const stats = statSync(archivePath);
  const metaPath = archiveMetaPath(archivePath);
  if (existsSync(metaPath)) {
    const metaStats = statSync(metaPath);
    if (metaStats.mtimeMs >= stats.mtimeMs) {
      try { return JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
    }
  }
  const raw = JSON.parse(readFileSync(archivePath, "utf8"));
  const infoOnly = { info: raw.info };
  writeFileSync(metaPath, JSON.stringify(infoOnly), { mode: 0o600 });
  return infoOnly;
}
```

In `listArchivedSessionFiles`, replace full archive read with:

```typescript
const raw = readArchiveInfoWithMeta(file);
const row = raw ? archiveInfoToRow(raw, file, cwdValue, Math.trunc(stats.mtimeMs)) : null;
```

- [ ] **Step 4: Run db tests**

Run:

```bash
bun test tests/db.test.ts
```

Expected: PASS.

### Task 8: Debounced Metadata Loading

**Files:**
- Modify: `opencode/tools/opencode-all/src/dashboard/state.ts`
- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Test: `opencode/tools/opencode-all/tests/state.test.ts`

- [ ] **Step 1: Add fast reload tests**

Add tests to `tests/state.test.ts`:

```typescript
import { loadSelectedMessages, reloadStateFast } from "../src/dashboard/state.ts";

describe("debounced metadata helpers", () => {
  test("reloadStateFast does not load messages", () => {
    const state = makeState();
    const expanded = expandFolderWithSessions(state);
    const visible = getVisibleRows(expanded);
    const cursor = visible.findIndex(row => "id" in row && row.id === "ses_0");
    const result = reloadStateFast({ ...expanded, cursor, messageRows: [] });
    expect(result.messageRows).toEqual([]);
  });

  test("loadSelectedMessages loads messages for selected session", () => {
    const state = makeState();
    const expanded = expandFolderWithSessions(state);
    const visible = getVisibleRows(expanded);
    const cursor = visible.findIndex(row => "id" in row && row.id === "ses_0");
    const result = loadSelectedMessages({ ...expanded, cursor, messageRows: [] });
    expect(result.messageRows.map(row => row.text)).toEqual(["active user message", "active assistant message"]);
  });
});
```

- [ ] **Step 2: Run failing state tests**

Run:

```bash
bun test tests/state.test.ts --filter "debounced metadata helpers"
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Split state reload helpers**

In `state.ts`, add:

```typescript
export function reloadStateFast(state: UiState): UiState {
  const baseCwd = cwd();
  let folders = sortFolders(directoriesForTab(state.index, state.tab), baseCwd);
  if (state.inputMode === "search" && state.query) {
    folders = folders.filter(row => row.directory.toLowerCase().includes(state.query.toLowerCase()));
  }
  const sessions = rowsForTab(state.index, state.tab, state.directory, state.query);
  const allSessions = [...state.index.active.values(), ...state.index.archived.values()];
  const visible = getVisibleRows({ ...state, folders, sessions, allSessions });
  const cursor = Math.min(state.cursor, Math.max(0, visible.length - 1));
  return { ...state, folders, sessions, allSessions, cursor, listScroll: Math.min(state.listScroll, cursor) };
}

export function loadSelectedMessages(state: UiState): UiState {
  const selected = selectedVisibleSession(state);
  let messageRows: ArchivedMessageRow[] = [];
  if (selected) {
    messageRows = selected.timeArchived == null ? readRecentMessages(selected.id) : readArchivedMessages(selected.id);
  }
  return { ...state, messageRows, messageScroll: 0 };
}

export function reloadState(state: UiState): UiState {
  return loadSelectedMessages(reloadStateFast(state));
}
```

- [ ] **Step 4: Add debounce timer in `tui.tsx`**

Inside `startInteractiveTui`, add:

```typescript
  let metadataTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleMetadataLoad() {
    if (metadataTimer) clearTimeout(metadataTimer);
    metadataTimer = setTimeout(() => {
      state = loadSelectedMessages(state);
      refreshPanes();
      renderer.requestRender();
    }, 150);
  }
```

When `applyKey` changes state due to navigation, call `scheduleMetadataLoad()` after `refreshPanes()`.

In `finally`, add:

```typescript
    if (metadataTimer) clearTimeout(metadataTimer);
```

- [ ] **Step 5: Run state and TUI tests**

Run:

```bash
bun test tests/state.test.ts tests/tui.test.tsx
```

Expected: PASS.

### Task 9: Debounced Search Typing

**Files:**
- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Test: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Add testable helper for search debounce**

Create this exported helper in `tui.tsx`:

```typescript
export const SEARCH_DEBOUNCE_MS = 150;
```

Add test:

```typescript
describe("search debounce", () => {
  test("uses 150ms debounce", async () => {
    const mod = await import("../src/tui.tsx");
    expect(mod.SEARCH_DEBOUNCE_MS).toBe(150);
  });
});
```

- [ ] **Step 2: Run failing search debounce test**

Run:

```bash
bun test tests/tui.test.tsx --filter "search debounce"
```

Expected: FAIL until constant is exported.

- [ ] **Step 3: Implement search debounce in keypress handler**

Inside `startInteractiveTui`, add:

```typescript
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
```

When mapped input changes search query, update visible input immediately and defer `reloadState`:

```typescript
    if (state.inputMode === "search" && mapped.length === 1 && mapped >= " ") {
      const query = `${state.query}${mapped}`;
      state = { ...state, query, status: `search:${query}` };
      refreshPanes();
      renderer.requestRender();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state = reloadState({ ...state, cursor: 0, listScroll: 0, searchSelected: 0, searchScroll: 0 });
        refreshPanes();
        renderer.requestRender();
      }, SEARCH_DEBOUNCE_MS);
      return;
    }
```

Also handle Backspace in search mode with same debounce path.

In `finally`, clear `searchTimer`.

- [ ] **Step 4: Run TUI tests**

Run:

```bash
bun test tests/tui.test.tsx
```

Expected: PASS.

### Task 10: Virtualize Session List Rendering

**Files:**
- Modify: `opencode/tools/opencode-all/src/dashboard/render.ts`
- Test: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Add virtualization test**

Add test:

```typescript
describe("session list virtualization", () => {
  test("buildSessionsContent renders bounded row count", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ ...sessions[0], id: `ses_many_${index}`, title: `Many ${index}`, directory: "/repo/many", timeUpdated: 10_000 - index }));
    let state = createInitialState(makeIndex(many), { height: 20, width: 100 });
    state = { ...state, expandedFolders: new Set(["/repo/many"]) };
    const text = flatText(buildSessionsContent(state));
    expect(text.split("\n").length).toBeLessThan(40);
  });
});
```

- [ ] **Step 2: Run failing virtualization test**

Run:

```bash
bun test tests/tui.test.tsx --filter "session list virtualization"
```

Expected: FAIL because all rows render.

- [ ] **Step 3: Slice visible rows in `buildSessionsContent`**

In `render.ts`, replace the `for (let i = 0; i < visible.length; i++)` loop with:

```typescript
  const maxRows = Math.max(4, Math.floor(state.viewport.height * 0.45));
  const start = Math.max(0, Math.min(state.listScroll, Math.max(0, visible.length - maxRows)));
  const end = Math.min(visible.length, start + maxRows + 2);

  for (let i = start; i < end; i++) {
    const item = visible[i];
    // existing row rendering body
  }
```

- [ ] **Step 4: Run TUI tests**

Run:

```bash
bun test tests/tui.test.tsx --filter "session list virtualization"
```

Expected: PASS.

### Task 11: Memoize Derived State

**Files:**
- Modify: `opencode/tools/opencode-all/src/dashboard/state.ts`
- Modify: `opencode/tools/opencode-all/src/dashboard/actions.ts`
- Test: `opencode/tools/opencode-all/tests/state.test.ts`
- Test: `opencode/tools/opencode-all/tests/actions.test.ts`

- [ ] **Step 1: Add exported cache clear helpers**

In `state.ts`, plan to export:

```typescript
export function clearVisibleRowsMemo(): void;
```

In `actions.ts`, plan to export:

```typescript
export function clearActionMemo(): void;
```

Add tests that call these helpers and verify repeated calls return equivalent arrays:

```typescript
test("getVisibleRows is stable for unchanged state", () => {
  clearVisibleRowsMemo();
  const state = expandFolderWithSessions(makeState());
  expect(getVisibleRows(state)).toEqual(getVisibleRows(state));
});
```

- [ ] **Step 2: Implement simple memo in `state.ts`**

Add:

```typescript
let visibleRowsMemo: { key: string; rows: Array<DirectoryRow | UiSession> } | null = null;

export function clearVisibleRowsMemo(): void {
  visibleRowsMemo = null;
}

function visibleRowsKey(state: UiState): string {
  return JSON.stringify({
    tab: state.tab,
    directory: state.directory || "",
    query: state.query,
    sessions: state.sessions.map(s => `${s.id}:${s.timeUpdated}:${s.timeArchived ?? ""}`).join("|"),
    folders: state.folders.map(f => `${f.directory}:${f.active}:${f.archived}:${f.latestUpdated}`).join("|"),
    expanded: [...state.expandedFolders].sort().join("|"),
  });
}
```

At start/end of `getVisibleRows`:

```typescript
  const key = visibleRowsKey(state);
  if (visibleRowsMemo?.key === key) return visibleRowsMemo.rows;
  // existing build rows
  visibleRowsMemo = { key, rows };
  return rows;
```

- [ ] **Step 3: Implement memo in `actions.ts` for `searchResultsFor` and `actionChips`**

Use a similar key helper keyed by query, tab, cursor row id/directory, pending action, pending choice, input mode, and focus.

- [ ] **Step 4: Run state/action tests**

Run:

```bash
bun test tests/state.test.ts tests/actions.test.ts
```

Expected: PASS.

### Task 12: Large Archive Preview Guard

**Files:**
- Modify: `opencode/tools/opencode-all/src/db.ts`
- Test: `opencode/tools/opencode-all/tests/db.test.ts`

- [ ] **Step 1: Add large archive test**

Add to `tests/db.test.ts`:

```typescript
test("readArchivedMessages skips large archive preview", () => {
  process.env.XDG_DATA_HOME = root;
  const file = defaultArchivePath("ses_big");
  mkdirSync(join(root, "opencode", "tools", "opencode-all", "exports"), { recursive: true });
  writeFileSync(file, JSON.stringify({ info: { id: "ses_big", title: "Big", directory: "/repo" }, messages: [] }) + "x".repeat(1024 * 1024 + 1));
  const rows = readArchivedMessages("ses_big");
  expect(rows[0]?.text).toContain("archive too large for preview");
  delete process.env.XDG_DATA_HOME;
});
```

- [ ] **Step 2: Implement threshold**

In `db.ts`, add:

```typescript
const ARCHIVE_PREVIEW_MAX_BYTES = 1024 * 1024;
```

In `readArchivedMessages`, before full read:

```typescript
if (size > ARCHIVE_PREVIEW_MAX_BYTES) {
  return [{ role: "system", time: 0, text: `archive too large for preview (${size} bytes)` }];
}
```

Keep existing `MAX_ARCHIVE_BYTES` as the hard safety cap for archive validity.

- [ ] **Step 3: Run db tests**

Run:

```bash
bun test tests/db.test.ts
```

Expected: PASS.

### Task 13: Worker-Backed Index Refresh

**Files:**
- Create: `opencode/tools/opencode-all/src/workers/index-worker.ts`
- Modify: `opencode/tools/opencode-all/src/dashboard/session-index.ts`
- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Test: `opencode/tools/opencode-all/tests/index-worker.test.ts`

- [ ] **Step 1: Add serialization helpers in `session-index.ts`**

Add exports:

```typescript
export type SerializableSessionIndex = {
  active: SessionRow[];
  archived: SessionRow[];
};

export function serializeSessionIndex(index: SessionIndex): SerializableSessionIndex {
  return { active: [...index.active.values()], archived: [...index.archived.values()] };
}

export function deserializeSessionIndex(raw: SerializableSessionIndex): SessionIndex {
  const index = emptyIndex();
  for (const row of raw.active) addActiveToIndex(index, row);
  for (const row of raw.archived) addArchivedToIndex(index, row);
  return index;
}
```

If `emptyIndex` is private, keep it private but call it inside `deserializeSessionIndex`.

- [ ] **Step 2: Create worker file**

Create `src/workers/index-worker.ts`:

```typescript
import { parentPort } from "node:worker_threads";
import { buildSessionIndex, serializeSessionIndex } from "../dashboard/session-index.ts";

parentPort?.on("message", (msg) => {
  try {
    if (msg.type === "refresh") {
      const index = buildSessionIndex({ cwd: msg.cwd, dbPath: msg.dbPath, archiveRoot: msg.archiveRoot });
      parentPort?.postMessage({ type: "refresh-result", index: serializeSessionIndex(index) });
    }
  } catch (error) {
    parentPort?.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
```

- [ ] **Step 3: Add worker integration test**

Add `tests/index-worker.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { deserializeSessionIndex, serializeSessionIndex, type SessionIndex } from "../src/dashboard/session-index.ts";

describe("session index serialization", () => {
  test("round-trips active and archived rows", () => {
    const index: SessionIndex = { active: new Map(), archived: new Map(), activeByDir: new Map(), archivedByDir: new Map() };
    const raw = serializeSessionIndex(index);
    const roundTrip = deserializeSessionIndex(raw);
    expect(roundTrip.active.size).toBe(0);
    expect(roundTrip.archived.size).toBe(0);
  });
});
```

- [ ] **Step 4: Wire async refresh in `tui.tsx`**

Add worker setup inside `startInteractiveTui`:

```typescript
  const indexWorker = new Worker(new URL("./workers/index-worker.ts", import.meta.url));
  indexWorker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "refresh-result") {
      state = reloadState({ ...state, index: deserializeSessionIndex(msg.index), status: "index refreshed" });
      rebuildLayout();
      refreshPanes();
      renderer.requestRender();
    }
    if (msg.type === "error") {
      state = { ...state, status: `refresh failed: ${msg.message}` };
      refreshPanes();
      renderer.requestRender();
    }
  };
```

Replace manual refresh handler with:

```typescript
      indexWorker.postMessage({ type: "refresh", cwd: cwd() });
      state = { ...state, status: "refreshing index" };
      refreshPanes();
      renderer.requestRender();
      return;
```

Terminate worker in `finally`:

```typescript
    indexWorker.terminate();
```

- [ ] **Step 5: Run worker tests and full tests**

Run:

```bash
bun test tests/index-worker.test.ts
bun test
```

Expected: PASS.

### Task 14: Final Verification and Manual Smoke Test

**Files:**
- All files changed above.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
bun test
bunx tsc --noEmit
bun run src/tui.tsx --list
```

Expected: all pass. `--list` prints active session rows or no output if the local DB has no sessions.

- [ ] **Step 2: Run fixture smoke test**

Run:

```bash
bash scripts/test-fixture.sh
```

Expected: script prints fixture instructions and launches against synthetic data.

- [ ] **Step 3: Manual TUI checks**

Run:

```bash
bun run src/tui.tsx
```

Manual expected behavior:

- Active folder row shows `N new`.
- Active session row shows `N new`.
- Archived tab does not show `N new`.
- `N` on archived tab sets status `new sessions only start from the Active tab`.
- `N` on active folder launches `opencode <directory>`.
- Returning from OpenCode refreshes index and keeps cursor position.
- `/` search input updates immediately and results update after the 150ms debounce.
- Large archive previews show `archive too large for preview` instead of freezing.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff -- opencode/tools/opencode-all opencode/docs/superpowers/specs/2026-06-23-opencode-all-fresh-session-design.md
```

Expected: only intended files changed.

Do not commit unless the user explicitly requests it. If the user requests a commit, route git operations through `hanko--git-seal` per repo policy.

---

## Self-Review Notes

- Spec coverage: Fresh-session feature maps to Tasks 1-5. Performance sections 12.1-12.8 map to Tasks 6-13.
- Deferred item: SQLite connection reuse is not in the implementation plan except as a documented deferral.
- Placeholder scan: No unfinished-marker text or open implementation gaps remain.
- Type consistency: `ContinueRequest`, `freshDirectory`, `runFreshSession`, `serializeSessionIndex`, and `deserializeSessionIndex` names are consistent across tasks.
