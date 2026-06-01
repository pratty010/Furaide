# opencode Configuration — v9.1 Agent Fleet

A 9-specialist + 13-subagent + 3 escape-hatch orchestration system for opencode. `AGENTS.md` classifies every request, routes to the right agent, and each agent self-selects its model via YAML frontmatter. Four fail-closed gate plugins enforce safety and cost discipline.

## Architecture

```
User request → AGENTS.md (intent triage) → specialist or escape-hatch
                                          ↓
                                    specialist dispatches subagents (T1 → T2, max depth)
                                          ↓
                                    subagents return results (no question — needs-clarification only)
```

**Three agent classes:**

| Class | Mode | Count | Dispatch |
|---|---|---|---|
| Specialist | `all` (long-running, stateful, multi-phase) | 9 | Routed by AGENTS.md intent triage |
| Shared subagent | `subagent` (dispatched by specialists) | 13 | Called by specialists; never by user |
| Escape-hatch | Built-in augmented agents | 3 | @general, @explore, @scout — when no specialist fits |

**Three billing pools:**

| Pool | Models | Cap |
|---|---|---|
| OpenAI flat-sub | gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex | Per OpenAI agreement |
| Gemini credit | gemini-3.1-pro-preview, gemini-3.5-flash, gemini-3-flash-preview, gemini-3.1-flash-lite | ~$300 credit |
| opencode-go | kimi-k2.5, kimi-k2.6, qwen3.7-max, qwen3.6-plus, glm-5.1, glm-5, deepseek-v4-pro, deepseek-v4-flash, minimax-m2.7, mimo-v2.5, mimo-v2.5-pro | ~$60/mo |

**Four reserved models** (primary ≤1 agent + first-fallback ≤1 other): `opencode-go/glm-5.1`, `opencode-go/qwen3.7-max`, `google-vertex/gemini-3.1-pro-preview`, `openai/gpt-5.5`

## 9 Specialists

| Specialist | Primary Model | Route when |
|---|---|---|
| deep-researcher | opencode-go/kimi-k2.5 | "dig deep", research, 3+ source synthesis + citations |
| financial | opencode-go/qwen3.7-max | valuation, DCF, financial model, unit economics |
| legal-compliance | opencode-go/qwen3.6-plus | compliance check, contract review, regulatory mapping |
| security | opencode-go/kimi-k2.6 | code audit, vulnerability research, threat modeling, CVE |
| coding | opencode-go/kimi-k2.5 | >3 files, multi-phase implementation, refactor + test loops |
| devops-sre | opencode-go/kimi-k2.6 | incident response, deployment, CI/CD, infra changes |
| pm-spec | opencode-go/qwen3.6-plus | PRD, spec, acceptance criteria, technical requirements |
| writer | opencode-go/glm-5.1 | blog post, white paper, essay — writing IS the deliverable |
| brand-builder | openai/gpt-5.4 | brand positioning, messaging framework, GTM narrative |

Full fallback chains: `docs/routing-manifest.json`. Tier justification: `docs/OPERATOR.md`.

## 13 Subagents

| Subagent | Primary Model | Dispatch when |
|---|---|---|
| source-retriever | opencode-go/minimax-m2.7 | Need raw sourced evidence before synthesis |
| fact-checker | openai/gpt-5.4-mini | Verify numbers/dates/attributed claims before delivery |
| data-analyst | opencode-go/deepseek-v4-flash | Quant/math/telemetry → tables + Evidence Matrix |
| code-runner | opencode-go/mimo-v2.5 | Execute any command/test/script — only bash-capable agent |
| explorer | opencode-go/qwen3.6-plus | Read-only recon: file/symbol map, no synthesis |
| reviewer | openai/gpt-5.5 | Adversarial review → findings table; premium, high-stakes |
| prose-wordsmith | google-vertex/gemini-3.1-pro-preview | Elevate draft prose → publication quality + humanizer pass |
| synthesizer | opencode-go/glm-5 | Corpus → narrative deliverable; after all evidence gathered |
| designer | google-vertex/gemini-3.5-flash | Diagrams/SVG/HTML/identity; heavy:true → gemini-3.1-pro |
| debugger | opencode-go/deepseek-v4-pro | RCA → ExecutionPacket for code-runner; pure reasoning, no bash |
| technical-writer | opencode-go/glm-5 | Mechanical docs → sectioned Markdown |
| extractor (T2) | opencode-go/minimax-m2.7 | Bulk structured extraction → JSON array; no judgment |
| formatter (T2) | opencode-go/mimo-v2.5 | Bulk format/transform → md/tables/JSON/SARIF; no judgment |

