# Session Vault Design Spec v2

## Overview

The Session Vault is a global session index that tracks OpenCode sessions across all projects. It enables browsing, searching, and lifecycle management of sessions through a `/session-vault` command and an automatic plugin.

Architecture: index-first for reads (`list`, `search`), SDK-first for actions (`show`, `continue`, `refresh`). The plugin maintains the index via session events. Commands read from the index for fast, offline-capable browsing, and call the opencode SDK for real-time data when actions need fresh information.

The vault uses two statuses only: `active` and `archived`. Permanent deletion of opencode sessions is not the vault's responsibility.

---

## 1. Session Record Schema

```json
{
  "version": 2,
  "sessions": [
    {
      "id": "string",
      "title": "string",
      "workspace": "string",
      "status": "active | archived",
      "model": "string | null",
      "tokens_in": "number | null",
      "tokens_out": "number | null",
      "messages_count": "number | null",
      "cost": "number | null",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601",
      "archived_at": "ISO-8601 | null",
      "archive_path": "string | null"
    }
  ]
}
```

## 2. Field Notes

| Field | Source | Notes |
|-------|--------|-------|
| `id` | SDK `session.id` or `OPENCODE_SESSION_ID` env var | Primary key |
| `title` | SDK `session.title` | Defaults to `Session <timestamp>` |
| `workspace` | SDK session path if available, otherwise `process.cwd()` | Absolute path |
| `status` | Vault-managed | `active` or `archived` only |
| `model` | SDK session model | Example: `opencode-go/glm-5.1` |
| `tokens_in` | Enriched on `session.idle` | Input token count |
| `tokens_out` | Enriched on `session.idle` | Output token count |
| `messages_count` | Enriched on `session.idle` | Message count |
| `cost` | Enriched on `session.idle` | Cost in USD |
| `created_at` | Set on first insert | Never overwritten |
| `updated_at` | Updated on every event | Sort key for recent-first |
| `archived_at` | Set when status changes to `archived` | `null` for active sessions |
| `archive_path` | Set on archive | Points to exported JSON in archive dir |

Archive default path: `~/.local/share/opencode/session-vault/archive/<id>.json`.

Archive path override: `SESSION_VAULT_ARCHIVE_DIR`.

---

## 3. Plugin Architecture

The plugin (`omokage.js`) is the automatic write path. It subscribes to opencode session events and maintains the index in real time. There are no LLM decisions in this flow. Everything is deterministic script logic.

## 4. Event Hooks

| Event | Action | Data Enrichment |
|-------|--------|-----------------|
| Plugin init | Run full `refresh` against `client.session.list()` | Full session data |
| `session.created` | Insert new session into index with partial data | Call `client.session.get()` if available |
| `session.updated` | Update title, model, cost in index | Merge SDK data into index record |
| `session.idle` | Update `tokens_in`, `tokens_out`, `messages_count`, `cost` | Full metrics from SDK if available |
| `session.deleted` | Set `status: archived`, export to archive dir, set `archive_path` | Export full session data before marking archived |

## 5. Plugin Rewrite

Current `omokage.js` uses synchronous `execFileSync` and only hooks `session.stop`. Replace this with async event handling.

Required changes:

- Use async event handlers instead of `execFileSync`.
- Use the `client` SDK object passed to the plugin function.
- Write to `index.json` directly instead of shelling out to CLI scripts.
- Queue writes to prevent concurrent write corruption.
- Keep CLI commands deterministic and usable outside plugin events.

Example shape:

```js
export const SessionVaultPlugin = async ({ client, project, directory }) => {
  return {
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        // upsert partial session
      }
      if (event.type === 'session.updated') {
        // upsert enriched session
      }
      if (event.type === 'session.idle') {
        // enrich with metrics
      }
      if (event.type === 'session.deleted') {
        // archive + mark archived
      }
    },
  };
};
```

The CLI script (`session-vault.mjs`) remains for command invocations. The plugin no longer shells out to it.

---

## 6. Commands

```text
/session-vault
├── list [--all] [--status active|archived] [--workspace <path>] [--format table|json]
├── show <id> [--json]
├── archive <id> [--force]
├── restore <id> [--continue]
├── delete <id> [--force]
├── continue <id>
├── refresh
└── search <query>
```

`export` and `inspect` are not standalone commands. Export is embedded in `archive`. Inspect is replaced by `show`.

---

## 7. `/session-vault list`

Usage:

```text
/session-vault list [--all] [--status active|archived] [--workspace <path>] [--format table|json]
```

Behavior:

