# OPERATOR — Tuning Reference

Not auto-loaded. Pull this when adjusting model assignments, tier discipline, or auditing the fleet.

---

## Model Map

Generated from `docs/routing-manifest.json` v9.1. **Do not edit manually** — run `bun test scripts/tests/agents-match-manifest.test.mjs` after any agent model change to validate.

### Specialists

| Agent | Primary | First Fallback | Full Fallback Chain | Notes |
|---|---|---|---|---|
| deep-researcher | opencode-go/kimi-k2.5 | openai/gpt-5.4-mini | gpt-5.4-mini → qwen3.6-plus → nemotron-3-super-free | |
| financial | opencode-go/qwen3.7-max | openai/gpt-5.4 | gpt-5.4 → minimax-m2.7 → gemini-3.5-flash | |
| legal-compliance | opencode-go/qwen3.6-plus | openai/gpt-5.4-mini | gpt-5.4-mini → glm-5 → nemotron-3-super-free | |
| security | opencode-go/kimi-k2.6 | openai/gpt-5.3-codex | gpt-5.3-codex → glm-5 → deepseek-v4-pro | |
| coding | opencode-go/kimi-k2.5 | openai/gpt-5.3-codex | gpt-5.3-codex → glm-5 → minimax-m2.7 | heavy→gpt-5.3-codex; simple→minimax-m2.7 |
| devops-sre | opencode-go/kimi-k2.6 | openai/gpt-5.4-mini | gpt-5.4-mini → glm-5 → gemini-3-flash-preview | |
| pm-spec | opencode-go/qwen3.6-plus | openai/gpt-5.4-mini | gpt-5.4-mini → glm-5 → gemini-3-flash-preview | |
| writer | opencode-go/glm-5.1 | openai/gpt-5.4 | gpt-5.4 → qwen3.6-plus → gemini-3.5-flash | |
| brand-builder | openai/gpt-5.4 | opencode-go/glm-5.1 | glm-5.1 → qwen3.6-plus → gemini-3.5-flash | |

### Subagents

| Agent | Primary | First Fallback | Full Fallback Chain |
|---|---|---|---|
| yamabiko--source-echo | opencode-go/minimax-m2.7 | openai/gpt-5.4-mini | gpt-5.4-mini → gemini-3-flash-preview → big-pickle |
| kagami--truth-mirror | openai/gpt-5.4-mini | opencode-go/glm-5 | glm-5 → gemini-3.5-flash → deepseek-v4-flash |
| soroban--number-sage | opencode-go/deepseek-v4-flash | openai/gpt-5.4-mini | gpt-5.4-mini → minimax-m2.7 → gemini-3.1-flash-lite |
| karakuri--command-runner | opencode-go/mimo-v2.5 | openai/gpt-5.3-codex | gpt-5.3-codex → gpt-5.4-mini → gemini-3.1-flash-lite |
| mikoshi--code-pathfinder | opencode-go/qwen3.6-plus | google-vertex/gemini-3-flash-preview | gemini-3-flash-preview → glm-5 → big-pickle |
| oni--red-team-reviewer | openai/gpt-5.5 | opencode-go/deepseek-v4-pro | deepseek-v4-pro → glm-5 → gemini-3.5-flash |
| kotodama--prose-polisher | google-vertex/gemini-3.1-pro-preview | openai/gpt-5.4 | gpt-5.4 → qwen3.6-plus → glm-5 |
| jorogumo--synthesis-weaver | opencode-go/glm-5 | openai/gpt-5.4-mini | gpt-5.4-mini → minimax-m2.7 → gemini-3-flash-preview |
| tengu--visual-artisan | google-vertex/gemini-3.5-flash | opencode-go/glm-5 | glm-5 → gpt-5.4-mini → minimax-m2.7 |
| bakeneko--bug-hunter | opencode-go/deepseek-v4-pro | openai/gpt-5.4-mini | gpt-5.4-mini → glm-5 → mimo-v2.5-pro |
| makimono--docs-scribe | opencode-go/glm-5 | openai/gpt-5.4-mini | gpt-5.4-mini → gemini-3-flash-preview → minimax-m2.7 |
| azukiarai--data-sifter | opencode-go/minimax-m2.7 | google-vertex/gemini-3.1-flash-lite | gemini-3.1-flash-lite → mimo-v2.5 → deepseek-v4-flash |
| henge--format-shifter | opencode-go/mimo-v2.5 | google-vertex/gemini-3.1-flash-lite | gemini-3.1-flash-lite → minimax-m2.7 → big-pickle |

