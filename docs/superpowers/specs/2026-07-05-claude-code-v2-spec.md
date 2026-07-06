# Furaidē claude-code harness v2 (spec)

> Master spec for the 2026-07 harness redesign. Three parts: **I. Īdisu v2** (universal learning platform, renamed from Satori — see Item 4 nomenclature decision), **II. Statusline v2** (persistent, transcript-aware), **III. Docs refresh**. Supersedes the v1 spec (`2026-05-26-satori-v1-spec.md`, deleted) and absorbs the interim statusline spec. Implementation plan: `docs/superpowers/plans/2026-05-27-satori-v1.md` (to be renamed to `2026-05-27-idisu-v1.md` and rewritten alongside this spec).

---

# Part I — Īdisu v2: Universal Learning Platform

> Redesigned 2026-07-05 from researched patterns (decisions D1–D8 in the session design ledger).

## Context

Īdisu v1 was specced as skill-usage observability (Python CLI, SQLite, LLM-as-judge). The implementation drifted into a deterministic Bun/TS "dream loop" with half the pipeline dead (backlog/findings writers never called, 5 of 8 event types never emitted, LLM scaffolding unimported) while the legacy Python `mekiki` package implements the old spec but is disconnected from the plugin runtime.

v2 rethinks Īdisu as a **universal learning platform**: the agent setup learns and evolves from its own usage — skills, workflows, memories, sessions — across Claude Code, Codex, and OpenCode. Observability remains the foundation, but it now feeds a closed learning loop.

Design is built from proven patterns, not from the legacy code:

| Pattern | Source | Used in |
|---|---|---|
| Background mining of native session stores | OpenAI Codex Memories | Ingest |
| "Prompt, not pipeline" learning; skills-as-commands; `pending/` + write-approval | Hermes Agent (`/learn`, 2026-06) | Learn / Stage / Approve |
| Sub-routine workflow induction from labeled trajectories, variable abstraction, overlap hygiene (0.08–0.20) | AWM (arXiv 2409.07429) | Mine |
| Utility ledger: +1 win / −1 loss / deprecate at 0 | ExpeL (arXiv 2308.10144) | Track |
| ADD/UPDATE/DELETE/NOOP adjudication kernel | Mem0 (arXiv 2504.19413) | Judge (v0.3 memory mining) |
| Bi-temporal invalidate-never-delete edges | Zep/Graphiti (arXiv 2501.13956) | Curate / KG-lite schema |
| Curation is existential: accumulation without pruning degrades below zero-shot | Insight governance (arXiv 2606.17591) | Curate (mandatory) |
| Metric-driven description mutation | GEPA (arXiv 2507.19457) | v0.4 instruction edits |
| Paired with/without A/B lift | SWE-Skills-Bench (arXiv 2603.15401) | Future |

### Principles

1. **Transcripts are the source of truth; mining is background.** Hooks shrink to what transcripts cannot provide. Everything else is derived offline, incrementally, replayably.
2. **Īdisu never authors artifacts — it assembles evidence and prompts.** Authoring is done by the live agent via `skill-creator`/`writing-skills` handoff. Īdisu ships no authoring engine.
3. **Curation is mandatory, not a dashboard feature.** Every artifact carries an evidence ledger from birth; unpruned accumulation is net-negative.

## Architecture

### Pipeline state machine (one dream pass walks left → right)

```
 hot path (sync, <10ms)                offline (dream pass, incremental)
┌──────────┐   ┌────────┐   ┌─────────┐   ┌───────┐   ┌──────┐   ┌───────┐
│ 0 CAPTURE│──▶│1 INGEST│──▶│2 MEASURE│──▶│3 JUDGE│──▶│4 MINE│──▶│5 STAGE│
│ slim     │   │adapters│   │determin.│   │outcome│   │candi-│   │pending/│
│ hooks →  │   │tail +  │   │metrics, │   │labels,│   │dates │   │+ evi-  │
│ spool    │   │dedupe  │   │no LLM   │   │2-tier │   │      │   │dence   │
└──────────┘   └────────┘   └─────────┘   └───────┘   └──────┘   └───┬────┘
                                                                     │ approval gate
                   ┌──────────────────────────────────────┐          ▼
                   │ 8 CURATE ◀── 7 TRACK ◀── 6 PROMOTE ◀─┴─ [APPROVE / REJECT]
                   │ stale/invalidate/  evidence   native surfaces
                   │ archive (never     ledger     + registry
                   │ delete)            per item
                   └──────┬───────────────────────────────┘
                          └────────▶ feeds next pass's MEASURE
```

### Artifact lifecycle

```
signal ─▶ candidate ─▶ staged ─┬─▶ rejected (+reason; blocks re-proposal)
                               └─▶ active ─┬─▶ reinforced (ledger grows)
                                           ├─▶ stale (no hits in N sessions)
                                           ├─▶ contradicted (invalidated, queryable)
                                           └─▶ deprecated ─▶ archived (never deleted)
```

Every lifecycle transition is itself an event in the store — Īdisu observes its own learning with the same machinery it uses to observe the harnesses.

## Storage substrate

Single Bun/TypeScript engine (`cli/src/idisu/`, `bun:sqlite`). The Python `mekiki` package is removed entirely (see Migration).

