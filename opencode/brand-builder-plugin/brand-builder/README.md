# Brand Builder v2

A project-local professional profile review and improvement system. Brand Builder is an opencode-native product: one primary orchestrator, specialist agents, deterministic scoring engines, and a persistent SQLite memory layer.

## What is operational (v2)

**Plugin tools (22 `bb_` tools)**
All 22 tools are implemented and wired in `.opencode/plugin/brand-builder.js`:
- Artifact intake: `bb_ingest`, `bb_update`, `bb_compare_promote`, `bb_delete`, `bb_read`, `bb_list`
- Assessment: `bb_assess`, `bb_role_fit`, `bb_parse_jd`
- Surface optimization: `bb_linkedin`, `bb_github_proof`, `bb_ats_scan`, `bb_brand`, `bb_growth`
- Memory: `bb_get_context`, `bb_get_full_context`, `bb_get_snapshots`, `bb_get_staleness`
- Progress: `bb_get_progress`, `bb_compare_snapshots`
- Retrieval: `bb_search`, `bb_embed`
- Utility: `bb_approve`, `bb_run_log`

**Schema (10 tables + embedding_config = 11 total)**
`artifacts`, `artifact_versions`, `evidence_summaries`, `relationships`, `snapshots`, `enrichment_approvals`, `profile_baselines`, `engine_results`, `run_log`, `vec_evidence`, `embedding_config`

**Hooks**
- Approval-before-mutation gate
- Routing guard (blocks engine calls before intake)
- Prerequisite gates per workflow
- Auto-embed on evidence creation
- Run-log audit on every tool call

**Scoring engines (7, deterministic, no LLM)**
- Assessment (4 dimensions: signal, evidence, visibility, narrative)
- Role-fit (6 buckets, weighted composite)
- LinkedIn optimizer
- GitHub proof evaluator
- ATS scanner
- Brand strategy
- Growth planner

**Semantic retrieval**
- Pluggable embedding providers: `transformers` (local), `ollama`, `gemini`
- sqlite-vec KNN search via `bb_search`

**Agents / commands**
All agents rewritten against BB-BRIEF / BB-RESULT contracts. Commands: `kurabokko`, `kudagitsune`, `awase`, `migaki`, `akashi`, `kataribe`, `kodama`, `omokage`.

## How to run

**Tests**
```bash
cd .opencode/brand-builder
bun test
# Expected: 394+ pass, 4 pre-existing fail (tech-debt-cleanup + opencode config checks)
```

**Calibration harness**
```bash
bun run calibration/harness.js
# Runs anchor-weak, anchor-mid, anchor-strong fixtures and reports score-vs-band table
# Add --fixture anchor-strong to run a single fixture
```

**Manual verification in opencode**
1. Open opencode in this repo directory
2. Run `@kitsune` or use `kurabokko` command to ingest a resume
3. Run `kudagitsune` to trigger assessment
4. Run `awase` with a job URL to test the JD acquisition ladder

## Plugin entry point

`.opencode/plugin/brand-builder.js` — single CJS module, loaded by opencode at startup. Defines all 22 tools via `definePlugin()`.

## Agents

All agent files are in `.opencode/agents/`:
- `kitsune.md` — primary orchestrator (Kitsune, the nine-tailed fox)
- `kurabokko.md`, `kudagitsune.md`, `akashi.md`, `migaki.md`, `kataribe.md`, `kodama.md`, `hyakume.md`, `amanojaku.md` — specialists
- Yamabiko (source-retriever) / Azukiarai (extractor) — bounded fetch/extraction/research offload delegated to Fleet agents (runs JD retrieval 3-tier ladder)

## Directory layout

```
.opencode/brand-builder/
  assess/         — assessment.js, role-fit.js
  ats/            — ats-scan.js
  brand/          — strategy.js
  calibration/    — harness.js, fixtures/
  embedding/      — index.js, gemini.js, ollama.js, transformers.js
  github-proof/   — evaluator.js
  growth/         — planner.js
  hooks/          — hook-predicates.js
  intake/         — artifact-store.js, compare-promote.js, index.js
  linkedin/       — optimizer.js
  memory/         — repository.js, retrieval.js, schema.js, types.js
  progress/       — comparison.js
  role-fit/       — history.js, jd-parser.js
  snapshots/      — persist.js
  tests/          — all test files
  tools/          — tool-helpers.js
```
