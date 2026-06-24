# Session Vault Record & Cleanup

**Date:** 2026-06-18
**Status:** Approved, pending execution
**Scope:** opencode/ session-vault removal + historical record + agent-count reconciliation

---

## Goal

Capture the full history of the `session-vault` system before removing it from the opencode fleet, then execute a complete cleanup of all repo code, config, tests, docs, user data, and stale agent-count references. The replacement (`opencode-all` standalone TUI) is designed separately in `2026-06-18-opencode-all-design.md` and is out of scope for this spec.

This spec covers three things:
1. **Record** — a comprehensive historical account of session-vault, preserved as a doc.
2. **Cleanup** — removal of all session-vault code + config + tests + user data + doc references.
3. **Agent-count reconciliation** — fix the pre-existing 29-vs-30 inconsistency across `opencode/README.md`, `opencode/AGENTS.md`, `fleet-manifest.json`, and root `README.md`.

---

## Part 1: Session Vault Record

### Origin & timeline

The session-vault system was an attempt to give opencode a global session manager — browse, search, inspect, export, archive, restore, continue, and delete sessions from a centralized vault at `~/.local/share/opencode/session-vault/index.json`.

Git history (9 commits, 2026-06-05 → 2026-06-18):

| Date | Commit | Action |
|------|--------|--------|
| 2026-06-05 | `a5c5347` | Skeleton planning for session-vault + fleet management |
| 2026-06-05 | `869cf24` | Revert of the skeleton (planning reset) |
| 2026-06-06 | `395e05e` | Add session vault command + sync hook |
| 2026-06-06 | `a7969b8` | Complete session vault helper operations |
| 2026-06-06 | (planning) | Design docs created at `docs/superpowers/specs/2026-06-06-session-vault-design.md` + `plans/2026-06-06-session-vault.md` |
| 2026-06-08 | `9d145b0` | Redesign installer for fleet + session vault |
| 2026-06-08 | `8b604d3` | Merge `feat/opencode-fleet-session-vault` into dev |
| 2026-06-08 | `a1e8c7c` | "Implement deterministic Session Vault with index v2, async plugin, CLI runner" |
| 2026-06-18 | `3681b03` | Design docs deleted from repo (only the `2026-06-18-opencode-all-design.md` successor remains) |
| 2026-06-18 | `d46787b` | Merge `origin/dev` into `feature/session-vault` |

### Original intent

An 8-command global session manager:
- `list` — recent sessions, recent-first order
- `search` — filter by title/workspace/status
- `inspect` — full session details
- `export` — session + messages to JSON
- `archive` — mark archived + export to archive dir
- `restore` — un-archive
- `continue` — resume (or safe-fallback)
- `delete` — permanent removal
- `refresh` — rebuild index from source

### Two parallel implementations (the core finding)

The repo shipped a broken `.mjs` implementation while a working `vault.py` lived in user-data, never committed. They were parallel, incompatible, and the repo one never worked.

#### Repo `.mjs` implementation — BROKEN

Files (all removed in Part 2):
- `opencode/command/session-vault.md` — 13-line command doc
- `opencode/plugins/omokage.js` — 34-line session-close hook plugin
- `opencode/scripts/session-vault.mjs` — 84-line CLI
- `opencode/scripts/lib/session-vault-index.mjs` — 44-line index lib
- `opencode/scripts/tests/session-vault-{plugin,index,helper}.test.mjs` — 3 test files
- `opencode/scripts/tests/install-fleet-session-vault.test.mjs` — manifest test

**Why it was broken:**

1. **Plugin/CLI contract mismatch.** `omokage.js:24` calls `bun scripts/session-vault.mjs sync-session <id>` (and `sync-new`) on the `session.stop` hook. But `session-vault.mjs` has **no `sync-session` or `sync-new` command** — only `list`, `search`, `mark-deleted` are implemented (3 of 8 documented commands). Every session close invoked a non-existent command. The plugin used `execFileSync('bun', [script, ...args], { stdio: 'ignore' })`, so the failure was silent.

2. **Dead `upsertSession`.** `lib/session-vault-index.mjs:24` exports `upsertSession()` — the function that would add/update a session in the index. It is **never called by any CLI command**. The index could never be populated by the plugin's sync hook. The `list`/`search`/`mark-deleted` commands only read/mutate an index that was always empty unless populated by some other tool.

3. **`INDEX_VERSION` mismatch.** `lib/session-vault-index.mjs:4` declares `INDEX_VERSION = 1`. Commit `a1e8c7c`'s message claims "index v2". The code never matched the commit description.

