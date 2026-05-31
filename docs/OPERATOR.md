# OPERATOR — Tuning Reference

Not auto-loaded. Pull this when adjusting model assignments or tier discipline.

---

## Tiers

**Intelligence-grade (gate hard — 10 agents max)**

- T1 reserve: `gpt-5.5` · `gemini-3.1-pro-preview` · `gemini-3.1-pro-preview-customtools` · `gemini-3.5-flash`
- T1.5: `gpt-5.4`

**Workhorse (default volume)**

`gpt-5.4-mini` · `gpt-5.3-codex` · `gpt-5.2` · `gemini-3-flash-preview` · `gemini-3.1-flash-lite` · `gemma-4-26b-a4b-it` · `gemma-4-31b-it`

**Free (low-stakes, low back-and-forth, spread <= 2 agents each)**

`big-pickle` · `nemotron-3-super-free` · `deepseek-v4-flash-free` · `mimo-v2.5-free`

**Never auto-route:** Gemini 2.x (`gemini-2.5-*`) — whitelisted in `opencode.jsonc` for manual selection only; no agent's `model:` field may use it.

---

## Model Map

| Agent | Model | Tier | Fallback | Escalation |
|---|---|---|---|---|
| general | opencode/big-pickle | free | partial findings | scope>10 files → @strategist/@coder |
| explore | opencode/deepseek-v4-flash-free | free | raw results | synthesis → @general |
| scout | google-vertex/gemini-3.1-flash-lite | workhorse | bunx ctx7@latest then webfetch | lib missing → manual clone |
| deep-research | openai/gpt-5.4-mini | workhorse | scoped plan + needs-clarification | high-stakes final synthesis → @synthesizer |
| strategist | openai/gpt-5.5 | intel(T1) | partial plan + needs-clarification | decision-paralysis → primary question |
| coder | openai/gpt-5.3-codex | workhorse | diff-text if write denied | codex stalls → caller switches model |
| reviewer | openai/gpt-5.4 | intel(T1.5) | partial table | high-blast-radius → escalate gpt-5.5 |
| security | openai/gpt-5.5 | intel(T1) | refuse w/o threat model | High/Critical → needs-clarification |
| debugger | openai/gpt-5.4 | intel(T1.5) | repro+hypothesis | 3 failed root-causes → escalate |
| tester | openai/gpt-5.4-mini | workhorse | failing tests | flaky infra → @devops |
| scanner | google-vertex/gemini-3.1-flash-lite | workhorse | raw input | never escalates; free fallback mimo-v2.5-free |
| designer | google-vertex/gemini-3.1-pro-preview-customtools | intel(T1) | 2 of N directions | arch implication → @strategist:ARCHITECT |
| devops | openai/gpt-5.4-mini | workhorse | dry-run output | prod-destructive → needs-clarification |
| migrator | openai/gpt-5.3-codex | workhorse | staged diff | breaking API → @strategist:PLAN |
| quant | opencode/deepseek-v4-flash-free | free | partial calc + gaps | can't math → gpt-5.4; tax → @compliance; free fallback gemma-4 |
| finance | openai/gpt-5.4-mini | workhorse | states assumptions | tax/multi-entity → escalate gpt-5.4/5.5 |
| analyst | google-vertex/gemini-3-flash-preview | workhorse | chart-ready output | pipeline → @data-engineer |
| data-engineer | openai/gpt-5.3-codex | workhorse | dry-run on destructive | analysis → @quant |
| researcher | google-vertex/gemini-3.1-flash-lite | workhorse | cited findings + source manifest | source corpus >500K → gemini-3.1-pro-preview |
| intel | google-vertex/gemini-3-flash-preview | workhorse | cited scan + source manifest | weak coverage → @researcher follow-up |
| synthesizer | openai/gpt-5.5 | intel(T1) | outline+sections | multimodal → @designer |
| compose | google-vertex/gemini-3-flash-preview | workhorse | outline+sections | premium brief → escalate gemini-3.1-pro-preview |
| editor | openai/gpt-5.4-mini | workhorse | tracked suggestions | rewrite → @compose |
| academic | google-vertex/gemini-3.1-pro-preview | intel(T1) | structured analysis | short paper → nemotron |
| factchecker | openai/gpt-5.4 | intel(T1.5) | supported/unsupported/[UNVERIFIED] | cannot source → flag |
| legal | openai/gpt-5.5 | intel(T1) | flagged-issues list | High-risk → needs-clarification (attorney) |
| compliance | openai/gpt-5.5 | intel(T1) | obligation map | ambiguous → needs-clarification |

---

## Reserve Justification

One line per intel-grade agent explaining why a wrong answer costs >3 rounds or needs a capability workhorses lack.

