---
description: Show the final stored output for a finished Kuma job
argument-hint: '<job-id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/kuma-companion.mjs" result $ARGUMENTS`

Present the output verbatim. Do not summarize or condense it.
