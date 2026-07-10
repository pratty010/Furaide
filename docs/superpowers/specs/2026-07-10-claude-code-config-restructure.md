# Spec — Claude Code config restructure + per-harness skill boundaries + installer per-skill selection

> **LIVING spec — in active discussion.** Research/Analysis workflow is designed; flows 2–5 (discussion/planning/PRD, development, bug-hunting, design/architecture) still to be walked one section at a time, updating this file as each locks.
> Companion outstanding-fixes spec: `2026-07-10-statusline-token-cost-fixes.md`.

## Context & goal

Restructure the **shipped** `harnesses/claude-code/config/CLAUDE.md` (the install-target working guide) around the real installed-skill ecosystem: map superpowers/mattpocock/other skills into natural day-to-day flows (research, development, bug-hunting, discussion/planning/PRD, design/architecture) and revamp Rules, Workflow routing, Model Usage & Selection, Delegation, and Output/Artifacts. Separately: re-scope which skills ship with each harness — the common pool ships more than each harness needs; each harness's installer/uninstaller should own its boundary. Add a per-skill selection mechanism to the installer (Track E).

## Verified inventory (evidence base)

- **75 skills** in `~/.agents/skills/`: 29 superpowers (obra), 12 mattpocock, 17 furaide-repo, 12 other-external, 5 unattributed.
- Of the **17 furaide-shipped**, only **4 wired to any runtime**: `github`→CC, `html-preview`→CC + 4 OC agents, `post-mortem`→1 OC agent, `verification-before-completion-furaide-addendum`→1 OC agent. The other **13 are referenced nowhere** (8 "Use in Workflow" research/finance natives + 4 dead addenda).
- Shipping is via two mechanisms: the installer glob (`install-vendored-skills.sh` copies ALL, no filter) and the OC fleet resolver (ships a skill to an agent only if its frontmatter allow-lists it).
- Housekeeping found: 2 manifests disagree on provenance (v2 relabels mattpocock `diagnose`→superpowers); addyosmani set + `ponytail` pinned-but-not-installed (the Ponytail-Gate rule references an absent skill); duplicate families (diagnose/diagnosing-bugs, grill-me/grilling, tdd/test-driven-development, writing-skills/write-a-skill/writing-great-skills, create-readme/readme-blueprint-generator).

## Locked decisions (2026-07-10)

**Boundary mechanism (Decision 1):** keep the single shared `skills/` pool as-is. The per-harness **installer/uninstaller** owns the boundary — each harness's install ships a defined internal+external set for THAT harness (feeds Track E's `--only`); uninstall removes exactly that set. No physical split of `skills/` into harness dirs.

**Global changes to every workflow:** (a) each workflow opens with a **pre-flight** — brief prose statement of scope + what the agent will do next (which subagents/searches) — before launching; (b) **native `WebSearch`/`WebFetch` only** — bx/tavily NOT installed/shipped (cost money); (c) `notebooklm` as an OPTIONAL, availability-gated source-grounding channel in the research flow (ships with both CC and OC — see Flow 1 for the gate + setup placement).

