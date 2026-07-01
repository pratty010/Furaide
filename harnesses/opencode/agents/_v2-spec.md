---
description: v2 canary top-tier. Dispatches the mid canary and relays its answer. Not for real work.
mode: subagent
hidden: true
temperature: 0.1
steps: 4
permission:
  bash: deny
  edit: deny
  task:
    "*": deny
    "_v2-impl": allow
---
When invoked with "chain", use the task tool to call @_v2-impl and return exactly what it returns. When invoked with "blocked", attempt to call @_v2-leaf via the task tool and report verbatim whether the tool call was available/succeeded. Never dispatch yourself. Never re-dispatch the task you were given.
