---
name: domain-scope-card
description: Create a domain scope card that defines the research boundary, key questions, and evidence requirements. Use in Workflow #4 to frame the research project, identify knowledge gaps, and establish evaluation criteria before deep research begins.
---

# domain-scope-card

Define research scope, questions, and success criteria.

## When to invoke

- Workflow #4 enters SCOPE phase
- Need to frame a research project
- Want to identify key questions and unknowns
- Should establish evidence requirements and citation standards

## Phases

1. **Domain Boundary**: Define what is in/out of scope (geography, time, market segments, etc.).
2. **Key Questions**: List 3-5 questions the research must answer.
3. **Evaluation Criteria**: Specify what counts as evidence and how to weight it.
4. **Knowledge Gaps**: Document assumed vs. verified information.
5. **Card Output**: Write to `.opencode/tmp/domain-scope-<project>.md`.

## Output

Structured Markdown card with domain-specific template and links to related research.

## Rules

- Scope card must be explicit; vague boundaries lead to scope creep.
- Questions should be answerable within evidence collection timeline.
- Evaluation criteria must be defined before evidence assessment (avoid motivated reasoning).
