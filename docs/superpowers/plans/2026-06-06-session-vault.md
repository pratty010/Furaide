# Session Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic Session Vault that indexes active and archived OpenCode sessions, keeps the index fresh from plugin session events, and exposes `/session-vault` subcommands for list, show, archive, restore, delete, continue, refresh, and search.

**Architecture:** Use `~/.local/share/opencode/session-vault/index.json` as the read-optimized materialized view for list/search. Use the OpenCode SDK client from plugin context for refresh, show enrichment, continue, and event-driven updates. Keep vault deletion limited to removing vault records; do not call SDK `session.delete`.

**Tech Stack:** Node ESM, Bun test runner, OpenCode plugin event hooks, OpenCode SDK client from plugin context, JSON index with atomic writes.

---

## File Structure

- Modify `opencode/scripts/lib/session-vault-index.mjs`: owns index versioning, migration, normalization, upsert/remove/archive/restore, and atomic save.
- Modify `opencode/scripts/session-vault.mjs`: owns deterministic CLI helpers and subcommand behavior.
- Modify `opencode/plugins/omokage.js`: owns plugin event wiring and SDK-driven index refresh/update/archive handling.
- Modify `opencode/command/session-vault.md`: documents command behavior for the OpenCode command prompt.
- Modify `opencode/scripts/tests/session-vault-index.test.mjs`: tests index v2 behavior and migrations.
- Modify `opencode/scripts/tests/session-vault-helper.test.mjs`: tests CLI pure helpers and index-only command helpers.
- Modify `opencode/scripts/tests/session-vault-plugin.test.mjs`: tests plugin event routing without requiring a live OpenCode server.

Run commands from `opencode/` unless explicitly stated otherwise.

Do not create commits unless the user explicitly asks for commits.

---

### Task 1: Index Schema v2 And Migration

**Files:**
- Modify: `opencode/scripts/lib/session-vault-index.mjs`
- Test: `opencode/scripts/tests/session-vault-index.test.mjs`

- [ ] **Step 1: Write failing tests for v2 defaults and migration**

Replace `opencode/scripts/tests/session-vault-index.test.mjs` with:

```js
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INDEX_VERSION,
  archiveSession,
  emptyIndex,
  loadIndex,
  removeSession,
  restoreSession,
  saveIndex,
  upsertSession,
} from '../lib/session-vault-index.mjs';

test('loadIndex returns empty v2 structure when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  expect(loadIndex(file)).toEqual(emptyIndex());
  expect(INDEX_VERSION).toBe(2);
});

test('loadIndex migrates v1 sessions to v2 defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      sessions: [{ id: 'ses_1', title: 'Old', workspace: '/repo', status: 'deleted', updated_at: '2026-06-05T10:00:00.000Z' }],
    }),
  );

  const index = loadIndex(file);
  expect(index.version).toBe(2);
  expect(index.sessions[0]).toEqual({
    id: 'ses_1',
    title: 'Old',
    workspace: '/repo',
    status: 'archived',
    model: null,
    tokens_in: null,
    tokens_out: null,
    messages_count: null,
    cost: null,
    created_at: '2026-06-05T10:00:00.000Z',
    updated_at: '2026-06-05T10:00:00.000Z',
    archived_at: null,
    archive_path: null,
  });
});

test('upsertSession inserts and updates normalized records by id', () => {
  const first = upsertSession(emptyIndex(), { id: 'ses_1', title: 'First', workspace: '/repo', status: 'active' });
  expect(first.sessions).toHaveLength(1);
  expect(first.sessions[0].status).toBe('active');
  expect(first.sessions[0].model).toBeNull();

  const second = upsertSession(first, { id: 'ses_1', title: 'Renamed', model: 'opencode-go/glm-5.1' });
  expect(second.sessions).toHaveLength(1);
  expect(second.sessions[0].title).toBe('Renamed');
  expect(second.sessions[0].model).toBe('opencode-go/glm-5.1');
  expect(second.sessions[0].status).toBe('active');
});

test('archiveSession marks active session archived with path and timestamp', () => {
  const index = upsertSession(emptyIndex(), { id: 'ses_1', title: 'First', workspace: '/repo', status: 'active' });
  const next = archiveSession(index, 'ses_1', '/tmp/archive/ses_1.json', '2026-06-05T12:00:00.000Z');
  expect(next.sessions[0].status).toBe('archived');
  expect(next.sessions[0].archive_path).toBe('/tmp/archive/ses_1.json');
  expect(next.sessions[0].archived_at).toBe('2026-06-05T12:00:00.000Z');
});

test('restoreSession returns archived session to active and clears archive metadata', () => {
  const archived = {
    version: 2,
    sessions: [{
      id: 'ses_1', title: 'First', workspace: '/repo', status: 'archived', model: null,
      tokens_in: null, tokens_out: null, messages_count: null, cost: null,
      created_at: '2026-06-05T10:00:00.000Z', updated_at: '2026-06-05T12:00:00.000Z',
      archived_at: '2026-06-05T12:00:00.000Z', archive_path: '/tmp/archive/ses_1.json',
    }],
  };

  const next = restoreSession(archived, 'ses_1');
  expect(next.sessions[0].status).toBe('active');
  expect(next.sessions[0].archive_path).toBeNull();
  expect(next.sessions[0].archived_at).toBeNull();
});

test('removeSession removes matching session from index', () => {
  const index = {
    version: 2,
    sessions: [
      { id: 'ses_1', title: 'One', workspace: '/a', status: 'active' },
      { id: 'ses_2', title: 'Two', workspace: '/b', status: 'active' },
    ],
  };
  const next = removeSession(index, 'ses_1');
  expect(next.sessions.map(session => session.id)).toEqual(['ses_2']);
});

test('saveIndex writes normalized v2 JSON atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-'));
  const file = join(dir, 'index.json');
  saveIndex(file, emptyIndex());
  const raw = readFileSync(file, 'utf8');
  expect(raw).toContain('"version": 2');
});
```