---

## Reserved Caps

These 4 models are capped to control cost — each is primary for ≤1 agent and first-fallback for ≤1 other:

| Model | Cap | Current placement |
|---|---|---|
| opencode-go/glm-5.1 | primary ≤1 + #1-fallback ≤1 | primary: writer; fallback: brand-builder |
| opencode-go/qwen3.7-max | primary ≤1 + #1-fallback ≤1 | primary: financial |
| google-vertex/gemini-3.1-pro-preview | primary ≤1 + #1-fallback ≤1 | primary: kotodama--prose-polisher |
| openai/gpt-5.5 | primary ≤1 + #1-fallback ≤1 | primary: oni--red-team-reviewer |

---

## Reserve Justification

Why the reserved models are worth their cost:

- **glm-5.1 (writer)** — long-form writing quality degrades markedly on workhorse models; a weak draft costs 3+ revision rounds to elevate.
- **qwen3.7-max (financial)** — financial arithmetic errors compound; a bad DCF or unit-economics model requires full reconstruction, not correction.
- **gemini-3.1-pro-preview (kotodama--prose-polisher)** — subagent elevating fully-drafted prose to publication quality; workhorse models flatten voice and miss structural issues that only surface on re-read.
- **gpt-5.5 (oni--red-team-reviewer)** — a shallow adversarial review that misses blast-radius issues creates false confidence; the cost of rework deferred to post-merge far exceeds the review cost.

---

## Audit

Canonical check after any agent model edit:

```sh
# Model-manifest consistency (expect all pass)
bun test scripts/tests/agents-match-manifest.test.mjs

# No Gemini 2.x in any agent model: field (expect empty — 2.x removed from whitelist entirely)
grep -rl 'model:.*gemini-2\.5' ~/.config/opencode/agents/*.md

# No gemini-2.5 in opencode.jsonc whitelist (expect empty)
grep 'gemini-2\.5' ~/.config/opencode/opencode.jsonc
```

---

## Context Load

The design assumes a large roster is near-free at baseline because **a subagent runs in its own session — its body is loaded as that subagent's prompt only when it is invoked**, not concatenated into the primary's context. Only AGENTS.md (+ `instructions` glob) and the one-line-per-agent registry load at baseline. To confirm in practice: start a primary session, run `/context`, and check that agent bodies are absent from the primary's token count until a subagent is dispatched. If a future opencode version changes this, revisit the one-role-per-file decision.

---

## Model budget (v9.1)

Three pools with distinct billing types:

| Pool | Models | Billing | Use for |
|---|---|---|---|
| OpenAI flat-sub | gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex | Rate-limited, $0 marginal | High-intelligence roles; kagami--truth-mirror (unmetered volume) |
| Gemini credit ($300 one-time) | gemini-3.1-pro-preview, gemini-3.5-flash, gemini-3.1-flash-lite, gemini-3-flash-preview | Metered, burns down | Prose-wordsmith + tengu--visual-artisan only (reserve) |
| opencode-go pool (~$60/mo) | kimi-k2.6/k2.5, glm-5.1/5, qwen3.7-max/3.6-plus, deepseek-v4-pro/flash, minimax-m2.7, mimo-v2.5/pro | Metered, shared pool | All other specialist/subagent work |

**Never route to:** Gemini 2.x (`gemini-2.5-*`) — removed from whitelist entirely. Use Gemini 3.x only.

### Failover policy

On retryable provider errors (429/5xx/timeout/model_not_found): `plugins/model-failover.js` walks the fallback chain from `routing-manifest.json` cross-vendor. Each transition is logged to `~/.local/share/opencode/state/<slug>/failover.ndjson`. Run `scripts/budget-report.mjs` after 7 days to check pool burn rate.
