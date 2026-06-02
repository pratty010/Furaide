# Satori — Skill usage observability for Claude Code (v1)

## Context

There is currently no way to assess how, when, why, and how well **skills** are invoked across AI agentic platforms. Questions like "is this skill earning its keep?", "which skills fire poorly?", and "which prompts should have triggered a skill but didn't?" cannot be answered today. Satori is a system that captures every skill invocation along with enough surrounding context to answer those questions offline.

Scope of v1 is **Claude Code only**, with two analysis goals:

- **A. Curation** — per-skill invocation counts, abandonment, user correction signals → drive decisions on which skills to keep, rewrite, or change triggers on.
- **B. Gap analysis** — detect user prompts where an installed skill *should* have fired but didn't. Hard problem; handled offline via LLM-as-judge.

D (personal telemetry) and C (cross-platform comparison) are out of scope for v1, but the data schema and adapter shape are designed so C drops in as additional capture adapters writing to the same on-disk format.

The system is designed under three principles:

1. **The transcript is the source of truth; events are pointers.** Hooks never copy conversation content; they emit a tiny event line referencing `transcript_path` + `turn_index`. Offline analysis reads the surrounding messages directly from the transcript when needed.
2. **Hot path is synchronous and fast.** Hooks fire on every tool call and turn close; each does one syscall (append a JSONL line). No parsing, no network, no LLM in the hot path.
3. **Derived knowledge is incremental and checkpointed.** Analyzer runs are idempotent and only consume new tail data. Past work is never redone unless explicitly requested with `--reanalyze`.

## Architecture

Three layers, fully decoupled:

```
                       hot path (sync, <10ms)
~/.claude/projects/...jsonl       hooks → ~/.satori/events/claude-code/YYYY-MM-DD.jsonl
(append-only transcripts,                       │
 source of truth)                               │
                                                ▼
                                  Layer 2: analyzer (incremental)
                                          A. Ingest      ─┐
                                          B. Judge (LLM) ─┼─> ~/.satori/state.db (SQLite)
                                          C. Aggregate   ─┤
                                          D. Improve     ─┘
                                                                │
                                                                ▼
                                                  Layer 3: /satori skill
                                                  (HTML reports via local http.server)
```

### Compaction handling (resolved by investigation)

Empirically verified against existing transcripts: Claude Code's `/compact` does **not** rewrite or delete prior messages on disk. The session JSONL is append-only across compactions; the compact-summary appears as a normal user message mid-file, and the same `sessionId` continues. **No `PreCompact` file-copy is needed.** Compaction is purely an offline-analyzer concern (detect the boundary marker and label messages before it as "no longer in model context").

Residual risk — Claude Code rotating old transcripts — is mitigated by running the analyzer on a periodic schedule (cron/loop) so that recent transcripts are always processed into `state.db` before any retention window could matter. Derived facts in `state.db` survive the loss of the raw transcript.

## Layer 1 — Capture (Claude Code hooks)

Distributed as a **Claude Code plugin** (not bare `~/.claude/settings.json` entries). Plugin manifest patches the required hooks into the user's settings on install.

**Hook scripts: bash** (zero deps, fast cold start ~5ms). Each script does exactly one thing: read the hook JSON payload from stdin, project the needed fields, append one JSONL line to today's event file, exit 0.

### Events captured (6 types, no file copies)

| Hook (matcher) | JSONL fields written |
|---|---|
| `SessionStart` | `session_id, ts, cwd, model, source, transcript_path` |
| `PreToolUse` (`matcher: "Skill"`) | `session_id, ts, event: "skill.invoke", skill, args, tool_use_id, transcript_path, turn_index` |
| `PostToolUse` (`matcher: "Skill"`) | `session_id, ts, event: "skill.loaded", tool_use_id, exit_code, run_time_seconds` |
| `PostToolUseFailure` (`matcher: "Skill"`) | `session_id, ts, event: "skill.load_failed", tool_use_id, exit_code, stderr` |
| `UserPromptExpansion` | `session_id, ts, event: "skill.user_typed", skill, turn_index` (only fires for slash-command typed by user — distinguishes user-typed vs model-chosen) |
| `Stop` and `StopFailure` | `session_id, ts, event: "turn.stop"/"turn.stop_failed", stop_reason, turn_index` |

Output path: `~/.satori/events/claude-code/YYYY-MM-DD.jsonl` (one file per day for cheap pruning + parallel-safe append).

Explicitly **not** captured at hot path (relied on transcript or offline derivation instead):
- `UserPromptSubmit` — duplicates transcript; privacy footgun. Offline analyzer reads prompts from transcript by turn_index.
- `InstructionsLoaded` — available skills list is already in transcript as a `<system-reminder>`. Parsed offline.
- `SessionEnd` — inferable from last Stop event + age.
- `PreCompact`/`PostCompact` — compaction is non-destructive on disk (verified). Boundary detected offline by scanning transcript for compact-summary marker.

## Layer 2 — Analyzer (Python CLI)

Single binary `satori` (Python; richest SDK ecosystem for SQLite + LLM APIs). Sub-commands map 1:1 to phases. Each phase is independently runnable and idempotent.