- [ ] **Step 2: Run the index tests and verify failure**

Run: `bun test scripts/tests/session-vault-index.test.mjs`

Expected: FAIL with missing exports such as `archiveSession`, `restoreSession`, `removeSession`, or version mismatch `expected 2`.

- [ ] **Step 3: Implement v2 index utilities**

Replace `opencode/scripts/lib/session-vault-index.mjs` with:

```js
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const INDEX_VERSION = 2;

export function emptyIndex() {
  return { version: INDEX_VERSION, sessions: [] };
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizeSession(session = {}) {
  const updatedAt = session.updated_at || session.updatedAt || session.time?.updated || nowIso();
  const createdAt = session.created_at || session.createdAt || session.time?.created || updatedAt;
  const rawStatus = session.status === 'archived' ? 'archived' : session.status === 'deleted' ? 'archived' : 'active';

  return {
    id: String(session.id || ''),
    title: session.title || `Session ${createdAt}`,
    workspace: session.workspace || session.path?.root || session.path || process.cwd(),
    status: rawStatus,
    model: session.model || session.model_id || null,
    tokens_in: Number.isFinite(session.tokens_in) ? session.tokens_in : Number.isFinite(session.input) ? session.input : null,
    tokens_out: Number.isFinite(session.tokens_out) ? session.tokens_out : Number.isFinite(session.output) ? session.output : null,
    messages_count: Number.isFinite(session.messages_count) ? session.messages_count : null,
    cost: Number.isFinite(session.cost) ? session.cost : null,
    created_at: createdAt,
    updated_at: updatedAt,
    archived_at: session.archived_at || null,
    archive_path: session.archive_path || null,
  };
}

function normalizeIndex(index) {
  if (!index || typeof index !== 'object') return emptyIndex();
  const sessions = Array.isArray(index.sessions)
    ? index.sessions.filter(session => session && session.id).map(normalizeSession)
    : [];
  return { version: INDEX_VERSION, sessions };
}

export function loadIndex(file) {
  if (!existsSync(file)) return emptyIndex();
  try {
    return normalizeIndex(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return emptyIndex();
  }
}

export function upsertSession(index, session) {
  const base = normalizeIndex(index);
  const sessions = [...base.sessions];
  const idx = sessions.findIndex(item => item.id === session.id);
  if (idx >= 0) {
    sessions[idx] = normalizeSession({ ...sessions[idx], ...session });
  } else {
    sessions.push(normalizeSession(session));
  }
  return { ...base, sessions };
}

export function archiveSession(index, id, archivePath, archivedAt = nowIso()) {
  const base = normalizeIndex(index);
  return {
    ...base,
    sessions: base.sessions.map(session => session.id === id
      ? normalizeSession({ ...session, status: 'archived', archive_path: archivePath, archived_at: archivedAt, updated_at: archivedAt })
      : session),
  };
}

export function restoreSession(index, id) {
  const base = normalizeIndex(index);
  return {
    ...base,
    sessions: base.sessions.map(session => session.id === id
      ? normalizeSession({ ...session, status: 'active', archive_path: null, archived_at: null, updated_at: nowIso() })
      : session),
  };
}

export function removeSession(index, id) {
  const base = normalizeIndex(index);
  return { ...base, sessions: base.sessions.filter(session => session.id !== id) };
}

export function saveIndex(file, index) {
  const dir = dirname(file);
  if (dir) mkdirSync(dir, { recursive: true });
  const normalized = normalizeIndex(index);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return normalized;
}
```

- [ ] **Step 4: Run the index tests and verify pass**

Run: `bun test scripts/tests/session-vault-index.test.mjs`

Expected: PASS, all 7 tests pass.

---

### Task 2: Pure CLI Helpers For Formatting, Filtering, And Archive Paths

**Files:**
- Modify: `opencode/scripts/session-vault.mjs`
- Test: `opencode/scripts/tests/session-vault-helper.test.mjs`

