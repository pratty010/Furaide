# OPERATOR — Tuning Reference

Not auto-loaded. Pull this when adjusting routing, budget tiers, or premium-model placement.

---

## Runtime pair

| File | Role |
|---|---|
| `config/opencode.jsonc` | Active runtime config: plugins, provider whitelist, per-agent overrides |
| `docs/routing-manifest.json` | v10 routing source of truth: primary + fallback chains for specialists, subagents, and workers |

Agent frontmatter is descriptive only. Runtime model ownership lives in the pair above.

---

## Budget pools (v10)

| Pool | Models in active v10 routes | Billing shape | Default use |
|---|---|---|---|
| OpenAI flat-sub | `openai/gpt-5.5`, `openai/gpt-5.4-mini` | rate-limited, no marginal per-call cost | premium review and low-friction verification |
| Vertex reserve | `google-vertex/gemini-3.1-pro-preview` | metered reserve | fallback reserve only |
| opencode-go metered | `kimi-k2.6`, `kimi-k2.5`, `qwen3.7-max`, `qwen3.6-plus`, `glm-5`, `glm-5.1`, `deepseek-v4-pro`, `deepseek-v4-flash`, `mimo-v2.5`, `minimax-m2.7` | shared monthly burn | primary fleet work |

Never reintroduce `gemini-2.5-*` into runtime routing.

---

## Tier policy

### Tier 1 — reserve / high-judgment

Use only where a bad answer is more expensive than a premium call.

| Agent | Primary | Why |
|---|---|---|
| `oni--red-team-reviewer` | `openai/gpt-5.5` | adversarial review quality is worth the premium cap |
| `daikoku--finance-steward` | `opencode-go/qwen3.7-max` | finance errors compound across the workflow |

### Tier 2 — workflow specialists

Top-level orchestration and domain judgment.

| Agent | Primary | Fallback |
|---|---|---|
| `kantoku--workflow-director` | `opencode-go/kimi-k2.6` | `opencode-go/kimi-k2.5` |
| `kyakuhon--spec-planner` | `opencode-go/qwen3.6-plus` | `opencode-go/glm-5` |
| `tsukumogami--code-forgemaster` | `opencode-go/kimi-k2.5` | `opencode-go/glm-5.1` |
| `fudo--security-guardian` | `opencode-go/kimi-k2.6` | `opencode-go/deepseek-v4-pro` |
| `tsuchigumo--research-weaver` | `opencode-go/kimi-k2.5` | `opencode-go/glm-5` |
| `daikoku--finance-steward` | `opencode-go/qwen3.7-max` | `opencode-go/kimi-k2.5` |

### Tier 3 — subagent review and support

| Agent | Primary | Fallback |
|---|---|---|
| `kagami--verifier` | `openai/gpt-5.4-mini` | `opencode-go/deepseek-v4-flash` |
| `hanko--git-seal` | `openai/gpt-5.4-mini` | `opencode-go/mimo-v2.5` |
| `hansei--lesson-keeper` | `opencode-go/glm-5` | `opencode-go/minimax-m2.7` |
| `kura--knowledge-banker` | `opencode-go/deepseek-v4-flash` | `opencode-go/minimax-m2.7` |
| `bakeneko--bug-hunter` | `opencode-go/deepseek-v4-pro` | `opencode-go/kimi-k2.5` |
| `oni--red-team-reviewer` | `openai/gpt-5.5` | `google-vertex/gemini-3.1-pro-preview` |

### Tier 4 — worker tier

Workers are the cheap, high-volume execution layer. Keep them below specialist cost unless a spec change justifies otherwise.

| Worker | Primary | Fallback | Use |
|---|---|---|---|
| `general` | `opencode-go/mimo-v2.5` | `opencode-go/minimax-m2.7` | bounded execution |
| `explore` | `opencode-go/qwen3.6-plus` | `opencode-go/minimax-m2.7` | read-only repo mapping |
| `scout` | `opencode-go/qwen3.6-plus` | `opencode-go/minimax-m2.7` | external docs and upstream recon |

If a worker starts doing specialist-grade reasoning, promote the task upward instead of promoting the worker model ad hoc.

---

## Reserve caps

Keep these placements intentionally scarce:

| Model | Cap rule | Current v10 placement |
|---|---|---|
| `openai/gpt-5.5` | primary for at most one live agent | `oni--red-team-reviewer` primary |
| `opencode-go/qwen3.7-max` | primary for at most one live agent | `daikoku--finance-steward` primary |
| `google-vertex/gemini-3.1-pro-preview` | reserve fallback only unless a new justification is documented | `oni--red-team-reviewer` fallback |
| `opencode-go/glm-5.1` | use as a narrow fallback, not a general worker default | `tsukumogami--code-forgemaster` fallback |

---

## Audit commands

```sh
bun test scripts/tests/agents-match-manifest.test.mjs
bun test scripts/tests/routing-manifest.test.mjs scripts/tests/model-failover.test.mjs scripts/tests/model-resolve.test.mjs
bun scripts/lint-dispatch-graph.mjs
```

After changing shipped docs, manifest file lists, or plugin paths, run:

```sh
bun test scripts/tests/
```
