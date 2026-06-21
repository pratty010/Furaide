# opencode-all Hard Archive Implementation — Consolidated Review Findings

**Date:** 2026-06-21
**Plan:** `docs/superpowers/plans/2026-06-20-opencode-all-hard-archive-index-plan.md`
**Scope:** All 12 tasks, working-tree implementation (uncommitted, HEAD=`0e4daac`)
**Reviewers:** Spec compliance, Code quality, Adversarial red team, Security/threat modeling, Verification
**Status:** All findings verified against source code. 3 false findings removed. Interrelated fixes merged.

---

## Verification Results

| Check | Result |
|---|---|
| Full test suite (`bun test`) | **172 pass / 0 fail** (exit 0) |
| Targeted test files (7 files) | All pass individually |
| `--list` smoke | Works (33 lines, clean exit) |
| Interactive smoke | Starts cleanly, renders 9 folders, exits on `q` |
| Typecheck (`bunx tsc --noEmit`) | 72 errors (71 in render.ts RGBA — pre-existing; 1 upstream) |
| `bun audit` | Clean |
| File integrity | All plan-specified files present |
| CLI commands (`opencode export`, `opencode import`, `opencode session delete`) | All valid |
| Archive directory | Exists, empty |

---

## False Findings Removed

These findings were in the original review but disproven by source-code verification:

- **I13 / CQ-8 (`selectedVisibleSession` dead code):** Called at `state.ts:127` inside `reloadState`. Not dead code.
- **M1 (`addToGroup` allocates new Set always):** The `||` short-circuit means `new Set` is only created when `group.get(row.directory)` is undefined. Not allocating on every call.
- **M8 (`searchResultsFor` empty-query ordering):** Empty-query results come from `allSessions = [...index.active.values(), ...index.archived.values()]`. Map insertion order comes from `listSessions` (DB-sorted `timeUpdated DESC`) and `listArchivedSessionFiles` (sorted by `timeArchived DESC`). Ordering IS deterministic.

---

## Required Fixes (18 findings → 6 files)

All files are already modified in the working tree. No new files needed. Fixes are grouped by file to minimize edit count.

---

### Fix 1: `src/db.ts` — CLI robustness, integrity, and sanitization

Covers: **C2, C3, I2, I4, I7, M16**

**C2/C3: `spawnSync` missing try/catch and timeout.**
Every `spawnSync` call (`exportSessionToFile`, `importSessionFromFile`, `deleteSessionById`) can throw `ENOENT` (missing binary → crash) or hang (no timeout → permanent freeze). Wrap all three with try/catch and add `timeout: 30_000`:
```typescript
try {
  const result = spawnSync(opencodeBin(), ["export", id], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  if (result.status === 0) writeFileSync(file, result.stdout || Buffer.from(""), { mode: 0o600 });
  return { ok: result.status === 0, code: result.status ?? 1, stderr: (result.stderr || "").toString() };
} catch (err) {
  return { ok: false, code: -3, stderr: `opencode CLI not found: ${(err as Error).message}` };
}
```
Same pattern for `importSessionFromFile` and `deleteSessionById`. On timeout (`result.signal === 'SIGTERM'`), return code -4 with "opencode CLI timed out (30s)".

**I2: Archive filename/inner-ID mismatch.**
`archiveInfoToRow` must verify `info.id` matches the filename-derived id. Otherwise a file named `benign.json` containing `info.id: "victim"` would route operations to `victim.json` instead:
```typescript
const fileId = archivePath.split("/").pop()?.replace(/\.json$/, "") || "";
if (id !== fileId) return null;
```

**I4: `mkdirSync` world-readable parent directories.**
Archive files are `0o600` but parent directory is `0o777 & ~umask` (typically `0o755`). Other local users can see session IDs, counts, and file sizes. Fix in `exportSessionToFile`:
```typescript
mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
```
Same in `tui.tsx` audit path.