- [ ] **Step 1: Replace helper tests with v2 expectations**

Replace `opencode/scripts/tests/session-vault-helper.test.mjs` with:

```js
import { test, expect } from 'bun:test';
import {
  archivePathFor,
  classifySearch,
  filterSessions,
  formatTable,
  formatTimestamp,
  selectVisibleSessions,
} from '../session-vault.mjs';

const FIXTURE = {
  sessions: [
    { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', tokens_in: 1200, tokens_out: 300, messages_count: 8, cost: 0.04, created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z', model: 'opencode-go/glm-5.1', archive_path: null, archived_at: null },
    { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', tokens_in: null, tokens_out: null, messages_count: null, cost: null, created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', model: null, archive_path: '/archive/ses_2.json', archived_at: '2026-06-04T11:00:00.000Z' },
  ],
};

test('selectVisibleSessions sorts recent first', () => {
  expect(selectVisibleSessions(FIXTURE)[0].id).toBe('ses_1');
});

test('filterSessions defaults to active sessions', () => {
  expect(filterSessions(FIXTURE.sessions, {}).map(session => session.id)).toEqual(['ses_1']);
});

test('filterSessions supports --all, status, and workspace filters', () => {
  expect(filterSessions(FIXTURE.sessions, { all: true }).map(session => session.id)).toEqual(['ses_1', 'ses_2']);
  expect(filterSessions(FIXTURE.sessions, { status: 'archived' }).map(session => session.id)).toEqual(['ses_2']);
  expect(filterSessions(FIXTURE.sessions, { all: true, workspace: 'brand' }).map(session => session.id)).toEqual(['ses_2']);
});

test('classifySearch filters by id, title, workspace, and model', () => {
  expect(classifySearch(FIXTURE.sessions, 'installer').map(session => session.id)).toEqual(['ses_1']);
  expect(classifySearch(FIXTURE.sessions, 'ses_2').map(session => session.id)).toEqual(['ses_2']);
  expect(classifySearch(FIXTURE.sessions, 'glm').map(session => session.id)).toEqual(['ses_1']);
});

test('formatTimestamp returns readable local-ish timestamp and dash for missing values', () => {
  expect(formatTimestamp(null)).toBe('-');
  expect(formatTimestamp('2026-06-05T10:00:00.000Z')).toMatch(/^2026-06-05 \d{2}:\d{2}$/);
});

test('formatTable renders header, row numbers, metrics, and archived rows', () => {
  const table = formatTable(FIXTURE.sessions);
  expect(table).toContain('| # | ID');
  expect(table).toContain('| 1 | ses_1');
  expect(table).toContain('1,500');
  expect(table).toContain('| 2 | ses_2');
  expect(table).toContain('archived');
});

test('archivePathFor uses env override before default vault archive directory', () => {
  expect(archivePathFor('ses_1', { SESSION_VAULT_ARCHIVE_DIR: '/tmp/vault-archive' })).toBe('/tmp/vault-archive/ses_1.json');
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run: `bun test scripts/tests/session-vault-helper.test.mjs`

Expected: FAIL with missing exports `filterSessions`, `formatTable`, `formatTimestamp`, and `archivePathFor`.

- [ ] **Step 3: Add helper implementations while preserving existing CLI behavior**

Modify `opencode/scripts/session-vault.mjs` imports and exports. The final top-level helper area should include:

```js
#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  archiveSession as archiveIndexSession,
  emptyIndex,
  loadIndex,
  removeSession,
  restoreSession as restoreIndexSession,
  saveIndex,
  upsertSession,
} from './lib/session-vault-index.mjs';

export function selectVisibleSessions(index) {
  return [...(index.sessions || [])].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
}

export function filterSessions(sessions, options = {}) {
  return sessions.filter(session => {
    if (!options.all && !options.status && session.status !== 'active') return false;
    if (options.status && session.status !== options.status) return false;
    if (options.workspace && !String(session.workspace || '').toLowerCase().includes(String(options.workspace).toLowerCase())) return false;
    return true;
  });
}

export function classifySearch(sessions, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter(session => `${session.id ?? ''} ${session.title ?? ''} ${session.workspace ?? ''} ${session.status ?? ''} ${session.model ?? ''}`.toLowerCase().includes(q));
}

