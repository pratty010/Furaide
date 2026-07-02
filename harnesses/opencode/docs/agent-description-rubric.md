# Agent Description and Frontmatter Rubric

## v2 frontmatter shape

Use this shape for active v2 agents:

```yaml
---
description: >
  <Operational role>: <primary routing trigger and purpose>.
  Use for: <task types and user phrases>.
  Not for: <common misroutes and exclusions>.
  Behavior: <output contract or critical operating rule>.
mode: primary | subagent | all
temperature: <optional number>
permission:
  edit: allow | deny | {"path/**": allow, "*": deny}
  bash: allow | deny | {"command *": allow, "*": deny}
  webfetch: allow | deny
  websearch: allow | deny
  task:
    "*": deny
    <allowed-target>: allow
  question: allow | deny | ask
  todowrite: allow | deny
  skill:
    "*": deny
    <allowed-skill>: allow
# Manifest
# governing_file: <spec or source-of-truth path>
---
```

## Hard rules

- Do **not** add `name:` frontmatter. The filename is the stem.
- Do **not** add runtime `model:` frontmatter. Runtime routing lives in `config/opencode.jsonc` and `docs/routing-manifest.json`.
- `permission.task` starts from `"*": deny` and only allows edges from the v2 delegation table.
- Scoped `bash` and `edit` carve-outs must end with a deny catch-all.
- `mode` must be `primary`, `subagent`, or `all`.
- Use `question: ask` only where the workflow explicitly permits user-facing gating.

## Description rules

- Lead with the operational role, not lore.
- Optimize for routing accuracy.
- Include at least one output or behavior contract.
- Name the main exclusions that prevent common misroutes.
- Keep prose compact. One paragraph is enough.

## Anti-recursion line

Every active v2 agent body must contain an explicit anti-recursion sentence. Default line:

```text
Never dispatch yourself.
```

If an agent delegates, it may add stronger wording such as “Never re-dispatch the task you were given,” but the self-dispatch ban must remain explicit.

## Review checklist

- filename stem matches every `permission.task` reference to it
- no `name:` field
- no runtime `model:` field
- scoped permissions match the owning workflow row
- anti-recursion line present in body
- description includes use-for, not-for, and behavior contract