## 3 Escape-Hatch Agents

| Agent | Use when |
|---|---|
| @general | Open-ended research, codebase Q&A, cross-domain — no specialist fits |
| @explore | Fast read-only codebase nav: "where is X", "what references Y" |
| @scout | External docs / library / API lookup — ctx7 baked in |

Rule: if the task maps to a v9.1 specialist, route there instead of escape-hatch.

## File Layout

```
~/.config/opencode/
├── AGENTS.md              # Primary routing — auto-loaded every session
├── README.md              # This file
├── opencode.jsonc         # Provider/model whitelist + permissions + plugin list
├── tui.jsonc              # Keyboard bindings (leader: ctrl+x)
├── package.json           # Single dep: @opencode-ai/plugin@1.4.3
├── bun.lock
├── agents/                # Agent definitions (one .md per role, YAML frontmatter)
│   ├── general.md         # Escape-hatch: broad research & Q&A
│   ├── deep-researcher.md # Specialist: multi-domain research orchestrator
│   ├── financial.md       # Specialist: financial modeling & valuation
│   ├── legal-compliance.md # Specialist: contracts, compliance, regulatory
│   ├── security.md        # Specialist: vulnerability research & audit
│   ├── coding.md          # Specialist: multi-file implementation (>3 files)
│   ├── devops-sre.md      # Specialist: incident response, CI/CD, infra
│   ├── pm-spec.md         # Specialist: PRD, specs, acceptance criteria
│   ├── writer.md          # Specialist: long-form content production
│   ├── brand-builder.md   # Specialist: brand positioning & GTM narrative
│   ├── source-retriever.md # Subagent: web source fetching & scoring
│   ├── fact-checker.md    # Subagent: claim verification
│   ├── data-analyst.md    # Subagent: quant/math/telemetry → tables
│   ├── code-runner.md     # Subagent: bash execution (only bash-capable agent)
│   ├── explorer.md        # Subagent: read-only codebase recon
│   ├── reviewer.md        # Subagent: adversarial code review
│   ├── prose-wordsmith.md # Subagent: prose polish & humanizer
│   ├── synthesizer.md     # Subagent: corpus → narrative synthesis
│   ├── designer.md        # Subagent: diagrams, SVG, HTML, identity
│   ├── debugger.md        # Subagent: root-cause analysis (no bash)
│   ├── technical-writer.md # Subagent: mechanical docs → sectioned Markdown
│   ├── extractor.md       # Subagent (T2): bulk structured extraction → JSON
│   ├── formatter.md       # Subagent (T2): format/transform → md/tables/JSON/SARIF
│   ├── scout.md           # Escape-hatch: external docs/API lookup (ctx7)
│   └── explore.md         # Escape-hatch: fast read-only codebase nav
├── plugins/               # Fail-closed gate plugins
│   ├── gate-enforcer.js   # Blocks mutating tools on critical/warn-unresolved verdicts
│   ├── delivery-gate.js   # Blocks response delivery on unresolved verdicts
│   ├── security-patterns.js # Edit/write gate: 35+ security patterns
│   └── model-failover.js  # Walks manifest fallback chain on provider errors
├── scripts/               # Utility scripts for agents & gates
│   ├── workflow-state.mjs # Sole writer of state.json (init/read/advance/gate)
│   ├── citation-verify.mjs # Claim source verification gate
│   ├── voice-check.mjs    # Voice profile overlap gate
│   ├── humanize-check.mjs # AI-tell density gate
│   ├── security-severity.mjs # Vulnerability scoring (0-15)
│   ├── sql-safety-check.mjs # SQL classification & safety gate
│   ├── ctx7-docs.mjs      # Library doc fetcher (falls back to bunx)
│   ├── memory-path.mjs    # CWD-to-slug → MEMORY.md validator
│   ├── state-path.mjs     # Workflow state path computation
│   ├── verify-run.mjs     # Verification plan executor
│   ├── playbook-check.mjs # Obligation-to-playbook mapping validator
│   ├── action-allowlist.mjs # Action allowlist + rollback gate
│   ├── lib/
│   │   ├── state-lock.mjs # File-based locking for workflow state (CAS)
│   │   └── history-serializer.mjs
│   ├── canaries/          # Model/agent health probes
│   │   ├── coderunner-toolcall.mjs
│   │   ├── history-roundtrip.mjs
│   │   ├── model-probe.mjs
│   │   ├── RESULTS.md
│   │   └── t2-depth.mjs
│   └── tests/             # bun test suites
│       ├── agents-match-manifest.test.mjs
│       ├── crash-safety.test.mjs
│       ├── delivery-gate.test.mjs
│       ├── gate-enforcer.test.mjs
│       ├── gate-scripts.test.mjs
│       ├── history-serializer.test.mjs
│       ├── humanize-check.test.mjs
│       ├── model-failover.test.mjs
│       ├── routing-manifest.test.mjs
│       ├── security-patterns.test.mjs
│       ├── state-lock.test.mjs
│       ├── state-path.test.mjs
│       └── workflow-state.test.mjs
├── rules/
│   └── memory.md          # Auto-memory contract
└── docs/
    ├── OPERATOR.md        # Full model map, tier discipline, reserve justification
    ├── workflows.md       # Common chains, patterns, specialist workflow contract
    ├── routing-manifest.json # Canonical model routing (primary + fallback chains)
    ├── manifest-schema.md # Specialist frontmatter/playbook schema
    ├── agent-template.md  # Template for new agent .md files
    ├── models/            # Per-family prompting nuances
    │   ├── openai.md      # GPT-5.x (imperative, reasoning_effort)
    │   ├── gemini.md      # Gemini 3.x (XML delimiters, temp 1.0)
    │   ├── gemma.md       # Gemma 4 (control tokens, local)
    │   ├── glm.md         # GLM-5.x (thinking toggle, temp rules)
    │   ├── kimi.md        # Kimi K2.x
    │   ├── qwen.md        # Qwen 3.x
    │   ├── deepseek.md    # DeepSeek V4
    │   ├── minimax.md     # MiniMax M2.x
    │   └── opensource.md  # Free models (big-pickle, deepseek-free, etc.)
    └── superpowers/       # Superpowers skill plans & specs
        ├── plans/
        └── specs/
```