export function formatTimestamp(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function metric(value) {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '-';
}

function cost(value) {
  return Number.isFinite(value) ? `$${value.toFixed(3)}` : '-';
}

function tokens(session) {
  const total = (Number.isFinite(session.tokens_in) ? session.tokens_in : 0) + (Number.isFinite(session.tokens_out) ? session.tokens_out : 0);
  return total > 0 ? total.toLocaleString('en-US') : '-';
}

export function formatTable(sessions) {
  const rows = [
    ['#', 'ID', 'Title', 'Workspace', 'Tokens', 'Msgs', 'Cost', 'Status', 'Created', 'Updated'],
    ...sessions.map((session, idx) => [
      String(idx + 1),
      session.id || '-',
      session.title || '-',
      session.workspace || '-',
      tokens(session),
      metric(session.messages_count),
      cost(session.cost),
      session.status || '-',
      formatTimestamp(session.created_at),
      formatTimestamp(session.updated_at),
    ]),
  ];
  const widths = rows[0].map((_, col) => Math.max(...rows.map(row => String(row[col]).length)));
  const render = row => `| ${row.map((cell, col) => String(cell).padEnd(widths[col])).join(' | ')} |`;
  const divider = `|${widths.map(width => '-'.repeat(width + 2)).join('|')}|`;
  return [render(rows[0]), divider, ...rows.slice(1).map(render)].join('\n');
}

export function archivePathFor(id, env = process.env) {
  const base = env.SESSION_VAULT_ARCHIVE_DIR || join(homedir(), '.local', 'share', 'opencode', 'session-vault', 'archive');
  return join(base, `${id}.json`);
}
```

Keep the existing CLI `if (import.meta.main)` block temporarily. Later tasks will replace command handling.

- [ ] **Step 4: Run helper tests and verify pass**

Run: `bun test scripts/tests/session-vault-helper.test.mjs`

Expected: PASS, all helper tests pass.

---

### Task 3: Deterministic Command Operations For Show, Archive, Restore, Delete, Refresh, And Search

**Files:**
- Modify: `opencode/scripts/session-vault.mjs`
- Test: `opencode/scripts/tests/session-vault-helper.test.mjs`

- [ ] **Step 1: Add tests for command operation helpers**

Append these tests to `opencode/scripts/tests/session-vault-helper.test.mjs`:

```js
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveVaultSession,
  deleteVaultSession,
  restoreVaultSession,
  showVaultSession,
} from '../session-vault.mjs';

test('showVaultSession renders active action hints', () => {
  const output = showVaultSession(FIXTURE.sessions[0]);
  expect(output).toContain('Status:        active');
  expect(output).toContain('/session-vault continue ses_1');
  expect(output).toContain('/session-vault archive ses_1');
});

test('showVaultSession renders archived archive metadata and restore actions', () => {
  const output = showVaultSession(FIXTURE.sessions[1]);
  expect(output).toContain('Status:        archived');
  expect(output).toContain('Archive Path:  /archive/ses_2.json');
  expect(output).toContain('/session-vault restore ses_2');
});

test('archiveVaultSession writes export and marks index archived', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-archive-'));
  const result = archiveVaultSession({ version: 2, sessions: [FIXTURE.sessions[0]] }, 'ses_1', { archiveDir: dir, now: '2026-06-05T12:00:00.000Z' });
  expect(result.session.status).toBe('archived');
  expect(result.session.archive_path).toBe(join(dir, 'ses_1.json'));
  expect(JSON.parse(readFileSync(result.session.archive_path, 'utf8')).id).toBe('ses_1');
});

test('restoreVaultSession marks archived session active', () => {
  const result = restoreVaultSession({ version: 2, sessions: [FIXTURE.sessions[1]] }, 'ses_2');
  expect(result.session.status).toBe('active');
  expect(result.session.archive_path).toBeNull();
});

