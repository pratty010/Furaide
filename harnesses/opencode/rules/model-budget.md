# Model Budget Caps

Reserve the following models for primary and first-fallback assignment only. Each model is shared across the fleet.

| Model | Reserved For | Status |
|---|---|---|
| `opencode-go/glm-5.1` | Primary for 1 agent + first-fallback for 1 other | Capped |
| `opencode-go/qwen3.7-max` | Primary for 1 agent + first-fallback for 1 other | Capped |
| `google-vertex/gemini-3.1-pro-preview` | Primary for 1 agent + first-fallback for 1 other | Capped |
| `openai/gpt-5.5` | Primary for 1 agent + first-fallback for 1 other | Capped |

## Costly Models

Use these sparingly. Each has high per-call cost or strict quota limits:

- `opencode-go/kimi-k2.6`
- `google-vertex/gemini-3.5-flash`
- `openai/gpt-5.4`

## Source of Truth

Runtime model assignment, fallback chains, and tier (heavy/simple/canary) definitions live in `docs/routing-manifest.json` (v10+). Agent frontmatter `model:` fields are overridden by `opencode.jsonc` `agent.<name>.model` settings, which are the actual runtime source.

**Before adding a reserved-model assignment:** verify no other agent is already holding primary or first-fallback for that model in `docs/routing-manifest.json`.
