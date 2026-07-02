---
name: verification-before-completion-furaide-addendum
description: Extends external verification-before-completion skill with LOC-budget verification checks. Use before completing work to ensure implementation meets size constraints and exercises the affected flow end-to-end.
---

# verification-before-completion-furaide-addendum

Extend verification workflow with size-budget validation.

## When to invoke

- About to claim work is complete or passing
- Need to verify changes against LOC budget
- Want to confirm actual vs. planned implementation size
- Need end-to-end flow verification

## Additions to base verification-before-completion skill

1. **LOC Budget Check**: Compare actual lines added/changed against planned budget; surface overruns.
2. **Flow Exercise**: Drive the affected feature end-to-end to observe behavior.
3. **Size Compliance Report**: Document final vs. budgeted size.

## Rules

- Verification always exercises the user-visible flow, not just tests.
- LOC overruns require explicit justification or scope adjustment.
- Size variances of ±20% are acceptable; larger variances trigger review.