1. Read the index file.
2. Show active sessions by default.
3. Ask `Show archived sessions too? [y/N]` unless `--all`, `--status`, or `--format json` makes the behavior explicit.
4. Display matching sessions in a table.
5. Prompt for an action after the table.

Table columns:

```text
| # | ID      | Title         | Workspace | Tokens | Msgs | Cost | Status | Created          | Updated          |
|---|---------|---------------|-----------|--------|------|------|--------|------------------|------------------|
| 1 | ses_123 | Fix installer | /home/ace | 12,450 | 18   | $0.04| active | 2026-06-05 10:00 | 2026-06-05 12:30 |
```

Action prompt:

```text
Choose a session action:
  s <#>  show
  a <#>  archive active session
  d <#>  delete from vault
  c <#>  continue active session
  r <#>  restore archived session
  rc <#> restore archived session and continue
```

Rules:

- `#` is the displayed row number.
- Active rows support: `delete`, `archive`, `show`, `continue`.
- Archived rows support: `delete`, `restore`, `restore and continue`, `show`.
- Null metrics display as `-`.
- Timestamps display as `YYYY-MM-DD HH:mm` in local time.
- Results sort by `updated_at` descending.
- Source is index file only.

Flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--all` | off | Show active and archived sessions |
| `--status active|archived` | `active` | Filter by status |
| `--workspace <path>` | all workspaces | Substring match against workspace |
| `--format table|json` | `table` | Output table or JSON |

---

## 8. `/session-vault show <id>`

Usage:

```text
/session-vault show <id> [--json]
```

Behavior:

1. Try SDK `client.session.get({ path: { id } })` first.
2. Fall back to index if SDK is unavailable or session is missing from opencode.
3. Render fields based on session status.
4. `--json` prints raw JSON.

Active session output:

```text
ID:            ses_abc123
Title:         Fix installer
Workspace:     /home/ace/project
Status:        active
Model:         opencode-go/glm-5.1
Tokens:        12,450 in / 3,200 out
Messages:      18
Cost:          $0.042
Created:       2026-06-05 10:00
Updated:       2026-06-05 12:30

Actions: /session-vault continue ses_abc123 | /session-vault archive ses_abc123 | /session-vault delete ses_abc123
```

Archived session output:

```text
ID:            ses_abc123
Title:         Fix installer
Workspace:     /home/ace/project
Status:        archived
Archive Path:  ~/.local/share/opencode/session-vault/archive/ses_abc123.json
Created:       2026-06-05 10:00
Updated:       2026-06-05 12:30
Archived:      2026-06-05 13:00

