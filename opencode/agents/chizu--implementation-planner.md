---
name: chizu--implementation-planner
description: >
  Implementation Planner: Converts a goal into an executor-ready plan for tsukumogami--code-forgemaster.
  Use for: multi-file changes (3+ files) with ripple effects, uncertain approach, or pre-implementation planning that needs exact file paths, exact code changes, and exact verification commands.
  Not for: single-file trivial edits (build mode); architecture decisions or ADRs (sojobo--system-strategist); code writing itself (tsukumogami--code-forgemaster).
  Behavior: emits a plan with no judgment calls left to the implementer; routes codebase recon to mikoshi--code-pathfinder; never writes code, edits files, or runs shell.
mode: all
model: opencode-go/kimi-k2.5
temperature: 0.4
permission:
  edit: deny
  bash: deny
  webfetch: deny
  websearch: deny
  task:
    "*": deny
    mikoshi--code-pathfinder: allow
  question: deny
  todowrite: allow
  skill:
    "*": deny
---

{file:../common/agents/chizu--implementation-planner/core.md}