**I7: SQL LIKE wildcards `%` / `_` not escaped.**
`activeSessionsMatchingText` passes user query directly into `LIKE '%...%'`. Searching for `%` or `_` returns all sessions (wildcard match) instead of literal:
```typescript
const escaped = query.toLowerCase().replace(/%/g, "\\%").replace(/_/g, "\\_");
const lower = `%${escaped}%`;
// In SQL: WHERE ... LIKE ? ESCAPE '\'
```

**M16: NaN propagation from malformed archive JSON.**
`Number(info.cost || 0)` where `info.cost = "abc"` → `Number("abc")` = `NaN`. Same for tokens/time fields. Replace with:
```typescript
cost: typeof info.cost === "number" ? info.cost : 0,
```

---

### Fix 2: `src/dashboard/actions.ts` — Remove legacy restore, fix bulk ops, fix search, update chips

Covers: **C4, C6, C7, C8, C9, I6, M9**

**C8: Remove legacy `restore` action.**
The locked product decision says "no `time_archived` flipping." Remove: `restore` branch from `executePendingAction`, `setArchived` import, and the `r` key handler that triggers restore. Import is the only restore path.

**C4: Folder bulk operations use DB instead of index.**
Folder key handlers (`D`, `I` on archived tab folders) call `listArchivedSessionsInDir(folder.directory)` which queries `time_archived IS NOT NULL` in the DB. After hard archive, DB rows are deleted → count is 0 → user sees "no sessions in this folder" even though the UI shows them. Replace with index-based lookup:
```typescript
const count = state.index.archivedByDir.get(folder.directory)?.size ?? 0;
```
Same pattern for active folder counts using `state.index.activeByDir`.

**C6: Archived session action chips include "Enter open".**
`actionChips` returns `{ id: "open", label: "Enter open", key: "Enter" }` for archived sessions, advertising an action that doesn't work. Branch on `state.tab === "archived"` and omit the open chip for archived sessions.

**C7: Import/delete status messages missing error details.**
The plan specifies partial-failure status messages must include `stderr`/`rem.err`. Add error details:
```typescript
// Import fail:
status: `import failed (exit ${imp.code}): ${imp.stderr.slice(-160)}`
// File removal fail:
status: `imported but archive file removal failed: ${rem.err}`
// Delete fail:
status: `delete failed (exit ${del.code}): ${del.stderr.slice(-160)}`
```

**C9: Dead `R` handler in `actions.ts`.**
`tui.tsx:205-210` intercepts `R` before `applyKey` and does full `buildSessionIndex` rebuild. `actions.ts:502-503` also handles `R` but only calls `reloadState` (no index rebuild) — dead code in TUI, but active in tests. Remove the `R` handler from `actions.ts`.

**I6: `searchSelected` stale on query change.**
When Backspace narrows search results, `searchSelected` can exceed new count. In the `type:` handler, reset `searchSelected: 0, searchScroll: 0`.

**M9: Enter on archived session gives terse status.**
Status shows `"archived session"` instead of plan-specified `"Archived sessions can't be opened directly. Press I to import first."`. Fix the status string.

---

### Fix 3: `src/dashboard/session-index.ts` — Index consistency

Covers: **C5, I8**

**C5: `removeFromGroup` leaks empty Sets.**
After removing the last session from a directory group, the empty `Set` stays in the Map. `directoriesForTab` produces entries with `active: 0` / `archived: 0`. Plan specifies cleanup:
```typescript
function removeFromGroup(group: Map<string, Set<string>>, row: SessionRow): void {
  const set = group.get(row.directory);
  if (!set) return;
  set.delete(row.id);
  if (set.size === 0) group.delete(row.directory);
}
```

**I8: `buildSessionIndex` split-brain on rebuild.**
If export succeeds but delete fails, then `R` rebuilds — session appears in BOTH active (from DB) and archived (from file). Skip archived entries whose ID already exists in active:
```typescript
for (const row of archived) {
  if (!index.active.has(row.id)) addArchivedToIndex(index, row);
}
```

