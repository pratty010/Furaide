---
description: Browse, search, inspect, export, archive, restore, continue, and delete global OpenCode sessions from the Session Vault
agent: build
---
Use @session-vault context to manage global sessions.

Requirements:
- Read `~/.local/share/opencode/session-vault/index.json` first.
- Show all sessions in recent-first order.
- Support search/filter similar to `/sessions`.
- Allow actions: inspect, export, archive, restore, continue, delete, refresh.
- Ask for confirmation only on destructive actions.
- If direct in-place continue is unsupported, return the safest supported resume/open fallback.
