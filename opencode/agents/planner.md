---
name: planner
description: >
  Planner(Implementation Planner): Turns a goal into an executor-ready plan with exact
  file paths, exact code changes, exact verification commands — no judgment calls left
  to the implementer. Route here for multi-file changes (3+ files) with ripple effects,
  uncertain approaches, or before delegating implementation to tsukumo.
  NOT for single-file trivial edits; NOT for architecture decisions (sojobō); NOT for
  code writing (tsukumo).
mode: agent
model: opencode-go/kimi-k2.5
temperature: 0.5
permission:
  edit: deny
  bash: deny
  webfetch: deny
  websearch: deny
  task:
    "*": deny
    explorer: allow
    mikoshi: allow
  question: deny
  todowrite: allow
  skill:
    "*": deny
---

{file:../common/agents/planner/core.md}
