---
name: kensaku-kaizen
description: Shared query optimization helper for sokkou and kensho under strict budgets.
user-invocable: false
disable-model-invocation: false
metadata: {"openclaw":{"emoji":"🧭"}}
---

# Kensaku-Kaizen (検索改善) - Query Optimizer

Generate the best possible search set under a hard budget.

## Inputs

- `topic`
- `mode` (`sokkou` | `kensho`)
- `active_roles` (optional for `kensho`: ordered subset of `shoko` | `hikaku` | `kenkai` | `kiban`)
- `existing_summary` (optional)
- `tags` (optional array)
- `known_gaps` (optional array of unanswered questions)

## Output Contract

Return structured output:

- `queries[]` ordered objects:
  - `id`
  - `query`
  - `intent`
  - `priority`
  - `role` (only for kensho role-bound queries)
- `allocations` (kensho only): role-to-query map, max 1 query per active role
- `coverage_map`: query id -> addressed sub-question or role objective

## Budget Rules

- Sokkou: hard max 2 queries total.
- Kensho: hard max 4 queries total globally.
- Kensho role assignment: hard max 1 query per active role.

## Mode-Specific Query Strategy

### Sokkou Mode

1. Produce up to 2 high-signal queries:
   - one broad discovery query
   - one targeted validation query
2. Prioritize recency and direct answerability.
3. Keep language concise for fast execution.

### Kensho Mode

1. Produce up to 4 role-ready queries aligned with active roles.
2. Keep max 1 query per active role.
3. Apply fixed role priority when role count exceeds budget:
   1. `shoko`
   2. `hikaku`
   3. `kenkai`
   4. `kiban`
4. Maintain deterministic assignment and ordering for repeatability.

## Query Formation Method

1. Extract entities, geography, and intent.
2. Apply keyword enrichment (synonyms and domain terms).
3. Use pseudo-answer shaping to identify evidence-bearing query terms.
4. Combine broad, targeted, and validation styles.
5. Trim final set to budget deterministically and remove redundancy.

## Quality Rules

- Prefer high-signal sources and explicit date constraints.
- Favor reproducible terms over vague language.
- Do not exceed budget even if coverage is incomplete.
