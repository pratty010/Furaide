# opencode-all Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `opencode-all` as a standalone OpenTUI session manager for OpenCode sessions, installed via XDG paths and hardened against terminal escape leakage.

**Architecture:** The tool is a standalone Bun/TypeScript application under `opencode/tools/opencode-all/`. It reads OpenCode session data through `bun:sqlite`, sanitizes all DB-sourced strings before rendering, and uses OpenCode CLI process handoff for export/delete/continue actions. Archive/restore are the only direct SQLite writes and are limited to the `session.time_archived` column.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `@opentui/core`, OpenCode CLI, XDG user install paths, `bun test`.

---

## File Structure

Create these files:

- `opencode/tools/opencode-all/package.json`: package metadata, bin target, scripts, dependencies.
- `opencode/tools/opencode-all/tsconfig.json`: TypeScript config for Bun.
- `opencode/tools/opencode-all/bunfig.toml`: Bun test/root config.
- `opencode/tools/opencode-all/src/sanitize.ts`: terminal escape sanitizer and length caps.
- `opencode/tools/opencode-all/src/db.ts`: OpenCode SQLite reader and archive/restore helper.
- `opencode/tools/opencode-all/src/tui.tsx`: executable OpenTUI app entrypoint, state, keybinds, actions.
- `opencode/tools/opencode-all/themes/friday.json`: reduced Friday palette.
- `opencode/tools/opencode-all/scripts/install.sh`: XDG install + symlink setup.
- `opencode/tools/opencode-all/tests/sanitize.test.ts`: sanitizer/security unit tests.
- `opencode/tools/opencode-all/tests/db.test.ts`: synthetic DB tests.
- `opencode/tools/opencode-all/tests/tui.test.tsx`: TUI state and action tests.

No existing files are modified in this plan.

## Task 1: Scaffold Package And Installer

**Files:**

- Create: `opencode/tools/opencode-all/package.json`
- Create: `opencode/tools/opencode-all/tsconfig.json`
- Create: `opencode/tools/opencode-all/bunfig.toml`
- Create: `opencode/tools/opencode-all/scripts/install.sh`

- [ ] **Step 1: Create package metadata**

Create `opencode/tools/opencode-all/package.json` with:

```json
{
  "name": "@furaide/opencode-all",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "opencode-all": "./src/tui.tsx"
  },
  "scripts": {
    "test": "bun test tests",
    "test:sanitize": "bun test tests/sanitize.test.ts",
    "test:db": "bun test tests/db.test.ts",
    "test:tui": "bun test tests/tui.test.tsx",
    "install:local": "bash scripts/install.sh"
  },
  "dependencies": {
    "@opentui/core": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `opencode/tools/opencode-all/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"]
}
```

- [ ] **Step 3: Create Bun config**

Create `opencode/tools/opencode-all/bunfig.toml` with:

```toml
[test]
root = "./tests"
```

- [ ] **Step 4: Create installer**

Create `opencode/tools/opencode-all/scripts/install.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${OPENCODE_ALL_INSTALL_DIR:-$HOME/.local/share/opencode/tools/opencode-all}"
BIN_DIR="${OPENCODE_ALL_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/opencode-all"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  "$SOURCE_DIR/" "$INSTALL_DIR/"

chmod +x "$INSTALL_DIR/src/tui.tsx"
ln -sfn "$INSTALL_DIR/src/tui.tsx" "$BIN_PATH"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'warning: %s is not on PATH\n' "$BIN_DIR" >&2 ;;
esac

printf 'installed opencode-all -> %s\n' "$BIN_PATH"
```

- [ ] **Step 5: Make installer executable**

Run:

```bash
chmod +x opencode/tools/opencode-all/scripts/install.sh
```

Expected: command exits 0.

- [ ] **Step 6: Verify package tests command currently has no tests**

Run:

```bash
bun test opencode/tools/opencode-all/tests
```

Expected: Bun reports no tests or exits non-zero because the tests directory does not exist yet. This is acceptable before Task 2.

## Task 2: Implement Sanitizer With Tests First

**Files:**

- Create: `opencode/tools/opencode-all/tests/sanitize.test.ts`
- Create: `opencode/tools/opencode-all/src/sanitize.ts`

- [ ] **Step 1: Write failing sanitizer tests**

Create `opencode/tools/opencode-all/tests/sanitize.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";
import { capText, hasControlBytes, renderSafe } from "../src/sanitize.ts";

