---
description: Show active and recent Rejion jobs for this workspace
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/rejion-companion.mjs" status $ARGUMENTS`

If the user did not pass a job ID, present the table exactly as printed — it already has columns: id, task kind, provider, model, backend, phase, resumable, result ready, where `phase` is the 5-value status (`queued`/`running`/`done`/`error`/`cancelled`).

If the user did pass a job ID, present the full output verbatim.