4. **Phantom `@session-vault` context.** `command/session-vault.md:5` instructs: "Use @session-vault context to manage global sessions." No `@session-vault` agent, context, or skill exists in the fleet. The command references a non-existent target.

5. **Missing CLI commands.** Only `list`, `search`, `mark-deleted` implemented. The 5 other documented commands (`inspect`, `export`, `archive`, `restore`, `continue`, `refresh`) were never built.

6. **Deleted CLI test.** `scripts/tests/session-vault-cli.test.mjs` (226 lines) was removed in commit `3681b03` without replacement. The remaining 3 test files test the index lib, the helper functions, and the plugin's sync-hook factory — but not the CLI commands themselves.

#### User-local `vault.py` implementation — WORKING

File (removed in Part 2, user-data): `~/.local/share/opencode/session-vault/vault.py` — 457 lines, Python 3, argparse-based CLI.

**Why it worked:**

- All 8 commands implemented: `list`, `inspect`, `export`, `archive`, `restore`, `continue`, `delete`, `refresh`.
- Reads from the opencode SQLite database directly: `~/.local/share/opencode/opencode.db` (table `session`, `message`, `project`).
- `refresh` rebuilds `index.json` from the DB — the index is a derived cache, not the source of truth.
- `index.json` at `~/.local/share/opencode/session-vault/index.json` is 438 KB, 13,794 lines, with real session metadata going back to early June 2026 (titles, directories, agents, models, token counts, costs, message counts, timestamps).
- `archive/` dir holds archived session exports.
- Never committed to the repo; lived only in user-data. The repo `.mjs` code was a parallel, broken reimplementation.

### Why the repo code shipped broken

The repo implementation was a JavaScript port of the Python original that was never completed. The plugin (`omokage.js`) was written against a CLI contract (`sync-session`/`sync-new` commands) that was never implemented in `session-vault.mjs`. The `upsertSession` function — the bridge between the plugin's sync hook and the index — was added to the lib but never wired into any CLI command. The tests covered the lib and the plugin's hook factory in isolation, but no integration test exercised the plugin → CLI → index path. The commit message ("index v2") described an aspirational state, not the shipped code.

### The replacement

`opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md` (dated 2026-06-18, same day as this spec) defines the successor: **`opencode-all`**, a standalone binary TUI application for managing OpenCode sessions across all directories.

Key differences from session-vault:
- **Standalone process**, not an opencode plugin or command.
- **Reads `opencode.db` directly** via `bun:sqlite` (like `vault.py` did) — no separate index file as source of truth.
- **No opencode plugin** — explicitly listed as a non-goal in the design doc.
- **Drops `vault.py`** — explicitly: "Do not keep the Python `vault.py` as a supported v1 frontend."
- **TUI, not CLI** — three-pane persistent layout, keybind-driven.
- Ships in `opencode/tools/opencode-all/`, installed to `~/.local/share/opencode/tools/opencode-all/`.

The cleanup in this spec clears the way for `opencode-all` by removing all session-vault code and user-data.

### Lessons

1. **Single source of truth.** Don't ship two parallel implementations (repo `.mjs` + user-local `vault.py`). Pick one, ship it, document it.
2. **Plugin/CLI contracts need integration tests.** The `omokage.js` → `session-vault.mjs sync-session` contract was never tested end-to-end. An integration test would have caught the missing command immediately.
3. **Commit messages must match code reality.** "index v2" in commit `a1e8c7c` described intent, not shipped code (`INDEX_VERSION = 1`). Reviewers and future maintainers rely on commit messages.
4. **Dead code is a signal.** `upsertSession` was exported but never called. Unused exports should either be wired in or removed before merge.
5. **Don't reference non-existent targets.** `@session-vault` context in the command doc pointed at nothing. Every reference should resolve.
6. **Tests must cover the contract, not just the units.** The 3 remaining test files tested the lib, the helpers, and the hook factory in isolation — but the plugin → CLI → index contract was untested.

---

## Part 2: Cleanup

### Repo files to DELETE (8)

