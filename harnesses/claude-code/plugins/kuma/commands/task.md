---
description: Delegate an implementation, debugging, research, or follow-up task to a Kuma backend
argument-hint: '[--backend opencode|pi] [--model <model>] [--wait|--background] [--resume|--fresh] <task description>'
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion
---

Raw slash-command arguments:
`$ARGUMENTS`

Execution mode rules:
- If `--wait` is present, run in the foreground and return output verbatim.
- If `--background` is present, launch via `Bash(..., run_in_background: true)` and tell the user to check `/kuma:status`.
- If neither is present, ask the user once via `AskUserQuestion` whether to wait or run in the background, same as `/kuma:review`.

Resume rules:
- If `--resume` is passed, Kuma continues the last relevant run for this workspace using the backend's own native session handle.
- If `--fresh` is passed, Kuma starts a new session, ignoring any prior resumable job.
- If neither is passed, Kuma may continue the last relevant run when that is obvious and safe — this is handled inside `kuma-companion.mjs`, not by this command file.
- At most one active background task job runs per workspace at a time; if one is already running, the companion script fails clearly and points to `/kuma:status`/`/kuma:cancel` rather than queuing silently.

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kuma-companion.mjs" task $ARGUMENTS
```
Return the command stdout verbatim.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/kuma-companion.mjs" task $ARGUMENTS`,
  description: "Kuma task",
  run_in_background: true
})
```
Do not wait for completion in this turn; tell the user to check `/kuma:status`.
