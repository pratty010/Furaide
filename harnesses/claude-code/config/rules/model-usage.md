# rules/model-usage.md

Model tiers and delegation rules for subagent work. Main session model is set manually per session; this file governs subagent selection only.

---

## Model tiers

**Top tier (planning, synthesis, review, architecture):**

- **Opus 4.8** — default top-tier. Architecture decisions, plan review, adversarial review, high-stakes synthesis, novel problem framing.
- **Fable 5** *(manual `/model` only)* — the agent PROPOSES escalating to Fable when a task genuinely exceeds Opus (large migration, multi-day autonomous run, stuck problem); the user opts in (soft gate). Never auto-switches to Fable.

**Workers (implementation):**

- **Haiku 4.5** — well-specified/mechanical work: file scan/parse/extract/format/boilerplate, scout collection, structured output, single-step edits.
- **Sonnet 4.6** *(default for the rest)* — moderate-complexity code changes with clear direction.
- **Sonnet 5** — CLI/terminal-heavy agentic execution specifically. ~30-40% more output tokens/task than Sonnet 4.6 (artificialanalysis.ai) → costs *more* than Opus for reasoning-heavy work despite the lower sticker price. Wins on CLI/terminal-heavy agentic execution (Terminal-Bench); loses on broader SWE benchmarks vs Opus. Narrow use, not a blanket cheap tier.
- **Opus 4.8** — edge case only, a genuinely hard sub-problem hit mid-implementation. Escalate, don't default.

---

## Delegation principles

- **opusplan** — reserve top-tier (Opus) rates for PLANNING; workers execute at their tier. Only pay Opus rates during planning.
- **Delegate outcomes, not steps** — if a task can be handed over in one sentence and the result judged without watching, it's a subagent job.
- **80-90% of tokens should ride cheaper tiers** (Haiku/Sonnet 4.6) across a session; Opus/Fable are the minority.
- **Orchestrator-no-code anti-pattern** — the orchestrating agent must NOT write code/content it could delegate. Forbid this outright.
- **Explore/Plan subagents skip CLAUDE.md + git-status loading** (fast, cheap); other subagent types load both.
- **Subagents can spawn subagents** (e.g. a reviewer spawning one verifier per finding) when the delegation threshold is met.

---

## Delegation thresholds

- **Delegate UP** (subagent for scope): 10+ files to read, 3+ independent subtasks, verification needed before merge.
- **Delegate DOWN** (cheaper model): session model over-qualified for the task at hand.
- **Execute inline**: ≤3 files, sequential with tight data dependencies, current model already right-sized.
- **Parallel** (`Skill(dispatching-parallel-agents)`): zero shared state, fully independent tasks.
- **Sequential** (`Skill(subagent-driven-development)`): task B reads task A's output.
- **Anti-pattern**: subagents for ≤1 file or ≤2 steps unless the point is model-downsizing — cold-start cost dominates at that scale.
