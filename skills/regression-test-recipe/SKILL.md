---
name: regression-test-recipe
description: Create a minimal regression test suite to prevent re-occurrence of a fixed bug. Use in Workflow #2 after identifying root cause to design test cases that exercise the failure mode and verify the fix.
---

# regression-test-recipe

Design and implement a focused regression test suite.

## When to invoke

- Bug is understood and fix is validated
- Need to prevent re-occurrence
- Want to build test coverage for the failure mode
- Should document test intent and edge cases

## Phases

1. **Test Plan**: Design minimal test cases that exercise the bug's failure mode.
2. **Edge Cases**: Identify boundary conditions and related scenarios.
3. **Implementation**: Write tests using the project's established test framework.
4. **Verification**: Confirm tests fail with the old code, pass with the fix.

## Output

Writes to the project's test directory (framework-dependent) with clear test names and comments.

## Rules

- Tests must directly exercise the root cause; avoid tangential coverage.
- Test suite should be minimal; don't gold-plate beyond preventing re-occurrence.
- Each test should document the bug it guards against (comment or docstring).