test('deleteVaultSession removes session from index without deleting archive file', () => {
  const result = deleteVaultSession(FIXTURE, 'ses_1');
  expect(result.index.sessions.map(session => session.id)).toEqual(['ses_2']);
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run: `bun test scripts/tests/session-vault-helper.test.mjs`

Expected: FAIL with missing exports `showVaultSession`, `archiveVaultSession`, `restoreVaultSession`, and `deleteVaultSession`.

- [ ] **Step 3: Implement operation helpers**

Add these exports to `opencode/scripts/session-vault.mjs` below `archivePathFor`:

```js
function findSession(index, id) {
  return (index.sessions || []).find(session => session.id === id) || null;
}

export function showVaultSession(session) {
  if (!session) return 'Session not found';
  const common = [
    `ID:            ${session.id}`,
    `Title:         ${session.title || '-'}`,
    `Workspace:     ${session.workspace || '-'}`,
    `Status:        ${session.status || '-'}`,
  ];
  if (session.status === 'archived') {
    return [
      ...common,
      `Archive Path:  ${session.archive_path || '-'}`,
      `Created:       ${formatTimestamp(session.created_at)}`,
      `Updated:       ${formatTimestamp(session.updated_at)}`,
      `Archived:      ${formatTimestamp(session.archived_at)}`,
      '',
      `Actions: /session-vault restore ${session.id} | /session-vault restore --continue ${session.id} | /session-vault delete ${session.id}`,
    ].join('\n');
  }
  return [
    ...common,
    `Model:         ${session.model || '-'}`,
    `Tokens:        ${metric(session.tokens_in)} in / ${metric(session.tokens_out)} out`,
    `Messages:      ${metric(session.messages_count)}`,
    `Cost:          ${cost(session.cost)}`,
    `Created:       ${formatTimestamp(session.created_at)}`,
    `Updated:       ${formatTimestamp(session.updated_at)}`,
    '',
    `Actions: /session-vault continue ${session.id} | /session-vault archive ${session.id} | /session-vault delete ${session.id}`,
  ].join('\n');
}

export function archiveVaultSession(index, id, options = {}) {
  const session = findSession(index, id);
  if (!session) throw new Error(`session not found: ${id}`);
  const archivePath = options.archivePath || join(options.archiveDir || dirname(archivePathFor(id)), `${id}.json`);
  mkdirSync(dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  const next = archiveIndexSession(index, id, archivePath, options.now);
  return { index: next, session: findSession(next, id), archivePath };
}

export function restoreVaultSession(index, id) {
  const next = restoreIndexSession(index, id);
  const session = findSession(next, id);
  if (!session) throw new Error(`session not found: ${id}`);
  return { index: next, session };
}

export function deleteVaultSession(index, id) {
  const session = findSession(index, id);
  if (!session) throw new Error(`session not found: ${id}`);
  return { index: removeSession(index, id), session };
}
```

- [ ] **Step 4: Run helper tests and verify pass**

Run: `bun test scripts/tests/session-vault-helper.test.mjs`

Expected: PASS.

---

### Task 4: CLI Subcommand Parser And Read/Write Command Wiring

**Files:**
- Modify: `opencode/scripts/session-vault.mjs`
- Test: `opencode/scripts/tests/session-vault-cli.test.mjs`

- [ ] **Step 1: Create CLI command tests**

Create `opencode/scripts/tests/session-vault-cli.test.mjs` with:

```js
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionVaultCommand } from '../session-vault.mjs';
import { saveIndex } from '../lib/session-vault-index.mjs';

function fixtureIndex(file) {
  saveIndex(file, {
    version: 2,
    sessions: [
      { id: 'ses_1', title: 'Fix installer', workspace: '/a/repo', status: 'active', tokens_in: 100, tokens_out: 20, messages_count: 3, cost: 0.01, created_at: '2026-06-05T09:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' },
      { id: 'ses_2', title: 'Brand review', workspace: '/b/brand', status: 'archived', created_at: '2026-06-04T09:00:00.000Z', updated_at: '2026-06-04T10:00:00.000Z', archive_path: '/archive/ses_2.json' },
    ],
  });
}

test('list prints active sessions as a table by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-cli-'));
  const indexPath = join(dir, 'index.json');
  fixtureIndex(indexPath);
  const result = await runSessionVaultCommand(['list', '--index', indexPath, '--no-prompt']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('ses_1');
  expect(result.stdout).not.toContain('ses_2');
});

test('list --all includes archived sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-cli-'));
  const indexPath = join(dir, 'index.json');
  fixtureIndex(indexPath);
  const result = await runSessionVaultCommand(['list', '--all', '--index', indexPath, '--no-prompt']);
  expect(result.stdout).toContain('ses_1');
  expect(result.stdout).toContain('ses_2');
});

test('show prints details for one session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-cli-'));
  const indexPath = join(dir, 'index.json');
  fixtureIndex(indexPath);
  const result = await runSessionVaultCommand(['show', 'ses_1', '--index', indexPath]);
  expect(result.stdout).toContain('ID:            ses_1');
});

test('archive writes archive file and persists archived status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-cli-'));
  const indexPath = join(dir, 'index.json');
  fixtureIndex(indexPath);
  const archiveDir = join(dir, 'archive');
  const result = await runSessionVaultCommand(['archive', 'ses_1', '--force', '--index', indexPath], { SESSION_VAULT_ARCHIVE_DIR: archiveDir });
  expect(result.stdout).toContain('Archived ses_1');
  expect(JSON.parse(readFileSync(indexPath, 'utf8')).sessions.find(session => session.id === 'ses_1').status).toBe('archived');
  expect(JSON.parse(readFileSync(join(archiveDir, 'ses_1.json'), 'utf8')).id).toBe('ses_1');
});

test('restore marks archived session active', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-cli-'));
  const indexPath = join(dir, 'index.json');
  fixtureIndex(indexPath);
  const result = await runSessionVaultCommand(['restore', 'ses_2', '--index', indexPath]);
  expect(result.stdout).toContain('Restored ses_2 to active');
  expect(JSON.parse(readFileSync(indexPath, 'utf8')).sessions.find(session => session.id === 'ses_2').status).toBe('active');
});

test('delete removes vault entry without SDK deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-vault-cli-'));
  const indexPath = join(dir, 'index.json');
  fixtureIndex(indexPath);
  const result = await runSessionVaultCommand(['delete', 'ses_1', '--force', '--index', indexPath]);
  expect(result.stdout).toContain('Removed ses_1 from vault');
  expect(JSON.parse(readFileSync(indexPath, 'utf8')).sessions.map(session => session.id)).toEqual(['ses_2']);
});
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run: `bun test scripts/tests/session-vault-cli.test.mjs`

Expected: FAIL with missing export `runSessionVaultCommand`.

- [ ] **Step 3: Implement parser and command runner**

Add this command runner to `opencode/scripts/session-vault.mjs`, then change the `if (import.meta.main)` block to call it:

```js
function defaultIndexPath(env = process.env) {
  const base = env.XDG_DATA_HOME || join(env.HOME || homedir(), '.local', 'share');
  return join(base, 'opencode', 'session-vault', 'index.json');
}

function printJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--all') parsed.all = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--no-prompt') parsed.noPrompt = true;
    else if (arg === '--continue') parsed.continue = true;
    else if (['--index', '--status', '--workspace', '--format'].includes(arg)) parsed[arg.slice(2)] = args[++i];
    else parsed._.push(arg);
  }
  return parsed;
}