Actions: /session-vault restore ses_abc123 | /session-vault restore --continue ses_abc123 | /session-vault delete ses_abc123
```

---

## 9. `/session-vault archive <id>`

Usage:

```text
/session-vault archive <id> [--force]
```

Behavior:

1. If `--force` is not set, confirm: `Archive <id> "<title>"? [y/N]`.
2. Fetch session details via SDK when available.
3. Write export to `$SESSION_VAULT_ARCHIVE_DIR/<id>.json` or the default archive dir.
4. Update index: `status: archived`, `archive_path`, `archived_at`.
5. Print `Archived <id> -> <archive_path>`.

Source: SDK read + index write + filesystem export.

---

## 10. `/session-vault restore <id>`

Usage:

```text
/session-vault restore <id> [--continue]
```

Behavior:

1. Find the session in the index.
2. If status is not `archived`, print `Session <id> is not archived (status: <status>)`.
3. Update index: `status: active`, clear `archive_path`, clear `archived_at`.
4. Print `Restored <id> to active`.
5. If `--continue` is set, run the `continue` action immediately.

The archive file remains on disk.

Source: index file only, plus SDK for optional continue.

---

## 11. `/session-vault delete <id>`

Usage:

```text
/session-vault delete <id> [--force]
```

Behavior:

1. If `--force` is not set, confirm: `Remove <id> from the vault? The archive file will be kept. [y/N]`.
2. Remove the session entry from the index array.
3. Print `Removed <id> from vault. Archive file preserved at <path>` if an archive path exists.
4. Print `Removed <id> from vault. No archive file was recorded.` if no archive path exists.

This command does not call SDK `session.delete`. Permanent opencode session deletion is not the vault's concern.

Source: index file write.

---

## 12. `/session-vault continue <id>`

Usage:

```text
/session-vault continue <id>
```

Behavior:

1. Try SDK `client.session.get({ path: { id } })`.
2. Attempt TUI switch using `client.tui.executeCommand` with an equivalent sessions command if available.
3. If the TUI switch succeeds, print `Switched to session <id>: "<title>"`.
4. If the TUI switch fails, print fallback resume info:

```text
Session <id>: "<title>"
Workspace: /home/ace/project
Run: opencode --session <id>
```

Source: SDK first, index fallback.

---

## 13. `/session-vault refresh`

Usage:

```text
/session-vault refresh
```

Behavior:

1. Call SDK `client.session.list()`.
2. For each SDK session, upsert into the index.
3. For each index entry missing from the SDK response, mark `status: archived` and export if possible.
4. Print `Synced N sessions. M new, K updated, J stale -> archived.`

Also runs automatically on plugin init.

Source: SDK + index.

---

## 14. `/session-vault search <query>`

Usage:

```text
/session-vault search <query>
```

Behavior:

1. Read index file.
2. Filter sessions where `id`, `title`, `workspace`, or `model` contains query, case-insensitive.
3. Display results in the same table format as `list`.

Source: index file only.

---

## 15. Files To Change

### `opencode/plugins/omokage.js`

Rewrite from synchronous `execFileSync` command runner to async event-driven index writer.

Required behavior:

- Use SDK `client` in plugin context.
- Handle `session.created`, `session.updated`, `session.idle`, `session.deleted`.
- Run refresh on plugin init.
- Maintain index directly.
- Queue writes.

### `opencode/scripts/session-vault.mjs`

Extend CLI command handling:

- Add `show`, `archive`, `restore`, `delete`, `continue`, `refresh`, `search`.
- Update `list` with filtering flags and table output.
- Add interactive list action prompt.
- Add deterministic helpers: `formatTable`, `formatTimestamp`, `parseArgs`, `confirm`, `archivePathFor`, `loadSdkSession`, `exportSession`.
- Keep `sync-new` and `sync-session` only if needed for backward compatibility, but the plugin should not call them.

### `opencode/scripts/lib/session-vault-index.mjs`

Extend index utilities:

- Bump `INDEX_VERSION` to 2.
- Add v1-to-v2 migration with defaults for new fields.
- Add `removeSession(index, id)`.
- Add `archiveSession(index, id, archivePath, archivedAt)`.
- Add `restoreSession(index, id)`.
- Keep atomic save behavior.

### `opencode/command/session-vault.md`

Rewrite command prompt:

- Document subcommands and flags.
- Document two-status model.
- Document archive directory and `SESSION_VAULT_ARCHIVE_DIR`.
- Emphasize deterministic scripts and minimal LLM decisions.

### Tests

Update and add tests in:

- `opencode/scripts/tests/session-vault-helper.test.mjs`
- `opencode/scripts/tests/session-vault-index.test.mjs`
- `opencode/scripts/tests/session-vault-plugin.test.mjs`

---

## 16. Acceptance Criteria

- [ ] Plugin subscribes to `session.created`, `session.updated`, `session.idle`, `session.deleted` events.
- [ ] Plugin init triggers refresh against SDK session list.
- [ ] Index schema version is bumped to 2.
- [ ] v1 index files migrate to v2 without data loss.
- [ ] `/session-vault list` shows active sessions in table format.
- [ ] `list --all` includes archived sessions.
- [ ] `list --status archived` filters by status.
- [ ] `list --workspace <path>` filters by workspace.
- [ ] `list --format json` outputs raw JSON.
- [ ] `list` offers action prompt after table output.
- [ ] `/session-vault show <id>` displays context-aware fields.
- [ ] `show --json` outputs raw JSON.
- [ ] `/session-vault archive <id>` exports to archive dir and marks archived.
- [ ] `/session-vault restore <id>` marks archived session active again.
- [ ] `restore --continue` restores and runs continue.
- [ ] `/session-vault delete <id>` removes entry from index and does not call SDK delete.
- [ ] `delete --force` skips confirmation.
- [ ] `/session-vault continue <id>` attempts TUI switch and falls back to resume info.
- [ ] `/session-vault refresh` reconciles index against SDK session list.
- [ ] `/session-vault search <query>` filters index by substring.
- [ ] Archive dir defaults to `~/.local/share/opencode/session-vault/archive`.
- [ ] Archive dir can be overridden with `SESSION_VAULT_ARCHIVE_DIR`.
- [ ] Existing tests pass.
- [ ] New tests cover commands, index migration, and plugin event handling.

---

## 17. Out Of Scope

- Permanent deletion of opencode sessions via SDK `session.delete`.
- Importing archived sessions back into opencode.
- Multi-user or shared vault scenarios.
- Interactive TUI beyond the list action prompt.
- Guaranteeing token/cost metrics if opencode event payloads do not expose them. The implementation should store available metrics and render missing values as `-`.
