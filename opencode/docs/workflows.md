# Workflows Reference

Not auto-loaded. Pull this when selecting a chain or pattern for a task.

---

## Chains

| Workflow | When to use | When NOT | Common pitfall | Next step needs |
|---|---|---|---|---|
| **Feature / Complex Chain** `brainstorming→writing-plans→pm-spec→coding→oni--red-team-reviewer→verification-before-completion` | New behavior, multi-file, no repro | Single-file, ≤30 LOC | Skipping brainstorm → coding builds wrong thing | Verified test output + diff |
| **Complex Chain** `recon (mikoshi--code-pathfinder) → plan (sojobo--system-strategist PLAN mode) → execute (tsukumogami--code-forgemaster) → review (oni--red-team-reviewer)` | Complex tasks not fitting Feature shape: ambiguous scope, unknown-depth refactors, novel system design. Use when the problem space isn't clear enough to write-plans directly. | Simple known-scope features (use Feature chain); single-file edits | Jumping to tsukumogami--code-forgemaster before sojobo--system-strategist plan is approved → re-work | Approved plan with exact file paths + review pass |
| **Bug-hard** `systematic-debugging→bakeneko--bug-hunter→karakuri--command-runner(tdd)→oni--red-team-reviewer` | Regression, unclear root cause, 3+ theories | Obvious typo/config | Fixing before reproducing | Confirmed repro + root cause hypothesis |
| **Refactor/arch** `improve-codebase-architecture→pm-spec→coding` | Coupling, seam work, testability | Style-only changes | Plan without checking existing patterns | Approved plan with exact file paths |
| **Security audit** `security→oni--red-team-reviewer` | Pre-release, blast-radius change, auth/crypto | Low-stakes CRUD | Skipping threat model → partial audit | Threat model + findings list |
| **Migration** `pm-spec→coding→karakuri--command-runner` | Breaking API, major version bump | Additive dep change | No staged diff → big-bang merge | Staged diff + passing test suite |
| **Design/UI** `brainstorming→tengu--visual-artisan` | Open-ended visual, UX shape unclear | Pixel fix, known spec | Building before validating direction | Approved direction + constraints |
| **Library/docs** `scout` | API syntax, config options, version migration | General research | Relying on training data for versioned APIs | Doc snippets + version pinned |
| **Data/numbers** `financial\|soroban--number-sage` | Calculation, modeling, financial analysis | Narrative-only output | soroban--number-sage for tax/legal → route to legal-compliance | Structured output or chart-ready data |
| **Research** `deep-researcher→yamabiko--source-echo→kagami--truth-mirror→jorogumo--synthesis-weaver` | Multi-source, cited findings needed | Single known source | Raw dump without synthesis pass | Cited findings handed to jorogumo--synthesis-weaver |
| **Deep research** `deep-researcher→scope checkpoint→parallel: yamabiko--source-echo + soroban--number-sage→kagami--truth-mirror→jorogumo--synthesis-weaver→md/html artifacts` | Detailed reports, market/sector/security/finance/legal/technical research, 3+ independent angles | One-source lookup, simple docs lookup | Launching parallel agents before quick scan + user scope checkpoint | Domain brief, Evidence Matrix, Source Manifest, Factcheck Queue, artifact plan |
| **Writing** `writer→kotodama--prose-polisher` | Draft long-form content, writing IS the deliverable | Code output, structured docs | Skipping kotodama--prose-polisher → stylistically inconsistent | Polished draft |
| **Structured docs** `makimono--docs-scribe` | API docs, changelogs, README sections, inline comments | Long-form editorial | Routing editorial writing to makimono--docs-scribe | Sectioned Markdown output |
| **Verify claims** `kagami--truth-mirror` | Numbers, dates, attributions in output | Internal code logic | Flagging opinion as fact | Supported/unsupported/[UNVERIFIED] table |
| **Legal/compliance** `legal-compliance` | Contract review, regulatory mapping, jurisdiction obligations | General policy Q | No jurisdiction → incomplete obligation map | Flagged-issues list or obligation map |
| **Infra/DevOps** `devops-sre→karakuri--command-runner` | Incident response, deployment, runbooks, CI/CD, infra changes | Software feature work | Destructive command without rollback plan | Allowlisted action + rollback |
| **Issues** `to-prd→to-issues→triage` | Plan → tracker tickets | Already-written tickets | PRD without acceptance criteria | Tracer-bullet slices ready for triage |

---

## Patterns

*Start with the simplest pattern. Default to sequential.*

**(1) Sequential / prompt-chaining** — each step consumes the previous step's output. Use for hard data dependencies, draft-review-polish flows, and any chain where step B cannot start without step A's artifact. Most chains above are sequential.

**(2) Parallel / orchestrator-workers** — independent subtasks with no shared state; an orchestrator fans out and collects results. Use when 3+ agents can run concurrently (e.g., yamabiko--source-echo + soroban--number-sage gathering from different sources). Trigger: `Skill(dispatching-parallel-agents)`.

**(3) Evaluator-optimizer** — generate → score → refine loop with a measurable quality signal. Use when the acceptance criterion is quantifiable (test pass rate, factcheck score, lint count). The evaluator must return a structured score the optimizer can act on, not prose feedback.

