---
name: research
description: "Investigate a question against high-trust primary sources and capture the findings as cited Markdown artifacts, running a scope-card -> outline -> collect -> evidence-matrix -> report flow with quick/medium/deep levels and Haiku-tier kamaitachi--scout delegation. Supersedes the generic external `research` skill stub bundled on developer machines — same `name: research`, so once this bundle is installed, `Skill(research)` invocations route here instead of the stub. Use when the user wants a topic researched, docs/API facts gathered, prior-art checked, or reading legwork delegated to background agents."
---

# Research Skill — F.R.I.D.A.Y. Research Flow

> Supersedes the generic external `research` skill stub. Same `name: research`, so once this bundle is installed, `Skill(research)` invocations route here instead of the stub. Keeps the stub's good instincts — primary sources, cite every claim, background-agent delegation — and builds the full flow around them.

## Flow at a glance

```
pre-flight  ->  scope-card.md  ->  outline.md  ->  collect  ->  evidence-matrix.md  ->  report.md
```

Templates for the fill-in artifacts live alongside this file: `scope-card.md`, `outline.md`, `evidence-matrix.md`, `report.md`. Copy the relevant template per research session; don't edit these bundled copies in place.

---

## Pre-flight (always first)

1. State the question and the chosen level (quick/medium/deep) — and why — in prose. Align before spending tokens.
2. Check the current project's `./.claude/projects/<slug>/memory/MEMORY.md` for a `reference` pointer to prior research on this topic (see Storage below). `MEMORY.md` auto-loads every session, so this check is naturally available before any scout is spawned. If a pointer covers the question, reuse it — read the pointed `report.md`/`evidence-matrix.md` instead of re-collecting. State this explicitly: "found prior research at `<path>`, reusing" or "no prior hit, proceeding."
3. If the topic looks document-shaped (papers, filings, long-form PDFs/video) and NotebookLM might apply, run `notebooklm list --json` to check for a reusable notebook before creating a new one (see the NotebookLM section below).

---

## Levels

Each invoking flow (Research, Planning, Bug-hunting) suggests a default level for its own use case; state the chosen level explicitly at pre-flight and let the user override.

- **quick** — skip scope-card/outline ceremony entirely. 1 `kamaitachi--scout` dispatch (or direct native search if trivial enough not to need isolated context), ~3-5 native `WebSearch`/`WebFetch` calls. Haiku-tier. Produces a short cited answer; no permanent artifacts required. Default for: bug-hunt error-message/prior-art lookups, quick fact-checks.
- **medium (default)** — full `scope-card.md` + `outline.md`, then 2-3 parallel `kamaitachi--scout` subagents for collection -> `evidence-matrix.md` -> `report.md`. Haiku collect / Sonnet synth. Default for: planning/PRD landscape scans, most invocations.
- **deep** — full ceremony (scope-card + outline + the pre-flight reuse-check) **wraps** the native bundled `/deep-research <question>` workflow for the web-fan-out/adversarial-verify/citation-pass portion. Do **not** hand-roll a scout fleet at this level — `/deep-research` already fans out searches, cross-checks sources, votes on claims, and returns a cited report with unsupported claims filtered; reuse it. AND/OR use NotebookLM-grounded synthesis for a document corpus (see below). Capture whichever output(s) into our own `evidence-matrix.md` + `report.md`. Default for: explicit "research this deeply" requests, high-stakes decisions.

**Hard gate:** launching a `deep` level run is a hard gate per `rules/gate-policy.md` (tier 3 — real token spend) — it must be confirmed **before** launching, never mid-run, since `/deep-research` and other bundled Claude Code workflows take no mid-run input.

---

## Step 1 — scope-card.md

Medium/deep only (quick skips it). Fill from the `scope-card.md` template: boundary, key questions, evidence bar. This does **not** persist as its own file after the report is written — its content folds into `report.md`'s header.

## Step 2 — outline.md

Medium/deep only. Fill from the `outline.md` template: each key question from the scope card maps to a collection strategy, a source category, and a time budget. Tmp artifact — discard once the report is written.

## Step 3 — collect

Behavior depends on level:

- **quick** — native `WebSearch`/`WebFetch` directly, or a single `kamaitachi--scout` dispatch if the question benefits from isolated context.
- **medium** — fan out 2-3 `kamaitachi--scout` subagents in parallel (see `Skill(dispatching-parallel-agents)`), one per outline question or question group. Codebase-facing questions (where the source of truth is this repo, not the web) go to an `Explore` subagent instead of a scout. Each scout writes its findings to a scratch file and returns **only** a file path + a 2-3 line summary — never a raw dump into the lead's context. This is the token-saving mechanism of the lead-researcher pattern: the lead (this skill's invoking agent) does pre-flight, scope, and synthesis; scouts do collection. 80-90% of tokens in a research run should ride Haiku (scout collection) / Sonnet (synthesis reading); reserve Opus/Fable for the final synthesis pass on a `deep` or high-stakes report.
- **deep** — invoke `/deep-research <question>` for the web-fan-out portion instead of a scout fleet. Optionally supplement with NotebookLM for document-heavy corpora (below).

