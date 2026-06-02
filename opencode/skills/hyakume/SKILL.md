---
name: hyakume
description: ATS scan playbook for hyakume agent — keyword coverage thresholds, format check rules, stuffing detection, and title normalization guidance.
---

## Keyword Coverage Thresholds

| Coverage | Action |
|---|---|
| < 60% | Material gap — list top missing terms by must-have priority |
| 60-79% | Moderate gap — list missing must-have terms only |
| ≥ 80% | Sufficient — report stuffing and format risks only |

Coverage is measured against the role-family target terms from Phase 4 context. Without role-family context, assess general professional vocabulary coverage only.

## Format Risks

Flag these as separate actionable items (not part of coverage score):
- Complex tables or multi-column layouts (ATS parsers fail silently)
- Images or graphics containing text (text not extracted)
- Non-standard section headers (ATS may not map to expected categories)
- Text in headers, footers, or text boxes in document formats
- Special characters used as bullet replacements (▪, ➤, etc.)

## Stuffing Detection

Flag keyword stuffing when:
- The same term appears more than 3 times in a 150-word window
- Keywords are listed without prose context (e.g., "Python JavaScript React Node.js TypeScript" as a standalone line outside a skills section)
- Keyword density feels unnatural compared to the surrounding prose

When flagging stuffing: recommend backing off, not adding a disclaimer. Density reduction is the fix.

## Title Normalization

Check whether the user's displayed job title matches standard ATS-indexed forms. If the title is non-standard (e.g., "Growth Hacker" vs "Growth Marketing Manager"), note the normalization risk and suggest a parenthetical or alternate phrasing.

## Output Contract

Return findings only. Do not rewrite content. Do not generate optimized text. Results feed back to the calling specialist for adjustment.