**(4) Routing** — classify the input first, then dispatch to the appropriate specialist. Use for cheap-vs-expensive model selection (workhorse default, reserved on capability-gap) and for ambiguous requests that could hit multiple chains. The router decision should be one inference call, not a chain; keep the classifier cheap (free/workhorse tier).

---

## Complex Chain — recon → plan → execute → review

Use for complex tasks where the problem space isn't clear enough to write a plan directly. Maps to `workflow-state.mjs` phases.

### Phase sequence

| Phase | Specialist | workflow-state.mjs phase | Gate |
|---|---|---|---|
| Recon | mikoshi--code-pathfinder | `recon` | Scope checkpoint: if ambiguous, needs-clarification before proceeding |
| Plan | sojobo--system-strategist (PLAN mode) | `plan` | Plan approved by user; exact file paths + verification commands required |
| Execute | tsukumogami--code-forgemaster | `execute` | All verification commands pass |
| Review | oni--red-team-reviewer | `review` | No blocking findings; only proceed to `artifact` when oni--red-team-reviewer returns clean |

### workflow-state.mjs phase mapping

```bash
# Recon phase
bun scripts/workflow-state.mjs advance --to recon ...

# Plan approved — advance to execute
bun scripts/workflow-state.mjs advance --to execute ...

# Execute complete — advance to review
bun scripts/workflow-state.mjs advance --to review ...

# Review clean — advance to artifact
bun scripts/workflow-state.mjs advance --to artifact ...
```

### progress.md artifact contract

At each phase boundary, the active specialist writes/updates `progress.md` in the working directory:

```markdown
# progress.md
## Phase: <current>
**Status**: completed | blocked | in-progress
**Artifacts**: list of files written/modified
**Next phase**: <phase-name>
**Blockers**: (if any)
**Residuals**: open questions or follow-ups for the next specialist
```

Agents MUST update progress.md at phase boundaries. The review phase reads progress.md to understand what was built. Never delete progress.md mid-chain.

---

## Deep Research Domain Routing

Deep research must avoid generic jargon by routing sub-questions to domain specialists with narrow briefs.

| Domain | Trigger | Specialist set | Required brief fields |
|---|---|---|---|
| Market / sector | TAM, growth, demand, trends, industry structure | deep-researcher + soroban--number-sage | geography, timeframe, product scope, buyer segments |
| Competitors | company lists, positioning, M&A, channels, exports | deep-researcher | company categories, evidence types, time horizon |
| Finance / economics | margins, pricing, capex, unit economics, working capital | financial + soroban--number-sage if calculations | currency, period, channel model, assumptions |
| Regulatory / compliance | rules, licenses, procurement standards, privacy, healthcare, finance regulation | legal-compliance | jurisdiction, regime, product/system scope |
| Legal | contracts, liability, IP, legal risk | legal-compliance | jurisdiction, document/topic, not-legal-advice constraint |
| Security | threat landscape, controls, vulnerabilities, security audit | security or deep-researcher | assets, threat model, timeframe, source priority |
| Technical / IT | architecture landscape, vendor/API/tool comparisons, feasibility | scout + deep-researcher | technologies, versions, evaluation criteria |
| Academic / scientific | literature reviews, papers, methods, evidence quality | deep-researcher + kagami--truth-mirror | research question, date range, inclusion criteria |
| Data / BI | dashboard-ready tables, chartable datasets, reporting | soroban--number-sage | metrics, dimensions, data source, visualization target |

Deep-research artifacts:

- `research/<topic>/source-manifest.md`
- `research/<topic>/factcheck.md`
- `research/<topic>/report.md`
- `research/<topic>/report.html` when visual review helps

---

## v9.1 Specialist Workflow Contract

### State contract

Every specialist calls `scripts/workflow-state.mjs` at phase boundaries. Never write `state.json` directly.

```bash
# Init at session start
bun scripts/workflow-state.mjs init \
  --cwd $CWD --workflow $WORKFLOW_ID \
  --specialist <name> --phase <first-phase> --session $SESSION_ID

# Advance at each phase boundary
bun scripts/workflow-state.mjs advance \
  --cwd $CWD --workflow $WORKFLOW_ID \
  --to <next-phase> --expected-rev <N> \
  --session $SESSION_ID --caller <specialist-name>

# Record gate result (warn verdict)
bun scripts/workflow-state.mjs gate \
  --cwd $CWD --workflow $WORKFLOW_ID \
  --gate <gate-name> --verdict warn --max-iterations <N> \
  --session $SESSION_ID --caller <specialist-name>
```

### Gate severity model

| Verdict | Effect |
|---|---|
| `ok` | Proceed to next phase |
| `warn` | Record via `workflow-state.mjs gate`; continue (bounded by `max_ralph_iterations`) |
| `warn-unresolved` | Advance blocked; surface to user |
| `critical` | gate-enforcer plugin blocks bash/edit/deliver/task; specialist must surface error |

### Subagent dispatch depth (A3=GO)

T1 subagents may dispatch T2 leaf-workers (azukiarai--data-sifter, henge--format-shifter) via `task`. T1 → T2 is the maximum depth. No subagent may dispatch another T1 or a specialist.

### Kill/resume

If a session is killed mid-workflow: the lock expires (stale-steal after TTL); a new session can acquire the lock and resume from the last committed `state.json` snapshot. The journal (`journal.ndjson`) records every op; use it to audit partial progress.