- **Hot path**: hooks append to a JSONL **spool** (`$IDISU_HOME/spool/YYYY-MM-DD.jsonl`, flock'd append, one line per event). No DB access on the hot path.
- **Structured state**: one **`~/.idisu/idisu.db`** (SQLite, WAL). Ingest drains the spool into it each dream pass. Tables:
  - `events` — typed envelope (`event_id = sha256(source_id:source_position)`, harness, event_type, ts, payload JSON). Retains the v1 envelope/dedup design.
  - `sessions` — per-session metadata + outcome label + rollup stats.
  - `artifacts` — the registry: every learned/tracked artifact (id, type: skill|memory|instruction_edit, origin: mined|learned|preexisting, surface path, lifecycle state, created/promoted/deprecated timestamps).
  - `evidence_ledger` — per-artifact ExpeL counters (applied/win/loss, score, last_earned_at) + evidence pointers (session/turn refs).
  - `outcome_labels` — session- and workflow-granular labels (`success|failure|abandoned|unknown`, tier: deterministic|llm, evidence pointer, judge model).
  - `workflow_ngrams` — mined tool-sequence n-grams with frequency, outcome split, last_seen.
  - `nodes` / `edges(src, dst, type, valid_at, invalid_at)` — **KG-lite**: typed relations (artifact↔evidence↔session↔capability, fact contradiction chains) traversed with recursive CTEs. Graphiti's bi-temporal semantics without a graph engine.
  - `checkpoints` — per-source tail cursors (inode, size, prefix_hash, offset).
  - `metric_rollups` — per-capability per-window computed metrics.
  - **FTS5** virtual tables over sessions/artifacts/evidence text (compiled into Bun's Linux SQLite; macOS needs `Database.setCustomSQLite()`).
- **Vector-ready, not vector-dependent**: v0.3 adds `sqlite-vec` (vec0 table keyed by artifact id) + fastembed-js (384d, lazy model download) for paraphrase dedup and gap matching. No schema migration required. Graphiti/Kuzu/sqlite-vss/libSQL/DuckDB were evaluated and rejected (server weight, archived, superseded, wrong driver/engine).
- **Human-facing artifacts are markdown**: staged candidates + evidence packs in `~/.idisu/pending/`, promoted skills in native surfaces, reports in `~/.idisu/reports/`.

### `~/.idisu/` layout

```
~/.idisu/
├── idisu.db                 # all structured state (WAL)
├── spool/YYYY-MM-DD.jsonl    # hot-path hook events, drained by ingest
├── pending/<artifact-id>/    # staged candidates: draft.md + evidence.md
├── archive/                  # deprecated artifacts + rejected candidates (never deleted)
├── reports/                  # read-only HTML reports
├── config.json               # user config
└── cli-path                  # bootstrap pointer to the idisu CLI
```

## Stage designs

### 0 — Capture (slim hooks)

Hooks keep only what transcripts cannot provide:

| Hook | Purpose |
|---|---|
| `SessionStart` | live-session marker (session_id, cwd, model, transcript_path) |
| `Stop` / `StopFailure` | trigger `idisu dream --scheduled` in background (respects `dream_interval_hours`) |
| `PostToolUse:Skill` | statusline sidecar update only (live UX) |

All other v1 capture hooks (skill_pre, skill_post_failure, user_prompt_expansion) are removed — their signals are derived from transcripts at ingest (skill invocations from `tool_use` blocks, user-typed vs model-chosen from transcript shape, failures from tool_result).

### 1 — Ingest (adapters)

Contract unchanged: `scan(checkpoints): AsyncGenerator<EventEnvelope>`, checkpointed, idempotent, dedup by `event_id`.

**Claude Code adapter goes deep (v0.2).** Reads the full transcript record set from `~/.claude/projects/<slug>/*.jsonl`:
- `assistant` records: tool_use chains (all tools, not just Skill), `attributionSkill` (native skill-usage attribution — no judge needed), token/cache usage.
- `user` records: tool_results (exit codes), correction-shaped reactions (regex proxies: "no,", "don't", "undo", re-instruction).
- `system` records: `turn_duration` (durationMs, messageCount), `compact_boundary`.
- `pr-link` records: session → merged PR (outcome ground truth).
- Task records (`~/.claude/tasks/<sessionId>/*.json`): completed vs abandoned, dependency graphs. Jobs (`~/.claude/jobs/`): subagent fan-out and token cost.

**Codex/OpenCode adapters stay shallow in v0.2** (skill/agent/command invocations, as today). v0.4 deepens them (Codex: `function_call` chains, `thread_spawn_edges`, `thread_goals` budget outcomes; OpenCode: typed `part` rows, per-session cost/diff churn, todo lifecycle).

### 2 — Measure (deterministic, always runs)

v0.2 metric set (no LLM anywhere):

1. Capability usage: invocation counts, user-typed vs model-triggered, session spread.
2. Skill usage attribution via `attributionSkill` (used-downstream for free).
3. Retry/rework rate: same file edited >2× per goal, failed command re-runs, test-fix-test churn.
4. Workflow repetition: recurring tool-sequence n-grams across sessions (mining trigger).
5. Token/duration trends per task shape (`turn_duration` + usage fields).
6. Staleness clocks: per artifact, sessions since last hit.
7. Delegation efficiency: subagent cold-start tokens vs work tokens (jobs data).
8. Relevance score per artifact: recency-decay × access-frequency × match (Supermemory formula).

### 3 — Judge (v0.2: outcome labeling only)

- **Tier 1 — deterministic harvest (free, always)**: `pr-link` merges, build/test exit codes in tool_results, task records reaching `completed` vs abandoned, clean stop vs mid-task truncation. Labels: `success | failure | abandoned | unknown` at session AND workflow-segment granularity, each with an evidence pointer.
- **Tier 2 — LLM residue (budgeted)**: AWM-style binary judgment for `unknown` segments only, highest-value first (longest/most-repeated workflows). Backend behind an interface; v0.2 backend: **`claude -p` headless with the cheapest capable model (Haiku-tier)**. Direct-API backend can drop in later. Budget: `llm_budget_per_dream`; judge fully skippable — pipeline degrades gracefully to tier-1 labels.
- Both success AND failure labels are first-class: mining learns winning workflows from successes and anti-patterns/pitfall material from failures.

### 4 — Mine (candidates, never auto-authored)

v0.2 mines **one artifact type: skill candidates** from workflow repetition:
- Trigger: an n-gram/sub-sequence recurring ≥N times (default 3) across ≥2 sessions with ≥1 success label.
- Candidate = evidence pack: the recurring sequence, outcome split (wins/failures), example session pointers, frequency stats, closest existing skills (FTS5/BM25 overlap check to suppress near-duplicates — AWM overlap hygiene).
- Naming, variable abstraction (AWM-style `{placeholder}` generalization), and SKILL.md drafting happen at authoring time via handoff — not in the background.
- Rejected-candidate memory: a rejected signature is recorded and blocks re-proposal.

v0.3 adds memory candidates (Mem0 extract→adjudicate kernel → project `memory/` dirs). v0.4 adds instruction-edit candidates (GEPA-style description mutation driven by trigger precision/recall).

### 5–6 — Stage, Approve, Promote

- Candidates land in `~/.idisu/pending/<id>/` as `draft.md` + `evidence.md`.
- **Approval gate — nothing auto-promotes in v0.2.**
- Primary UX: conversational **`/idisu review`** — the live agent presents the queue, the user approves/edits/rejects in conversation; the agent authors the final SKILL.md via `skill-creator` conventions on approval.
- Underneath: CLI verbs `idisu promote <id> --to <surface>` / `idisu reject <id> --reason "…"` (scriptable, headless-safe). The conversational flow drives these same verbs.
- Promotion writes to **native surfaces** (skills → `~/.agents/skills/<name>/SKILL.md`, agentskills.io-compatible; Claude Code sees them via existing symlinks) and records the artifact in the registry. Īdisu is **not** a runtime injection layer — harness-native loading does that job.

### 7 — Track

- Every promoted artifact (and preexisting skills, imported into the registry at first dream) accrues an **evidence ledger**: `applied` (+ pointer), `win` +1, `loss` −1; `last_earned_at` timestamp.
- Signals: `attributionSkill` (applied), outcome label of the attributed segment (win/loss), correction proxies immediately after skill-attributed work (loss).

### 8 — Curate

- Ledger ≤ 0 → deprecation **proposal** into the review queue (not automatic removal).
- Staleness: no hits in `stale_after_sessions` (default 30) → stale flag, surfaced in review.
- Contradiction (v0.3+, memory artifacts): **invalidate, never delete** — `edges.invalid_at` set, history queryable.
- Redundancy: pairwise BM25/token overlap across the learned store; above-threshold pairs surfaced for merge/retire.
- Deprecated + rejected artifacts move to `archive/` — nothing is ever hard-deleted.

## Explicit path: `/idisu learn`

Hermes prompt-builder pattern, no pipeline: `/idisu learn <source>` (current session | directory | URL | pasted notes) expands to an instruction block — "learn a reusable skill from this; treat every part of the request as load-bearing" — plus authoring standards, and hands off to `skill-creator`/`writing-skills`. The result is registered in `artifacts` with `origin: learned` and enters Track/Curate like any mined artifact. Ships in v0.2.

## Command surface

```
/idisu                      # status: profile summary + pending queue size + last dream
/idisu dream [--force]      # run a pass now
/idisu learn <source>       # explicit learning (prompt-builder → skill-creator handoff)
/idisu review               # conversational approval gate over the pending queue
/idisu profile              # capability metrics + trends
/idisu report [--serve]     # read-only HTML report (overview, per-artifact, queue)
idisu promote <id> / reject <id> / mark <id> win|loss   # CLI verbs (also driven by review)
idisu reset [--projections-only]
```

## Config (`~/.idisu/config.json`, all optional)

`dream_interval_hours` (24) · `harnesses` (["claude_code"]) · `lookback_days` (30) · `llm_budget_per_dream` (50000, now actually consumed by Tier-2 judge) · `judge_backend` ("claude-cli") · `judge_model` ("haiku") · `min_repetition` (3) · `stale_after_sessions` (30) · `evidence_retention_days` (90) · source-path overrides per harness.

## Roadmap

- **v0.2 — the loop exists end-to-end for skills, outcome-aware**: slim hooks + spool; CC deep adapter; deterministic metrics; two-tier outcome labeling (`claude -p`, Haiku-tier); workflow-repetition mining → pending; `/idisu review` gate; promote to `~/.agents/skills/`; ExpeL ledger + staleness/deprecation proposals; `/idisu learn`; FTS5 + KG-lite schema; mekiki removal.
- **v0.3**: judge expansion (correction classification, gap detection, judge-alignment tracking); memory mining (Mem0 kernel) → project `memory/` dirs; `sqlite-vec` + fastembed-js for paraphrase dedup and gap matching.
- **v0.4**: instruction-edit candidates (GEPA loop over skill descriptions / CLAUDE.md); Codex + OpenCode deep adapters (spawn trees, goal budgets, cost/diff churn).
- **Future**: paired A/B lift measurement (SWE-Skills-Bench pattern), journey-graph visualization, cross-harness skill sync, judge few-shot recalibration from human overrides.

## Migration / removal (no past remnants)

- Delete `cli/src/mekiki/`, `cli/pyproject.toml`, `cli/uv.lock`, `cli/tests/` (Python), `plugins/idisu/bin/mekiki`, `plugins/idisu/commands/mekiki.md`.
- CI: drop the `uv sync`/`pytest` job; keep `bun test` + `bun run typecheck`.
- `~/.mekiki/` runtime dir: archived (its 55-invocation event history is optionally re-ingestable from transcripts, which remain the source of truth — no data migration needed).
- Port as TS where useful: judge backend interface shape, outcome-label prompt structure. Nothing kept as Python.
- Dead TS paths removed or wired live: `appendBacklogItem`/`appendFinding` replaced by the pending/registry flow; `llm-contracts.ts`/`gap-detection.ts` retained only where v0.2 judge/mine actually consume them.

## Verification (end-to-end)

1. **Hooks**: fresh session → spool receives `session.start`; Stop triggers scheduled dream; statusline sidecar updates on skill use. No other hook writes.
2. **Ingest**: `idisu dream --force` on fixture transcripts → events/sessions rows; re-run → zero new rows (checkpoint + dedup).
3. **Measure**: metric_rollups populated; `attributionSkill`-derived usage matches a hand-counted fixture.
4. **Judge**: fixture with pr-link + failing tests → tier-1 labels correct; one `unknown` segment + budget → exactly one `claude -p` call, label persisted with judge model recorded; budget 0 → tier 2 skipped cleanly.
5. **Mine**: fixture with a 3×-repeated workflow (2 successes, 1 failure) → one pending candidate with outcome split in evidence; re-run → no duplicate; rejected signature never re-proposed.
6. **Review/Promote**: `/idisu review` on seeded queue → approve → SKILL.md in `~/.agents/skills/`, registry row `active`; reject → `archive/` + rejection memory.
7. **Track/Curate**: session using the promoted skill (attributionSkill) + success label → ledger +1; forced ledger ≤0 → deprecation proposal appears in queue; nothing hard-deleted anywhere.
8. **`/idisu learn`**: from a live session → handoff prompt contains session evidence; resulting skill registered `origin: learned`.
9. **Removal**: repo contains no `mekiki` references (`grep -ri mekiki` clean outside CHANGELOG/history); CI green with Python job removed.

## Out of scope (deliberate)

- Runtime context injection by Īdisu (harness-native loading only).
- Auto-promotion of any artifact type (revisit post-v0.2 with queue signal-to-noise data).
- Vector store in v0.2; graph engines entirely (KG-lite tables suffice at this scale).
- Real-time analytics; the dream pass is the only analysis cadence.
- Cross-platform capture beyond the three existing adapters.

---

# Part II — Statusline v2: persistent, transcript-aware 2-line statusline

Target: `harnesses/claude-code/config/statusline-command.sh` (installed to `~/.claude/statusline-command.sh`). Designed against Claude Code **v2.1.201** (docs updated 2026-07-04). All decisions finalized 2026-07-05.

## Context

The current script has five problems: (1) session clock resets on quit/reopen; (2) a redundant `⚠` warning glyph and uncolored subscription percentages; (3) the token cluster shows wrong numbers — Claude Code v2.1.132 changed `context_window.total_input_tokens` to mean *current context occupancy* (not cumulative) and `total_output_tokens` to mean *most recent response only*, so `↑in/↓out` is wrong on both counts and cache% divides by the wrong denominator; (4) `$` cost is display-only with no subagent awareness; (5) useful newer payload fields are unused.

## Verified facts (v2.1.201)

- `session_id` **persists across `--resume`/`--continue`** (documented); the same transcript file is appended.
- Transcript JSONL format is officially **internal and version-unstable** → all transcript parsing must fail open.
- `context_window.current_usage` can be **null** (before first response; after `/compact` until next response). `used_percentage` = (input + cache_creation + cache_read) / window; excludes output.
- Subagent API calls are **not** in the main transcript; but each completed agent leaves a `task-notification` record containing `<usage><subagent_tokens>N</subagent_tokens>` and an `<output-file>` path to the subagent's own JSONL transcript (under `/tmp/claude-1000/...`), which carries full per-message `message.usage`.
- `total_api_duration_ms` = API-wait time only (excludes tool execution and user think time); v2.1.200 auto-retries can inflate it.
- Auto-compact threshold is undocumented; rate-limit windows (`five_hour`, `seven_day`) may each be independently absent.
- Prompt caching is input-side only: `cache_read_input_tokens` (served from cache) and `cache_creation_input_tokens` (paid to write cache). There is no output-side caching.

## Design

### Sidecar state (fixes persistence)

One JSON file per session: `~/.claude/statusline-state/<session_id>.json`

```json
{
  "transcript_offset": 812345,
  "in_total": 5800000, "out_total": 112000,
  "cache_read_total": 5278000, "cache_creation_total": 232000,
  "subagents": { "<task_id>": { "in": 310000, "out": 9800, "done": true } },
  "subagent_fallback_tokens": 0,
  "base_duration_ms": 14520000, "last_duration_ms": 612000,
  "base_api_duration_ms": 5100000, "last_api_ms": 230000
}
```

- Keyed by `session_id` (documented-stable across resumes). State files older than 30 days are pruned on each run.
- **Duration fold**: when a payload duration value is *lower* than the last seen value (process restart), add the last value to the corresponding `base_*`; display `base + current`. Applied to **both** `total_duration_ms` and `total_api_duration_ms`.

### Tail pass (fixes token totals)

Each render, one incremental pass over the transcript from `transcript_offset`:

1. Sum `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` across new `assistant` records → main-thread session totals.
2. Extract `task-notification` records: `<output-file>` path + `<subagent_tokens>`. For each newly completed task, sum its `.output` JSONL usage once (in/out), keyed by task id. If the tmp file is already gone, fall back to adding `subagent_tokens` to `subagent_fallback_tokens` (combined, unsplit).
3. Advance `transcript_offset`.

Counted-once semantics + the byte cursor make all sums resume-safe and reboot-safe (already-counted subagent work survives `/tmp` clearing).

**Fail-open rule**: any parse anomaly, missing file, or jq failure → render payload-only values (↑ = current context, ↓ = last response; cache/⑂ hidden). The statusline never errors and never blocks on state.

### Display

Line 1:

```
🧠 Fable 5 │ high │ 🕐 9h03m (📡38%)   ↑5.8M⚡91%/↓112k⚡4% [⑂58%/6%] │ CTX: [██████▓░░░] 132k/200k/+2.4k
```

| Element | Definition |
|---|---|
| `🕐 9h03m` | `base_duration_ms + total_duration_ms` (survives quit/reopen) |
| `(📡38%)` | api-wait share = folded api_ms / folded duration_ms (glyph per mode: emoji 📡 / nerd fallback / text "api") |
| `↑5.8M` | Σ main-thread input tokens (session, cumulative, resume-inclusive) |
| `⚡91%` (on ↑) | session cache-read share = Σcache_read / Σinput |
| `↓112k` | Σ main-thread output tokens |
| `⚡4%` (on ↓) | session cache-write share = Σcache_creation / Σinput (input-side cost, displayed on the write side by design) |
| `[⑂58%/6%]` | subagent share of **total** input / **total** output tokens; denominators = main + subagent sums |
| `CTX [bar]` | bar from `used_percentage` |
| `132k/200k` | `current_usage` sum (input+cache_read+cache_creation; null-guard → `total_input_tokens`) / `context_window_size` |
| `+2.4k` | last-turn output = `current_usage.output_tokens` (null-guarded, hidden when null) |

Line 2 (unchanged layout, recolored):

```
📁 ~/…/Furaidē (dev) │ +892/-401        5hr: 83% (0h47m) │ 1wk: 71% (2d1h) │ $: 4.83
```

- `$` stays `cost.total_cost_usd` (payload estimate). No burn-pace, no separate subagent cost. (Verify empirically that the estimate includes subagent calls — undocumented, expected yes.)
- No `output_style`, no `⚠` glyph anywhere.

### Color ramps (user-specified, percentage of total)

```
CTX bar, window > 300K:   0–20% green · 20–50% yellow · >50% red
CTX bar, window ≤ 300K:   0–50% green · 50–75% yellow · >75% red
Rate limits (each of 5hr/1wk, independently null-guarded):
                          0–50% green · 50–75% yellow · 75–90% orange · >90% red
```

Orange = 256-color `\033[38;5;208m` with plain-yellow fallback when 256-color is unavailable. The big-window ramp is deliberately stricter: long-context quality degrades well before a 1M window fills.

### Retained from v1

Two-line outer-pinned layout, `_lr` pinning + `_trunc` ANSI-safe truncation, batch width computation, `STATUSLINE_GLYPHS` modes, `_pathshort` (fixed to measure visual width), git branch detection, lines added/removed. `_until` keeps GNU `date -d` (WSL2 target; macOS caveat documented in header).

## Known accounting caveats (documented in script header)

- ↑/↓ are main-thread; subagent burn is the separate ⑂ block. Haiku background calls (titles etc.) are not counted anywhere.
- v2.1.200 auto-retried 429s may write multiple usage entries per logical turn (slight overcount).
- Transcript format is internal → the tail parser is version-fragile by design and fails open to payload-only display.

## Verification

1. `bash -n`; shellcheck clean.
2. Mock payloads: fresh session (null `current_usage`, absent `rate_limits`) · mid-session · one rate window absent · narrow `COLUMNS` (80) · 1M window (ramp switch).
3. Fixture transcript + fake subagent `.output`: sums match hand-computed totals; second run adds nothing (offset cursor); deleting the `.output` file exercises the `subagent_tokens` fallback.
4. Resume simulation: feed payload with lower `total_duration_ms` than sidecar's last → clock shows base+current, api% consistent.
5. Corrupt sidecar / unreadable transcript → payload-only render, exit 0.
6. Live session visual check across all ramp bands.

---

# Part III — Docs refresh

Scope (full refresh, not incremental):

1. **`config/` folder** (install-target bundle): refresh `config/README.md` (per-file notes incl. statusline v2 behavior + `~/.claude/statusline-state/` sidecar dir) and `config/CLAUDE.md` (Īdisu v2 command surface, identity blurb, no mekiki, Version control section shortened per item 3). Verify `config/settings.json` keys still match current Claude Code schema.
2. **`harnesses/claude-code/CLAUDE.md`**: regenerate via `/init`, then hand-merge — v2 architecture, no mekiki/Python/uv commands, corrected installer paths, updated CI notes.
3. **`harnesses/claude-code/README.md`**: full rewrite — v2 architecture, corrected install paths, updated command surfaces, data-dir layout (idisu.db/spool/pending), configuration table, plus a **Timeline** section (renamed from "Future Work" — shipped-vs-upcoming per offering: Īdisu, Rejion, config bundle, github skill / hanko--git-seal, statusline), grounded in the implemented-vs-planned inventory from code + `docs/superpowers/plans/` + `docs/superpowers/archive/plans/`.
4. **git/GitHub tooling** (`skills/github/SKILL.md`, `skills/github/GITHUB.md`, `harnesses/claude-code/config/agents/hanko--git-seal.md`): full redesign, decisions below.
5. **Nomenclature pass** (deferred to its own discussion item — see item 4 of this session's plan): once finalized, path/name changes ripple back through all of the above.

Known current-docs defects to fix: bootstrap path contradiction (`scripts/bootstrap.sh` in CLAUDE.md vs `packages/cli/src/targets/claude-code/install.sh` in README — no `scripts/` dir exists in the harness); dream loop described as writing `backlog.json`/`findings.json` (writers are dead code); mekiki presented as active.

## Item 1 — mekiki: doc-mention cleanup (finalized)

Mekiki's actual deletion is a Part I execution step (D6 already covers the full file/dir list: `cli/src/mekiki/`, `pyproject.toml`/`uv.lock`, `plugins/idisu/bin/mekiki`, `plugins/idisu/commands/mekiki.md`, CI pytest job — confirmed complete, no gaps). Part III's job is the acceptance criterion only: after Part I executes, zero mekiki references anywhere in `harnesses/claude-code/` (code, docs, commands). No transitional/legacy language needed in refreshed docs — by the time they're written, mekiki is gone.

## Item 2 — git/GitHub tooling redesign (finalized)

**Problem**: `hanko--git-seal.md` (101 lines), `skills/github/SKILL.md`, and `skills/github/GITHUB.md` triplicate the same approval-protocol/commit-format/constraints content, and the approval model assumed a subagent could interactively ask the user — it can't.

**D9 — `AskUserQuestion` is unavailable to subagents (verified via Claude Code docs + GitHub issues #12890/#18721).** Tools like `AskUserQuestion`/`EnterPlanMode`/`ExitPlanMode` depend on main-session UI state and are never passed to subagent execution, regardless of `tools:` frontmatter. **Two-hop approval model, locked**: `hanko--git-seal` performs read-only + commit work autonomously, then for any operation needing approval returns a structured `NEEDS APPROVAL: <exact command> — <details>` message to the parent instead of executing; the **parent** (main orchestrator) calls `AskUserQuestion` with those details, and only then re-dispatches hanko--git-seal to execute. This replaces the old model where the subagent asked directly (it never actually could).

**D10 — Approval scope narrowed: commit no longer requires approval.** Commits are local/reversible and not yet shared state — `hanko--git-seal` commits autonomously (still runs `git status`/`git diff --stat` first, still validates Conventional Commits format, still verifies the SSH signature after). **Requires two-hop approval**: any `git push` to origin (any branch — this is what makes work visible/shared), `gh pr create`, `gh pr merge`, worktree merge-backs (item below). **Always forbidden, never merely "ask"**: push to master, `--force`, `--no-verify`, `git add -A`/`git add .`.

**D11 — `Assisted-by:` replaces `Co-Authored-By:` everywhere in this repo's git tooling.** Research found `Co-Authored-By` legally implies copyright standing an LLM can't hold; `Assisted-by:` is the emerging correct convention (keeps the human as author/committer). Format: `Assisted-by: <agent/model identity> <noreply@...>`. Applies to: `skills/github/SKILL.md` conventions section + all 6 recipes, `hanko--git-seal.md`, and `harnesses/claude-code/config/CLAUDE.md`'s Version control section (currently mandates `Co-Authored-By`). Out of scope: the user's *global* `~/.claude/CLAUDE.md` (outside this repo).

**D12 — Commit and PR body templates (finalized, both conditional-section, not fixed-checklist):**

Commit body:
```
type(scope): description

Why: <1-3 sentences — the problem/prior behavior this fixes, or the
requirement driving it. Not what the diff shows — why it was needed.>

<optional bullets, only if multiple distinct changes/reasons>

Refs: #123                              (only if an issue/PR exists)
Assisted-by: <agent/model identity> <noreply@...>
```

PR body (Summary generated via `git merge-base <target> HEAD` → `git log <base>..HEAD --format=%s --no-merges`, grouped by Conventional Commit type — not hand-narrated from memory):
```markdown
## Summary
1-3 bullets: what changed, at a glance.

## Why / Context
(Omit if the title/summary already makes it obvious.)

## Approach
Key design decisions and rejected alternatives. (Omit if no real fork in approach.)

## Testing
Commands run / cases covered.

## Breaking changes
(Omit if none — don't write "None" as boilerplate.)

## Review focus
(Omit unless something is genuinely risky/uncertain.)

Closes #123                             (only if applicable)
```

Rationale: "why not what" (diff already shows what); sections are conditional to avoid template-boilerplate noise on trivial PRs; grep-able structure for future-agent traceback (this is the load-bearing reason — a future dream-pass or agent session reading `git log`/PR history should reconstruct context without re-reading full diffs).

**D13 — New recipe: worktree merge-back (gap, zero prior coverage confirmed by Explore).** Covers Claude Code's `isolation: "worktree"` subagent feature (not currently used by any agent in this repo, but needs a recipe before it is). Two paths: (a) from inside the worktree — push branch, open/merge PR via existing feature-branch recipes; (b) from the main repo — `git checkout <target>`, `git merge <worktree-branch>` (or rebase), resolve conflicts. Cleanup: `git worktree remove <path>` + `git branch -d <branch>` post-merge. Conflict guidance generalized beyond the existing back-merge-PR recipe (which side to prefer, merge-commit-vs-rebase per dev/master rules) — also fixes the gap that today only the automated back-merge PR has conflict guidance; a plain `git push` rejected by remote divergence, or a manual `git merge`/`git rebase` conflict on a feature branch, had none.

**File-level redesign (content drafted and approved in-session; final files written when Part III executes):**

- **`hanko--git-seal.md`**: 101 → ~42 lines. Keeps: frontmatter, a short role/persona block with **no F.R.I.D.A.Y./Furaidē branding** (agent ships standalone/portable), dispatch instruction (invoke `Skill(github)` first, read `GITHUB.md` only when needed), a compressed safety-net reminder (not the source of truth), and the `<output_contract>` report-format templates (genuinely unique, not duplicated elsewhere). Removed: full approval-protocol restatement, commit-format regex, constraints list — all now live once, canonically, in `SKILL.md`.
- **`SKILL.md`**: stays the canonical source for conventions, approval rule (updated per D10), and the 6 recipes (commit/PR bodies updated per D12, worktree recipe added per D13). One factual fix: the `feat(mekiki/judge)` scope example → `feat(idisu/judge)`.
- **`GITHUB.md`**: trim duplicated sections (commit-message-format restatement, Claude-Code-agent constraints restatement, "Security Rules" restatement, local-dev-workflow/quick-reference restatement) down to pointers at `SKILL.md`. **Security setup (SSH signing, fine-grained PAT) moves out of `GITHUB.md` into its own bundled file** (`skills/github/SECURITY.md` — new, progressive-disclosure: read only when doing signing/PAT setup, not on every workflow lookup). `GITHUB.md` keeps: branch strategy + back-merge automation mechanics, OpenCode `@hanko` delegation section, workflow-state.mjs disambiguation note, lefthook checks table, CI gates (needs a sync pass once Part I drops the mekiki pytest job), troubleshooting (all 5 scenarios plus the new worktree/divergence cases from D13), reference footer.
- Rationale against merging `GITHUB.md`/`SECURITY.md` into `SKILL.md` entirely: `SKILL.md`'s body loads into context on every `Skill(github)` invocation; bundled files load only on-demand via `Read`. Keeping rare/deep material (security setup, troubleshooting) out of `SKILL.md` is the correct progressive-disclosure pattern, and `GITHUB.md` also serves OpenCode's `@hanko` agent, which never touches Claude Code's `Skill` mechanism at all.

**D14 — `SECURITY.md` scope (ground-truth-verified via Explore, repo root config read directly).** Actual configured security surface, none of it accurately documented in `skills/github/` today:

- **Lefthook** — pre-commit (parallel): `gitleaks protect --staged --redact` (allowlist: test fixtures, `docs/examples/`, `graphify-out/`, `harnesses/opencode/future-work/`), `validate-json`, `validate-yaml`, `pytest` (glob `harnesses/claude-code/**`). commit-msg: `conventional` (Conventional Commits regex). **pre-push (sequential, ~8min)**: `shellcheck --rcfile .shellcheckrc`, `semgrep-diff` (`r/bash`+`r/typescript`, `--baseline-commit origin/dev`), `trivy-quick` (`trivy fs --scanners vuln --severity CRITICAL .`) — **none of the three pre-push checks are documented anywhere in `skills/github/` today** (only the pre-commit ones are, in `GITHUB.md`'s Lefthook table).
- **CI `security.yml`** (undocumented in `skills/github/` entirely): `trivy-full` (full `trivy.yaml` config: `vuln,secret,misconfig` @ `HIGH,CRITICAL`, on PR-to-master + daily cron), `semgrep-full` (same rulesets, not diff-scoped), `snyk-master-gate` (Snyk `test`, PR-only gate, needs `SNYK_TOKEN`).
- **Trivy quick-vs-full split is real and intentional (fast local gate vs. comprehensive CI job) but was previously undocumented** — `SECURITY.md` states this explicitly as a documented decision, not a silent drop of scanners/severity.
- **GitHub server-side controls** (secret scanning, push protection, master `required_signatures` ruleset) are checked via API by the setup script but never explained as controls in `GITHUB.md` — only local SSH signing/PAT are today.
- **Setup script path was wrong in docs**: real path is `packages/cli/src/shared/github-setup-check.sh` (not `scripts/github-setup-check.sh`). It checks 7 categories (local signing config, GitHub-registered signing key, GitHub repo security API fields, local tool presence, SSH agent, PAT type, API connectivity) — doc only ever covered 2 (signing, PAT).
- **Branch protection is unmanaged as code** (no ruleset JSON in `.github/`, web-UI-only) — documented as a known, accepted limitation, not silently absent.
- **Absent and out of scope for this pass**: CodeQL, SBOM generation, signed tags, `dependency-review-action`. `SECURITY.md` lists these explicitly as "not implemented" (Snyk/Trivy/Semgrep cover overlapping ground) so it reads as a decision, not an oversight — optionally noted as future-work candidates, not implemented now (hardening work is out of scope for a docs-refresh pass).

**`SECURITY.md` final scope**: SSH signing + PAT setup (moved from `GITHUB.md`), full accurate hook inventory (pre-commit/commit-msg/pre-push, exact commands), CI security jobs, the quick-vs-full Trivy split explained, GitHub server-side controls explained as controls, corrected script path + full 7-check walkthrough, and a first-time-setup section (run script → remediate per finding).

**`hanko--git-seal.md` addition**: one line noting pushes can take ~8 min (pre-push hooks run sequentially) — don't retry or bypass with `--no-verify` on that basis. No new tool grants needed; it already never uses `--no-verify`.

## Item 3 — `config/CLAUDE.md` refresh (finalized)

**Identity**: strip the Īdisu paragraph entirely — Identity becomes pure persona (no offering/plugin mentions); Īdisu stays fully described in Active Plugins, which already has it.

**Rules — additions**:
- Two-hop git approval clause (from D9/D10): main agent calls `AskUserQuestion` when `hanko--git-seal` returns a `NEEDS APPROVAL: ...` message, before re-dispatching to execute.
- New **"Ponytail Gate"** mini-section (mirrors Caveman Mode's structure — behavioral-gating content belongs near Rules/Workflow, per placement research below): *"Software-development/research tasks only: invoke `Skill(ponytail)` before writing code — YAGNI/reuse/scope gate. Not for general assistant work."*
- "Right-size the model" rule extended: *"Reserve high intelligence (Opus/Fable) for planning/guidance; default implementation to Haiku or Sonnet 4.6; escalate only for a genuinely hard sub-problem."*

**Subagent Model Selection — two-axis table (finalized), sourced from verified pricing/benchmarks (platform.claude.com, artificialanalysis.ai) and Anthropic's own multi-agent-research post (Opus-orchestrator/Sonnet-subagent/Haiku-formatting architecture):**

Pricing verified: Opus 4.8 `$5/$25`/Mtok (1M ctx); Opus 4.7 same price, legacy; Sonnet 5 `$3/$15` (intro `$2/$10` through 2026-08-31), 1M ctx; Sonnet 4.6 `$3/$15`, 1M ctx, extended thinking supported; Sonnet 4.5 `claude-sonnet-4-5-20250929`, `$3/$15`, 200K ctx, legacy-but-served; Haiku 4.5 `$1/$5`, 200K ctx; Fable 5 `$10/$50`, 1M ctx, GA 2026-06-09.

Sonnet 5 caveat (artificialanalysis.ai cost-per-task metric): ~30-40% more output tokens/task than Sonnet 4.6 → **~$2.29/completed task vs Opus 4.8's ~$1.99** — costs *more* than Opus for reasoning-heavy work despite the lower sticker price. Wins Terminal-Bench 2.1 (80.4% vs Opus 74.6%); loses SWE-bench Pro (63.2% vs 69.2%). Net: Sonnet 5 is not a safe blanket "cheap middle tier" — narrow it to what it actually wins at.

*Planning & guidance* (reserve intelligence here):
| Model | Use for |
|---|---|
| Opus 4.8 | Architecture decisions, plan review, adversarial review, high-stakes synthesis, novel problem framing |
| Fable 5 *(manual `/model` only)* | Escalation beyond Opus — large migrations, multi-day autonomous runs, genuinely stuck problems. Not a default delegation target given cost |

*Implementation / worker* (Haiku + Sonnet 4.6 carry most of the actual work; Sonnet 5 and Opus are narrow/edge-case tiers, not defaults):
| Model | Use for |
|---|---|
| Haiku 4.5 | File scan/parse/extract/format/boilerplate, single-step edits, structured output, **and direct/well-specified simple changes** (clear inputs/outputs, no design choice) |
| Sonnet 4.6 *(default for the rest)* | Moderate-complexity code changes with clear direction — same price as Sonnet 5, without its token-hunger |
| Sonnet 5 | CLI/terminal-heavy agentic execution specifically — narrow use, not a blanket default |
| Opus 4.8 | Edge case only — a genuinely hard sub-problem hit mid-implementation. Escalate, don't default |

`codex:codex-rescue` row dropped (codex unavailable — deferred to item-4 tail discussion, this session).

**Ponytail — shipped as a real external skill, not a native rule** (reversing the earlier draft call): scope is narrow (software dev/research only), so it goes through the same source-registry mechanism as `caveman`. Manifest addition to `packages/manifests/skills-manifest.json`:
```json
"sources": {
  "ponytail": {
    "type": "git",
    "url": "https://github.com/DietrichGebert/ponytail.git",
    "clone_to": "~/.agents/skill-repos/ponytail",
    "skills_dir": "skills",
    "notes": "YAGNI/scope-gating decision ladder — software-development and research tasks only, not general-purpose.",
    "ecosystem": ["claude-code"]
  }
}
```
plus a skill entry (`{"name": "ponytail", "source": "ponytail", ...}`) in the dev/research skill set (not the always-on global set caveman lives in — scope stays narrow per the critical caveat below).

Caveat carried into the doc (Scott Logic review): ponytail's measured benchmark gains are largely a verbosity-suppression effect, not proof of deeper gating value — document it as "worth having for the explicit YAGNI ladder," not as a magic quality multiplier.

**Caveman Mode — ponytail-inspired procedural-gate rewrite** (the actual fix for "not working properly"): replace the soft vibe-trigger with an explicit gate — invoke `Skill(caveman)` *before* drafting for the existing mechanical-task trigger list, then a mandatory self-check *after* drafting each response while active (articles stripped / filler cut / fragments used / code-errors verbatim / materially shorter than normal prose) instead of trusting the skill's own "stays active" claim to hold unaided. Location stays as-is (near Output Discipline) — already correct per placement research.

**Workflow Decision Table — two new rows** (current table is entirely SWE-shaped; these close the non-SWE gap that otherwise falls through to a wasteful "Unknown → match closest"):
| Task type | Skill chain |
|---|---|
| Research / analysis (non-code) | Explore/general-purpose agent(s) for gathering → synthesize directly; no writing-plans/execute phase unless findings require a code change |
| Decision support (compare options, no execution) | Open prose questions → recommend + tradeoff; don't implement until the user chooses |

**Version control section**: already shortened via item 2's redesign (`Assisted-by:`, two-hop approval, trimmed duplication) — no separate work needed here.

## Item 4 — Nomenclature: Marvel-timeline + Japanese lineage (finalized)

**Scope, confirmed**: `harnesses/claude-code/` only — repo-wide renaming (e.g. `harnesses/opencode/`'s 30-shikigami fleet) is explicitly out of scope for this pass.

**Convention**: where a real MCU/Stark-tech concept fits a component's actual function, name it with a Japanese transliteration of that concept — mirroring how "Furaidē" is the transliteration of "Friday" (Tony Stark's F.R.I.D.A.Y.). Where no MCU concept fits well, keep a genuine Japanese word chosen for functional accuracy rather than forcing a Marvel angle (this is why `hanko` — a real word for an official seal/stamp — is untouched: no canon Stark signature/authorization tech was found to map it to).

**MCU research (verified, not guessed)**:
- **E.D.I.T.H.** ("Even Dead, I'm The Hero," *Spider-Man: Far From Home*) — Tony's AI, bequeathed to Peter Parker after Tony's death, carrying forward Stark's knowledge and arsenal.
- **Iron Legion / House Party Protocol** (*Iron Man 3*, not Age of Ultron — corrected) — JARVIS deploys dozens of autonomous Iron Man suits at once, each acting independently for one engagement.
- Checked and rejected as mappings: Veronica (single-purpose Hulkbuster-delivery module, *Age of Ultron*), KAREN (suit-embedded assistant, *Homecoming*) — weaker fits. No canon Stark signature/authorization-gate tech found (unverified, not used).

**Renames, both confirmed by the user as full replacements (accepting the full migration cost, not a lore-only overlay):**

- **Satori → Īdisu** (transliteration of EDITH). Rationale volunteered by the user: EDITH's "carries Tony's knowledge forward after his death" parallels D6 exactly — mekiki dies (fully removed), its lessons live on inside this platform. Note for the record: "Satori" was already a fitting name on its own terms (Zen term for sudden insight/enlightenment) independent of any Marvel tie-in — flagged during the discussion, user chose the full rename anyway.
- **Kuma → Rejion** (transliteration of Iron Legion, katakana レギオン). Rationale: Kuma's actual function — one-shot delegation to multiple independent CLI backends (`opencode-go`, `opencode`, `ollama-cloud`), no persistent server — maps directly to Iron Legion's "deploy many autonomous units for one engagement each." Backend tool names (`opencode-go`, `opencode`, `ollama-cloud`, `pi`) are external and unchanged.
- **hanko--git-seal**: unchanged (no fitting Marvel concept found; already apt on its own terms).
- **mekiki naming collision, flagged not fixed**: the user's own *global* `~/.claude/CLAUDE.md` (outside this repo) already defines a persona named "Mekiki (Skill Overseer)" — coincidentally close in function to Īdisu (skill-invocation observability) and coincidentally same name as the just-deleted Python package. Out of scope to fix here (global config, not this repo) — noted so it doesn't get rediscovered as a mystery later.

**Migration scope (mechanical, applied via find/replace across this spec already — same substitutions apply repo-wide when Part III executes):**
- `Satori`/`satori`/`SATORI` → `Īdisu`/`idisu`/`IDISU` (prose, paths, env vars, commands): `plugins/satori/` → `plugins/idisu/`, `cli/src/satori/` → `cli/src/idisu/`, `~/.satori/` → `~/.idisu/`, `satori.db` → `idisu.db`, `SATORI_HOME` → `IDISU_HOME`, `SATORI_CAPTURE_HOOK_PAYLOADS` → `IDISU_CAPTURE_HOOK_PAYLOADS`, `/satori <verb>` commands → `/idisu <verb>`, `@friday/satori` package name → `@friday/idisu`, `bin/mekiki` shim target unaffected (mekiki itself is deleted per D6, not renamed).
- `Kuma`/`kuma`/`KUMA` → `Rejion`/`rejion`/`REJION`: `plugins/kuma/` → `plugins/rejion/`, `/kuma:*` commands → `/rejion:*`, `kuma-companion.mjs` → `rejion-companion.mjs`, `KUMA_PLUGIN_DATA` → `REJION_PLUGIN_DATA`, `~/.kuma/` → `~/.rejion/`.
- Historical filenames are NOT renamed retroactively where they're citations to files that literally existed under the old name: `docs/superpowers/plans/2026-05-27-satori-v1.md` (still on disk under that name — renaming it to `2026-05-27-idisu-v1.md` is itself a Part III execution step, not a citation to fix now) and `docs/superpowers/archive/plans/2026-06-23-kuma-v1.md` (same — becomes `2026-06-23-rejion-v1.md` when Part III executes, cited under its real current name until then).
- Badges, READMEs, plugin manifests (`plugin.json` name fields), marketplace registration (`.claude-plugin/marketplace.json` source paths and plugin names) all need the same substitution when Part III executes.

## Item 5 — Installer entry-point fix (finalized; scope note: touches shared `packages/cli/`, not exclusive to this harness)

**Root cause, confirmed by reading `packages/cli/src/router.ts` directly (not assumed):** `scripts/install.sh`'s own header comment promises `bash scripts/install.sh` (bare) gives an "interactive target picker." It doesn't exist. The wrapper scripts hardcode the action (`bun run bin/furaide.ts install "$@"`), so a bare invocation reaches `router.ts` as `argv = ["install"]` — `target` is `undefined`, which hits the `!KNOWN_TARGETS.includes(target)` branch, prints the usage string, and **exits 1**. The documented behavior and actual behavior diverge; this is a real bug, not a docs gap.

**Second, related bug**: `KNOWN_TARGETS = ["opencode-fleet", "claude-code", "pi-agent"]` — there is no `"opencode"` alias. `harnesses/opencode/README.md` correctly uses `opencode-fleet` throughout, but the shorter, more natural `opencode` (matching the harness directory name) hits the same usage-error branch.

**Fix, in `packages/cli/src/router.ts`:**
1. When `target` is missing, prompt interactively via `@clack/prompts`' `select()` — list the 3 known targets with the one-line descriptions already written in `printUsage()`, read the choice, then dispatch normally. `@clack/prompts` is already a declared dependency (used today by `opencode-fleet/wizard.ts`) and already installed by the existing `bun install` step in `scripts/install.sh` — **zero new dependency fetch, no binary download introduced**. Fall back to the current usage+exit(1) only when stdin isn't a TTY (piped/CI context) — never hang non-interactively.
2. Add a target-alias map (`{ opencode: "opencode-fleet" }`) resolved before the `KNOWN_TARGETS` check, so `bash scripts/install.sh opencode ...` resolves correctly.
3. No change to the "shell-target dispatch is a thin passthrough" behavior (`claude-code`/`pi-agent` still just `spawnSync bash <target script>`, unchanged) — the fix is scoped to target resolution only, not the dispatch mechanism.

**Docs**: flip `harnesses/claude-code/README.md`'s Install section to lead with `bash scripts/install.sh` (bare, interactive) / `bash scripts/install.sh claude-code --yes` as the primary documented command — matching the convention `harnesses/opencode/README.md` already uses — with direct target-script invocation (`bash packages/cli/src/targets/claude-code/install.sh`) demoted to a secondary/advanced note (still valid: for shell-based targets it's functionally identical to going through the router, just skips packages/cli's own `bun install` step).

**Verification addendum**: `bash scripts/install.sh` (bare, TTY) → picker appears, all 3 targets listed, selecting `claude-code` dispatches correctly; `bash scripts/install.sh opencode --yes` → resolves to `opencode-fleet`, no usage-error; `bash scripts/install.sh </dev/null` (non-TTY) → falls back to usage+exit(1), does not hang.

## Item 6 — Plan-writing verbosity as a user choice (finalized)

**Problem, confirmed by reading the actual skill file**: `writing-plans` (sourced from external `superpowers` marketplace, same as `caveman`) hardcodes exactly ONE verbosity: maximal detail — bite-sized 2–5-minute TDD steps, full code blocks in every step, written for a "zero-context engineer." There is no lever for a lighter plan; our own global CLAUDE.md rule ("Plans must be Haiku-executable... no judgment calls left to the executor") currently mandates this tier unconditionally, for every plan, regardless of who executes it or how much context they'll have.

**Research findings (cited, not invented):**
- **GitHub Spec Kit** — precedent for a genuine 2-layer split: `plan.md` (architectural: tech stack, constraints, no line-by-line steps) → `tasks.md` (granular: per-story breakdown, file paths, TDD ordering, `[P]` parallel markers). Detail is fixed per artifact type, not a dial, but the two-altitude *shape* is real prior art.
- **Anthropic's own guidance** (`code.claude.com/docs/en/best-practices`, "Effective context engineering for AI agents"): explicit rule — *"if you can describe the diff in one sentence, skip the plan"* (already mirrored in our own Intent Triage's TRIVIAL heuristic); and the **"right altitude"** concept — instructions need to be specific enough to constrain behavior but flexible enough to leave room for judgment; over-prescriptive detail is its own failure mode (brittle, token-heavy, doesn't survive plan drift), not a strictly-safer default.
- **Kiro** (AWS spec-driven agent) enforces requirements→design→tasks with approval gates but has no user-facing granularity dial — the fine-grained breakdown is prescriptive there too, so no additional precedent beyond Spec Kit's split.
- **Who needs more detail**: no direct study found, but the context-rot/right-altitude findings support a defensible design principle — a fresh-context executor (a dispatched subagent with zero session memory) benefits from full step-level detail; an executor with live session context (the user, or the current agent continuing inline) is better served by a higher-altitude plan that doesn't over-specify what it can already judge.

**Design, cannot fork the upstream skill (same constraint as `caveman` — externally sourced, actively maintained, don't want to own a drifting copy)**: the verbosity choice is implemented as a **wrapping instruction around the `Skill(writing-plans)` invocation**, in our own `config/CLAUDE.md`, not as a modification to the skill file itself — identical pattern to how Item 3's Caveman Mode gate works (we control *when/how* an external skill is invoked, not its internals).

**Concrete mechanism**: before invoking `Skill(writing-plans)`, present an altitude choice (`AskUserQuestion`), defaulting based on the likely executor:

| Tier | Shape | Use when |
|---|---|---|
| **Step-level** (current skill default, unmodified invocation) | Bite-sized 2–5 min TDD steps, full code in every step, zero-context-assumed | Executor is a fresh subagent with no session context (pairs with `subagent-driven-development`); unfamiliar codebase area; high-risk change |
| **Task-level** | Per-component/file breakdown, exact paths + acceptance criteria per task, no forced TDD micro-steps or full-code-per-step | Executor has some session context but plan may survive a context reset; moderate familiarity |
| **Milestone-level** | Phases/checkpoints + key architecture/interface decisions only (mirrors Spec Kit's `plan.md` layer); step detail deferred to execution time | Executor is the current agent continuing inline with full session context; low-risk/familiar work; user wants a reviewable roadmap before committing to full detail |

The chosen tier becomes an explicit instruction prepended to the `Skill(writing-plans)` invocation (e.g., *"Write this plan at task-level altitude: skip literal TDD micro-steps and full-code-per-step; keep exact file paths and acceptance criteria per task"*) — the skill's own header/task-structure/no-placeholders rules stay intact underneath, only the granularity changes.

**Correlation with the existing execution-choice** (already in the skill, at the end: Subagent-Driven vs Inline): Step-level pairs naturally with Subagent-Driven; Milestone/Task-level pairs naturally with Inline. Present them as two independent choices, but let the altitude choice's default track whatever execution mode the user is likely to pick — don't force two redundant prompts when the pairing is obvious from context (e.g., if the user already said "I'll implement this myself right now," skip straight to milestone/task-level without asking).

**`config/CLAUDE.md` change**: the Rules section's "Plans must be Haiku-executable" line becomes conditional, not absolute — reworded to reflect that step-level detail is the *default for subagent-dispatched execution*, not a blanket requirement for every plan.
