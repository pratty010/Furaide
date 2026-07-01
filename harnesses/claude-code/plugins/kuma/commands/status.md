---
description: Show active and recent Kuma jobs for this workspace
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/kuma-companion.mjs" status $ARGUMENTS`

If the user did not pass a job ID, render the output as a compact Markdown table with columns: id, task kind, provider, model, backend, phase, resumable, result ready. The `phase` column is the 5-value status (`queued`/`running`/`done`/`error`/`cancelled`) — do not invent additional phase values.

If the user did pass a job ID, present the full output verbatim.
