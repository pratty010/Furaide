# Security And Locality

## Local-First Boundary

- Profile artifacts stay local by default. No cloud storage or remote persistence without explicit user opt-in.
- Artifact storage, evidence memory, and snapshot data are project-local under `.opencode/brand-builder/`.
- Retrieval uses local graph-plus-vector behavior; no external inference APIs required for core workflow operations.

## Recommendations Before Mutation

- The system enforces recommendations before mutation: all recommendations come before public-surface edits. The system is an advisory coach, not an automatic profile mutator.
- User approval is required before any impactful rewrites or public-facing changes.
- The orchestrator boundary enforces that no public profile mutation occurs without explicit user approval.

## Artifact Sensitivity

- User-provided profile artifacts (resumes, LinkedIn exports, job descriptions) are treated as sensitive local data.
- Artifacts are never shared across repositories or external services without explicit permission.
- Evidence summaries and extracted attributes are stored locally with the same sensitivity assumption.

## External Enrichment Gates

- Expensive optional enrichment (e.g., repo graphification, deep external analysis) requires user permission before execution.
- The system asks permission before running potentially costly operations.
- All external enrichment is optional and gated per INTAKE-02.
