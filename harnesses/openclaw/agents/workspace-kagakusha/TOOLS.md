# TOOLS.md - Local Notes

Skills define how tools work. This file is for local conventions and environment specifics.

## What Goes Here

- Path conventions
- Workspace-specific retrieval/index behavior
- Operational rules that subagents must always receive

## Paths

- Workspace: `${OPENCLAW_WORKSPACE_ROOT}/Kagakusha`
- Reports: `${OPENCLAW_WORKSPACE_ROOT}/Kagakusha/reports`
- Research distillations: `${OPENCLAW_WORKSPACE_ROOT}/Kagakusha/RESEARCH_NOTES.md`
- Date-folder reports: `${OPENCLAW_WORKSPACE_ROOT}/Kagakusha/reports/YYYY-MM-DD/*.md`

## Retrieval Contract

- Prior report similarity and reuse: `memory_search` only.
- Indexed sources should include:
  - `MEMORY.md`
  - `memory/**/*.md`
  - `RESEARCH_NOTES.md`
  - `reports/**/*.md`
- `sokkou` context sources (strict):
  1. `RESEARCH_NOTES.md`
  2. `reports/index.json`
  - do not read `reports/**/*.md` for context building
- `kensho` context sources:
  - `RESEARCH_NOTES.md`
  - `reports/index.json`
  - `reports/**/*.md`

## Report Distillation Contract

- Distillation output target: `RESEARCH_NOTES.md`.
- `reports/index.json` card-level distillation fields:
  - `distilled.status`: `true | false`
  - `distilled.distilledAt`: ISO timestamp or `null`

## Report Index Contract (v2)

- File: `reports/index.json`
- Root shape:
  - `schemaVersion: "2.0"`
  - `generatedAt`
  - `cards` object keyed by canonical card key/slug
- Topic-card fields:
  - `topic`, `reportDate`, `summary`, `latestConfidence`, `tags`, `coverage`, `variants`, `distilled`
- Date policy:
  - Keep only one date field at card level: `reportDate`.
  - Do not write `createdAt`/`updatedAt` in cards.
- Variant grouping:
  - `variants.sokkou[]` and `variants.kensho[]` under same topic card.
  - card key is canonical slug from normalized topic (remove `(Deep Dive)` before slugging).

## Skills in Use

Invocable:
- `sokkou`
- `kensho`
- `mokuroku`
- `seiri`

Internal:
- `kensaku-kaizen`
- `hokoku-sakusei`

## Budget Rules

- `sokkou`: max 2 `web_search`, request up to 10 results per search.
- `kensho`: max 1 `web_search` per subagent, max 4 global.
- active workflow progress updates: max 30-second gap.

## Helper Skill Notes

- `kensaku-kaizen`:
  - no `time_scope` input
  - no `dropped_candidates` output
  - deterministic mode-level generation for `sokkou` vs `kensho`
  - helper spawn settings: `runTimeoutSeconds=120`, `cleanup=delete`
- `kensho` post-run cleanup:
  - delete `reports/_scratch/*`
  - delete `reports/_scratch` directory (warn-only on failure)
- `kensho` deep subagent spawn settings:
  - `runTimeoutSeconds=300`
  - `cleanup=delete`
- model lifecycle:
  - switch to workflow-specific model at start
  - reset to agent default at end via `session_status(model="default")`

## Mokuroku Rendering Profiles

- `discord`: compact bullets, no markdown tables, chunked output when needed.
- `webchat`: richer markdown allowed, optional table-like formatting.
- fallback: plain structured bullets.
- keep deterministic ordering and labels across profiles.

## Subagent Context Pack

Inject these fields into every `sessions_spawn.task` payload:

- `role`
- `objective`
- `allocated_query`
- `hard_budget`
- `output_path`
- `output_schema`
- `citation_rules`
- `uncertainty_policy`

Do not assume subagents inherit full persona files.

---

Add any environment-specific operational notes here as the stack evolves.
