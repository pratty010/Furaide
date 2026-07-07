---
description: Cancel an active Rejion job
argument-hint: '<job-id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/rejion-companion.mjs" cancel $ARGUMENTS`

This terminates the backend's one-shot process (and its child process tree) and marks the job `cancelled`. Present the output verbatim.
