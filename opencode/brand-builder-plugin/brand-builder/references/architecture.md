# Brand Builder Architecture

## Namespace Rules

- Brand Builder replaces "Profile Orchestrator" as the product identity in all planning and implementation artifacts per D-01.
- All Brand Builder-specific internals live under `.opencode/brand-builder/` per D-02, D-05, and D-06.
- User-discoverable entrypoints reside in standard top-level `.opencode/agents/`, `.opencode/command/`, `.opencode/hooks/`, and `.opencode/skills/`.
- Future phases default to local-first Brand Builder ownership per D-16.

## Entry Surface

- The primary orchestrator agent (`kitsune`) is the main user-facing entry point per D-07 and D-08.
- There is no generic public entry command (`/bb` or `/kitsune`). The experience starts from the primary agent.
- Workflow helper commands use yōkai naming (e.g. `kurabokko`, `akashi`) per D-09 and D-10.
- Kitsune-domain commands are orchestrator-scoped per D-12 — invoked from within the orchestrator experience, not from unrelated primary agents.

## Directory Responsibilities

| Path | Responsibility |
|------|----------------|
| `.opencode/agents/kitsune.md` | Primary orchestrator agent definition (Kitsune, the nine-tailed fox) |
| `.opencode/agents/<yokai>.md` | Specialist and worker subagent definitions (mode: subagent) |
| `.opencode/command/<yokai>.md` | Workflow helper commands (agent: kitsune) |
| `.opencode/brand-builder/workflows/` | Brand Builder-owned workflow definitions |
| `.opencode/brand-builder/references/` | Brand Builder reference contracts and patterns |
| `.opencode/brand-builder/templates/` | Reusable output templates for specialists and workers |

## Reference-Only Framework Boundary

- `.opencode/get-shit-done/` is reference-only design inspiration per D-03 and D-04.
- Brand Builder must not be integrated into `get-shit-done` paths per D-13 and D-14.
- Existing `get-shit-done` / OpenCode artifacts are implementation patterns to learn from, not the target namespace for Brand Builder features.

## Reset And Adaptation Rules

- Old Phase 1 structure under the `get-shit-done` boundary is invalid per D-14.
- Already created Phase 1 work may be adapted when useful, but only after moving it to the corrected Brand Builder architecture and naming per D-15.
- Reuse is allowed; carrying forward the old structural boundary is not.