---

### Fix 4: `src/dashboard/render.ts` — Overlay text, widths, labels

Covers: **C1, I12, M10, M11, M12**

**C1: Choice overlay label misleads into data loss.**
`buildChoiceOverlay` for `delete_or_import` mode shows `[D] Delete archive & import`. Pressing `D` only deletes — it does NOT import. User expects restore but gets destruction. Change to `[D] Delete archive only`.

**I12: Choice overlay doesn't differentiate bulk vs single.**
When `pendingDirectory` is set (folder context), the overlay shows `[A] Archive & delete session` (singular) but the actual action is `bulk_archive`. Make `buildChoiceOverlay` aware of `pendingDirectory` and show "bulk" labels when appropriate.

**M10/M12: Overlay widths exceed terminal on narrow screens.**
`buildChoiceOverlay` (`Math.max(60, ...)`) and `buildSearchOverlay` (`Math.max(60, ...)`) produce boxes wider than the viewport on small terminals. Clamp to `Math.min(boxWidth, state.viewport.width - 2)`.

**M11: Folder labels not clipped.**
`buildSessionsContent` renders `\`${marker}${cwdMark}${prefix} ${dir.directory}\`` without `clip()`. Long directory paths overflow the sessions pane. Apply `clip(dir.directory, maxWidth)`.

---

### Fix 5: `src/sanitize.ts` — Unicode bidi and tab filtering

Covers: **I1, M14**

**I1: Unicode bidi/format chars bypass sanitizer.**
`renderSafe` filters only ASCII control chars (`\x00-\x1f\x1b\x7f`). Unicode Cf category (U+200B–U+2069, U+2028–U+202F) passes through. U+202E (RLO) reorders visible text — user can be visually tricked into archiving/deleting the wrong session. CWE-172. Add to `renderSafe`:
```typescript
if (code >= 0x200b && code <= 0x2069) continue;
if (code >= 0x2028 && code <= 0x202f) continue;
```
Update `hasControlBytes` to detect these so `suspicious` flag triggers.

**M14: Tab characters preserved in titles/directories.**
`renderSafe` preserves `\t`. In session lists and search overlays, tabs cause column misalignment. Replace `\t` → `" "` in `renderSafe`.

---

### Fix 6: `tests/actions.test.ts` — Test DB isolation

Covers: **I5**

**I5: `actions.test.ts` leaks real user DB.**
Unlike `state.test.ts` and `tui.test.tsx` (which set `OPENCODE_ALL_DB_PATH`), `actions.test.ts` never isolates the DB. `searchResultsFor` → `activeSessionsMatchingText` → `defaultDbPath()` reads `~/.local/share/opencode/opencode.db`. Local tests pollute with real data; CI diverges. Add:
```typescript
let savedDbPath: string | undefined;
beforeAll(() => {
  savedDbPath = process.env.OPENCODE_ALL_DB_PATH;
  process.env.OPENCODE_ALL_DB_PATH = "/tmp/opencode-all-actions-test-empty.db";
});
afterAll(() => {
  if (savedDbPath) process.env.OPENCODE_ALL_DB_PATH = savedDbPath;
  else delete process.env.OPENCODE_ALL_DB_PATH;
});
```

---

## Deferred Findings

These findings are real but deferred with explicit reasons. None are correctness-blocking or security-critical for current usage.

