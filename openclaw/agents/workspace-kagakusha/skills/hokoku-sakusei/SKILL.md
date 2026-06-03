---
name: hokoku-sakusei
description: Shared report generation helper for sokkou and kensho with date-folder storage and topic-card index upsert.
user-invocable: false
command-dispatch: tool
command-tool: write
metadata: {"openclaw":{"emoji":"📝"}}
---

# Hokoku-Sakusei (報告作成) - Report Generator

Standardize report writing, naming, storage, and topic-card index upsert.

## Inputs

- `mode` (`sokkou` | `kensho`)
- `topic`
- `findings`
- `sources`
- `confidence` (`high` | `medium` | `low`)
- `stats` (search usage, subagents used, source count)
- `summary` (latest synthesized topic summary)
- `tags` (optional)

## Storage Contract

1. Create date folder: `reports/YYYY-MM-DD` (IST date).
2. File naming:
   - instant: `reports/YYYY-MM-DD/<Topic Title>.md`
   - deep: `reports/YYYY-MM-DD/<Topic Title> (Deep Dive).md`
3. Sanitize only forbidden filesystem characters.

## Topic Identity Contract

- Derive card key as canonical kebab-case slug from normalized topic.
- Normalization steps:
  1. remove suffix `(Deep Dive)` for identity
  2. trim extra whitespace
  3. lowercase
  4. replace spaces and punctuation with single `-`
  5. collapse repeated `-`

## Report Structures

### Instant (Sokkou)

Mandatory order:

1. Title
2. Report Meta
3. BLUF
4. Key Findings
5. Concise Analysis
6. What Changed Since Prior Report (optional)
7. Sources

Word range: 700-1200.

### Deep (Kensho)

Mandatory order:

1. Title `(Deep Dive)`
2. Report Meta
3. Abstract
4. Table of Contents
5. Research Questions and Scope
6. Methodology and Evidence Quality Rules
7. Findings by Theme
8. Contradictions and Confidence Deltas
9. What We Still Do Not Know
10. Practical Implications and Next Steps
11. Sources
12. Appendix

Word range: 2500-5000.

## Index Contract (`reports/index.json`)

Use schema v2:

```json
{
  "schemaVersion": "2.0",
  "generatedAt": "ISO-8601",
  "cards": {
    "<cardKey>": {
      "topic": "<display title>",
      "reportDate": "YYYY-MM-DD",
      "summary": "latest cross-mode summary",
      "latestConfidence": "medium",
      "distilled": {
        "status": false,
        "distilledAt": null
      },
      "tags": [],
      "coverage": {
        "hasSokkou": true,
        "hasKensho": false
      },
      "variants": {
        "sokkou": [],
        "kensho": []
      }
    }
  }
}
```

Rules:

- One date factor only at card level: `reportDate`.
- Store both instant and deep variants under the same card key.
- Do not use `createdAt` or `updatedAt`.
- Do not write deprecated fields: `topicId`, `variantCount`, `variants.*.sectionChecklist`, `variants.*.charCount`.
- Update card summary on each write.
- On new card creation, initialize:
  - `distilled.status = false`
  - `distilled.distilledAt = null`
- On any new or updated variant write, reset distillation:
  - `distilled.status = false`
  - `distilled.distilledAt = null`
- Backward compatibility:
  - tolerate legacy fields on read if present
  - never emit legacy fields on new writes

## Variant Metadata Contract

Each variant entry should include:

- `title`
- `path`
- `confidence`
- `sourceCount`
- `searchBudgetUsed`
- `subagentsUsed` (deep only)
- `wordCount`

## Guardrails

- Every material claim must be source-backed.
- Mark unresolved uncertainty explicitly.
- Keep deterministic output and valid JSON on index upsert.
