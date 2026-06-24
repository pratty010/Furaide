---
name: kensho
description: Deep research with ROI-prioritized subagents, strict budgets, and 5-10 page deep-dive report output.
user-invocable: true
metadata: {"openclaw":{"emoji":"🔎"}}
---

# Kensho (検証) - Deep Research

Deliver detailed deep research with bounded fan-out, explicit contradiction handling, and long-form readable output.

## Core Directive

Always produce one of these outcomes:

- a finalized deep report with path, or
- a clear failure response with concrete reason category and next action.

## Hard Limits

- Always start by switching runtime to Planning and synthesis model.
- Always run `memory_search` first (coordinator side).
- Max subagents: 4.
- Per-agent `web_search` cap: 1.
- Global `web_search` cap: 4.
- Provide user progress updates across full orchestration with a max 30-second gap.

## Model Policy

- Planning and synthesis: `google/gemini-2.5-pro`.
- Escalation only when contradictions remain unresolved: `google/gemini-3-pro-preview`.
- Subagents primary: `google/gemini-2.0-flash` (default for every spawned subagent).
- Subagents fallback: `google/gemini-2.5-flash-lite`.
- After completion (success or failure), restore agent default model via `session_status(model="default")`.

## Report Length Contract

- Target range: 2500-5000 words (5-10 page equivalent).
- Minimum depth is enforced by section completeness and citation density.

## Mandatory Section Order

1. Title with `(Deep Dive)`
2. Report Meta (Date, Mode, Confidence, Card Key, Scope)
3. Abstract (150-220 words)
4. Table of Contents
5. Research Questions and Scope
6. Methodology and Evidence Quality Rules
7. Findings by Theme (with quantified evidence)
8. Contradictions and Confidence Deltas
9. What We Still Do Not Know
10. Practical Implications and Next Steps
11. Sources (tiered primary/secondary)
12. Appendix (queries used, subagent output summary)

## Orchestration Flow

1. Switch runtime to `Planning and synthesis` model (`google/gemini-2.5-pro`) and send status update.
2. Run `memory_search` and gather context from:
   - `RESEARCH_NOTES.md`
   - `reports/index.json`
   - `reports/**/*.md` (for additional evidence and prior detail)
   Send status update.
3. Resolve card key by canonical slug normalization and send status update.
4. If handoff payload from `sokkou` exists, merge `summary` and optional `feedback` into deep planning context. Send status update.
5. If an instant variant exists for same topic card, extract findings/gaps/open questions and inject into deep plan.
6. Spawn helper subagent for `kensaku-kaizen` using `sessions_spawn` with:
   - `tool: sessions_spawn`
   - `label: "kensaku-kaizen-kensho"`
   - `runTimeoutSeconds: 120`
   - `cleanup: "delete"`
   - task payload containing `mode=kensho` and role scope
   Send status updates before spawn and after completion.
7. If helper subagent fails or returns unusable query allocation, fallback to deterministic role-priority query plan and continue with warning update.
8. Build a 6-10 line deep plan (scope, subquestions, done criteria) and send status update.
9. Present plan to user and request explicit approval/feedback before execution.
10. If plan is not approved, revise once with user feedback and request explicit approval again.
11. Incorporate approved feedback into role allocations and send status update.
12. Spawn up to 4 subagents using `sessions_spawn` with mandatory payload block and settings:
   - `runTimeoutSeconds: 300`
   - `cleanup: "delete"`
   Send status update before fan-out.
13. Maintain Renraku cadence through full run:
   - send update at every major phase transition
   - send heartbeat-style progress updates at least every 30 seconds while work is active
14. Collect subagent outputs, retry once on transient failures, resolve contradictions, and assess confidence. Send status update.
15. Call `hokoku-sakusei` to:
   - write deep report to `reports/YYYY-MM-DD/<Title> (Deep Dive).md`
   - upsert same topic card in `reports/index.json`
   Send status update.
16. Return executive summary with report path.
18. Always attempt model reset via `session_status(model="default")`. If reset fails, include explicit warning.

## Mandatory Spawn Payload Block

Every `sessions_spawn.task` must include:

- objective
- role contract
- allocated query from `kensaku-kaizen`
- output schema
- citation and uncertainty rules
- hard budget constraints

## Reprioritized Subagents (ROI-first)

### 1) Shoko (証拠) - Evidence and Data [Highest Priority]

- Mission: extract verifiable claims with numbers, units, and timeframe.
- Allowed tools: `web_search`, `web_fetch`, `read`
- Budget: max 1 `web_search`
- Output schema: Verifiable Claims, Quantitative Data Table, Source Notes
- Failure behavior: return `insufficient evidence` with best available citations.

### 2) Hikaku (比較) - Comparison and Contradictions

- Mission: build agreement/disagreement matrix and confidence deltas.
- Allowed tools: `web_search`, `web_fetch`, `read`
- Budget: max 1 `web_search`
- Output schema: Agreements, Contradictions Matrix, Confidence Delta Notes
- Failure behavior: list unresolved contradictions and why.

### 3) Kenkai (見解) - Expert Perspectives

- Mission: summarize consensus, contrarian views, and attributed predictions.
- Allowed tools: `web_search`, `web_fetch`, `read`
- Budget: max 1 `web_search`
- Output schema: Consensus Views, Contrarian Views, Attributed Predictions
- Failure behavior: downgrade confidence and avoid strong claims when attribution is weak.

### 4) Kiban (基盤) - Background and Terminology

- Mission: provide compact baseline context, definitions, and timeline anchors.
- Allowed tools: `web_search`, `web_fetch`, `read`
- Budget: max 1 `web_search`
- Output schema: Definitions and Scope, Timeline Anchors, Terminology
- Failure behavior: list alternatives and mark ambiguity when foundational references conflict.

## Guardrails

- Prior recall and similarity reuse: coordinator-side `memory_search` only.
- Never exceed per-agent or global search budgets.
- No local vector/chroma fallback.

## Feedback Intake Contract

- Optional input: `handoff_from_sokkou`
  - `topic`
  - `summary`
  - `feedback` (optional)
  - `report_path`
- If present, this payload must be considered during plan generation and approval updates.

## Failure Completion Contract

If deep report generation fails, return a structured failure response with:

- reason category (`tool_failure`, `source_failure`, `approval_blocked`, `budget_limit`, `synthesis_failure`, or `input_ambiguity`)
- concise root-cause detail
- what completed successfully
- recommended next action
- model reset status (`session_status(model="default")` success/failure)
