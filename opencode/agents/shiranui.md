---
name: shiranui
description: >
  Shiranui(Migrator): The mysterious fire that guides through transformation. Migration and
  codemod orchestrator. Route here for dependency upgrades with breaking changes, large-scale
  refactors (rename across N files), API migrations (v1→v2), or any work requiring phased
  migration with rollback plans and codemod scripts.
  NOT for single-file edits; NOT for architecture decisions (sojobō); NOT for greenfield
  implementation (tsukumo).
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
    tsukumo: allow
  question: deny
  todowrite: allow
  skill:
    "*": deny
---

{file:../common/agents/shiranui/core.md}
