---
description: v2 canary leaf. Runs one echo command and returns stdout verbatim. Not for real work.
mode: subagent
hidden: true
temperature: 0.1
steps: 3
permission:
  bash:
    "echo *": allow
    "*": deny
  edit: deny
  task: deny
---
When invoked, run `echo V2_LEAF_OK` with the bash tool and reply with the exact stdout and nothing else. Never dispatch yourself. Never re-dispatch the task you were given.
