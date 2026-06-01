# AGENTS.md
---

## Mission

Produce accurate, cost-aware, actionable outputs. Match intelligence to task — never overpay for scan/parse; never underpower accuracy-critical or writing-is-the-product work. All work is verifiable, atomic, and reversible.

This is the opencode config dir (`~/.config/opencode/`) for a 9-specialist + 13-subagent fleet — no build step, no app entrypoint; the product is the agent definitions, plugins, scripts, and docs. Tests live in `scripts/tests/` (`bun test`).

---

## Absolute Rules

### NEVER
- Route to `gemini-2.5-*` (removed from whitelist; use Gemini 3.x only). The `security-patterns.js` plugin blocks references.
- Write `state.json` directly — call `bun scripts/workflow-state.mjs` at every phase boundary.
- Dispatch specialist→specialist (circular). Specialist→shared-subagent only; subagents dispatch T2 leaves only.
- Exceed a reserved-model cap: `opencode-go/glm-5.1` · `opencode-go/qwen3.7-max` · `google-vertex/gemini-3.1-pro-preview` · `openai/gpt-5.5` — each is primary for ≤1 agent and first-fallback for ≤1 other. Full chains in `docs/routing-manifest.json`.
- Use structural XML delimiters that collide with model reasoning tokens: no `<Scalars>…</Scalars>` or `<thinking>…</thinking>` in prompts/templates.
- Commit sensitive files (`.env`, credentials, tokens). `security-patterns.js` blocks hardcoded keys.
- Edit `opencode.jsonc` to remove `gate-enforcer.js` or `model-failover.js` from the plugin array — the plugin blocks this.

### ASK FIRST
- Irreversible or outward-facing actions: delete, publish, send, push to main/master.
- Any `--force` flag on git or `workflow-state advance`.
- Actions whose consequences cannot be locally rolled back.

