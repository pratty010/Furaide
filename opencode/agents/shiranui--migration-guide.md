---
name: shiranui--migration-guide
description: >
  Migration Guide: Phased migration and codemod orchestrator.
  Use for: dependency upgrades with breaking changes, large-scale refactors (rename across N files), API migrations (v1 to v2), framework swaps, codemod scripts, phased runbooks with rollback.
  Not for: single-file edits (build mode); architecture decisions (sojobo--system-strategist); greenfield implementation (tsukumogami--code-forgemaster).
  Behavior: produces a phased migration plan with rollback per phase; dispatches subagents for research and codemod scoping only — implementation is handed off via the plan, never via direct specialist dispatch.
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
    tsukumogami--code-forgemaster: allow
  question: deny
  todowrite: allow
  skill:
    "*": deny
---

{file:../common/agents/shiranui--migration-guide/core.md}
