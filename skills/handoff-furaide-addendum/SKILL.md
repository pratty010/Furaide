---
name: handoff-furaide-addendum
description: Extends external handoff skill with long-running harness mode support. Use when handing off multi-phase work to another agent to preserve workflow state, session progress, and durable memory across agent boundaries.
---

# handoff-furaide-addendum

Extend handoff workflow with long-running harness state preservation.

## When to invoke

- Handing off multi-phase work to another agent
- Need to preserve workflow state machine
- Want to maintain session progress tracking
- Need to pass durable memory across agent boundaries

## Additions to base handoff skill

1. **Workflow State Preservation**: Capture current workflow state, artifact registry, and gate status.
2. **Session Progress Tracking**: Record completion milestones and next-state transitions.
3. **Memory Bridge**: Hand off durable learning and decision context for the receiving agent.

## Rules

- Handoff documents must include current state machine position.
- All artifact paths and ledger entries must be explicit.
- Receiving agent must acknowledge state before resuming workflow.
