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