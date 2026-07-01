---
description: Check backend availability and auth readiness for opencode-go, opencode (OpenCode Zen), and ollama-cloud, and refresh the local model index
argument-hint: '[--default-backend opencode|pi] [--default-model <model>]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kuma-companion.mjs" setup $ARGUMENTS
```

Present the output verbatim. Do not summarize or paraphrase it.