### Phases

**A. Ingest** — deterministic, no LLM.
- Tail new lines from each `events/claude-code/*.jsonl` since `source_files.last_line_processed`.
- For each referenced `transcript_path`, tail new lines.
- Populate `sessions`, `skill_invocations`, `available_skills_at_session` (parsed from transcript's `<system-reminder>` blocks).
- Update `source_files` checkpoints.

**B. Judge** — LLM-driven, batched, **pluggable judge backend**.
- For each `skill_invocations` row without a corresponding `invocation_judgments` row:
  - Pull a window of N messages around `turn_index` from the transcript.
  - Ask judge: load succeeded? did the model make follow-up tool calls consistent with the skill's guidance? user reaction tone (positive / negative / neutral / none)? quote the reaction. session ended cleanly?
  - Insert `invocation_judgments` row.
- For each new user prompt in transcripts (sampled, not exhaustive — sampling rate configurable) without a `gap_findings` row:
  - Pull available skills list from `available_skills_at_session`.
  - Ask judge: given these available skills, should one have fired for this prompt? If yes, which and why.
  - Insert `gap_findings` row (only when positive — most prompts produce no row).

**Judge backend interface** (pluggable, two adapters shipped in v1):

```python
class JudgeBackend(Protocol):
    def classify_invocation(self, context: InvocationContext) -> Judgment: ...
    def detect_gap(self, prompt: str, available_skills: list[Skill]) -> Gap | None: ...
```

Adapters:
- `anthropic` (default) — Haiku 4.5 for `classify_invocation` (high volume, structured output), Sonnet 4.6 for `detect_gap` (needs reasoning).
- `codex` — shells out to the Codex CLI runtime already present on the machine, mirroring `codex:rescue` invocation patterns.

Backend selected via config (`~/.satori/config.toml`) or CLI flag `--judge anthropic|codex`.

**C. Aggregate** — deterministic.
- Recompute `skill_stats` rollups per skill per window (all, 30d, 7d): invocations, positive/negative/neutral/none rates, load_failure_rate, used_downstream_rate, user-typed vs model-triggered split.

**D. Improve** — long-horizon evidence assembly + handoff. Does **not** rewrite skills directly.

Phase D's job is to surface enough structured evidence over weeks/months that emergent patterns become visible to whichever skill actually performs the rewrite. It does not reimplement skill-authoring logic.

- The analyzer accumulates per-invocation evidence continuously: positive cases (with the user reaction quote and the surrounding turn context), negative cases (correction quotes + what the user said the skill *should* have done), gap-findings where the skill was conspicuously not triggered, and load-failure cases. All retained verbatim with `transcript_path` + `turn_index` pointers so they can be re-fetched in full.
- For each skill with ≥ `MIN_SAMPLE` judged invocations in the configured horizon (default: 30d, min 20 invocations), `satori improve --skill SKILL` produces a **structured evidence pack**: current `SKILL.md`, top N positive exemplars, top N negative exemplars, top N gap-cases, frequency patterns, and any detected meta-pattern (e.g., "fires correctly for X-style prompts; misses Y-style prompts"). Written to `~/.satori/evidence/<skill>-<date>.md` and recorded as a `skill_improvements` row with `evidence_path` and `status='evidence_ready'`.
- **Rewriting is delegated**, not built. The `/satori` skill, when asked to improve a skill, generates the evidence pack and then explicitly hands off to `Skill(skill-creator)` (relevant parts) or `Skill(writing-skills)` with the evidence pack as input. Those skills already encode authoring conventions; Satori should not duplicate them. The handoff flow is documented in `skills/satori/SKILL.md`.
- After the user applies (or rejects) the rewrite, they update the `skill_improvements` row status to `applied` / `rejected` via `satori improve --mark SKILL <applied|rejected>`. This closes the loop and feeds back into future judgments (was the rewrite followed by improved metrics?).

### CLI surface

```
satori ingest                          # phase A
satori judge [--reanalyze SKILL|all]   # phase B
satori aggregate                       # phase C
satori improve [--skill SKILL]         # phase D
satori run                             # A → B → C in sequence
satori report --overview               # phase E (see Layer 3)
satori report --skill SKILL [--deep]   # phase E
satori reset --from PHASE              # wipe checkpoints + re-run from phase
```

`satori run` is what gets scheduled (cron, or Claude Code `/loop` skill) on the user's preferred cadence (daily default).

### State schema (SQLite at `~/.satori/state.db`)

Tables: `source_files` (ingest checkpoints), `sessions`, `skill_invocations`, `invocation_judgments`, `gap_findings`, `available_skills_at_session`, `skill_stats`, `skill_improvements`.

All foreign keys via `session_id` and `invocation_id`. WAL mode enabled for concurrent read during analyzer writes.

## Layer 3 — `/satori` skill (user-facing)

Claude Code skill bundled with the plugin. Invoked as `/satori` from any Claude Code session.

Behavior:
1. Parses the user's request ("show me overview", "deep dive on /brainstorming", "what gaps did you find this week").
2. Shells out to the appropriate `satori report` subcommand.
3. **Primary output: HTML report** generated to `~/.satori/reports/<timestamp>-<topic>.html`, served via `python3 -m http.server` from `~/.satori/reports/`. Skill returns the URL.
4. **Future**: markdown output option for quick in-session checks (`--format markdown`). Stubbed in the report subcommand but not the primary path in v1.

Report contents:
- **Overview**: top skills by invocation count, by positive-reaction rate, by load-failure rate. Gap-analysis summary (top suggested-but-unfired skills). Trend lines over time.
- **Per-skill deep dive**: invocation timeline, reaction distribution, sample positive cases, sample negative cases, recent improvement suggestions, current description vs latest proposed description (diff).

## Plugin repo layout

```
satori/
├── plugin.json                    # Claude Code plugin manifest
├── hooks/
│   ├── on_session_start.sh
│   ├── on_skill_pre.sh
│   ├── on_skill_post.sh
│   ├── on_skill_post_failure.sh
│   ├── on_user_prompt_expansion.sh
│   └── on_stop.sh                 # handles Stop + StopFailure
├── skills/
│   └── satori/
│       └── SKILL.md               # /satori user-facing skill
├── cli/
│   ├── pyproject.toml
│   └── satori/
│       ├── __main__.py
│       ├── ingest.py              # phase A
│       ├── judge/
│       │   ├── interface.py
│       │   ├── anthropic_backend.py
│       │   └── codex_backend.py
│       ├── aggregate.py           # phase C
│       ├── improve.py             # phase D
│       ├── report.py              # phase E (HTML render)
│       ├── transcript.py          # transcript parser + compact-boundary detection
│       ├── db.py                  # SQLite schema + migrations
│       └── config.py
└── README.md
```

## Verification (end-to-end)

1. **Plugin install**: install the plugin into a fresh Claude Code config. Verify `~/.claude/settings.json` contains the patched hooks.
2. **Hot path correctness**: start a Claude Code session. Type `/brainstorming` (force user-typed invocation). Trigger model-chosen skill invocation via a request that should fire one (e.g., "let's brainstorm X"). Verify `~/.satori/events/claude-code/YYYY-MM-DD.jsonl` contains the expected event lines with correct `tool_use_id` pairing across Pre/Post.
3. **Compaction safety**: run `/compact` mid-session. Verify subsequent events still write to the same `session_id`. Verify offline analyzer reads the full transcript (pre + post compact) by inspecting `available_skills_at_session` + `skill_invocations` for that session.
4. **Phase A**: run `satori ingest`. Verify `sessions` and `skill_invocations` populated. Run again; verify no duplicate rows (checkpointing works).
5. **Phase B**: run `satori judge --judge anthropic`. Verify `invocation_judgments` populated with non-null reaction quotes pulled verbatim from transcripts. Re-run with `--judge codex`; verify a parallel set of judgments is produced (judge identity recorded per row).
6. **Phase C**: run `satori aggregate`. Verify `skill_stats` rows for all-time/30d/7d windows. Spot-check one skill's count against raw `skill_invocations`.
7. **Phase D**: run `satori improve --skill brainstorming`. Verify an evidence pack written to `~/.satori/evidence/brainstorming-<date>.md` containing current SKILL.md, exemplars, gap-cases, and pattern summary. Verify `skill_improvements` row with `status='evidence_ready'` and `evidence_path` set. Then invoke `/satori` in a session and request "improve brainstorming"; verify it hands off to `Skill(skill-creator)` or `Skill(writing-skills)` with the evidence pack. After applying or rejecting, run `satori improve --mark brainstorming applied` and verify status transitions in the DB.
8. **Layer 3**: invoke `/satori` in a session, ask for "overview". Verify HTML report renders at the returned URL with the expected sections. Then ask for "deep dive on brainstorming". Verify a per-skill HTML report with timeline, reactions, sample cases, and proposed-description diff.
9. **Scheduled run**: configure `satori run` under cron or a Claude Code `/loop` invocation; let it run twice over a day; verify it processes only new tail data on the second pass (`source_files` checkpoints advance, no rework).

## Critical files to create

Everything is greenfield. The repo at `/d/Everything/F.R.I.D.A.Y./claude-code/` is empty. All files in the layout above are new.

The only "modifications to existing systems" happen at plugin-install time, where Claude Code's plugin loader patches `~/.claude/settings.json` with the hook entries from `plugin.json`. We do not edit `~/.claude/settings.json` ourselves.

## Out of scope for v1 (deliberate cuts)

- Cross-platform adapters (Codex, OpenCode, Cursor, etc.) — designed for, not built. Each gets its own thin adapter writing to `~/.satori/events/<platform>/`.
- Markdown report output as primary surface — future flag on `report`.
- Daily rsync of `~/.claude/projects/` — deferred; scheduled analyzer runs are the safety net.
- Real-time shadow scoring (predicting which skills should fire as the user types) — explicitly rejected as a hot-path concern.
- D (personal telemetry / pretty dashboard for its own sake) — not a v1 goal.
