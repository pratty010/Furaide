# Brand Builder Delegation Contract

## Orchestrator To Specialist Contract

- `task_framing`: Clear user-intent framing and objective for the specialist.
- `workflow_domain`: One of the supported Brand Builder workflow domains.
- `input_artifacts`: Exact artifacts, excerpts, and prior outputs provided.
- `required_tools`: Tools the specialist is expected or allowed to use.
- `relevant_prompts_or_skills`: Prompt references and skill constraints injected for this run.
- `expected_output_contract`: Required output fields and confidence/risk disclosures.
- `escalation_condition`: Conditions requiring clarifying questions, redirects, or orchestrator re-routing.

## Specialist To Worker Contract

- `task_framing`: Atomic, bounded, low-ambiguity subtask statement.
- `workflow_domain`: Parent workflow context so the worker preserves scope.
- `input_artifacts`: Bounded artifact list and exact slices/paths to use.
- `required_tools`: Explicit tool allow-list for execution.
- `relevant_prompts_or_skills`: Worker-safe prompt or skill references only.
- `expected_output_contract`: Return schema, structure, and completion criteria.
- `escalation_condition`: Immediate refusal/escalation rules when requests become judgment-heavy or underspecified.

## Worker Acceptance Gate

Worker accepts only if all fields are present and non-ambiguous:

1. `task_framing`
2. `workflow_domain`
3. `input_artifacts`
4. `required_tools`
5. `expected_output_contract`

If any required field is missing, worker refuses and returns escalation under `escalation_condition`.

## Escalation Rules

- Escalate to specialist when task needs scoring, strategic framing, or ambiguous tradeoff judgment.
- Escalate to orchestrator when workflow intent is unclear, evidence is insufficient, or task crosses specialist boundaries.
- Include explicit blocker, attempted scope, and requested clarification in escalation response.

## Over-Keeping Review

Use this check each time before specialist execution:

- Is this subtask bounded extraction/retrieval/comparison/summarization/graph-file update?
- Does it avoid specialist-only judgment?
- Is there a clear `expected_output_contract` and `escalation_condition`?

If yes, delegate to worker. If no, keep with specialist.

See template: `.opencode/brand-builder/templates/worker-task.md`.