| # | Path | Reason |
|---|------|--------|
| 1 | `opencode/command/session-vault.md` | References phantom `@session-vault` context; 13-line stub |
| 2 | `opencode/plugins/omokage.js` | Calls non-existent `sync-session`/`sync-new` commands; silent failure on every session close |
| 3 | `opencode/scripts/session-vault.mjs` | 3 of 8 commands implemented; `upsertSession` never wired in |
| 4 | `opencode/scripts/lib/session-vault-index.mjs` | `INDEX_VERSION=1` (not v2 as commit claimed); `upsertSession` dead code |
| 5 | `opencode/scripts/tests/session-vault-plugin.test.mjs` | Tests broken plugin contract in isolation |
| 6 | `opencode/scripts/tests/session-vault-index.test.mjs` | Tests unused index lib |
| 7 | `opencode/scripts/tests/session-vault-helper.test.mjs` | Tests partial helper functions |
| 8 | `opencode/scripts/tests/install-fleet-session-vault.test.mjs` | Tests manifest entry being removed |

### Repo files to EDIT (4 for session-vault removal + 3 for agent-count fix = 7 total)

#### Session-vault removal edits

| # | Path | Edit |
|---|------|------|
| 9 | `opencode/opencode.jsonc` | Remove line 10 `"./plugins/omokage.js"` from the `plugin` array (5 → 4 plugins) |
| 10 | `opencode/fleet-manifest.json` | Remove lines 64-85 (the `session-vault` component object). Components count 9 → 8. |
| 11 | `opencode/README.md` | Line 21: remove "session vault" from the core-bundle list. Line 58: remove the `| 4 | Session Vault | yes | on | ... |` table row; renumber rows 5-9 → 4-8. |
| 12 | `opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md` | Line 96: change "Existing session-vault metadata may be read for compatibility, but v1 does not depend on it as source of truth." → "Existing session-vault code and user-data have been fully removed (see `2026-06-18-session-vault-record-and-cleanup.md`); `opencode-all` reads `opencode.db` directly." |

#### Agent-count reconciliation edits (29 → 30 everywhere)

The fleet-manifest is the source of truth: it lists 30 agent files (12 specialists + 16 subagents + 2 escape-hatch). Root `README.md` already says "30-agent fleet". `opencode/README.md` says "29" in 3 places. `opencode/AGENTS.md` says "15 shared subagents" (should be 16 — `tanuki--codemod-runner` is in the manifest but missing from the delegation table).

| # | Path | Edit |
|---|------|------|
| 13 | `opencode/README.md` | Line 3: `"Twenty-nine spirits."` → `"Thirty spirits."`. Line 5: `"a 29-agent fleet"` → `"a 30-agent fleet"`. Line 59: `"29 core shikigami: 12 domain specialists + 2 general agents + 15 shared subagents"` → `"30 core shikigami: 12 domain specialists + 2 general agents + 16 shared subagents"`. |
| 14 | `opencode/AGENTS.md` | Line 7: `"15 shared subagents dispatched by specialists"` → `"16 shared subagents dispatched by specialists"`. Line 123 heading: `"### 15 Shared Subagents"` → `"### 16 Shared Subagents"`. Add a row to the delegation table (after the `hanko--git-seal` row, line 140) for `tanuki--codemod-runner`: `| tanuki--codemod-runner (T2) | Tanuki(Codemod Runner) | opencode-go/mimo-v2.5 | Bulk code transforms (jscodeshift, ast-grep, sed-based); dispatched by shiranui--migration-guide + tsukumogami--code-forgemaster; dispatches shell to karakuri--command-runner |` |
| 15 | `opencode/docs/architecture.md` | Line 14: `"Plugin array must include all 4 plugins"` → `"Plugin array must include all 4 gate plugins"` (clarify — after web-tools lands later it'll be 5, but for now it's 4 gate plugins post-cleanup). |

### User data to DELETE (confirmed — option 3)

The user confirmed full removal of the user-data directory. The `vault.py` content is preserved in Part 1 of this spec (and in git history of the user-data dir if any; it was never committed to the repo).

| # | Path | Contents |
|---|------|----------|
| 16 | `~/.local/share/opencode/session-vault/index.json` | 438 KB, 13,794 lines of session metadata |
| 17 | `~/.local/share/opencode/session-vault/archive/` | Archived session export JSON files |
| 18 | `~/.local/share/opencode/session-vault/vault.py` | 457-line working Python CLI (captured in Part 1 above) |

### NOT touched (confirmed unrelated)

- `harnesses/opencode/future-work/skills/omokage/SKILL.md` — brand-builder progress_feedback skill. Name collision with the plugin, but entirely different concept. The skill is part of the brand-builder domain and stays.
- `harnesses/opencode/future-work/brand-builder-plugin/brand-builder/workflows/michibiki.md` and `references/synthesis-and-clarification.md` + `intent-routing.md` — reference `omokage` as a brand-builder workflow stage (progress_feedback). Unrelated to the session-vault plugin. Stays.
- `harnesses/opencode/future-work/brand-builder-plugin/brand-builder/README.md` — lists `omokage` as a brand command. Unrelated. Stays.

