# Agent Fleet Registry (v9.1)

> Model routing: `docs/routing-manifest.json` is the single source of truth.
> All `model:` values in agent frontmatter are generated from this manifest.
> Fallback chains: see `plugins/model-failover.js`.

## 9 Specialists (mode: all — long-running orchestrators)

| Specialist | Primary Model | When to route here |
|---|---|---|
| deep-researcher | opencode-go/kimi-k2.5 | Multi-domain research, detailed reports, evidence synthesis |
| financial | opencode-go/qwen3.7-max | Financial analysis, investment cases, economic modeling |
| legal-compliance | opencode-go/qwen3.6-plus | Regulatory mapping, contract review, compliance checks |
| security | opencode-go/kimi-k2.6 | Code audits, threat modeling, vulnerability research |
| coding | opencode-go/kimi-k2.5 | Software implementation, implement↔test ralph loops |
| devops-sre | opencode-go/kimi-k2.6 | Incident response, deployments, runbook execution |
| pm-spec | opencode-go/qwen3.6-plus | Spec-Kit production, AC definition, product planning |
| writer | opencode-go/glm-5.1 | Long-form content, articles, white papers, scripts |
| brand-builder | openai/gpt-5.4 | Brand positioning, messaging frameworks, identity |

## 13 Shared Subagents (mode: subagent — dispatched by specialists)

| Subagent | Primary Model | Role |
|---|---|---|
| source-retriever | opencode-go/minimax-m2.7 | Multi-source fetch and dedup → Source Manifest |
| fact-checker | openai/gpt-5.4-mini | Claim vs source verification → verdict per claim |
| data-analyst | opencode-go/deepseek-v4-flash | Quant/math/telemetry → tables + Evidence Matrix |
| code-runner | opencode-go/mimo-v2.5 | Deterministic execution → stdout/stderr/artifacts |
| explorer | opencode-go/qwen3.6-plus | Read-only recon (1M ctx) → file/symbol map |
| reviewer | openai/gpt-5.5 | Adversarial evaluation → findings table (premium) |
| prose-wordsmith | google-vertex/gemini-3.1-pro-preview | Final-prose polish → revised prose + notes (premium) |
| synthesizer | opencode-go/glm-5 | Normalized corpus → narrative deliverable |
| designer | google-vertex/gemini-3.5-flash | Diagrams/SVG/HTML/identity |
| debugger | opencode-go/deepseek-v4-pro | RCA → ExecutionPacket for code-runner |
| technical-writer | opencode-go/glm-5 | Mechanical reliable docs → sectioned Markdown |
| extractor (T2) | opencode-go/minimax-m2.7 | Bulk structured pull → JSON array |
| formatter (T2) | opencode-go/mimo-v2.5 | Bulk format/transform → md/tables/JSON/SARIF |

## State and Gates

- State: `scripts/workflow-state.mjs` is the SOLE writer. Specialists call it at phase boundaries; never write `state.json` directly.
- Gates: `plugins/gate-enforcer.js` blocks `critical` verdicts fleet-wide. Fails CLOSED if unloaded.
- Domain gate scripts: `scripts/{citation-verify,playbook-check,action-allowlist,voice-check}.mjs`
- Model failover: `plugins/model-failover.js` walks the manifest fallback chain on retryable errors.

## Canary results

See `scripts/canaries/RESULTS.md` for Phase A results (all models reachable, mimo-v2.5 confirmed for code-runner, T2 depth GO).