function result(stdout, code = 0, stderr = '') {
  return { stdout: stdout ? `${stdout.replace(/\n?$/, '\n')}` : '', stderr, code };
}

function loadCommandIndex(indexPath) {
  return existsSync(indexPath) ? loadIndex(indexPath) : emptyIndex();
}

export async function runSessionVaultCommand(args, env = process.env) {
  const [cmd = 'list', ...rest] = args;
  const options = parseArgs(rest);
  const indexPath = options.index || defaultIndexPath(env);
  const index = loadCommandIndex(indexPath);

  if (cmd === 'list') {
    const sessions = filterSessions(selectVisibleSessions(index), options);
    if (options.format === 'json') return result(printJson(sessions));
    const table = sessions.length ? formatTable(sessions) : 'No sessions found';
    const prompt = options.noPrompt ? '' : '\nChoose a session action:\n  s <#>  show\n  a <#>  archive active session\n  d <#>  delete from vault\n  c <#>  continue active session\n  r <#>  restore archived session\n  rc <#> restore archived session and continue\n';
    return result(`${table}${prompt}`);
  }

  if (cmd === 'search') {
    const [query = ''] = options._;
    return result(formatTable(classifySearch(selectVisibleSessions(index), query)));
  }

  if (cmd === 'show') {
    const [id] = options._;
    const session = findSession(index, id);
    if (!session) return result('', 1, `session not found: ${id}\n`);
    return result(options.json ? printJson(session) : showVaultSession(session));
  }

  if (cmd === 'archive') {
    const [id] = options._;
    const archived = archiveVaultSession(index, id, { archivePath: archivePathFor(id, env) });
    saveIndex(indexPath, archived.index);
    return result(`Archived ${id} -> ${archived.archivePath}`);
  }

  if (cmd === 'restore') {
    const [id] = options._;
    const restored = restoreVaultSession(index, id);
    saveIndex(indexPath, restored.index);
    const suffix = options.continue ? `\n${showVaultSession(restored.session)}` : '';
    return result(`Restored ${id} to active${suffix}`);
  }

  if (cmd === 'delete') {
    const [id] = options._;
    const removed = deleteVaultSession(index, id);
    saveIndex(indexPath, removed.index);
    return result(removed.session.archive_path
      ? `Removed ${id} from vault. Archive file preserved at ${removed.session.archive_path}`
      : `Removed ${id} from vault. No archive file was recorded.`);
  }

  return result('', 1, `unknown command: ${cmd}\n`);
}

if (import.meta.main) {
  const response = await runSessionVaultCommand(process.argv.slice(2));
  if (response.stdout) process.stdout.write(response.stdout);
  if (response.stderr) process.stderr.write(response.stderr);
  process.exit(response.code);
}
```

If this creates duplicate `defaultIndexPath` or `printJson` definitions, remove the older versions.

- [ ] **Step 4: Run CLI tests and helper tests**

Run: `bun test scripts/tests/session-vault-cli.test.mjs scripts/tests/session-vault-helper.test.mjs`

Expected: PASS.

---

### Task 5: Plugin Event Handler Rewrite

**Files:**
- Modify: `opencode/plugins/omokage.js`
- Test: `opencode/scripts/tests/session-vault-plugin.test.mjs`

- [ ] **Step 1: Replace plugin tests with event-driven tests**

Replace `opencode/scripts/tests/session-vault-plugin.test.mjs` with:

```js
import { test, expect } from 'bun:test';
import { __test_createVaultHandlers } from '../../plugins/omokage.js';
import { emptyIndex } from '../lib/session-vault-index.mjs';

function fakeStore() {
  let index = emptyIndex();
  return {
    read: () => index,
    write: next => { index = next; },
    index: () => index,
  };
}

test('session.created upserts active session', async () => {
  const store = fakeStore();
  const handlers = __test_createVaultHandlers({
    store,
    client: { session: { get: async () => ({ data: { id: 'ses_1', title: 'Created', path: '/repo', createdAt: '2026-06-05T10:00:00.000Z', updatedAt: '2026-06-05T10:00:00.000Z' } }) } },
    now: () => '2026-06-05T10:00:00.000Z',
  });

  await handlers.event({ event: { type: 'session.created', properties: { id: 'ses_1' } } });
  expect(store.index().sessions[0].id).toBe('ses_1');
  expect(store.index().sessions[0].status).toBe('active');
});

