# Agent Description And Parameter Rubric

## Description Shape

Use this frontmatter shape:

```yaml
description: >
  <Role Name>: <Primary routing trigger and purpose>.
  Use for: <specific task types and user phrases>.
  Not for: <common misroutes and exclusions>.
  Behavior: <output contract or critical operational rule>.
```

## Description Rules

- Lead with the operational role, not lore.
- Optimize for routing and invocation, not flavor.
- Include at least one output or behavior contract.
- Mention exclusions that prevent common misroutes.
- Keep lore to zero or one short connection line only when it improves understanding.

## Parameter Review Rules

- `mode` must be `primary`, `subagent`, or `all`.
- `model` must stay in sync with `docs/routing-manifest.json` unless an approved structural change updates both.
- `temperature` range 0.0-1.0. Lower = focused/deterministic, higher = creative/varied. Default varies by model (0 for most, 0.55 for Qwen).
- `top_p` range 0.0-1.0. Alternative to temperature for controlling randomness.
- `steps` controls max agentic iterations before forced text-only response. Set when cost/loop control needed.
- `hidden: true` hides subagent from @ autocomplete. Only for `mode: subagent` agents.
- `permission.task` must only reference real renamed agent stems.
- `permission` last matching rule wins: put broad rules first, narrow rules last.
- `color` accepts hex or theme color names.
- Provider-specific options pass through to the model (e.g., `reasoningEffort` for OpenAI).