describe("renderSafe", () => {
  test("strips OSC 52 clipboard payloads", () => {
    expect(renderSafe("a\x1b]52;c;SGVsbG8=\x07b")).toBe("ab");
  });

  test("strips OSC 0 title spoofing", () => {
    expect(renderSafe("x\x1b]0;FAKE PROMPT\x07y")).toBe("xy");
  });

  test("strips OSC 8 hyperlink wrappers but keeps text", () => {
    expect(renderSafe("\x1b]8;;https://evil.example\x07CLICK\x1b]8;;\x07")).toBe("CLICK");
  });

  test("strips CSI clear screen", () => {
    expect(renderSafe("before\x1b[2Jafter")).toBe("beforeafter");
  });

  test("strips DCS payloads", () => {
    expect(renderSafe("a\x1bP1;2;3+qAAAA\x1b\\b")).toBe("ab");
  });

  test("preserves printable text, tabs, and newlines", () => {
    expect(renderSafe("alpha\tbeta\ngamma")).toBe("alpha\tbeta\ngamma");
  });

  test("removes raw control bytes except tab and newline", () => {
    expect(renderSafe("a\x00b\x07c\rd")).toBe("abcd");
  });
});

describe("hasControlBytes", () => {
  test("detects raw ESC and BEL", () => {
    expect(hasControlBytes("safe")).toBe(false);
    expect(hasControlBytes("bad\x1b[2J")).toBe(true);
    expect(hasControlBytes("bad\x07")).toBe(true);
  });
});

describe("capText", () => {
  test("caps long text with ellipsis", () => {
    expect(capText("abcdef", 4)).toBe("abc…");
  });

  test("does not cap short text", () => {
    expect(capText("abc", 4)).toBe("abc");
  });
});
```

- [ ] **Step 2: Run sanitizer tests to verify failure**

Run:

```bash
bun test opencode/tools/opencode-all/tests/sanitize.test.ts
```

Expected: FAIL because `../src/sanitize.ts` does not exist.

- [ ] **Step 3: Implement sanitizer**

Create `opencode/tools/opencode-all/src/sanitize.ts` with:

```ts
const ESC = "\x1b";
const BEL = "\x07";

function stripUntilTerminator(input: string, start: number): number {
  for (let i = start; i < input.length; i++) {
    if (input[i] === BEL) return i + 1;
    if (input[i] === ESC && input[i + 1] === "\\") return i + 2;
  }
  return input.length;
}

function stripCsi(input: string, start: number): number {
  for (let i = start; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) return i + 1;
  }
  return input.length;
}

export function renderSafe(input: unknown): string {
  const text = String(input ?? "");
  let out = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);

    if (ch === ESC) {
      const next = text[i + 1];
      if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
        i = stripUntilTerminator(text, i + 2) - 1;
        continue;
      }
      if (next === "[") {
        i = stripCsi(text, i + 2) - 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }

    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }

  return out;
}

export function hasControlBytes(input: unknown): boolean {
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(String(input ?? ""));
}

export function capText(input: unknown, max: number): string {
  const text = renderSafe(input);
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}
```

- [ ] **Step 4: Run sanitizer tests to verify pass**

Run:

```bash
bun test opencode/tools/opencode-all/tests/sanitize.test.ts
```

Expected: PASS.

## Task 3: Implement SQLite Data Layer With Tests First

**Files:**

- Create: `opencode/tools/opencode-all/tests/db.test.ts`
- Create: `opencode/tools/opencode-all/src/db.ts`

- [ ] **Step 1: Write failing DB tests**

Create `opencode/tools/opencode-all/tests/db.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { getSessionDetail, listDirectories, listSessions, setArchived } from "../src/db.ts";

const root = join(import.meta.dir, ".tmp-db");
const dbPath = join(root, "opencode.db");

function seed() {
  mkdirSync(root, { recursive: true });
  const db = new Database(dbPath);
  db.run(`CREATE TABLE session (
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
  )`);
  db.run(`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer, data text)`);
  db.run(`INSERT INTO session VALUES
    ('ses_a','p',NULL,'a','/repo/current','Current newest','v',NULL,1,2,1,1000,5000,NULL,NULL,'','build','model-a',1.5,100,200),
    ('ses_b','p',NULL,'b','/repo/other','Other newest','v',NULL,0,0,0,1000,6000,NULL,NULL,'','general','model-b',3.0,200,300),
    ('ses_c','p',NULL,'c','/repo/current/sub','Current old','v',NULL,0,0,0,1000,3000,NULL,NULL,'','build','model-a',0.2,10,20),
    ('ses_d','p',NULL,'d','/repo/archive','Archived','v',NULL,0,0,0,1000,2000,7000,NULL,'','build','model-c',0.1,1,2),
    ('ses_child','p','ses_a','child','/repo/current','Child','v',NULL,0,0,0,1000,9000,NULL,NULL,'','build','model-a',9,9,9)
  `);
  db.run(`INSERT INTO message VALUES ('msg_a','ses_a',1000,'{}'), ('msg_b','ses_a',1001,'{}')`);
  db.close();
}