test('session.idle enriches cost and token fields', async () => {
  const store = fakeStore();
  store.write({ version: 2, sessions: [{ id: 'ses_1', title: 'Created', workspace: '/repo', status: 'active', created_at: '2026-06-05T10:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' }] });
  const handlers = __test_createVaultHandlers({
    store,
    client: { session: { get: async () => ({ data: { id: 'ses_1', title: 'Created', path: '/repo', input: 100, output: 50, cost: 0.02, updatedAt: '2026-06-05T10:05:00.000Z' } }), messages: async () => ({ data: [{}, {}, {}] }) } },
    now: () => '2026-06-05T10:05:00.000Z',
  });

  await handlers.event({ event: { type: 'session.idle', properties: { id: 'ses_1' } } });
  expect(store.index().sessions[0].tokens_in).toBe(100);
  expect(store.index().sessions[0].tokens_out).toBe(50);
  expect(store.index().sessions[0].messages_count).toBe(3);
  expect(store.index().sessions[0].cost).toBe(0.02);
});

test('session.deleted archives session instead of removing it', async () => {
  const store = fakeStore();
  store.write({ version: 2, sessions: [{ id: 'ses_1', title: 'Created', workspace: '/repo', status: 'active', created_at: '2026-06-05T10:00:00.000Z', updated_at: '2026-06-05T10:00:00.000Z' }] });
  const handlers = __test_createVaultHandlers({
    store,
    client: { session: { get: async () => ({ data: { id: 'ses_1', title: 'Created', path: '/repo' } }) } },
    archiveSession: (index, id) => ({ ...index, sessions: index.sessions.map(session => session.id === id ? { ...session, status: 'archived', archive_path: '/archive/ses_1.json' } : session) }),
    now: () => '2026-06-05T10:05:00.000Z',
  });

  await handlers.event({ event: { type: 'session.deleted', properties: { id: 'ses_1' } } });
  expect(store.index().sessions[0].status).toBe('archived');
});
```

- [ ] **Step 2: Run plugin tests and verify failure**

Run: `bun test scripts/tests/session-vault-plugin.test.mjs`

Expected: FAIL with missing export `__test_createVaultHandlers`.

- [ ] **Step 3: Rewrite plugin with testable handler factory**

Replace `opencode/plugins/omokage.js` with:

```js
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { archiveSession, emptyIndex, loadIndex, saveIndex, upsertSession } from '../scripts/lib/session-vault-index.mjs';

function defaultIndexPath() {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || homedir(), '.local', 'share');
  return join(base, 'opencode', 'session-vault', 'index.json');
}

function createStore(file = defaultIndexPath()) {
  return {
    read: () => loadIndex(file),
    write: index => saveIndex(file, index),
  };
}

function eventSessionId(event) {
  return event?.properties?.id || event?.properties?.sessionID || event?.properties?.session?.id || null;
}

function sdkData(response) {
  return response?.data || response || {};
}

function sessionRecord(session, fallback = {}) {
  return {
    id: session.id || fallback.id,
    title: session.title,
    workspace: session.workspace || session.path?.root || session.path,
    model: session.model || session.modelID || session.model_id,
    tokens_in: Number.isFinite(session.tokens_in) ? session.tokens_in : Number.isFinite(session.input) ? session.input : undefined,
    tokens_out: Number.isFinite(session.tokens_out) ? session.tokens_out : Number.isFinite(session.output) ? session.output : undefined,
    cost: Number.isFinite(session.cost) ? session.cost : undefined,
    created_at: session.created_at || session.createdAt,
    updated_at: session.updated_at || session.updatedAt,
    status: 'active',
  };
}

async function fetchSession(client, id) {
  if (!client?.session?.get || !id) return { id };
  try {
    return sdkData(await client.session.get({ path: { id } }));
  } catch {
    return { id };
  }
}

async function fetchMessageCount(client, id) {
  if (!client?.session?.messages || !id) return null;
  try {
    const response = sdkData(await client.session.messages({ path: { id } }));
    return Array.isArray(response) ? response.length : null;
  } catch {
    return null;
  }
}

export function __test_createVaultHandlers({ store, client, archiveSession: archiveFn, now = () => new Date().toISOString() }) {
  const writeQueue = { current: Promise.resolve() };
  const enqueue = fn => {
    writeQueue.current = writeQueue.current.then(fn, fn);
    return writeQueue.current;
  };

  async function upsertFromSdk(id, extra = {}) {
    const sdkSession = await fetchSession(client, id);
    const messagesCount = extra.includeMessages ? await fetchMessageCount(client, id) : undefined;
    return enqueue(async () => {
      const index = store.read();
      const next = upsertSession(index, {
        ...sessionRecord(sdkSession, { id }),
        messages_count: Number.isFinite(messagesCount) ? messagesCount : undefined,
        updated_at: sdkSession.updatedAt || sdkSession.updated_at || now(),
      });
      store.write(next);
    });
  }

  return {
    event: async ({ event }) => {
      const id = eventSessionId(event);
      if (!id) return;
      if (event.type === 'session.created' || event.type === 'session.updated') return upsertFromSdk(id);
      if (event.type === 'session.idle') return upsertFromSdk(id, { includeMessages: true });
      if (event.type === 'session.deleted') {
        return enqueue(async () => {
          const index = store.read();
          const next = archiveFn ? archiveFn(index, id) : archiveSession(index, id, null, now());
          store.write(next);
        });
      }
    },
  };
}