## State & Gate System

**Workflow state:** `scripts/workflow-state.mjs` is the sole writer of `state.json`. Subcommands: `init`, `read`, `advance`, `gate`. Exit codes: 0=success, 1=error, 2=critical gate, 5=wrong caller, 9=CAS conflict. Never write `state.json` directly.

**Gate plugins** (all fail-closed — if a plugin can't load, the session refuses to proceed):

| Plugin | Purpose |
|---|---|
| `gate-enforcer.js` | Blocks mutating tools (`workflow-advance`, `deliver`, `bash`, `edit`, `webfetch`, `websearch`, `task`) on critical/warn-unresolved verdicts |
| `delivery-gate.js` | Stop hook: blocks response delivery if active workflow verdict is `critical` or `warn-unresolved` |
| `security-patterns.js` | Edit/write gate: 35+ patterns across 10 categories; first hit warns, second+ hit same pattern same session escalates |
| `model-failover.js` | On 429/5xx/timeout/model_not_found, walks fallback chain from `routing-manifest.json` |

## Key Design Decisions

- **No Gemini 2.x auto-routing** — `gemini-2.5-*` removed from whitelist entirely; `security-patterns.js` blocks references
- **Cheapest agent first** — free tier → workhorse → intel only on cascade-risk
- **Subagents deny `question`** — only the primary may ask the user; subagents return `needs-clarification: <topic>`
- **Specialist dispatch depth: T1 → T2 only** — no specialist→specialist or subagent→T1
- **Memory** — per-project at `~/.local/share/opencode/memory/<cwd-slug>/MEMORY.md`
- **Reserved model caps** — each reserved model is primary for ≤1 agent and first-fallback for ≤1 other
- **Gate enforcement: fail-closed** — if gate-enforcer can't read verdict, session refuses to proceed

## Setup

1. Install [opencode](https://opencode.ai)
2. Clone this config to `~/.config/opencode/`
3. Install plugin dependency: `bun install`
4. Restart opencode

Model providers (OpenAI, Google Vertex, opencode-go) are configured in `opencode.jsonc` — add your API keys via provider auth.

## Testing

Run `bun test` from the config directory. Key test suites verify:

- Agent model fields match `routing-manifest.json`
- Workflow state init/advance/gate semantics
- Gate enforcer and delivery gate behavior
- Security pattern detection
- Model failover chain resolution
- Routing manifest structural validity