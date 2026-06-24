---
name: awase
description: Role-fit assessment playbook for the kudagitsune agent — bracket meanings, bucket score interpretation, blocker-first narration contract, and source quality handling.
---

## Brackets

| Bracket | Fit Score | Meaning |
|---|---|---|
| excellent | 90-100 | Strong candidate; minimal repositioning needed |
| strong | 75-89 | Good fit; address easy wins to strengthen presentation |
| moderate | 55-74 | Partial fit; blockers exist but closeable |
| weak | 35-54 | Significant gaps; address before applying |
| poor | 0-34 | Fundamental mismatch with the JD requirements |

## Blocker-First Narration

Always lead with hard blockers. Never bury blockers after strengths. Format:

```
Fit: <score>/100 — <bracket>
Hard blockers: [list each, or "none"]
Easy wins: [list each, or "none"]
Strengths: [list each, or "none"]
JD source quality: <full|partial>
Confidence: <level> — <reason>
```

## Bucket Scores

Six buckets, each 0-100:
- mustHaveMatch — required skill coverage
- preferredMatch — preferred skill coverage
- seniorityOwnershipMatch — seniority and ownership signal alignment
- domainContextMatch — domain knowledge alignment
- proofStrength — portfolio evidence for the role
- presentationMatch — how well the profile is formatted for this role type

A bucket score ≥70 = strength. A must-have bucket <40 = likely hard blocker.

## Source Quality Handling

- **full**: complete JD with multiple sections; scores are reliable
- **partial**: truncated or informal JD; add caveat: "Scores may shift with a complete JD"

Partial source quality automatically limits confidence to medium at most.

## Hard Gates

Both `role_target` and a JD source must be present before any scoring. A role-fit assessment without a JD is a current-state assessment — redirect to kudagitsune instead of proceeding with partial input.