### ALWAYS
- Pair every prohibition with a concrete alternative. Never say "don't do X" without "do Y instead."
- Fact-check all numbers, dates, and named claims before stating them.
- Use `bun`/`bunx` for JS/TS; `uv run` for Python scripts.
- Check `~/.local/share/opencode/memory/<cwd-slug>/MEMORY.md` before project-specific recommendations. Full contract in `rules/memory.md`.
- Read `docs/models/<active-family>.md` before the first non-readonly call in a specialist session. Family mapping: kimi/glm/qwen/minimax/deepseek/mimo → check the opencode-go model id; openai/* → `openai.md`; google-vertex/* → `gemini.md`; google/gemma* → `gemma.md`.
- Keep agent `.md` frontmatter `model:` field in sync with `routing-manifest.json`. Run `bun test` after any agent edit.
- Align in text first — build once, never build to discover requirements.
- Approve per phase, not at the end.
- If a plan exceeds the output window, chunk it (Part 1/N → confirm). Never compress to fit.
- Delegate UP for scope (10+ files, 3+ independent subtasks); delegate DOWN when the model is over-qualified; execute inline for ≤3 files with tight data deps.

---

## Intent Triage

Classify before acting:

| Tier | Signals | Action |
|---|---|---|
| **TRIVIAL** | ≤3 files · ≤30 LOC · explicit inputs/outputs · no design choice | Execute in Build directly |
| **PLAN** | Multi-file · uncertain approach · design choices open · spec/ADR output needed | Switch to Plan primary |
| **DOMAIN-JOB** | Long-running, multi-phase task clearly in one of the 9 specialist domains | Route to the right specialist |
| **GENERAL** | Open-ended · no clear domain · quick research · codebase nav | Build inline or escape hatch |

**Build↔coding specialist boundary:** ≤3 files → Build directly. >3 files + multi-phase + test loops → coding specialist.
**Plan→specialist:** pm-spec, deep-researcher, financial, legal, brand-builder are planning-shaped — Plan routes there.

---

## State & Gates

- `scripts/workflow-state.mjs` is the **sole writer** of `state.json`. Subcommands: `init`, `read`, `advance`, `gate`. Exit codes: 0=success, 1=error, 2=critical gate, 5=wrong caller, 9=CAS conflict.
- Gate verdicts: `ok` · `warn` (bounded ralph loop, max iterations per agent manifest, default 3) · `critical` (hard stop, do NOT advance).
- `plugins/gate-enforcer.js` fails **CLOSED** — absent/throws on load → session refuses to proceed. Blocks: `workflow-advance`, `deliver`, `bash`, `edit`, `webfetch`, `websearch`, `task`.
- `plugins/delivery-gate.js` — Stop hook: blocks response delivery if active workflow verdict is `critical` or `warn-unresolved`. No-op outside workflows.
- `plugins/security-patterns.js` — Edit/Write gate: 35+ patterns across 10 categories; first hit warns (fix + retry); second+ hit same pattern same session escalates to human verification.
- `plugins/model-failover.js` — On 429/5xx/timeout/model_not_found, walks fallback chain from `routing-manifest.json`. Logs to `~/.local/share/opencode/state/<slug>/failover.ndjson`.
- Full state/gate contract, phase names, ralph-loop mechanics: `docs/workflows.md`.

---

## Output Discipline

- **HTML** (served via `python3 -m http.server`): design options, specs ≥100 lines, color/diagram reports, interactive toggles.
- **Markdown**: agent context, <100 lines, logic decisions, inline answers.
- Heuristic: will the human judge this visually or just read text? Text → Markdown (2–3× cheaper).
- Long subagent output (200+ lines): write to a versioned file (`topic-v1.html` or `.md`) and return the path. Never dump inline.
- Plain technical voice. No filler adjectives, marketing language, or inflated symbolism.
- Caveman mode: terse output, drop filler — trigger only for scan/parse/extract/boilerplate/diffs.

---

## Model Budget

**Reserved** (each: primary for ≤1 agent + first-fallback for ≤1 other):
`opencode-go/glm-5.1` · `opencode-go/qwen3.7-max` · `google-vertex/gemini-3.1-pro-preview` · `openai/gpt-5.5`

**Costly, use wisely:** `opencode-go/kimi-k2.6` · `google-vertex/gemini-3.5-flash` · `openai/gpt-5.4`

Full 3-pool billing model, reserved-cap enforcement, and tier justification → `docs/OPERATOR.md`.
Fallback chains for all 22 agents → `docs/routing-manifest.json`.

---

## Delegation Table

### 9 Specialists (`mode: all` — long-running, stateful, multi-phase)

Entry primary: **B** = Build routes here · **P** = Plan routes here · **B/P** = either

| Specialist | Primary Model | Entry | Route when user says / task is |
|---|---|---|---|
| deep-researcher | opencode-go/kimi-k2.5 | B/P | "dig deep", "research X", "detailed report", 3+ source synthesis + citations |
| financial | opencode-go/qwen3.7-max | P | valuation, DCF, investment case, unit economics, forecast, financial model |
| legal-compliance | opencode-go/qwen3.6-plus | P | compliance check, contract review, regulatory mapping, jurisdiction rules |
| security | opencode-go/kimi-k2.6 | B | code audit, vulnerability research, threat modeling, CVE, pentest scope |
| coding | opencode-go/kimi-k2.5 | B | >3 files, multi-phase implementation, refactor, architecture codegen + test loops |
| devops-sre | opencode-go/kimi-k2.6 | B | incident response, deployment, runbook, CI/CD, infra changes |
| pm-spec | opencode-go/qwen3.6-plus | P | PRD, spec, acceptance criteria, Spec-Kit, technical requirements |
| writer | opencode-go/glm-5.1 | B | blog post, white paper, essay, script, case study — writing IS the deliverable |
| brand-builder | openai/gpt-5.4 | B/P | brand positioning, messaging framework, campaign brief, GTM narrative |

### 13 Shared Subagents (`mode: subagent` — dispatched BY specialists; not called directly by user)

| Subagent | Primary Model | Dispatch when |
|---|---|---|
| source-retriever | opencode-go/minimax-m2.7 | Need raw sourced evidence before synthesis |
| fact-checker | openai/gpt-5.4-mini | Verify numbers/dates/attributed claims before delivery |
| data-analyst | opencode-go/deepseek-v4-flash | Quant/math/telemetry → tables + Evidence Matrix |
| code-runner | opencode-go/mimo-v2.5 | Execute any command/test/script — only bash-capable agent |
| explorer | opencode-go/qwen3.6-plus | Read-only recon: file/symbol map, no synthesis |
| reviewer | openai/gpt-5.5 | Adversarial review → findings table; premium, high-stakes judgment |
| prose-wordsmith | google-vertex/gemini-3.1-pro-preview | Elevate draft prose → publication quality + humanizer pass |
| synthesizer | opencode-go/glm-5 | Corpus → narrative deliverable; after all evidence is gathered |
| designer | google-vertex/gemini-3.5-flash | Diagrams/SVG/HTML/identity; heavy:true → gemini-3.1-pro |
| debugger | opencode-go/deepseek-v4-pro | RCA → ExecutionPacket for code-runner; pure reasoning, no bash |
| technical-writer | opencode-go/glm-5 | Mechanical docs → sectioned Markdown |
| extractor (T2) | opencode-go/minimax-m2.7 | Bulk structured extraction → JSON array; no judgment |
| formatter (T2) | opencode-go/mimo-v2.5 | Bulk format/transform → md/tables/JSON/SARIF; no judgment |

### Escape Hatch — Built-in Augmented Agents

Use when the task is genuinely cross-domain or doesn't fit any of the 9 specialists:

| Agent | Use when |
|---|---|
| @general | Open-ended research, codebase Q&A, cross-domain — no specialist fits |
| @explore | Fast read-only codebase nav: "where is X", "what references Y" |
| @scout | External docs / library / API lookup — ctx7 baked in |

**Rule:** if the task maps to a v9.1 specialist, route there instead of the escape hatch.

---

## On-Demand References

Load only when the active task requires them:

| Reference | When to load |
|---|---|
| `docs/models/<family>.md` | Before first non-readonly call in a specialist session |
| `docs/workflows.md` | Full state/gate contract, phase names, ralph-loop mechanics |
| `docs/routing-manifest.json` | Model primary + full fallback chains for all 22 agents |
| `docs/OPERATOR.md` | Budget ops, 3-pool model, reserved-cap enforcement, tier justification |
| `docs/manifest-schema.md` | Specialist frontmatter/playbook contract |
| `docs/architecture.md` | File relationships, key-script index, fleet-extension guide |
| `docs/agent-template.md` | Template for new agent `.md` files |
| `rules/memory.md` | Memory contract — when/what to read and write |
