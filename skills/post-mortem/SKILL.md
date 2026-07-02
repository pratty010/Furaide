---
name: post-mortem
description: Conduct a root-cause analysis and distill lessons from a completed Workflow #2 debugging session. Use after a bug is fixed to document the failure cascade, root causes, and preventive measures in durable learning artifacts.
---

# post-mortem

Analyze a completed debugging session and extract lasting lessons.

## When to invoke

- Bug fix is complete (Workflow #2 exit)
- Want to distill lessons into durable documentation
- Need to identify preventive measures
- Should capture failure cascade and root causes

## Phases

1. **RCA Distillation**: Summarize failure mode, reproduction steps, and fix mechanism.
2. **Causality Mapping**: Document root causes and contributing factors.
3. **Preventive Measures**: Identify patterns, tests, or guards that would catch this class of bug.
4. **Durable Learning**: Write lesson artifact in `docs/learnings/` with pointers to related patterns.

## Output

Writes to `docs/postmortems/` with links from `docs/learnings/` and relevant architecture docs.

## Rules

- RCA must trace from observed symptom to root cause; avoid speculation.
- Preventive measures must be concrete (test pattern, lint rule, design constraint).
- Learning artifact must be reusable by future work.