export default async function SessionVaultPlugin({ client }) {
  const store = createStore();
  const handlers = __test_createVaultHandlers({ store, client });
  try {
    if (client?.session?.list) {
      const response = sdkData(await client.session.list());
      const sessions = Array.isArray(response) ? response : [];
      let index = store.read();
      for (const session of sessions) index = upsertSession(index, sessionRecord(session));
      store.write(index);
    }
  } catch {
    // Keep opencode startup resilient if refresh cannot reach the SDK.
  }
  return handlers;
}
```

- [ ] **Step 4: Run plugin tests and verify pass**

Run: `bun test scripts/tests/session-vault-plugin.test.mjs`

Expected: PASS.

---

### Task 6: Command Documentation Update

**Files:**
- Modify: `opencode/command/session-vault.md`

- [ ] **Step 1: Replace command prompt documentation**

Replace `opencode/command/session-vault.md` with:

```md
---
description: Manage active and archived OpenCode sessions from the deterministic Session Vault
agent: build
---

Use the deterministic Session Vault scripts to manage global sessions. Do not infer state from conversation context when a script can read the vault index or OpenCode SDK.

Storage:
- Index: `~/.local/share/opencode/session-vault/index.json`
- Archive default: `~/.local/share/opencode/session-vault/archive/<id>.json`
- Archive override: `SESSION_VAULT_ARCHIVE_DIR`

Statuses:
- `active`
- `archived`

Permanent deletion of OpenCode sessions is not handled by this command. `/session-vault delete <id>` removes a vault entry only and never calls SDK `session.delete`.

Subcommands:
- `list [--all] [--status active|archived] [--workspace <path>] [--format table|json]`
- `show <id> [--json]`
- `archive <id> [--force]`
- `restore <id> [--continue]`
- `delete <id> [--force]`
- `continue <id>`
- `refresh`
- `search <query>`

Workflow:
1. Start with `/session-vault list` unless the user gave a specific subcommand.
2. Use row numbers from the list for human discussion, but pass session IDs to scripts.
3. Confirm only destructive vault actions (`delete`) unless `--force` is explicitly present.
4. For archived sessions, offer `restore`, `restore --continue`, and `delete`.
5. For active sessions, offer `show`, `continue`, `archive`, and `delete`.
6. If direct TUI continue is unsupported, return the safest resume fallback printed by the script.
```

- [ ] **Step 2: Verify command doc syntax**

Run: `bun test scripts/tests/install-fleet-session-vault.test.mjs`

Expected: PASS.

---

### Task 7: Full Test Run And Spec Coverage Review

**Files:**
- Verify: all changed files

- [ ] **Step 1: Run targeted session-vault tests**

Run: `bun test scripts/tests/session-vault-index.test.mjs scripts/tests/session-vault-helper.test.mjs scripts/tests/session-vault-cli.test.mjs scripts/tests/session-vault-plugin.test.mjs scripts/tests/install-fleet-session-vault.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run full opencode tests**

Run: `bun test scripts/tests`

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run from repo root: `git diff -- opencode/plugins/omokage.js opencode/scripts/session-vault.mjs opencode/scripts/lib/session-vault-index.mjs opencode/command/session-vault.md opencode/scripts/tests/session-vault-index.test.mjs opencode/scripts/tests/session-vault-helper.test.mjs opencode/scripts/tests/session-vault-cli.test.mjs opencode/scripts/tests/session-vault-plugin.test.mjs docs/superpowers/specs/2026-06-06-session-vault-design.md docs/superpowers/plans/2026-06-06-session-vault.md`

Expected: Diff only contains Session Vault implementation, tests, command docs, spec, and this plan.

- [ ] **Step 4: Review spec coverage**

Verify these requirements are implemented:

- Plugin handles `session.created`, `session.updated`, `session.idle`, `session.deleted`.
- Plugin init refreshes from SDK list.
- Index version is 2 and migrates v1 records.
- Two statuses only: `active`, `archived`.
- `list` supports `--all`, `--status`, `--workspace`, `--format`.
- `show`, `archive`, `restore`, `delete`, `continue`, `refresh`, and `search` exist.
- `delete` does not call SDK `session.delete`.
- Archive dir defaults correctly and supports `SESSION_VAULT_ARCHIVE_DIR`.

Expected: Every item maps to tests or implementation.