### Verification

After cleanup, run:

```bash
# 1. Tests pass (no broken imports from deleted files)
bun test opencode/scripts/tests/

# 2. No session-vault references remain in opencode/ (except this spec + the opencode-all design's historical mention)
rg -i 'session.?vault|omokage\.js|sync-session|sync-new' opencode/ --glob '!docs/superpowers/specs/2026-06-18-session-vault-record-and-cleanup.md' --glob '!docs/superpowers/specs/2026-06-18-opencode-all-design.md'

# 3. Plugin array has 4 entries (gate plugins only, omokage removed)
grep -c '"./plugins/' opencode/opencode.jsonc   # expects 4

# 4. Fleet manifest has 8 components (session-vault removed)
grep -c '"id":' opencode/fleet-manifest.json     # expects 8

# 5. Agent counts consistent
grep -n 'Twenty-nine\|29-agent\|29 core\|15 shared subagents\|15 Shared Subagents' opencode/README.md opencode/AGENTS.md  # expects no matches

# 6. User-data dir gone
ls ~/.local/share/opencode/session-vault/ 2>&1   # expects "No such file or directory"

# 7. opencode loads cleanly (manual: start opencode, confirm no plugin load errors)
```

---

## Execution order

Checkpoint after each phase. Do not proceed if a checkpoint fails.

### Phase 1 — Write the record doc (this spec)
- **Status:** Done (this file).
- **Checkpoint:** Spec written + self-reviewed.

### Phase 2 — Repo cleanup (8 deletes + 4 edits)
1. Delete the 8 repo files (rows 1-8).
2. Edit `opencode.jsonc` (remove omokage from plugin array).
3. Edit `fleet-manifest.json` (remove session-vault component).
4. Edit `opencode/README.md` (remove session-vault from core-bundle + component table).
5. Edit `opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md` (line 96 update).
- **Checkpoint:** `bun test opencode/scripts/tests/` passes; `rg -i vault opencode/` clean (except this spec + opencode-all design).

### Phase 3 — User-data cleanup (3 deletes)
1. Delete `~/.local/share/opencode/session-vault/index.json`.
2. Delete `~/.local/share/opencode/session-vault/archive/` (recursive).
3. Delete `~/.local/share/opencode/session-vault/vault.py`.
4. Delete the now-empty `~/.local/share/opencode/session-vault/` directory itself.
- **Checkpoint:** `ls ~/.local/share/opencode/session-vault/` → "No such file or directory".

### Phase 4 — Agent-count reconciliation (3 edits)
1. Edit `opencode/README.md` (29 → 30 in 3 places).
2. Edit `opencode/AGENTS.md` (15 → 16 subagents in 2 places + add `tanuki--codemod-runner` delegation table row).
3. Edit `opencode/docs/architecture.md` (clarify "4 gate plugins").
- **Checkpoint:** `grep -n 'Twenty-nine\|29-agent\|29 core\|15 shared subagents\|15 Shared Subagents' opencode/README.md opencode/AGENTS.md` → no matches. Fleet manifest lists 30 agents; AGENTS.md delegation table lists 16 subagent rows.

### Phase 5 — Final verification
- Run all 7 verification commands above.
- Start opencode, confirm no plugin load errors, confirm `/sessions` still works (native opencode, not our removed command).
- **Checkpoint:** All 7 commands pass; opencode loads cleanly.

---

## Out of scope

- **`opencode-all` TUI implementation** — designed in `2026-06-18-opencode-all-design.md`, executed separately.
- **Web-tools plugin (Part 3 of the original brainstorming session)** — designed separately, pending finalization. This spec only covers Parts 1 + 2.
- **`tanuki--codemod-runner` full agent doc audit** — we add the delegation-table row for it (row 14), but we do not audit its `.md` file for consistency with other agents in this cleanup. That's a follow-up.

---

## References

- `opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md` — the successor TUI design.
- Git commits: `a5c5347`, `869cf24`, `395e05e`, `a7969b8`, `9d145b0`, `8b604d3`, `a1e8c7c`, `3681b03`, `d46787b`.
- `~/.local/share/opencode/session-vault/vault.py` (457 lines, captured in Part 1, deleted in Phase 3).
- opencode plugin docs: https://opencode.ai/docs/plugins
- opencode custom-tools docs: https://opencode.ai/docs/custom-tools
