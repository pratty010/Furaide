# Specialist Manifest Schema — OpenCode v2

Agent manifest blocks define the state/gate contract for each specialist's workflows. The schema is lightweight and enforcement is delegated to linting and plugins.

## Fields

| Field | Type | Description | Enforced By |
|---|---|---|---|
| `permission.task` | dict | Dispatch allow-list per the Specialist Delegation Model table in the design spec. Auto-generated; never hand-edited. | `lint-dispatch-graph.mjs` (depth, cycles, ask at depth ≥2) + OpenCode runtime |
| `permission.bash` | dict or `allow`/`deny` | Global bash access or scoped patterns (glob). See "Scoped Bash Carve-Outs" below. | `lint-dispatch-graph.mjs` (pattern validation) + OpenCode runtime |
| `permission.edit` | dict or `allow`/`deny` | Global edit access or scoped paths. See "Scoped Edit Carve-Outs" below. | `lint-dispatch-graph.mjs` (path validation) + OpenCode runtime |
| `gate_scripts` | `string[]` | Commands to run at phase boundaries. Must exit 0 and output verdict. | Linting + `workflow-state.mjs` enforcement |
| `max_ralph_iterations` | `number` | Max warn-loop iterations before escalation (default: 3). | `workflow-state.mjs gate` |

## Rule: permission.task is Generated from Specialist Delegation Model

The source of truth for `permission.task` allow-lists is the **Specialist Delegation Model table** in `docs/superpowers/specs/2026-06-30-opencode-harness-redesign-design.md`.

When generating or updating an agent's frontmatter:

1. Find the agent in the Specialist Delegation Model table.
2. Copy its `permission.task allow-list` column into the frontmatter.
3. Start with `"*": deny`, then allow each entry per spec.
4. Never manually add specialist-to-specialist edges; only entries in the spec's table are allowed.

**Example:** For `tsukumogami--code-forgemaster`, spec lists allow-list as `general`:

```yaml
permission:
  task:
    "*": deny
    general: allow
```

## Rule: gate_scripts run before phase transitions

Before each `workflow-state.mjs advance`, the specialist runs each gate script. If any returns `critical`, do NOT call `advance` — the gate-enforcer plugin will also block it. If `warn`, record via `workflow-state.mjs gate` and continue (subject to `max_ralph_iterations`).

## Scoped Bash Carve-Outs

Only named agents in the spec's "Scoped Permission Carve-Outs" table may use scoped bash. All others use `bash: deny` or unscoped settings per their spec row.

Example:

```yaml
permission:
  bash:
    "git *": allow       # hanko--git-seal
    "gh *": allow        # hanko--git-seal
    "*": deny            # Deny everything else
```

## Scoped Edit Carve-Outs

Only named agents in the spec's "Scoped Permission Carve-Outs" table may use scoped edit. All others use `edit: deny` or unscoped settings per their spec row.

Example:

```yaml
permission:
  edit:
    ".opencode/tmp/**": allow      # kyakuhon--spec-planner (tmp artifacts)
    "docs/superpowers/**": allow   # kyakuhon--spec-planner (spec/plan docs)
    "*": deny                      # Deny everything else
```

## Enforcement: lint-dispatch-graph.mjs

The linting script `scripts/lint-dispatch-graph.mjs` verifies:

- No cycles in task dispatch DAG.
- All allowed tasks exist and have matching role type (specialist/subagent/built-in).
- Maximum depth from root is 3 nested Task calls.
- No `question: ask` or ask-resolving permission at depth ≥2.
- No redundant or unreachable entries.
- Bash/edit patterns are valid globs/paths.

Run before committing agent updates:

```bash
bun run scripts/lint-dispatch-graph.mjs
```

## max_ralph_iterations

The default warn-loop cap is 3 iterations. This value matches Workflow #1's verification loop cap and Workflow #2's hypothesis-test loop cap — same vocabulary, one number.

Override only when a workflow explicitly requires a different value. Document the reason.

```yaml
max_ralph_iterations: 3
```