- **strategist** — architecture misalignment propagates across every downstream task; reversing it after coding starts costs 5+ rounds.
- **security** — a missed threat model invalidates the entire audit; a workhorse lacks the adversarial depth to construct one reliably.
- **legal** — an incorrect legal read can commit the user to an unenforceable position; correction requires attorney review, not a re-run.
- **compliance** — obligation gaps compound silently; a workhorse will miss edge-case jurisdiction interactions that cause downstream cascades.
- **synthesizer** — low-quality synthesis from scattered sources produces confident-sounding noise; a workhorse cannot discriminate signal at scale.
- **academic** — peer-review-grade analysis requires nuanced source evaluation; a workhorse defaults to surface summary and misses methodological flaws.
- **designer** — premature visual direction locks downstream implementation; only T1 reasoning reliably anticipates arch implications before pixel-level decisions.
- **reviewer** — a shallow review that misses blast-radius issues creates false confidence and defers rework to the worst possible moment.
- **debugger** — a wrong root-cause sends the coder down a dead branch; the cost is the coder's full iteration cycle, repeated.
- **factchecker** — an undetected false claim in a report or legal/financial context can cause real-world harm that no follow-up round can undo.

---

## Gating Rules

1. Default workhorse; intel-grade only on capability-gap or cascade-risk.
2. `gpt-5.3-codex` is cheapest GPT for codegen — prefer over `gpt-5.4` unless reasoning (not editing) is the bottleneck.
3. Free pool spread: no single free model > 2 primary agents (`big-pickle`: general+intel; `deepseek`: explore+quant; `nemotron`: researcher; `mimo`: routine-pass fallback only).
4. `compose`/`finance` default workhorse; escalate inline (premium prose / tax-multientity).
5. Gemma-4 local = offline-safety or free-quota-exhausted fallback.

---

## Audit

Grep commands to verify tier discipline after any agent file change.

```sh
# Intel-grade count (expect ~10)
grep -lE 'model:.*(gpt-5\.5|gpt-5\.4$|gemini-3\.1-pro-preview)' ~/.config/opencode/agents/*.md | wc -l

# No Gemini 2.x in any agent model: field (expect empty). 2.x is whitelisted in jsonc for MANUAL use only.
grep -l 'model:.*gemini-2.5' ~/.config/opencode/agents/*.md

# Every subagent denies question (expect empty)
grep -L 'question: deny' ~/.config/opencode/agents/*.md
```

---

## Context Load (verify the roster-size premise)

The design assumes a large roster is near-free at baseline because **a subagent runs in its own session — its body is loaded as that subagent's prompt only when it is invoked**, not concatenated into the primary's context. Only AGENTS.md (+ `instructions` glob) and the one-line-per-agent registry load at baseline. To confirm in practice: start a primary session, run `/context` (or equivalent), and check that agent bodies are absent from the primary's token count until a subagent is dispatched. If a future opencode version changes this, revisit the one-role-per-file decision.

---

## Model budget (v9.1)

Three pools with distinct billing types:

| Pool | Models | Billing | Use for |
|---|---|---|---|
| OpenAI flat-sub | gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex | Rate-limited, $0 marginal | High-intelligence roles; fact-checker (unmetered volume) |
| Gemini credit ($300 one-time) | gemini-3.1-pro-preview, gemini-3.5-flash, gemini-3.1-flash-lite, gemini-3-flash-preview | Metered, burns down | Prose-wordsmith + designer only (reserve) |
| opencode-go pool (~$60/mo) | kimi-k2.6/k2.5, glm-5.1/5, qwen3.7-max/3.6-plus, deepseek-v4-pro/flash, minimax-m2.7, mimo-v2.5/pro | Metered, shared pool | All other specialist/subagent work |

### Reserved model caps (v9.1)

These 4 models are capped to control cost:

| Model | Cap | Current placement |
|---|---|---|
| opencode-go/glm-5.1 | primary ≤1 agent + #1-fallback ≤1 other | primary: writer; fallback: brand-builder |
| opencode-go/qwen3.7-max | primary ≤1 agent + #1-fallback ≤1 other | primary: financial |
| google-vertex/gemini-3.1-pro-preview | primary ≤1 agent + #1-fallback ≤1 other | primary: prose-wordsmith |
| openai/gpt-5.5 | primary ≤1 agent + #1-fallback ≤1 other | primary: reviewer |

### Failover policy

On retryable provider errors (429/5xx/timeout/model_not_found): `plugins/model-failover.js` walks the manifest fallback chain cross-vendor. Each transition is logged to `~/.local/share/opencode/state/<slug>/failover.ndjson`. Run `scripts/budget-report.mjs` after 7 days to check pool burn rate.