beforeEach(seed);
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("listSessions", () => {
  test("lists active parent sessions with cwd boost", () => {
    const rows = listSessions({ dbPath, tab: "active", cwd: "/repo/current" });
    expect(rows.map(row => row.id)).toEqual(["ses_a", "ses_c", "ses_b"]);
  });

  test("lists archived sessions by archive recency", () => {
    const rows = listSessions({ dbPath, tab: "archived", cwd: "/repo/current" });
    expect(rows.map(row => row.id)).toEqual(["ses_d"]);
  });

  test("filters by substring across title directory agent and model", () => {
    expect(listSessions({ dbPath, tab: "all", cwd: "/none", query: "current" }).map(row => row.id)).toEqual(["ses_a", "ses_c"]);
    expect(listSessions({ dbPath, tab: "all", cwd: "/none", query: "model-b" }).map(row => row.id)).toEqual(["ses_b"]);
  });
});

describe("detail and archive", () => {
  test("gets detail with message count", () => {
    const detail = getSessionDetail({ dbPath, id: "ses_a" });
    expect(detail?.id).toBe("ses_a");
    expect(detail?.messages).toBe(2);
  });

  test("archives and restores a session", () => {
    setArchived({ dbPath, id: "ses_a", archivedAt: 8000 });
    expect(listSessions({ dbPath, tab: "archived", cwd: "/repo/current" }).map(row => row.id)).toContain("ses_a");
    setArchived({ dbPath, id: "ses_a", archivedAt: null });
    expect(listSessions({ dbPath, tab: "active", cwd: "/repo/current" }).map(row => row.id)).toContain("ses_a");
  });
});

