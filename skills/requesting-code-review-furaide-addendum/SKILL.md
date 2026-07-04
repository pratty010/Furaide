---
name: requesting-code-review-furaide-addendum
description: Extends external requesting-code-review skill with prior-art scan, SLAP/SRP violation detection, and LOC budget verification. Use before merging to ensure code follows Furaidē patterns, respects architectural boundaries, and stays within complexity budgets.
---

# requesting-code-review-furaide-addendum

Extend code review workflow with pattern validation and budget checks.

## When to invoke

- Completing implementation and ready for review
- Need to verify code follows existing patterns
- Want to check for SLAP/SRP violations
- Need to confirm implementation stayed within LOC budget

## Additions to base requesting-code-review skill

1. **Prior-Art Scan**: Search codebase for established patterns; flag novel approaches for review.
2. **SLAP/SRP Check**: Detect functions with mixed abstraction levels or multiple responsibilities.
3. **LOC Budget Verification**: Compare actual implementation size against planned budget.

## Rules

- Novel patterns require explicit justification; follow established conventions.
- Each function should have one reason to change.
- LOC overruns trigger scope review, not automatic approval.
