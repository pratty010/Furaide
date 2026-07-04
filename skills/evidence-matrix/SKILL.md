---
name: evidence-matrix
description: Build an evidence matrix that maps research questions to sources, claims, and confidence levels. Use in Workflow #4 SYNTHESIS phase to organize findings, track citation provenance, and identify weak claims before finalizing the research report.
---

# evidence-matrix

Organize and validate research evidence systematically.

## When to invoke

- Workflow #4 enters SYNTHESIS phase
- Need to track evidence provenance and confidence
- Want to identify unsupported or weakly sourced claims
- Should organize findings for final report

## Structure

Evidence matrix maps:
- Research question → sources consulted
- Claim → primary source + secondary confirmations
- Confidence level (primary evidence, corroborated, inference, assumption)
- Gaps or conflicts between sources

## Phases

1. **Harvest**: Extract all claims and evidence from research notes.
2. **Organize**: Map claims to research questions.
3. **Validate**: Verify each claim has at least one primary source.
4. **Audit**: Flag inferences, assumptions, and conflicts.
5. **Output**: Write to `.opencode/tmp/evidence-matrix-<project>.json`.

## Rules

- Every claim must cite a source; no unsourced assertions in final report.
- Primary source required for core claims; secondary confirmations raise confidence.
- Conflicting sources must be noted explicitly, not hidden.
