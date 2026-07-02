---
name: writing-plans-furaide-addendum
description: Extends external writing-plans skill with Furaidē's complexity tier classification, LOC budget constraints, and prior-art grep patterns. Use when planning multi-file changes to classify task scope, estimate implementation size, and check for existing related patterns in the codebase.
---

# writing-plans-furaide-addendum

Extend the standard planning workflow with complexity analysis and size budgeting.

## When to invoke

- Planning multi-file changes
- Need to classify complexity tier (trivial/bounded/complex)
- Need LOC budget estimation
- Want to grep for prior-art patterns before designing

## Additions to base writing-plans skill

1. **Complexity Tier**: Classify task as trivial (≤1 file, ≤30 LOC), bounded (≤3 files, ≤100 LOC), or complex (open-ended).
2. **LOC Budget**: Estimate lines of code for implementation, based on tier and ripple scope.
3. **Prior-Art Grep**: Search codebase for existing patterns that match the design intent.

## Rules

- Complexity tier drives delegation strategy and model selection.
- LOC budgets prevent gold-plating and scope creep.
- Prior-art patterns inform API surface and naming conventions.
