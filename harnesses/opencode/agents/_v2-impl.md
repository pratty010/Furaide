---
description: v2 canary mid-tier. Dispatches the leaf canary and relays its answer. Not for real work.
mode: subagent
hidden: true
temperature: 0.1
steps: 4
permission:
  bash: deny
  edit: deny
  task:
    "*": deny
    "_v2-leaf": allow
---
When invoked, use the task tool to call @_v2-leaf and return exactly what it returns. Never dispatch yourself. Never re-dispatch the task you were given.
