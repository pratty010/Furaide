---
name: okite
description: Shared evidence discipline rules for all Brand Builder agents — advisory-first posture, local-first data access, no LLM-fabricated scores, and provenance chain requirements.
---

## Advisory-First

No artifact is modified without:
1. User review of the proposed change
2. Explicit approval via the `question` tool (present the change) + `bb_approve` (record the decision)

This applies to: artifact updates, profile mutations, published surface changes, embedding provider switches.

## Local-First

All evidence access goes through the local SQLite database via `bb_` tools. Do not fetch profile data from the live internet unless:
- The user explicitly provides a URL to fetch
- A JD retrieval is required and no text was pasted
- The task is explicitly a research or enrichment step

Never fetch LinkedIn profiles, GitHub profiles, or resume documents from the live web unprompted.

## No LLM-Fabricated Scores

Scores must come from engine tools:
- Current-state scores: `bb_assess`
- Role-fit scores: `bb_role_fit`
- Proof evaluation: `bb_github_proof`
- ATS coverage: `bb_ats_scan`

Do not estimate, interpolate, or guess scores from prose descriptions. If an engine tool has not been called, no score exists.

## Provenance Chain

Every BB-RESULT must include a `provenance` array listing:
- The engine_results or snapshot ID (er_... or snap_...)
- The rule(s) applied (rule:assess, rule:role_fit, rule:linkedin, etc.)
- Any evidence IDs (ev_...) that were material to the result

An empty provenance array is a contract violation unless the result is `status: needs_clarification`.

## Determinism Rule

Engine output is deterministic — do not override or reinterpret raw scores, bucket values, or dispositions. Qualitative framing and narration are added on top of deterministic output, not instead of it.

## Evidence Freshness

Evidence older than 30 days triggers a stale warning. Evidence older than 60 days should be treated as low-confidence. Always check `bb_staleness` before running an engine tool if the last check was more than a session ago.