### NotebookLM — optional, gated source-grounding

NotebookLM (`notebooklm` skill, wraps `notebooklm-py`) gives source-grounded, cited synthesis over a corpus (PDFs, papers, long YouTube, filings) — far less hallucination than open-web synthesis for document-heavy sources. It is unofficial and setup-heavy (undocumented API, Google auth, ~170MB Playwright/Chromium first-run). Treat it as a **conditional enhancement, never a required step** — if unavailable, continue silently with native tools; never fail the flow on its absence.

**Availability gate — engage only if ALL hold:**
1. `notebooklm auth check --test --json` returns `status:"ok"` **and** `checks.token_fetch:true`. (A bare `--json` without `--test` is a false positive per the skill's own docs — don't trust it.)
2. There's a real document corpus to ground **or** the user explicitly asked for a NotebookLM artifact.

**Two touch-points only:**
1. **Collect phase** — document-heavy corpora where `WebFetch` is lossy.
2. **Deliverable phase** — optional bonus artifact (mind-map/data-table/audio), only if the user asks.

**v0.1 collect recipe:**

```bash
# 1. Create a notebook, or reuse one found at pre-flight (prefer explicit IDs over re-creating)
notebooklm create "<topic>" --use --json
# reuse path instead of the above, if `notebooklm list --json` found a match:
#   pass --notebook <id> to the commands below

# 2. Add sources, per source
notebooklm source add "<url>" --json
notebooklm source add "./file.pdf" --json
notebooklm source add "<youtube-url>" --json
notebooklm source add - --json          # pasted text, via stdin

# 3. Deep-level auto-gather (optional)
notebooklm source add-research "<query>" --mode deep --from web --import-all --cited-only --json

# 4. Verify what actually landed
notebooklm source list --json

# 5. Condense — ask per outline question, never raw-dump the corpus
notebooklm ask "<question>" --json [--save-as-note]
# returns a cited, grounded answer ([N] anchors + source refs) — parse straight into evidence-matrix.md rows

# Fallback, sparingly: raw extraction when `ask` isn't enough
notebooklm source fulltext <id> -f markdown -o <file>
```

Record the notebook id in the `MEMORY.md` research pointer alongside the report path (Storage below), so a later session can reuse the same notebook instead of re-ingesting. v0.1 keeps NotebookLM main-agent-driven, not a scout job — engaging it needs judgment about the corpus shape that a deterministic collector shouldn't be making alone.

Setup instructions (auth, first-run Playwright/Chromium install) live in the harness README, not here — this section only covers the gate check and the collect-phase commands.

---

## Step 4 — evidence-matrix.md

Fill from the `evidence-matrix.md` template: question -> source -> claim -> confidence. Pulls from every scout's findings file (and NotebookLM `ask` answers, if used). **Permanent artifact.**

## Step 5 — report.md

Fill from the `report.md` template: cited synthesis referencing the evidence matrix (and, for deep runs, the `/deep-research` output). The scope card's boundary and key questions fold into the report's header — there is no separately persisted scope-card file. **Permanent artifact.**

---

## Artifact permanence & storage

- **Permanent** (indexed, reusable across sessions): `report.md` (the cited deliverable) + `evidence-matrix.md` (claim -> source -> confidence).
- **Tmp** (discard after the report is written): `outline.md`, every scout's raw scratch findings file.
- **No parallel store** — reuse the existing memory system. Permanent artifacts land under:
  ```
  ./.claude/projects/<slug>/memory/research/<topic-slug>/report.md
  ./.claude/projects/<slug>/memory/research/<topic-slug>/evidence-matrix.md
  ```
- After writing, add one `reference`-type pointer line to that project's `MEMORY.md`, matching its existing index format, e.g.:
  ```
  - [<Topic>](research/<topic-slug>/report.md) — <one-line summary>; evidence-matrix at research/<topic-slug>/evidence-matrix.md<; NotebookLM notebook <id> if used>
  ```
  This is what makes the pre-flight reuse-check (Step 0 above) actually work on the next session.

---

## Model tiers

Per `rules/model-usage.md`:

- **Scout collection** — Haiku 4.5 (`kamaitachi--scout`'s default; also `Explore` for codebase questions).
- **Synthesis** (evidence-matrix, report) — Sonnet by default; escalate to Opus for the final synthesis pass only on a `deep` or high-stakes report.
- **Main agent** (pre-flight, scope, outline, synthesis) — runs at whatever the session is already on; top-tier capacity is reserved for planning/synthesis, not spent on collection.

---

## Constraints

- Every claim in `evidence-matrix.md` and `report.md` must cite a source. If a scout or NotebookLM can't source a claim, that must be recorded explicitly (as `unsourced`/low confidence) rather than the lead silently omitting the caveat.
- Never fabricate a citation.
- Don't hand-roll a scout fleet at the `deep` level — reuse `/deep-research`.
- Launching a `deep` level run is a hard gate: confirm before, never mid-run.
- NotebookLM is always optional — its absence or failure never blocks the flow.