| Finding | Deferral reason |
|---|---|
| **I3:** Per-keystroke archive file scan (DoS) | `exports/` is empty (0 archived sessions). Theoretical until user accumulates 100+ archives. Cache later. |
| **I9:** `buildSearchOverlay` double-calls `searchResultsFor` | Minor perf. 2x work on hot path, but search is interactive and result sets are small (≤50). |
| **I10:** `listArchivedSessionFiles` O(n) JSON parse on startup | Startup cost. With 0 archives, negligible. Add mtime cache when archives grow. |
| **I11:** Bulk ops collapse multiple failures into one `lastError` | Current status bar is 160 chars. Accumulating failure IDs requires either truncated list or log file — design decision. |
| **I14:** `buildMetadataContent` `as any` cast | The `SessionDetail` type doesn't have `archivePath`/`archiveBytes`. Union type is cleaner but zero runtime risk. |
| **I15:** 71 `render.ts` RGBA typecheck errors | Pre-existing, not from this implementation. `tone()` returns `string`, `TextRenderable` expects `RGBA`. Fix as separate issue. |
| **I16:** Untracked test temp dirs | Tests clean up in `afterEach`. Directories only appear when tests are interrupted. `.gitignore` is a separate commit. |
| **M2:** `rowsForTab` array rebuild on every call | Premature optimization. Dataset is < 2000 sessions. |
| **M3, M4, M13, M15, M17, M18, M19, M20:** Various minor | All cosmetic/documentation/pre-existing. No runtime impact. |
| **M5:** WAL mode | Read-biased workload, no concurrent writers. |
| **M6:** Silent error swallow in `activeSessionsMatchingText` | Returns `[]` on any failure — functional but opaque. Debuggability improvement, not correctness. |
| **M7:** Non-null assertion on `timeArchived` | `archiveInfoToRow` always sets it; assertion is defensive but redundant. |

---

## Fix Summary By File

| File | Fixes | Lines |
|---|---|---|
| `src/db.ts` | C2 + C3 (try/catch+timeout on 3 spawnSync calls), I2 (filename/id check), I4 (mkdir mode), I7 (SQL LIKE escape), M16 (NaN guard) | ~30 |
| `src/dashboard/actions.ts` | C4 (index-based folder ops), C6 (archived chips), C7 (error details), C8 (remove restore), C9 (remove R handler), I6 (searchSelected reset), M9 (Enter status) | ~40 |
| `src/dashboard/session-index.ts` | C5 (removeFromGroup cleanup), I8 (buildSessionIndex dedup) | ~5 |
| `src/dashboard/render.ts` | C1 (overlay label), I12 (bulk context), M10 (width clamp), M11 (label clip), M12 (width clamp) | ~15 |
| `src/sanitize.ts` | I1 (Unicode bidi filter), M14 (tab→space) | ~5 |
| `tests/actions.test.ts` | I5 (DB isolation) | ~10 |
| **Total** | **18 fixes** | **~105** |

---

## Strengths (noted by all reviewers)

- **Index-based state design** — `SessionIndex` with `activeByDir`/`archivedByDir` avoids repeated DB queries.
- **Deterministic state machine** — `applyKey` is a pure reducer. Testable with zero I/O.
- **Error propagation** — `executePendingAction` returns structured status. Import rollback on file-removal failure.
- **Test isolation** — `beforeEach`/`afterEach` with `rmSync`. Fake `opencode-*.sh` scripts for CLI tests.
- **Type discipline** — Near-zero `any` (one `as any` in render.ts). Consistent `import type`.
- **Sanitization** — Every text path through `renderSafe`. `isSafeSessionId` on all I/O.
- **Performance awareness** — `MAX_ARCHIVE_BYTES` guard, SQL `LIMIT`, `slice()` caps.

---

## Conclusion

172/172 tests pass. 18 findings require fixes across 6 files (all already in working tree), totalling ~105 lines. No new files. No findings remain unaddressed — every item is either included as a fix or explicitly deferred with reason. All inter-related fixes are merged into single file edits (e.g., C2+C3+I2+I4+I7+M16 in `db.ts`, C1+I12+M10+M11+M12 in `render.ts`). Fixes are ordered by file dependency: `db.ts` → `session-index.ts` → `sanitize.ts` → `state.ts` (no changes) → `actions.ts` → `render.ts` → `tests/actions.test.ts`.