**Addenda (#1):** fold the shared code-discipline from 4 addenda (`writing-plans`/`tdd`/`verification-before-completion`/`requesting-code-review` -furaide-addendum) into ONE always-on **Global Constraints** rule (LOC budgets, complexity tiers trivial/bounded/complex, YAGNI/KISS/DRY/SLAP/SRP, prior-art grep) — they're adjectives not verbs, and the external bases are pinned/unfoldable. Retire those 4 addendum skill files. **Keep `handoff-furaide-addendum`** (real harness-state mechanics).

**Ponytail (#2):** install properly (fixes the dangling Gate rule).
**Dedup (#3):** canonicalize `diagnose`, `grill-with-docs`, `tdd`, `writing-skills`, `create-readme`; drop the variants from all guidance.
**OC unwired natives (#4):** minimalistic/on-demand now; OC-parity (gated workflows) later.
**Finance skills:** `earnings-10k-extraction`/`dcf-valuation-model` ship to OpenCode-`daikoku` only, not CC (finance domain; CC is dev-focused).

## Final file layout (authoritative — per code.claude.com/docs/en/claude-directory)

Claude Code natively supports `rules/`, `workflows/`, bundling `skills/`, and `agents/` at both `~/.claude/` (global) and project `.claude/`. (This SUPERSEDES the earlier "rules-folder is Cursor-only" blog note.) Furaidē's CC config ships into `~/.claude/`:

| Path | Holds |
|---|---|
| `CLAUDE.md` | **Lean** entry: identity, front-load-alignment behavior, intent triage, workflow-routing table (links to skills), **Global Constraints** (folded — see below), output discipline, pointers to `rules/`. Target 500–2000 tokens. |
| `rules/model-usage.md` | Model selection + delegation (opusplan; delegate-outcomes-not-steps; 80–90% cheap-tier; orchestrator-must-not-write-code-it-can-delegate). |
| `rules/version-control.md` | hanko--git-seal routing + conventions (moved out of CLAUDE.md prose). |
| `rules/gate-policy.md` | Cross-cutting gate policy — auto-proceed / soft-confirm / hard-gate tiers + idle-timeout behavior (applies to ALL flows). |
| `skills/research/` | Research flow as a **bundled skill** (SKILL.md + artifact templates). |
| `agents/hanko--git-seal.md`, `agents/kamaitachi--scout.md` | The two required custom subagents. |
| `workflows/` | **RESERVED — future work.** OC-parity gated multi-subagent orchestration (JS `Workflow()` scripts). Empty in v1. |
| `projects/<slug>/memory/research/<topic>/` | Permanent research artifacts + `MEMORY.md` pointer (reuse path). |

## Flow 1 — Research / Analysis (LOCKED v1)

**Home:** a `research` skill (`skills/research/SKILL.md` + bundled templates `scope-card.md`, `outline.md`, `evidence-matrix.md`, `report.md`) — the official "new workflows are skills, bundle supporting files" model. REPLACES the three retired scaffold skills (`deep-research-outline`, `domain-scope-card`, `evidence-matrix`). Reconcile with the existing unattributed `research` skill in the pool (adopt/adapt — don't ship a colliding second one).

**Flow:** pre-flight (state scope + plan in prose, align; check `MEMORY.md` for pertaining prior research first) → **scope-card.md** (boundary + key questions + evidence bar) → **outline.md** (each Q → collection strategy → source category → time budget) → **collect** (native WebSearch/WebFetch; Explore for codebase Qs; **notebooklm as an optional grounding channel — gated, see below**) → **evidence-matrix.md** (Q → source → claim → confidence) → **report.md** (cited synthesis referencing the artifacts).

**NotebookLM (optional, gated source-grounding) — LOCKED 2026-07-10.** The `notebooklm` skill (`notebooklm-py`, teng-lin/notebooklm-py) gives source-grounded, *cited* synthesis over a corpus (URLs/PDFs/YouTube/Drive/audio/video) — far less hallucination than open-web synthesis — plus auto-gather (`source add-research --import-all`) and artifact generation (mind-map/data-table/audio). It is **unofficial and setup-heavy** (undocumented Google API that can break; Google auth; Playwright+Chromium ~170MB; rate/source-tier caps; PEP 668 → must use `uv`/`pipx`; `[cookies]`/rookiepy fails on Python 3.13+). So it is a **conditional enhancement, never a required step**.
- **Two touch-points only:** (1) *collect phase* — for document-heavy corpora (PDFs, papers, long YouTube, filings) where native WebFetch is lossy: `source add` the corpus → `notebooklm ask` cited questions → feed cited answers into `evidence-matrix.md`; (2) *deliverable phase* — optional bonus artifact (mind-map / data-table / audio overview of the report) only when the user asks.
- **Availability gate (engage ONLY if all hold, else silently continue with native tools — never fail the flow):** `notebooklm auth check --test --json` returns `status:"ok"` AND `checks.token_fetch:true` (bare `--json` is a false-positive per the skill's own docs — `--test` makes a real network call); AND there is a real document corpus to ground OR the user explicitly requested a NotebookLM artifact.
- **Where documented:** the research SKILL.md carries the gate + the two touch-points (references the skill, does NOT re-document setup). First-time **setup lives as a curated "Optional: NotebookLM research grounding" section in `harnesses/claude-code/README.md` (and OC's README)** — the minimal happy path (`uv tool install "notebooklm-py[browser]"` → `notebooklm login` → verify `notebooklm auth check --test --json`) + the five gotchas (Playwright 170MB first login; use uv/pipx not system pip re PEP 668; `[cookies]` unavailable on 3.13+ → use interactive `notebooklm login`; unofficial-API fragility; rate/source-tier caps), linking out to the upstream install guide + the skill's own `SKILL.md` for the full matrix (curate the quick path, don't duplicate 39KB).
- **Boundary correction:** because CC's research flow uses it, the `notebooklm` skill ships with **both CC and OC** installers (earlier "OC-only" note superseded). The pip package + Google auth is a one-time per-machine setup, documented once and linked from both harness READMEs.
- **v1 keeps notebooklm main-agent-driven, not a scout job** (engaging it needs judgment about the corpus; scout stays native web + `gh`).

**NotebookLM v0.1 collect path (SHIPPED commands — source→fetch→condense; per teng-lin/notebooklm-py/docs/cli-reference.md):**
- *Where sources come from:* (a) user-provided materials (URLs/PDFs/docs handed to us), (b) URLs discovered by native WebSearch/scouts during collect, (c) NotebookLM's own auto-gather (`source add-research`) at the deep level.
- *Fetch (ingest into a grounded notebook):*
  1. `notebooklm create "<topic>" --use --json` (or reuse an existing notebook via `--notebook <id>` — prefer explicit IDs, never rely on shared `use` state, per the skill's parallel-agent guidance).
  2. Per source: `notebooklm source add "<url>" --json` / `source add "./file.pdf" --json` / `source add "<youtube-url>" --json`. Pasted text via `source add - --json` (stdin).
  3. Deep-level auto-gather (optional): `notebooklm source add-research "<query>" --mode deep --from web --import-all --cited-only --json`.
  4. Verify ingest: `notebooklm source list --json`.
- *Condense (the key move — ask-per-question, NOT raw dumps):* for each outline question, `notebooklm ask "<question>" --json [--save-as-note]` returns a **cited, grounded answer** (`[N]` anchors + source refs). Parse the JSON answer+citations straight into `evidence-matrix.md` rows (Q → source → claim → confidence). This is the condensation: targeted cited answers replace dumping source text into context. Raw extraction fallback (sparingly): `notebooklm source fulltext <id> -f markdown -o <file>`.
- *Kept for FUTURE expansion (NOT v0.1):* artifact generation + downloads (audio/video/quiz/flashcards/mind-map/slide-deck/infographic/data-table), `add-drive`, `suggest-prompts`, multi-account profiles, deliverable-phase artifacts. Build on top of this collect path later.

**Deep level leverages the NATIVE `/deep-research` bundled workflow (LOCKED 2026-07-10 — per code.claude.com/docs/en/workflows#bundled-workflows):** Claude Code ships `/deep-research <question>` — fans out web searches across angles, fetches + cross-checks sources, **votes on each claim**, returns a cited report with unsupported claims filtered (unverifiable ones marked, not refuted). This IS our deep-level web fan-out + adversarial-verify + citation pass — do NOT reinvent it.
- **quick:** native WebSearch/WebFetch + 1 scout, no notebooklm, no workflow. Main-agent.
- **medium:** scope-card + outline + 2–3 scouts (native); notebooklm OFFERED in pre-flight if corpus + available; evidence-matrix; report. Main-agent-driven.
- **deep:** our pre-flight + scope-card + outline (planning discipline + reuse-check) WRAP the native `/deep-research` for the web portion AND/OR notebooklm grounded synthesis for a document corpus; capture both into our `evidence-matrix.md` + permanent `report.md`. Escalate to `/deep-research`, don't hand-roll a scout fleet at this level.
- **`workflows/` future use is now concrete:** save a custom research workflow (built on the deep-research pattern + notebooklm collect path) to `~/.claude/workflows/` for reuse — the natural v2 of this flow. Still future work; v0.1 uses the bundled `/deep-research` directly.
- **Gate-policy interaction (see cross-cutting rule):** workflows take NO mid-run user input (only permission prompts pause them) — so any sign-off must happen BEFORE launching `/deep-research` (in pre-flight) or BETWEEN stages, never mid-run. Launching a deep workflow is a **hard gate** (real token spend).

**NotebookLM notebook reuse + metadata cache (avoid re-ingesting/re-searching):**
- *v0.1 (lightweight, shipped):* at pre-flight, when notebooklm is available and the topic looks document-shaped, run `notebooklm list --json` and check for an existing notebook whose title/topic matches the current research. If found, **reuse it** (`--notebook <id>`) — its sources are already ingested and prior `ask` answers may already cover questions — instead of creating a new notebook and re-adding sources. The `MEMORY.md` research pointer for a topic records the **notebook id** alongside the report path, so the auto-loaded index surfaces "there's a NotebookLM notebook for this" at pre-flight without a network call.
- *Future work (fuller cache):* a local metadata index (e.g. `memory/research/notebooks-index.json`, refreshed via `notebooklm metadata --json`) mapping topic → notebook-id → ingested sources → key cited answers, so reuse can be matched semantically and prior cited answers pulled without re-asking. Build on top of the v0.1 list-and-match path.

**Delegation (Anthropic lead-researcher pattern):** high-tier main (Opus/Fable) does pre-flight + scope + synthesis; **fan out 3–5 scouts in parallel**, each an "intelligent filter" that **writes findings to a file and returns only a lightweight reference** (not raw dumps); 80–90% of tokens ride Haiku (lookups) / Sonnet (heavier reading).

**Artifact permanence + cross-session reuse:**
- **Permanent** (indexed, reusable): `report.md` (deliverable) + `evidence-matrix.md` (claim→source→confidence). Scope-card folds into the report header.
- **Tmp** (discarded after report): `outline.md`, every scout's raw dump.
- **Reuse via the existing memory system** (no parallel store): permanent artifacts land under `./.claude/projects/<slug>/memory/research/<topic>/` with a one-line `MEMORY.md` pointer (type `reference`). MEMORY.md auto-loads → pre-flight naturally sees prior research and reuses it before spawning any scout.

**Research levels (resource control):**
- **quick:** 1 scout, ~3–5 searches, skip scope-card/outline → short cited answer. Haiku. *Default:* bug-hunt lookups, quick fact-checks.
- **medium (default):** scope-card + outline + 2–3 parallel scouts → evidence-matrix → report. Haiku collect / Sonnet synth. *Default:* planning/PRD landscape scans, most flows.
- **deep:** full ceremony, 3–5 scouts + multi-source, adversarial claim verification + citation pass. Haiku collect / Opus–Fable synth. *Default:* explicit "research deeply" / high-stakes.
- Each invoking workflow suggests a default; user overrides; the level is stated in pre-flight.

## Scout subagent (NEW required — `kamaitachi--scout`)

- Role: deterministic web/source collection — the "intelligent filter" of the lead-researcher pattern.
- **Model: Haiku (cheapest)** — collect + condense + emit is deterministic, no judgment.
- Tools (minimal): `WebSearch`, `WebFetch`, `Read`, `Write`, `Bash(gh …)` (GitHub via the already-present `gh` CLI, free).
- Behavior: given a sub-question + source hints + level → runs searches/fetches, writes a condensed findings file to scratch, returns only its path + a 2–3 line summary.
- Naming: **Kamaitachi** (鎌鼬 — trio of swift weasels; fits 3–5 parallel scouts). Confirm at build.
- **Future expansion (NOT v1 — web + `gh` only):** opt-in MCP source adapters — Reddit (`king-of-the-grackles/reddit-research-mcp`, free, 20k+ subreddits), X/Twitter (official hosted X MCP, 2026-06), YouTube transcripts (YT-transcript MCP), broad multi-source (arXiv/HN/StackExchange/OpenAlex/GDELT via Apify research-mcp). Domain-driven; gated on cost/auth.

## Subagent ledger (tracked across ALL flows — build only the absolutely-required)

- *Shipped now:* `hanko--git-seal` (git/GitHub).
- *NEW required:* `kamaitachi--scout` (Haiku collector) — reused by research + bug-hunt (error/prior-art lookups) + planning (landscape scans).
- *Lean on built-ins:* `Explore` (codebase search, skips CLAUDE.md/git = cheap), `Plan`, `general-purpose`.
- **Running required-set: { hanko--git-seal, kamaitachi--scout }.** Extend only when a flow genuinely can't use a built-in or scout; re-evaluate per flow.

## Online best-practice research (2026-07-10)

- *Rules vs Skills:* Rules = adjectives (ambient, always-loaded, how code is written); Skills = verbs (invokable, on-demand). The guide routes to verbs, doesn't restate them.
- *Rules structure:* Claude Code's native `rules/` dir modularizes topic detail; CLAUDE.md stays the lean entry/routing doc (500–2000 token budget, link-don't-inline).
- *Model routing:* opusplan (high-tier plans, Sonnet executes — "only pay Opus rates during planning"); delegate outcomes not steps; 80–90% of tokens on cheaper models; escalation Sonnet → opusplan → Opus-only-when-needed. Explore/Plan subagents skip CLAUDE.md+git (fast); others load both. Subagents can spawn subagents. Anti-pattern: orchestrator writing code it could delegate — forbid explicitly.

## Cross-cutting rule — Gate Policy (LOCKED 2026-07-10 → `rules/gate-policy.md`)

Applies to EVERY flow. Formalizes the reversible→proceed / irreversible→stop principle and adds "don't stall on a soft gate — move forward on the stated default." Three tiers:

1. **Auto-proceed** (reversible; a clear sensible default exists): state the default + why, then proceed. Never block. (e.g. "defaulting to medium/native, starting collection.")
2. **Soft-confirm** (moderate consequence; good default exists): state the default + alternatives, then **proceed with the default if unaddressed** — in interactive use, on the next turn if the user doesn't redirect; in autonomous/`/loop` use, after an **idle threshold of 20 minutes** (via ScheduleWakeup). Never hang indefinitely.
3. **Hard gate** (always block for explicit confirmation, NO timeout auto-proceed): git push / PR / merge (via `hanko--git-seal`); launching a **deep / `/deep-research`** run (real token spend); deletion or overwrite of files we did not create; any scope change.

Honest mechanism note: a literal timer only fires in autonomous/`/loop` contexts (ScheduleWakeup). In plain interactive Claude Code the agent ends its turn and the soft-gate default fires on the user's next message if unaddressed — there is no background clock mid-turn. Dynamic `workflows/` runs take no mid-run input at all, so their gating is pre-launch or between-stage only.

---

## Flow 1 status: **LOCKED v1** (research/analysis). All decisions above are final for v0.1; expansions are tagged "future work."

## Flow 2 — Discussion / Planning / PRD (LOCKED 2026-07-10)

**Chain:** pre-flight → `brainstorming` (open prose Q&A) → `grill-with-docs` (default) → `writing-plans` → durable plan/PRD artifact. Model: high-tier (Opus/Fable) for the thinking/synthesis; `scout` / medium research when the problem space is unfamiliar.

**Front-load-alignment behavior — ingrained in CLAUDE.md (not just this flow), per user 2026-07-10:** exhaust discussion and ambiguity-resolution in the upper (discussion/planning) stages via **open prose Q&A — never the structured `AskUserQuestion` picker** during design — so downstream execution doesn't churn. Prefer resolving a question now over revisiting it mid-build. This is a top-level always-on CLAUDE.md rule (the user explicitly wants CLAUDE.md as the source that ingrains it), extending the existing brainstorm-style preference.

**No issue tracker (user 2026-07-10) — borrow traits, don't push to a tracker:** `to-prd`/`to-issues`/`triage` are NOT invoked as tracker flows. Borrow their *techniques* into the plan/PRD artifact instead — PRD synthesis (from `to-prd`: turn context into a crisp problem/requirements doc), tracer-bullet **vertical-slice decomposition** (from `to-issues`: break work into independently-shippable slices — useful for plan structure even with no tracker), and **prioritization** (from `triage`: order the slices). Applied as thinking, no tracker skills run.

**`grill-with-docs` is default (user metric 2026-07-10):** grill every non-trivial plan. Skip ONLY when the change is menial AND **there is zero ambiguity on the exact requirement** (fully understood) — requirement-ambiguity is the measuring metric; any ambiguity → grill.

**Artifacts — all under `<current-dir>/docs/`, durable (user 2026-07-10):**
- **plans** → `docs/superpowers/plans/`; **specs / PRD** → `docs/superpowers/specs/` (PRD is spec-class).
- **Plan-file edit-in-place is canonical** (existing preference): when a plan file is supplied, edit it directly — do NOT spawn a new plan-mode scratch file.
- (Flow 1's research artifacts stay under `memory/research/` for the MEMORY.md auto-load reuse mechanism — a different artifact class; a research report may additionally be copied into `docs/` when it's a shareable deliverable — optional.)

## Flow 3 — Development (LOCKED 2026-07-10)

**Starts from an EXISTING spec/plan** (writing-plans belongs to Flow 2, not here). Chain: pre-flight → *[worktree-or-direct decision]* → execute the spec/plan (`subagent-driven-development` in-session **or** `executing-plans` separate-session) → `tdd` → `verification-before-completion` → `requesting-code-review` (+ `/code-review` where warranted) → `finishing-a-development-branch`. Code-discipline (LOC/tiers/YAGNI/KISS/DRY/SLAP/SRP/prior-art) ambient via Global Constraints; all git via `hanko--git-seal`.

- **Worktree vs direct-on-`dev` — user decides, agent SUGGESTS (soft gate, user 2026-07-10):** the agent recommends a path based on the plan's scope and the user confirms/decides. Suggestion threshold (#1 confirmed): **≥3 files OR touches shared contracts OR needs parallel isolation → suggest worktree** (`using-git-worktrees`); else suggest direct on `dev`. (This session: worktree for statusline+docs; direct-on-`dev` for small Track D.)
- **Execution + worker-model delegation (confirmed):** `subagent-driven-development` = execute plan tasks with subagents in the *current* session; `executing-plans` = run the plan in a *separate* session with checkpoints. Worker tiers: **Haiku** for well-specified/mechanical tasks, **Sonnet 4.6** for moderate-complexity, reserve **Opus/Fable** for a genuinely hard sub-problem only (matches this session's dispatch).
- **TDD posture (confirmed):** default red-green-refactor for features/bugfixes; pragmatic skip allowed for trivial/throwaway only.
- **Review composition (user 2026-07-10):** self-review via `requesting-code-review` (with the folded prior-art/SLAP/LOC checks) always; the **`/code-review`** skill (two-axis Standards+Spec) before merge on non-trivial changes, **at a calibrated effort level** for the change size/risk. **No `rejion`** (external-model review) for now — future scope.
- **`finishing-a-development-branch`:** merge/PR/cleanup via `hanko--git-seal` — a **hard gate** (explicit approval, no timeout) per the gate policy.

## Flow 4 — Bug hunting (LOCKED 2026-07-10)

**Chain:** pre-flight → `systematic-debugging` (ALWAYS first — no fix proposed before it) → `diagnose` (escalate ONLY for hard bugs / perf regressions: full repro→minimise→hypothesise→instrument→fix→regression-test loop) → fix → `regression-test-recipe` → `post-mortem` (conditional). Scout at **quick** level is the default research capacity (error-message / prior-art lookups). Model: higher tier for hypothesis/root-cause reasoning; workers (Haiku/Sonnet) for repro/instrument grunt-work.

- **Escalation (confirmed):** systematic-debugging is the always-first posture for any bug; diagnose escalates for hard/regression cases only.
- **`regression-test-recipe` (default non-trivial):** default for every non-trivial bugfix — mirrors the Flow 3 TDD posture (the bug reproduces as a failing test first; this formalizes the minimal repro that stays in the suite). Skip only for trivial/throwaway.
- **`post-mortem` (conditional):** reserve for **significant / recurring / production-impacting / diagnose-escalated** bugs (ones that cost real time or teach a durable lesson); skip trivial fixes. Its output feeds the **memory system** (a `feedback`/`project` memory + MEMORY.md pointer) so the lesson persists — that is the point of the post-mortem.

## Flow 5 — Design / UI & Architecture (LOCKED 2026-07-10)

Two branches. This repo is mostly CLI/tooling, so the design tooling skews to logic/state validation + HTML specs, not frontend polish.

- **Design/UI branch:** pre-flight → `brainstorming` → `prototype` (throwaway — validate a state-model / logic-feel / design question) as the **primary** tool, with `html-preview` producing design options/specs a human judges visually. **`impeccable` is NOT default** — surface it in the workflow ONLY with ample stated reasoning why it's warranted (genuine frontend polish/UX need), user 2026-07-10.
- **Architecture/refactor branch:** `codebase-design` (deep-modules vocabulary) / `domain-modeling` (ubiquitous language + ADRs) / `improve-codebase-architecture` (scan for deepening/refactor opportunities) → `grill-with-docs` (**default**, consistent with Flow 2) → **hands the design off to Flow 2 (plan) → Flow 3 (execute)**. Flow 5-arch is a front-end to Flows 2/3, NOT a standalone build path (confirmed).
- **Artifacts — all under proper `docs/` subdirs (user 2026-07-10):** ADRs → `docs/adr/`; design specs → `docs/superpowers/specs/`; plans → `docs/superpowers/plans/`. `html-preview` governs the output-format choice (HTML for visual judgment; markdown for logic/text) — the cross-cutting Output/Artifacts discipline.

---

## ALL FIVE FLOWS LOCKED (2026-07-10). Cross-cutting sections — LOCKED:

**Intent Triage (fresh design, LOCKED 2026-07-10)** — one pass before the first consequential action:
1. **Route to flow(s):** Research / Planning / Development / Bug-hunting / Design-Architecture (a request may chain them, e.g. Design → Planning → Development).
2. **Clarity gate:** is the exact requirement unambiguous? **No → front-load alignment (open prose Q&A) first** — never launch a full flow on ambiguity. Yes → proceed.
3. **Size/risk → scaffolding + path:** *Trivial* (≤1 file, one-sentence diff, no design choice, unambiguous) → execute directly, skip ceremony. *Bounded* (few files, clear) → light/task-level, direct on `dev`. *Multi-file / rippling / shared-contracts* → plan (Flow 2) + suggest worktree.
4. **Research level** (if collecting): quick / medium (default) / deep — stated in pre-flight.
5. **Gate tier** per consequential action: auto-proceed / soft-confirm / hard (per the gate policy).
This subsumes the old 4-way (TRIVIAL→3-trivial, NON-TRIVIAL→3-multifile, GENERAL→2-ambiguous, SPECIFIC→2-clear) and also routes flow + level + gate.

**Model Usage & Selection (LOCKED → `rules/model-usage.md`):**
- **Opus 4.8 = default top-tier** (planning, synthesis, hard review, architecture). **Fable 5 = manual-only** — the agent *proposes* escalating to Fable when a task genuinely exceeds Opus (large migration, multi-day autonomous run, stuck problem); the user opts in (soft gate). Never auto-switches to Fable.
- Workers: **Haiku** (well-specified/mechanical, scout collection, file scan/format), **Sonnet 4.6** (moderate-complexity with clear direction). Sonnet 5 caveat retained (narrow CLI/agentic use, ~30–40% more output tokens — not a blanket cheap tier).
- Principles: opusplan (reserve top-tier for planning; workers execute), delegate outcomes-not-steps, 80–90% of tokens on cheaper tiers, orchestrator must NOT write code it could delegate.

**Output / Artifacts (LOCKED):** durable artifacts under `docs/` proper subdirs (`plans/`, `specs/`, `adr/`); research artifacts under `memory/research/` (MEMORY.md auto-load reuse); tmp in scratchpad; `html-preview` governs HTML-vs-markdown (HTML for visual judgment / 100+-line specs, markdown for logic/text).

**Delegation (LOCKED):** subagent ledger `{ hanko--git-seal, kamaitachi--scout }` + built-ins (`Explore` codebase, `Plan`, `general-purpose`); delegate-up for scope (10+ files / 3+ independent subtasks / verify-before-merge), delegate-down for cost (over-qualified session model); parallel when independent, sequential when data-dependent; anti-pattern: subagents for ≤1 file / ≤2 steps unless model-downsizing.

**End-of-track:** the CONTENT of each doc file is specified below (as structure/outline — actual files authored at implementation time, not now).

---

## Final doc-file content spec (structure — authored at implementation)

**`config/CLAUDE.md` (lean, ≤~2000 tokens — entry/routing only):**
1. *Identity* — Furaidē persona (kept, trimmed).
2. *Front-load alignment* (always-on behavior) — resolve ambiguity in the upper stages via open prose Q&A, never the `AskUserQuestion` picker during design; prefer resolving now over revisiting mid-build.
3. *Intent Triage* — the fresh 5-step (route to flow → clarity gate → size/path → research level → gate tier).
4. *The 5 flows* — one line each, naming the canonical skill chain + linking to the flow's skill/rules: Research (→ `research` skill), Planning, Development, Bug-hunting, Design/Architecture.
5. *Pointers to `rules/`* — global-constraints, model-usage, version-control, gate-policy.
6. *Output/Artifacts* one-liner → `html-preview`; durable homes under `docs/`.
7. *Active subagents* — `hanko--git-seal`, `kamaitachi--scout`.

**Global Constraints — folded INTO `config/CLAUDE.md`** (too small for its own file; ~7 lines, always-on ambient): YAGNI/KISS (build only what's needed, err to simplicity) · DRY (accept duplication when deduping adds coupling) · SLAP (one abstraction level/function) · SRP (one reason to change/unit) · Complexity tier (trivial ≤1 file/≤30 LOC · bounded ≤3 files/≤100 LOC · complex open-ended — drives model + delegation + plan altitude) · LOC budget (estimate first; ±20% ok; larger overrun → scope review) · Prior-art grep (search existing patterns before designing; novel needs justification). Folded from the 4 retired addenda. **No `rules/global-constraints.md`.**

**`config/rules/model-usage.md`:** Opus default top-tier; Fable manual-only (agent proposes → user opts in, soft gate); Haiku/Sonnet-4.6 workers; Sonnet-5 caveat; opusplan; delegate outcomes-not-steps; 80–90% cheap-tier; orchestrator-no-code; Explore/Plan skip CLAUDE.md+git.

**`config/rules/version-control.md`:** hanko--git-seal routing; Conventional Commits, SSH-signed, `Assisted-by` trailer; push/PR/merge = hard gate; never `--force`/`--no-verify`, never push to `master`.

**`config/rules/gate-policy.md`:** the 3 tiers (auto-proceed / soft-confirm 20-min idle / hard) + the hard-gate list + the workflow no-mid-run-input note.

**`config/skills/research/` (bundled skill):** SKILL.md = the research flow (pre-flight → scope-card → outline → collect → evidence-matrix → report), levels quick/medium/deep, notebooklm gate + v0.1 commands, deep=`/deep-research`, scout delegation, memory reuse. Bundled templates: `scope-card.md`, `outline.md`, `evidence-matrix.md`, `report.md`. Reconcile with the existing pool `research` skill (adopt/adapt, no collision).

**`config/agents/kamaitachi--scout.md`:** Haiku; tools `WebSearch`/`WebFetch`/`Read`/`Write`/`Bash(gh)`; deterministic collect → condense → write-file → return-reference contract.

**`harnesses/claude-code/README.md` changes:** (a) add "Optional: NotebookLM research grounding" setup section (quick path `uv tool install "notebooklm-py[browser]"` → `notebooklm login` → `auth check --test --json`, + the 5 gotchas, links out); (b) `## 📅 Timeline` — add **law + financial workflows** as upcoming/roadmap.

---

## CC installer ship-set (the per-harness boundary — feeds Track E `--only`)

Principle: CC ships exactly what its 5 flows + rules + output discipline reference. Changes to the repo `skills/` and the external set:

- **Correction (found during implementation, 2026-07-10):** the original plan here said "RETIRE (delete) 7" for the 4 addenda + 3 research scaffolds. That's wrong and was reverted — `harnesses/opencode/scripts/tests/skills-manifest.test.mjs`'s `'core skill set exists'` test asserts `writing-plans-furaide-addendum`, `test-driven-development-furaide-addendum`, `requesting-code-review-furaide-addendum`, `domain-scope-card`, `evidence-matrix`, and `deep-research-outline` all exist on disk in the shared pool, and `verification-before-completion-furaide-addendum` is separately still allow-listed live in `harnesses/opencode/agents/kagami--verifier.md`'s frontmatter. Deleting any of them breaks OC's own CI. This directly contradicted **Decision 1** above (installer-owned boundary, not physical pool splitting) — fixed by leaving all 7 files in the shared `skills/` pool untouched and enforcing CC's exclusion purely through the installer's `--only` allowlist (implemented in `claude-code/install.sh`'s `CC_SKILL_SET`). The content-folding into CLAUDE.md's Global Constraints and the `research` skill templates below still happened — that's independent of whether the underlying skill directories are deleted.
- **Repo `skills/` — fold content, keep files (no deletion):** the 4 code-discipline addenda (`writing-plans`/`tdd`/`verification-before-completion`/`requesting-code-review` -furaide-addendum → folded into the CLAUDE.md **Global Constraints** section) and the 3 research scaffolds (`deep-research-outline`/`domain-scope-card`/`evidence-matrix` → folded into the `research` skill templates) stay on disk for OC (and any other harness) to keep using; CC simply excludes them from its own `--only` set.
- **Repo `skills/` — CC ships:** `github`, `html-preview`, `handoff-furaide-addendum`, `post-mortem`, `regression-test-recipe`, and the NEW `research`.
- **Repo `skills/` — NOT shipped to CC (excluded from `--only`, stays in shared pool):** `dcf-valuation-model`, `earnings-10k-extraction` (finance — surfaced as an OC-`daikoku` opt-in extra), `mcp-supply-chain-scan` (security — surfaced as an OC-`fudo` opt-in extra), `brave-search`, `bx` (dropped from CC — native `WebSearch`/`WebFetch` instead).
- **External skills CC ships (canonical only, via `install-external-skills.sh --ecosystem claude-code --all`, now the DEFAULT install path, not a rare `--with-skills` opt-in):** superpowers — `brainstorming`, `writing-plans`, `subagent-driven-development`, `verification-before-completion`, `requesting-code-review`, `finishing-a-development-branch`, `using-git-worktrees`, `caveman`, `diagnose`, `systematic-debugging`, `tdd`, `skill-creator`, `writing-skills`, `humanizer`, `receiving-code-review`, `create-readme`, `improve-codebase-architecture`, `grill-with-docs`, `impeccable`, `prototype`, `to-prd`, `to-issues`, `triage`, `html-preview`, `find-docs`, `dispatching-parallel-agents`, `handoff`, `executing-plans`; plus `notebooklm` (manual/gated) and **`ponytail`** (flipped from `manual` to auto-install in `skills-manifest.json` — fixes the dangling Ponytail-Gate rule). **Known gap:** `codebase-design` and `domain-modeling` (2 of the 4 originally-planned mattpocock skills) are NOT currently in `skills-manifest.json` at all — no verified upstream source URL was available during implementation, so they were NOT added (fabricating a git clone URL would be worse than leaving the gap documented). They're already present in some developers' `~/.agents/skills/` via a separate, unknown installation path. Follow-up needed: confirm the real mattpocock source repo URL and add a proper manifest entry.
- **Dedup (drop these variants from CC's set + all guidance):** `diagnosing-bugs` (use `diagnose`), `grilling`/`grill-me` (use `grill-with-docs`), `test-driven-development` (use `tdd`), `write-a-skill`/`writing-great-skills` (use `skill-creator`/`writing-skills`), `readme-blueprint-generator` (use `create-readme`).
- **New config-bundle dirs the installer must copy:** `config/rules/*.md`, `config/skills/research/`, `config/agents/kamaitachi--scout.md` (alongside existing `hanko--git-seal.md`), and the rewritten `config/CLAUDE.md`.

---

## Track E — installer/uninstaller finalization (supersedes the earlier Track E sketch; now informed by the full flow design)

Runs in a worktree (`feat/installer-config-restructure`). Combines the per-skill selection mechanism with the CC ship-set boundary + the new config-bundle dirs.

**E1 — shared primitive** (`packages/cli/src/shared/install-vendored-skills.sh`): add `--list` (emit `name<TAB>desc` from SKILL.md frontmatter via python3, quoted-scalar-safe), `--only <names>` (filter loop, validate, warn+skip unknown; default = all), and echo `INSTALLED: <name>` per skill actually installed.

**E2 — CC install** (`packages/cli/src/targets/claude-code/install.sh`):
- Ship the CC boundary set by default (the repo + external lists above), NOT all-of-`skills/`. Skills picker line → `[Y/n/s/b]`, `s` = numbered multi-select from `--list` scoped to the CC set.
- **Copy the new bundle dirs:** `config/rules/` → `~/.claude/rules/`, `config/skills/research/` → the skills pool + symlink, `config/agents/kamaitachi--scout.md` → `~/.claude/agents/`.
- Install external canonical set + `ponytail` via `install-external-skills.sh` (dedup variants excluded).
- **Receipt-drift fix:** populate `skillNames` from `INSTALLED:` lines (actual outcome), not a re-glob. Receipt records rules/agents/research too.

**E3 — CC uninstall** (`.../claude-code/uninstall.sh`): `[Y/n/s]` per-skill subset from the receipt; also remove `~/.claude/rules/*` and `~/.claude/agents/kamaitachi--scout.md` that the receipt records (symlink-verify unchanged); rewrite receipt minus removed.

**E4 — OC fleet** (`.../opencode-fleet/wizard.ts`): agent-required skills stay automatic; new opt-in "extras" multiselect of remaining repo skills (incl. the relocated finance/security natives + `notebooklm`) unchecked by default; tracked under `skills-bundled`.

**E5 — Pi** (`.../pi-agent/install.sh`): if `~/.agents/skills` empty, offer `install-vendored-skills.sh --global` with the `s` selection; `--yes` skips.

**E6 — do-now vs future:** *do now* — receipt-drift fix, the shared `--list`/`--only` primitive, the CC boundary set, the new-dir copies, retire the 7 skills, install ponytail. *Future work* — unify the two receipt schemas (CC flat v1 vs OC zod v2), external/pinned-skill uninstall lifecycle, reconcile the two extended-skills systems.

**Track E verification:** extend `test_install_lib.sh` (`--list` shape, `--only` filter + unknown-warn, `INSTALLED:` matches disk, new-dir copies land); scratch-HOME E2E (CC install `s`-select subset → correct symlinks + rules/ + scout agent + receipt; uninstall subset → correct removal + receipt rewrite); OC wizard dry-run extras; `bun x tsc --noEmit` + `bash -n`; commits via `hanko--git-seal` in the worktree, merge-back on approval.

**Bugs found + fixed during implementation (2026-07-10), all pre-existing, none part of the original spec:**
- `install-vendored-skills.sh`'s last line (`[[ -n "$CLAUDE_DEST" ]] && printf ...`) leaked a nonzero exit code on every `--custom`-mode run (empty `CLAUDE_DEST` → the `&&` chain evaluates false → that's the script's final exit status). Fixed with an `if` block + explicit `exit 0`.
- `uninstall.sh` had the identical pattern on its own last line (`[[ "$DRY_RUN" -eq 1 ]] && printf ...`) — every normal (non-dry-run) uninstall has always exited 1 regardless of success. Same fix.
- CC's new "canonical external skills install by default" step (this Track E's own change) calls `install-external-skills.sh`, which has no `--custom`-scope concept — for `SCOPE=custom` CC installs it was silently writing to the real `~/.agents/skill-repos`, `~/.agents/skills`, `~/.claude/skills` on the host machine instead of the isolated target dir. Caught via a scratch E2E test that (harmlessly but unintentionally) cloned `ponytail` onto the implementer's real machine; reverted per user call. Fixed by redirecting `AGENTS_SKILL_REPOS`/`AGENTS_SKILLS`/`CLAUDE_SKILLS` (env vars the script already supports) into `TARGET_DIR` for `SCOPE=custom`.
- The same default-install change left the canonical external skill set completely untracked for uninstall (they come from a separate script that never touches the receipt's `skillNames`) — a full uninstall left them behind. Fixed with a best-effort companion cleanup pass in `uninstall.sh`, gated to global-scope full (non-subset) uninstalls, using the same symlink-safety guard as the vendored-skills removal.
- `rules/` and `agents/` directories were never `rmdir`'d after their last file was removed (harmless empty-dir litter). Added `rmdir ... || true` cleanup.
- **Known gap, NOT fixed (no custom-scope uninstall path exists at all):** `uninstall.sh --scope` only accepts `global`/`project` — a CC install done with `--scope custom:<path>` has no matching uninstall entry point via this script. Pre-existing (predates this Track), out of scope for Track E's locked items; flagged here for future work rather than silently expanding scope to build one.

## Future flows (roadmap — NOT built now)

- **Law and financial workflows** are planned for the harness (finance partially seeded by `dcf-valuation-model`/`earnings-10k-extraction`, shipped to OpenCode-`daikoku`; law is net-new). **Action:** add these to the `## 📅 Timeline` section of the harness `README.md` (`harnesses/claude-code/README.md`) as upcoming/roadmap items when the Track-G docs are updated.
- OC-parity gated multi-subagent `workflows/` (JS `Workflow()` scripts), the fuller NotebookLM metadata cache, and the scout's MCP source adapters (Reddit/X/YouTube/arXiv) all remain future work as noted in their sections.

## End-of-track (after all flows locked)

Discuss and draft the **actual content** of the final `CLAUDE.md` + each `rules/*.md` file together once all workflow info is encapsulated — get them to their best state as a set, not piecemeal.

---

## Track E — installer: per-skill selection + install/uninstall reassessment

Runs in a worktree (`feat/installer-skill-selection`) — multi-file installer surface. Current state: 17 skills all with `name:`+`description:` frontmatter (quoted scalars exist — `github` — parse with python3, not grep). `install-vendored-skills.sh` installs ALL unconditionally. CC installer: one `INSTALL_SKILLS` toggle (`install.sh:206`); CC uninstall: one `DO_SKILLS` toggle over receipt `components.skillNames`. **Bug: receipt drift** — CC `install.sh:248-250` re-globs ALL `skills/*` into the receipt regardless of what the sub-installer actually installed.

- **E1 — shared primitive** (`packages/cli/src/shared/install-vendored-skills.sh`): `--list` (emit `name<TAB>one-line-description` via a python3 frontmatter parser, argv-safe, ~70-char truncation); `--only <name,…>` (filter the loop, validate names, warn+skip unknown; default = all, preserving OC callers); echo `INSTALLED: <name>` per skill actually installed.
- **E2 — CC install** (`.../claude-code/install.sh`): skills picker line → `[Y/n/s/b]`, `s` = numbered multi-select from `--list` (`1 3 5`/`all`/`none`, re-prompt on garbage) → `--only`. **Receipt-drift fix:** populate `SKILL_NAMES` from the sub-installer's `INSTALLED:` lines (actual outcome), replacing the re-glob. `--yes` keeps all-skills default.
- **E3 — CC uninstall** (`.../claude-code/uninstall.sh`): skills prompt → `[Y/n/s]`, `s` lists receipt `skillNames` numbered (descriptions via `--list` when repo present) → remove chosen subset; per-name symlink-verify unchanged; rewrite receipt `skillNames` minus removed.
- **E4 — OC fleet** (`.../opencode-fleet/wizard.ts`): agent-required bundled skills stay automatic (deselecting breaks agents). New wizard step after workflows: multiselect of remaining repo skills NOT required (unchecked by default), installed via `copySkillTree`, tracked under `skills-bundled`. Uninstall stays file-driven all-or-nothing per install.
- **E5 — Pi** (`.../pi-agent/install.sh`): if `~/.agents/skills` missing/empty, prompt `Install shared skills now? [y/N]` → `install-vendored-skills.sh --global` (with the `s` selection). Keeps pi's no-copy design; `--yes` skips.
- **E6 — reassessment:** *do now* — the receipt-drift fix + one shared list/select primitive (E1) consumed by CC install, CC uninstall, and pi. *Future work (documented, NOT built):* unify the two receipt schemas (CC flat v1 vs OC zod v2); lifecycle for external/pinned skills (recorded in `requiredSkills.external`, never uninstalled); reconcile the two "extended skills" systems (`install-external-skills.sh` vs `skills-manifest.json` + mjs puller).

**Track E verification:** extend `test_install_lib.sh` (`--list` shape, `--only` filter + unknown-name warn, `INSTALLED:` matches on-disk); scratch-HOME E2E (install `s`-select 3 → 3 symlinks + receipt lists 3 → uninstall `s`-select 1 → that gone, 2 intact, receipt updated); OC wizard dry-run (extras step, selected extra in `skills-bundled`); `bun x tsc --noEmit` + `bash -n`; commits via `hanko--git-seal` in the worktree, merge-back on approval.

---

## Not in this spec

- **Track F (real-session token/cost walkthrough)** — a later *discussion* deliverable (walk an actual local transcript line-by-line to confirm the math), NOT a spec/implementation. Tracked in the working plan, not here.
- **`workflows/` dir usage** — future work (OC-parity gated orchestration), noted above.
