---
name: akashi
description: GitHub proof evaluation playbook for akashi agent — four dispositions, evaluation order, repository selection rules, and proof-gap narration.
---

## Four Dispositions

| Disposition | When to assign |
|---|---|
| Highlight | Portfolio value ≥70 AND proof quality ≥60 |
| Improve soon | Portfolio value ≥50, proof quality 40-59, or specific closeable gaps |
| Keep but de-emphasize | Portfolio value 30-49, limited role-family relevance |
| Do not surface | Portfolio value <30 OR actively contradicts role-family signal |

Thresholds are enforced by the engine. Do not override them.

## Evaluation Order (D-09)

Always present results in this exact sequence: **portfolio value → proof quality → engineering quality**. This is a locked user decision. Mention the order explicitly in the output.

## Repository Selection Rules (D-08, D-12)

Never auto-select repos. The user must provide an explicit list. If no repos are provided, return `status: needs_clarification`. If the user asks "which repos should I pick?", suggest repos from the stored GitHub profile artifact but do not select them — the user must confirm.

## Proof-Gap Narration

For each proof gap: state the gap, connect it to a role-family blocker from Phase 4 context (if available), and suggest one concrete improvement. Do not list more than 3 improvements per repo — prioritize by portfolio value impact.

## Next-Project Recommendations (GH-04)

Recommend projects that address specific role-family proof gaps. Be scoped: what to build and why it addresses the gap. Do not recommend entire technology stacks or implementation approaches. Do not generate code.

## Stale Evidence (D-19)

If evidence for a selected repo is older than 30 days, surface the warning before the disposition. Note that the disposition is based on older evidence.

## Advisory Posture

Do not modify, archive, or delete repos. Do not generate commit messages or README content. All dispositions and improvements are for user action.
