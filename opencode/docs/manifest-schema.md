# Specialist Manifest Schema

Each specialist agent file carries a manifest block (YAML comment or frontmatter extension) that defines the state/gate contract for that specialist's workflows.

## Fields

| Field | Type | Description |
|---|---|---|
| `playbooks` | `string[]` | Paths to governing playbook files (relative to repo root). Read at workflow init. |
| `gate_scripts` | `string[]` | Gate script commands to run at phase boundaries. Each must exit 0 and emit `{verdict, reasons}`. |
| `permitted_subagents` | `string[]` | **The allow-list** that ALSO becomes `permission.task` in the agent frontmatter. Lists only shared subagent names + T2 leaves. NEVER includes specialist names. |
| `max_ralph_iterations` | `number` | Maximum warn-loop iterations before `warn-unresolved` is forced. Enforced by `workflow-state.mjs gate`. |
| `governing_file` | `string` | Path to the primary governing document (constitution, brief, or playbook) that the specialist reads at start. |

## Rule: permitted_subagents = task allow-list

The `permitted_subagents` array is the single source for `permission.task`. Generate the frontmatter allow-list from it:

```yaml
permission:
  task:
    "*": deny
    source-retriever: allow
    fact-checker: allow
    # ... one line per entry in permitted_subagents
```

Every specialist name and self are implicitly denied by `"*": deny`. Never add a specialist name to `permitted_subagents`.

## Rule: gate_scripts run before phase transitions

Before each `workflow-state.mjs advance`, the specialist runs each gate script. If any returns `critical`, do NOT call `advance` — the gate-enforcer plugin will also block it. If `warn`, record via `workflow-state.mjs gate` and continue (subject to `max_ralph_iterations`).

## Worked example: deep-researcher

```yaml
# Manifest (in agent frontmatter comments or a companion .manifest.yaml)
playbooks:
  - docs/playbooks/research.md
gate_scripts:
  - bun scripts/citation-verify.mjs
permitted_subagents:
  - source-retriever
  - extractor
  - fact-checker
  - data-analyst
  - synthesizer
  - reviewer
  - explorer
max_ralph_iterations: 3
governing_file: docs/playbooks/research.md
```

Generated `permission.task` block:
```yaml
permission:
  task:
    "*": deny
    source-retriever: allow
    extractor: allow
    fact-checker: allow
    data-analyst: allow
    synthesizer: allow
    reviewer: allow
    explorer: allow
```
