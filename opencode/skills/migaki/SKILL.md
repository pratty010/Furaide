---
name: migaki
description: LinkedIn optimization playbook for migaki — locked variant counts, label rules, advisory contract, ATS discipline, and missing-artifact handling.
---

## Locked Variant Counts (D-02)

| Section | Variant count | Format |
|---|---|---|
| headline | 3 | Single line, ~120 chars max |
| about | 2 | Paragraph prose |
| experience | 2 | Bullet arrays, 3-5 bullets each |
| featured | 2 | Shelf content and media positioning |
| skills | 1 | Reordered existing skills list |

These counts come from the engine. Do not change them.

## Label Rules (D-05)

Use "Variant 1", "Variant 2", "Variant 3" exclusively. Never use A/B labels. If A/B labels appear anywhere in the output, reject and regenerate.

## Advisory Contract

All variants are presented for user review before any profile edit. Do not apply variants to the live profile. Do not claim a variant is "correct" — present it as an option with rationale.

## ATS Discipline

Weave role-family keywords naturally. Keyword density should not exceed natural prose. If bb_ats_scan flags stuffing, back off — reduce density, do not add a disclaimer.

## Missing Artifact Handling (D-20)

If the LinkedIn artifact is absent: proceed in diagnose-only mode. The engine sets `missing_artifact_flag: true` and returns empty variant arrays. Present the diagnoses and recommend uploading the LinkedIn profile for full variants. Do not block.

## Stale Evidence (D-19)

If evidence is older than 30 days, surface the warning prominently. Recommend kurabokko before applying variants. Do not suppress the warning.

## Voice Preservation (D-03)

Keep the user's core message and word choices. Allow moderate rephrasing to strengthen professional signal. Do not introduce corporate-speak or generic template language. Every variant should plausibly be the user's own words.