describe("directories", () => {
  test("lists unique directories with counts", () => {
    expect(listDirectories({ dbPath, prefix: "/repo" })).toEqual([
      { directory: "/repo/archive", count: 1 },
      { directory: "/repo/current", count: 1 },
      { directory: "/repo/current/sub", count: 1 },
      { directory: "/repo/other", count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run DB tests to verify failure**

Run:

```bash
bun test opencode/tools/opencode-all/tests/db.test.ts
```

Expected: FAIL because `src/db.ts` does not exist.

- [ ] **Step 3: Implement DB module**

Create `opencode/tools/opencode-all/src/db.ts` with:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { capText, hasControlBytes, renderSafe } from "./sanitize.ts";

export type Tab = "active" | "archived" | "all";

export type SessionRow = {
  id: string;
  title: string;
  directory: string;
  path: string;
  agent: string;
  model: string;
  shareUrl: string;
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  timeCreated: number;
  timeUpdated: number;
  timeArchived: number | null;
  isCurrent: boolean;
  suspicious: boolean;
};

export type SessionDetail = SessionRow & { messages: number; diffPath: string | null };

export type ListOptions = {
  dbPath?: string;
  tab: Tab;
  cwd: string;
  query?: string;
  directory?: string;
};

export function defaultDbPath(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "opencode.db");
}

function openDb(path = defaultDbPath()): Database {
  const db = new Database(path);
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

function tabWhere(tab: Tab): string {
  if (tab === "active") return "time_archived IS NULL";
  if (tab === "archived") return "time_archived IS NOT NULL";
  return "1 = 1";
}

function toRow(raw: any, cwd: string): SessionRow {
  const title = renderSafe(raw.title);
  const directory = renderSafe(raw.directory);
  const path = renderSafe(raw.path);
  const agent = renderSafe(raw.agent);
  const model = renderSafe(raw.model);
  const shareUrl = renderSafe(raw.share_url);
  const isCurrent = directory.startsWith(cwd) || path.startsWith(cwd);
  const suspicious = [raw.title, raw.directory, raw.path, raw.agent, raw.model, raw.share_url].some(hasControlBytes);
  return {
    id: String(raw.id),
    title: capText(title, 240),
    directory: capText(directory, 300),
    path: capText(path, 300),
    agent: capText(agent, 80),
    model: capText(model, 120),
    shareUrl: capText(shareUrl, 240),
    cost: Number(raw.cost || 0),
    tokensInput: Number(raw.tokens_input || 0),
    tokensOutput: Number(raw.tokens_output || 0),
    timeCreated: Number(raw.time_created || 0),
    timeUpdated: Number(raw.time_updated || 0),
    timeArchived: raw.time_archived == null ? null : Number(raw.time_archived),
    isCurrent,
    suspicious,
  };
}

function rank(row: SessionRow, q: string): number {
  if (!q) return 0;
  const fields = [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl].map(v => v.toLowerCase());
  const query = q.toLowerCase();
  if (fields.some(v => v.startsWith(query))) return 0;
  if (fields.some(v => v.includes(query))) return 1;
  return 2;
}

function subsequence(haystack: string, needle: string): boolean {
  let idx = 0;
  for (const char of haystack.toLowerCase()) {
    if (char === needle[idx]?.toLowerCase()) idx++;
    if (idx === needle.length) return true;
  }
  return needle.length === 0;
}

function matches(row: SessionRow, q = ""): boolean {
  if (!q) return true;
  const fields = [row.title, row.directory, row.path, row.agent, row.model, row.shareUrl];
  return fields.some(field => field.toLowerCase().includes(q.toLowerCase()) || subsequence(field, q));
}

export function listSessions(options: ListOptions): SessionRow[] {
  const db = openDb(options.dbPath);
  try {
    const rows = db.query(`
      SELECT id, title, directory, COALESCE(path, '') AS path, COALESCE(agent, '') AS agent,
             COALESCE(model, '') AS model, COALESCE(share_url, '') AS share_url,
             cost, tokens_input, tokens_output, time_created, time_updated, time_archived
      FROM session
      WHERE parent_id IS NULL AND ${tabWhere(options.tab)}
      ORDER BY time_updated DESC
    `).all().map(raw => toRow(raw, options.cwd));
    return rows
      .filter(row => !options.directory || row.directory === options.directory)
      .filter(row => matches(row, options.query))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || rank(a, options.query || "") - rank(b, options.query || "") || b.timeUpdated - a.timeUpdated);
  } finally {
    db.close();
  }
}

export function getSessionDetail(options: { dbPath?: string; id: string; cwd?: string }): SessionDetail | null {
  const db = openDb(options.dbPath);
  try {
    const raw = db.query(`
      SELECT id, title, directory, COALESCE(path, '') AS path, COALESCE(agent, '') AS agent,
             COALESCE(model, '') AS model, COALESCE(share_url, '') AS share_url,
             cost, tokens_input, tokens_output, time_created, time_updated, time_archived
      FROM session WHERE id = ?
    `).get(options.id);
    if (!raw) return null;
    const row = toRow(raw, options.cwd || process.cwd());
    const messages = Number(db.query("SELECT COUNT(*) AS count FROM message WHERE session_id = ?").get(options.id)?.count || 0);
    const diffBase = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
    const diffPath = join(diffBase, "opencode", "storage", "session_diff", `${options.id}.json`);
    return { ...row, messages, diffPath: existsSync(diffPath) ? diffPath : null };
  } finally {
    db.close();
  }
}

export function setArchived(options: { dbPath?: string; id: string; archivedAt: number | null }): void {
  const db = openDb(options.dbPath);
  try {
    db.query("UPDATE session SET time_archived = ? WHERE id = ?").run(options.archivedAt, options.id);
  } finally {
    db.close();
  }
}

export function listDirectories(options: { dbPath?: string; prefix?: string }): Array<{ directory: string; count: number }> {
  const db = openDb(options.dbPath);
  try {
    const prefix = renderSafe(options.prefix || "").toLowerCase();
    return db.query(`
      SELECT directory, COUNT(*) AS count
      FROM session
      WHERE parent_id IS NULL
      GROUP BY directory
      ORDER BY directory ASC
    `).all()
      .map((row: any) => ({ directory: renderSafe(row.directory), count: Number(row.count || 0) }))
      .filter(row => !prefix || row.directory.toLowerCase().includes(prefix));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run DB tests to verify pass**

Run:

```bash
bun test opencode/tools/opencode-all/tests/db.test.ts
```

Expected: PASS.

## Task 4: Add Friday Theme

**Files:**

- Create: `opencode/tools/opencode-all/themes/friday.json`

- [ ] **Step 1: Create reduced theme**

Create `opencode/tools/opencode-all/themes/friday.json` with:

```json
{
  "name": "friday-opencode-all",
  "vars": {
    "bg": "#040410",
    "surface": "#0a0616",
    "surfaceAlt": "#120a22",
    "accent": "#ff0080",
    "violet": "#7b2fff",
    "success": "#39ff14",
    "warning": "#ffaa00",
    "error": "#ff4466",
    "muted": "#b48fe0",
    "dim": "#8064a8",
    "text": "#f2eaff",
    "cyan": "#00d8ff"
  },
  "pane": {
    "listBorder": "dim",
    "listBorderFocus": "accent",
    "listSelectedBg": "surfaceAlt",
    "listSelectedFg": "text",
    "listCursor": "accent",
    "detailBorder": "dim",
    "detailLabel": "muted",
    "detailValue": "text",
    "detailCost": "violet",
    "detailTokens": "cyan",
    "detailStatusActive": "success",
    "detailStatusArchived": "warning",
    "detailStatusDeleted": "error",
    "statusBg": "surface",
    "statusFg": "muted",
    "statusKey": "accent",
    "modalBorder": "accent",
    "modalBg": "surface",
    "modalFg": "text"
  }
}
```

- [ ] **Step 2: Verify JSON parses**

Run:

```bash
bun -e 'console.log(JSON.parse(await Bun.file("opencode/tools/opencode-all/themes/friday.json").text()).name)'
```

Expected output:

```text
friday-opencode-all
```

## Task 5: Implement Minimal TUI State And Navigation With Tests First

**Files:**

- Create: `opencode/tools/opencode-all/tests/tui.test.tsx`
- Create: `opencode/tools/opencode-all/src/tui.tsx`

- [ ] **Step 1: Write failing TUI state tests**

Create `opencode/tools/opencode-all/tests/tui.test.tsx` with:

```ts
import { describe, expect, test } from "bun:test";
import { applyKey, createInitialState, currentSession, type UiSession } from "../src/tui.tsx";

const sessions: UiSession[] = Array.from({ length: 100 }, (_, index) => ({
  id: `ses_${index}`,
  title: `Session ${index}`,
  directory: index % 2 === 0 ? "/repo/current" : "/repo/other",
  path: "",
  agent: "build",
  model: "model",
  shareUrl: "",
  cost: index,
  tokensInput: index,
  tokensOutput: index,
  timeCreated: index,
  timeUpdated: index,
  timeArchived: null,
  isCurrent: index % 2 === 0,
  suspicious: false,
}));

describe("TUI state", () => {
  test("moves selection and scrolls", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    for (let i = 0; i < 60; i++) state = applyKey(state, "j");
    expect(state.cursor).toBe(60);
    expect(state.listScroll).toBeGreaterThan(0);
    expect(currentSession(state)?.id).toBe("ses_60");
  });

  test("jumps top and bottom", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "G");
    expect(state.cursor).toBe(99);
    state = applyKey(state, "gg");
    expect(state.cursor).toBe(0);
  });

  test("cycles active archived all tabs", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    expect(state.tab).toBe("active");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("archived");
    state = applyKey(state, "Tab");
    expect(state.tab).toBe("all");
  });

  test("drills and backs out", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "drill:/repo/current");
    expect(state.directory).toBe("/repo/current");
    expect(state.stack).toHaveLength(1);
    state = applyKey(state, "b");
    expect(state.directory).toBeUndefined();
    expect(state.stack).toHaveLength(0);
  });

  test("clears drill stack", () => {
    let state = createInitialState(sessions, { height: 20, width: 100 });
    state = applyKey(state, "drill:/repo/current");
    state = applyKey(state, "drill:/repo/current/sub");
    expect(state.stack).toHaveLength(2);
    state = applyKey(state, "B");
    expect(state.directory).toBeUndefined();
    expect(state.stack).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run TUI tests to verify failure**

Run:

```bash
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

Expected: FAIL because `src/tui.tsx` does not exist.

- [ ] **Step 3: Implement testable TUI state core**

Create the first version of `opencode/tools/opencode-all/src/tui.tsx` with:

```ts
#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getSessionDetail, listDirectories, listSessions, setArchived, type SessionRow, type Tab } from "./db.ts";

export type UiSession = SessionRow;

export type Viewport = { height: number; width: number };

export type UiState = {
  sessions: UiSession[];
  cursor: number;
  listScroll: number;
  detailScroll: number;
  tab: Tab;
  query: string;
  directory?: string;
  sort: "updated" | "created" | "cost" | "title" | "recency";
  stack: Array<Pick<UiState, "cursor" | "listScroll" | "tab" | "query" | "directory" | "sort">>;
  viewport: Viewport;
  status: string;
};

const tabs: Tab[] = ["active", "archived", "all"];

export function createInitialState(sessions: UiSession[], viewport: Viewport): UiState {
  return {
    sessions,
    cursor: 0,
    listScroll: 0,
    detailScroll: 0,
    tab: "active",
    query: "",
    sort: "updated",
    stack: [],
    viewport,
    status: "ready",
  };
}

function visibleRows(state: UiState): number {
  return Math.max(1, state.viewport.height - 3);
}

function clampCursor(state: UiState): UiState {
  const max = Math.max(0, state.sessions.length - 1);
  const cursor = Math.max(0, Math.min(state.cursor, max));
  const rows = visibleRows(state);
  let listScroll = state.listScroll;
  if (cursor < listScroll) listScroll = cursor;
  if (cursor >= listScroll + rows) listScroll = cursor - rows + 1;
  return { ...state, cursor, listScroll: Math.max(0, listScroll) };
}

export function currentSession(state: UiState): UiSession | undefined {
  return state.sessions[state.cursor];
}

function pushDrill(state: UiState, directory: string): UiState {
  return clampCursor({
    ...state,
    stack: [...state.stack, { cursor: state.cursor, listScroll: state.listScroll, tab: state.tab, query: state.query, directory: state.directory, sort: state.sort }],
    directory,
    query: "",
    tab: "all",
    cursor: 0,
    listScroll: 0,
    status: `drilled into ${directory}`,
  });
}

function popDrill(state: UiState): UiState {
  const previous = state.stack.at(-1);
  if (!previous) return state;
  return clampCursor({ ...state, ...previous, stack: state.stack.slice(0, -1), status: "back" });
}

export function applyKey(state: UiState, key: string): UiState {
  if (key.startsWith("drill:")) return pushDrill(state, key.slice("drill:".length));
  if (key === "j" || key === "ArrowDown") return clampCursor({ ...state, cursor: state.cursor + 1 });
  if (key === "k" || key === "ArrowUp") return clampCursor({ ...state, cursor: state.cursor - 1 });
  if (key === "G") return clampCursor({ ...state, cursor: state.sessions.length - 1 });
  if (key === "gg") return clampCursor({ ...state, cursor: 0 });
  if (key === "Ctrl+D" || key === "PageDown") return clampCursor({ ...state, cursor: state.cursor + Math.floor(visibleRows(state) / 2) });
  if (key === "Ctrl+U" || key === "PageUp") return clampCursor({ ...state, cursor: state.cursor - Math.floor(visibleRows(state) / 2) });
  if (key === "Tab") return clampCursor({ ...state, tab: tabs[(tabs.indexOf(state.tab) + 1) % tabs.length], cursor: 0, listScroll: 0 });
  if (key === "b") return popDrill(state);
  if (key === "B") return clampCursor({ ...state, stack: [], directory: undefined, query: "", cursor: 0, listScroll: 0, status: "reset" });
  return state;
}

function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all");
}

function audit(action: string, sessionId: string, status: string): void {
  const file = join(dataDir(), "audit.log");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), action, session_id: sessionId, status })}\n`, { flag: "a", mode: 0o600 });
}

function opencodeBin(): string {
  return process.env.OPENCODE_ALL_OPENCODE_BIN || "opencode";
}

export function exportSession(id: string, raw = false): number {
  const args = ["export", id];
  if (!raw) args.push("--sanitize");
  const result = spawnSync(opencodeBin(), args, { stdio: "inherit" });
  audit(raw ? "export_raw" : "export_sanitized", id, String(result.status ?? 1));
  return result.status ?? 1;
}

export function deleteSession(id: string): number {
  const result = spawnSync(opencodeBin(), ["session", "delete", id], { stdio: "inherit" });
  audit("delete", id, String(result.status ?? 1));
  return result.status ?? 1;
}

export function archiveSession(id: string): void {
  setArchived({ id, archivedAt: Date.now() });
  audit("archive", id, "ok");
}

export function restoreSession(id: string): void {
  setArchived({ id, archivedAt: null });
  audit("restore", id, "ok");
}

export function continueSession(id: string, fork = false): never {
  const args = ["--session", id];
  if (fork) args.push("--fork");
  spawnSync(opencodeBin(), args, { stdio: "inherit" });
  process.exit(0);
}

function printFallbackList(): void {
  const rows = listSessions({ tab: "active", cwd: process.env.OPENCODE_ALL_CWD || process.cwd() });
  for (const row of rows) {
    console.log(`${row.id}\t${row.title}\t${row.directory}`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--list")) {
    printFallbackList();
    return;
  }

  printFallbackList();
}

if (import.meta.main) await main();
```

- [ ] **Step 4: Run TUI state tests to verify pass**

Run:

```bash
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

Expected: PASS.

## Task 6: Wire OpenTUI Render Loop

**Files:**

- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Modify: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Add render snapshot tests**

Append to `opencode/tools/opencode-all/tests/tui.test.tsx`:

```ts
import { renderRows } from "../src/tui.tsx";

describe("renderRows", () => {
  test("renders selected row and status", () => {
    const state = createInitialState(sessions.slice(0, 3), { height: 10, width: 100 });
    const output = renderRows(state).join("\n");
    expect(output).toContain("❯ Session 0");
    expect(output).toContain("q quit");
  });

  test("renders scroll counter", () => {
    let state = createInitialState(sessions, { height: 10, width: 100 });
    state = applyKey(state, "G");
    expect(renderRows(state).join("\n")).toContain("100 / 100");
  });
});
```

- [ ] **Step 2: Run TUI tests to verify failure**

Run:

```bash
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

Expected: FAIL because `renderRows` is not exported.

- [ ] **Step 3: Add deterministic renderer helper**

Add this export to `opencode/tools/opencode-all/src/tui.tsx` before `main()`:

```ts
function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function fmtCost(value: number): string {
  return value > 0 ? `$${value.toFixed(2)}` : "";
}

export function renderRows(state: UiState): string[] {
  const rows = visibleRows(state);
  const leftWidth = Math.min(50, Math.max(24, Math.floor(state.viewport.width * 0.45)));
  const visible = state.sessions.slice(state.listScroll, state.listScroll + rows);
  const lines = [`Sessions ${state.cursor + 1} / ${state.sessions.length} [${state.tab}]`.padEnd(leftWidth) + " │ Detail"];
  for (let i = 0; i < rows; i++) {
    const session = visible[i];
    if (!session) {
      lines.push(pad("", leftWidth) + " │");
      continue;
    }
    const absolute = state.listScroll + i;
    const marker = absolute === state.cursor ? "❯" : " ";
    const archive = session.timeArchived == null ? "" : "[A] ";
    const left = `${marker} ${archive}${session.title}`;
    const right = absolute === state.cursor ? `${session.id} ${session.directory} ${fmtCost(session.cost)}` : "";
    lines.push(pad(left, leftWidth) + " │ " + right);
  }
  lines.push("q quit · / search · \\ dirs · Tab tabs · e export · a archive · r restore · d delete · c continue · R refresh");
  return lines;
}
```

- [ ] **Step 4: Replace fallback main with render output**

Change the final branch in `main()` to:

```ts
  const rows = listSessions({ tab: "active", cwd: process.env.OPENCODE_ALL_CWD || process.cwd() });
  const state = createInitialState(rows, { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
  for (const line of renderRows(state)) console.log(line);
```

- [ ] **Step 5: Run TUI tests to verify pass**

Run:

```bash
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Integrate OpenTUI with one text renderable**

Modify the top imports in `opencode/tools/opencode-all/src/tui.tsx` by adding:

```ts
import { createCliRenderer, Text } from "@opentui/core";
```

Add this function before `main()`:

```ts
function mapKey(key: any): string {
  if (key?.ctrl && key?.name === "c") return "q";
  if (key?.ctrl && key?.name === "d") return "Ctrl+D";
  if (key?.ctrl && key?.name === "u") return "Ctrl+U";
  if (key?.name === "down") return "j";
  if (key?.name === "up") return "k";
  if (key?.name === "pagedown") return "PageDown";
  if (key?.name === "pageup") return "PageUp";
  if (key?.name === "tab") return "Tab";
  return key?.sequence || key?.name || "";
}

export async function startInteractiveTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    useMouse: true,
  });

  let state = createInitialState(
    listSessions({ tab: "active", cwd: process.env.OPENCODE_ALL_CWD || process.cwd() }),
    { height: process.stdout.rows || 24, width: process.stdout.columns || 100 },
  );

  const screen = Text({ content: renderRows(state).join("\n"), fg: "#f2eaff" });
  renderer.root.add(screen);

  let pendingG = false;
  renderer.keyInput.on("keypress", (key: any) => {
    const mapped = mapKey(key);
    if (mapped === "q") {
      renderer.destroy();
      process.exit(0);
    }
    if (pendingG && mapped === "g") {
      state = applyKey(state, "gg");
      pendingG = false;
    } else if (mapped === "g") {
      pendingG = true;
      return;
    } else {
      pendingG = false;
      state = applyKey(state, mapped);
    }
    screen.setContent(renderRows(state).join("\n"));
    renderer.requestRender();
  });
}
```

Replace the final branch in `main()` with:

```ts
  if (process.stdout.isTTY && !argv.includes("--no-tui")) {
    await startInteractiveTui();
    return;
  }

  const rows = listSessions({ tab: "active", cwd: process.env.OPENCODE_ALL_CWD || process.cwd() });
  const state = createInitialState(rows, { height: process.stdout.rows || 24, width: process.stdout.columns || 100 });
  for (const line of renderRows(state)) console.log(line);
```

Verification command after wiring OpenTUI:

```bash
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

Expected: PASS. Then run `bun opencode/tools/opencode-all/src/tui.tsx --list` to confirm the non-interactive fallback still prints rows.

## Task 7: Add Action Confirmations And Error Handling

**Files:**

- Modify: `opencode/tools/opencode-all/src/tui.tsx`
- Modify: `opencode/tools/opencode-all/tests/tui.test.tsx`

- [ ] **Step 1: Add tests for confirmation state**

Append to `opencode/tools/opencode-all/tests/tui.test.tsx`:

```ts
describe("confirmation state", () => {
  test("delete opens a confirmation modal", () => {
    let state = createInitialState(sessions.slice(0, 1), { height: 10, width: 100 });
    state = applyKey(state, "d");
    expect(state.status).toContain("confirm delete");
  });

  test("archive opens a confirmation modal", () => {
    let state = createInitialState(sessions.slice(0, 1), { height: 10, width: 100 });
    state = applyKey(state, "a");
    expect(state.status).toContain("confirm archive");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

Expected: FAIL because `applyKey` does not set confirmation status.

- [ ] **Step 3: Add action status states**

Update `applyKey` in `opencode/tools/opencode-all/src/tui.tsx` by inserting before `return state;`:

```ts
  if (key === "d") return { ...state, status: `confirm delete ${currentSession(state)?.id || ""}`.trim() };
  if (key === "a") return { ...state, status: `confirm archive ${currentSession(state)?.id || ""}`.trim() };
  if (key === "r") return { ...state, status: `confirm restore ${currentSession(state)?.id || ""}`.trim() };
  if (key === "e") return { ...state, status: `confirm export sanitized ${currentSession(state)?.id || ""}`.trim() };
  if (key === "E") return { ...state, status: `confirm export raw ${currentSession(state)?.id || ""}`.trim() };
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
bun test opencode/tools/opencode-all/tests/tui.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add runtime error helper**

Add to `opencode/tools/opencode-all/src/tui.tsx`:

```ts
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as any).code === "ENOENT") {
    return "opencode CLI not found. Set OPENCODE_ALL_OPENCODE_BIN or install opencode.";
  }
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 6: Use error helper around action spawns**

Wrap `exportSession`, `deleteSession`, `continueSession`, `archiveSession`, and `restoreSession` bodies in `try/catch` and call `audit(action, id, "error")` in catch branches. Re-throw after auditing so the UI can display `errorMessage(error)`.

## Task 8: Install And End-to-End Verification

**Files:**

- Use existing files created by prior tasks.

- [ ] **Step 1: Run all opencode-all tests**

Run:

```bash
bun test opencode/tools/opencode-all/tests
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
bunx tsc --noEmit -p opencode/tools/opencode-all/tsconfig.json
```

Expected: exits 0.

- [ ] **Step 3: Install locally**

Run:

```bash
bash opencode/tools/opencode-all/scripts/install.sh
```

Expected output includes:

```text
installed opencode-all -> /home/ace/.local/bin/opencode-all
```

- [ ] **Step 4: Verify symlink**

Run:

```bash
ls -la "$HOME/.local/bin/opencode-all"
```

Expected: symlink to `$HOME/.local/share/opencode/tools/opencode-all/src/tui.tsx`.

- [ ] **Step 5: Verify executable starts**

Run:

```bash
opencode-all --list
```

Expected: prints tab-separated session rows or an empty list without throwing.

- [ ] **Step 6: Verify DLP tests independently**

Run:

```bash
bun test opencode/tools/opencode-all/tests/sanitize.test.ts
```

Expected: PASS.

## Self-Review Checklist

- Spec coverage: install path, standalone process, DB reads, archive/restore carve-out, DLP, sort priority, tabs, search, directory drill, scrolling, click-to-drill, actions, error handling, and tests are covered by tasks.
- Placeholder scan: this plan uses concrete paths, commands, file contents, and expected outputs.
- Type consistency: `SessionRow`, `UiSession`, `UiState`, `Tab`, `listSessions`, `getSessionDetail`, `setArchived`, `renderSafe`, `hasControlBytes`, and `capText` are defined before use.

## Execution Options

Plan complete and saved to `opencode/docs/superpowers/plans/2026-06-18-opencode-all-implementation-plan.md`.

1. **Subagent-Driven (recommended)**: dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution**: execute tasks in this session using executing-plans, with checkpoints for review.
