# Inter-Agent Handoff Contracts

This document defines the message formats for agent-to-agent handoffs in the OpenCode v2 workflows. These contracts are always-on rules — the payload structures are the single source of truth for depth-2+ coordination and non-interactive routing.

## RoutePacket Contract

A `RoutePacket` is returned upward by a specialist when work falls outside its ownership or dispatch allow-list.

```yaml
route_packet:
  from: string                # Specialist or agent that found the work
  found_at_state: string      # Workflow state name where work was discovered
  work_kind: string           # Category: `implement`, `verify`, `research`, `security`, `git`, `learn`
  suggested_owner: string     # Recommended specialist or handler
  artifacts: string[]         # Temporary artifacts/context needed by next handler
  blocking: yes | no          # Whether the workflow is halted awaiting this route decision
  user_decision_needed: boolean # True if route must be approved by user; false if autonomous
```

**Example:**

```yaml
route_packet:
  from: kyakuhon--spec-planner
  found_at_state: PLAN_DRAFT
  work_kind: implement
  suggested_owner: tsukumogami--code-forgemaster
  artifacts:
    - .opencode/tmp/wf-123/plan-file.md
    - .opencode/tmp/wf-123/implementation-analysis.md
  blocking: yes
  user_decision_needed: false
```

## ExecutionPacket Contract

An `ExecutionPacket` is returned by a debugger (`bakeneko--bug-hunter` or equivalent) to a fix implementer or verifier.

```yaml
execution_packet:
  bug_summary: string
  ranked_hypotheses:
    - hypothesis: string
      confidence: number
      files_to_inspect: string[]
      commands_to_run: string[]
      expected_observations: string[]
      stop_criteria: string
  recommended_next_action: string
  stop_criteria: string
```

**Example:**

```yaml
execution_packet:
  bug_summary: "CLI crashes on undefined config.output when no --output flag is provided"
  ranked_hypotheses:
    - hypothesis: "config.output accessed without null-check in CLI initialization"
      confidence: 0.85
      files_to_inspect:
        - src/cli/index.ts
        - src/config/loader.ts
      commands_to_run:
        - npm test -- --grep "undefined output"
        - grep -r "config\.output" src/
      expected_observations:
        - "Existing test fails; null guard is missing"
        - "3+ code paths access config.output unsafely"
      stop_criteria: "Locate the missing null check"
    - hypothesis: "Default config object lacks output field entirely"
      confidence: 0.65
      files_to_inspect:
        - src/config/defaults.ts
      commands_to_run:
        - cat src/config/defaults.ts
      expected_observations:
        - "output field missing from default config"
      stop_criteria: "Confirm defaults are incomplete"
  recommended_next_action: "Test hypothesis 1 with focused grep; if confirmed, implement null-guard fix and regression test"
  stop_criteria: "CLI runs without crash with default config; new test passes"
```

## Dispatch Rules

- **Autonomy:** RoutePackets with `user_decision_needed: false` can be routed autonomously by `kantoku--workflow-director` or the current state owner.
- **Blocking:** If `blocking: yes`, the workflow is held at the current state until the route is resolved and the suggested owner confirms the handoff.
- **Depth:** RoutePackets must surface to `kantoku` or depth-1 owners; depth-2+ agents must not attempt to route around their parent.
