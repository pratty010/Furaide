---
name: test-driven-development-furaide-addendum
description: Extends external test-driven-development skill with Global Constraints (YAGNI, KISS, DRY, SLAP, SRP) and stronger anti-rationalization rows. Use when building features or fixing bugs using red-green-refactor loop to ensure code meets Furaidē's architectural standards.
---

# test-driven-development-furaide-addendum

Extend TDD workflow with Global Constraints and rationalization guards.

## When to invoke

- Implementing features with test-first discipline
- Fixing bugs using red-green-refactor
- Need to ensure code adheres to YAGNI, KISS, DRY, SLAP, SRP principles
- Want stronger checks against over-engineering

## Additions to base test-driven-development skill

1. **Global Constraints**: Enforce YAGNI (You Aren't Gonna Need It), KISS (Keep It Simple), DRY (Don't Repeat), SLAP (Single Level of Abstraction), SRP (Single Responsibility).
2. **Anti-Rationalization Rows**: Catch design patterns that violate constraints before implementation.
3. **Refactor Gates**: Verify each refactor maintains constraint compliance.

## Rules

- Every failing test must be motivated by a concrete requirement, not speculative features.
- Code complexity should match problem complexity; error on simplicity.
- Duplication is acceptable if deduplication adds coupling.
