# Workflows Reference

Runtime contract for the v2 OpenCode harness.

---

## Runtime Contract

`scripts/workflow-state.mjs` is the sole writer of workflow runtime state.

- Commands: `init`, `read`, `advance`, `gate`
- Exit codes: `0` success, `1` error, `2` critical gate, `5` caller not in the workflow's allowed-callers set, `6` unresolved critical gate verdict blocking a terminal/delivery transition, `9` CAS conflict
- Workflow IDs: `wf1`, `wf2`, `wf3`, `wf4`, `wf5`
- Invalid transitions are rejected.
- Ownership is DAG-based, not single-owner-for-life: `state.specialist` (set at `init`) is an audit/display field only — any agent documented as owning at least one state in that workflow (per the spec's state-ownership tables) may call `advance`/`gate` on that workflow instance, not only the agent that called `init`. `workflow-state.mjs` hardcodes a per-workflow allowed-callers table (`WORKFLOW_ALLOWED_CALLERS`) derived from those tables; a caller outside that set is rejected with exit `5`.
- Gate loop caps are enforced by the state engine, not by prompt text alone.
- **Delivery gate**: `cmdAdvance` blocks entry into each workflow's terminal/delivery-adjacent state (`FINISH_READY` for WF1-WF3, `DELIVERY` for WF4/WF5 — see `WORKFLOW_TERMINAL_STATES` in `workflow-state.mjs`) while any gate verdict recorded on that workflow instance is still `critical` (exit `6`). A later `gate` call for the same gate name that records a different verdict (e.g. `escalate`) resolves it. This supersedes the retired `plugins/gates/nurikabe.js` plugin hook, which bound to a `deliver` tool that never existed in OpenCode's tool set and never fired in a real session — `nurikabe.js` is kept in the repo with a `SUPERSEDED` header for institutional memory but is no longer registered in `config/opencode.jsonc`.

Canonical command shapes:

```bash
bun scripts/workflow-state.mjs init \
  --cwd "$CWD" --workflow wf1 \
  --specialist <owner> --phase <initial-phase> --session <session-id>

bun scripts/workflow-state.mjs advance \
  --cwd "$CWD" --workflow wf1 \
  --to <next-phase> --expected-rev <n> \
  --session <session-id> --caller <owner>

bun scripts/workflow-state.mjs gate \
  --cwd "$CWD" --workflow wf1 \
  --gate <gate-name> --verdict <ok|warn|critical> \
  --max-iterations <n> --session <session-id> --caller <owner>
```

---

## Shared Rules

### `BLOCKED_CLARIFY` resume rule

When the user's answer changes scope or plan, follow the explicit `BLOCKED_CLARIFY` exits drawn in the state machine. When the answer only removes an operational blocker — for example a missing tool, credential, or environment dependency — resume at the state that raised the block instead of jumping back to an earlier draft state.

### Loop caps

| Loop | Cap | Applies to |
|---|---:|---|
| Verify/fix loop | 3 rounds | WF1, WF2, WF3 |
| Review loop | 2 blocked rounds | WF1, WF2, WF3, WF5 |
| Debug hypothesis/fix loop | 3 rounds, then `ARCHITECTURE_QUESTION` | WF2 |
| Research gap loop | 2 rounds, then synthesize with downgraded confidence | WF4 |
| Finance gap loop | 2 rounds, then synthesize with downgraded confidence | WF5 |
| Finance model validation loop | 3 rounds | WF5 |

### Closing-prompt consolidation

`LEARN_OFFER` and `TMP_CLEANUP_OFFER` remain separate tracked states, but present them as one closing prompt. WF5 applies the same rule to `BANK_UPDATE_DECISION`, `PERSISTENCE_DECISION`, `LEARN_OFFER`, and `TMP_CLEANUP_OFFER`: one consolidated closing card, not a chain of trivial prompts.

---

## Shared Artifact Ledger

### Temporary workflow artifacts

| Artifact | Path |
|---|---|
| Workflow tmp root | `.opencode/tmp/<workflow-id>/` |
| Scope notes | `.opencode/tmp/<workflow-id>/scope.md` |
| Recon packet | `.opencode/tmp/<workflow-id>/recon-packet.md` |
| Scout packet | `.opencode/tmp/<workflow-id>/scout-packet.md` |
| Security triage | `.opencode/tmp/<workflow-id>/security-triage.md` |
| Implementation analysis | `.opencode/tmp/<workflow-id>/implementation-analysis.md` |
| Worker briefs | `.opencode/tmp/<workflow-id>/worker-briefs/*.md` |
| Worker results | `.opencode/tmp/<workflow-id>/worker-results/*.md` |
| Verification manifest | `.opencode/tmp/<workflow-id>/verify.json` |
| Verification output | `.opencode/tmp/<workflow-id>/verification-output.json` |
| Verification summary | `.opencode/tmp/<workflow-id>/verification-summary.md` |
| Review findings | `.opencode/tmp/<workflow-id>/review-findings.md` |
| Fix analysis | `.opencode/tmp/<workflow-id>/fix-analysis.md` |
| Finish summary | `.opencode/tmp/<workflow-id>/finish-summary.md` |
| WF3 tooling readiness | `.opencode/tmp/<workflow-id>/security-tooling-readiness.md` |
| WF4 evidence matrix | `.opencode/tmp/<workflow-id>/evidence-matrix.md` |
| WF4 citation verification | `.opencode/tmp/<workflow-id>/citation-verification.md` |
| WF5 source manifest | `.opencode/tmp/<workflow-id>/source-manifest.json` |
| WF5 artifact audit | `.opencode/tmp/<workflow-id>/artifact-audit.json` |
| WF5 freshness ledger | `.opencode/tmp/<workflow-id>/freshness-ledger.json` |
| WF5 extraction ledger | `.opencode/tmp/<workflow-id>/extraction-ledger.json` |
| WF5 assumption register | `.opencode/tmp/<workflow-id>/assumption-register.json` |
| WF5 valuation input | `.opencode/tmp/<workflow-id>/valuation-input.json` |
| WF5 model validation report | `.opencode/tmp/<workflow-id>/model-validation.json` |
| WF5 module-run registry | `.opencode/tmp/<workflow-id>/module-runs.json` |

### Durable artifacts

| Artifact | Path |
|---|---|
| Spec doc | `docs/superpowers/specs/<topic>-design.md` |
| Plan file | `docs/superpowers/plans/<topic>-plan.md` |
| Learning file | `docs/learnings/<topic>-learning.md` |
| RCA file | `docs/postmortems/<topic>-rca.md` |
| Security file | `docs/security/<topic>-security.md` |
| Verification file | `docs/verification/<topic>-verification.md` |
| Finance artifact registry | `research/financial/<subject-slug>/artifact-registry.json` |
| Finance bank manifest | `research/financial/<subject-slug>/bank-manifest.json` |
| Bank update log | `research/financial/<subject-slug>/bank-updates.jsonl` |
| Source registry | `research/financial/<subject-slug>/source-registry.md` |
| Data manifest | `research/financial/<subject-slug>/data-manifest.json` |
| Durable freshness ledger | `research/financial/<subject-slug>/freshness-ledger.json` |
| Durable extraction ledger | `research/financial/<subject-slug>/extraction-ledger.json` |
| Assumptions register | `research/financial/<subject-slug>/assumptions-register.yaml` |
| Model inputs | `research/financial/<subject-slug>/model-inputs.json` |
| Model output | `research/financial/<subject-slug>/model-output.json` |
| Citation verification | `research/financial/<subject-slug>/citation-verification.md` |
| Research memo | `research/financial/<subject-slug>/research-memo.md` |
| Valuation memo | `research/financial/<subject-slug>/valuation-memo.md` |
| Evidence appendix | `research/financial/<subject-slug>/evidence-appendix.md` |
| Thesis history | `research/financial/<subject-slug>/thesis-history.md` |
| Finance knowledge index | `docs/knowledge/finance/index.md` |
| Finance reusable knowledge | `docs/knowledge/finance/<pattern-or-subject>.md` |

---

## Workflow #1 — Non-Trivial Multi-File Feature

Trigger: user asks for a non-trivial feature, refactor, or implementation crossing multiple files.

Owner route: `kantoku--workflow-director` -> `kyakuhon--spec-planner` -> `tsukumogami--code-forgemaster` / `general` / `kagami--verifier` as needed.

```mermaid
stateDiagram-v2
    [*] --> RECEIVED

    RECEIVED --> ROUTED: prompt accepted
    ROUTED --> DISCUSSION_MEMORY_READ: non-trivial feature/refactor
    ROUTED --> SIMPLE_IMPLEMENT: trivial bounded task
    ROUTED --> BLOCKED_CLARIFY: ambiguous intent

    DISCUSSION_MEMORY_READ --> SPEC_DRAFT: reusable context loaded
    SPEC_DRAFT --> USER_SCOPE_REVIEW: draft scope ready
    USER_SCOPE_REVIEW --> SPEC_DRAFT: changes requested
    USER_SCOPE_REVIEW --> RECON: scope approved

    RECON --> PLAN_DRAFT: recon complete
    RECON --> BLOCKED_CLARIFY: blocking unknowns
    RECON --> SPEC_DRAFT: findings change scope

    PLAN_DRAFT --> USER_PLAN_REVIEW: plan ready
    USER_PLAN_REVIEW --> PLAN_DRAFT: changes requested
    USER_PLAN_REVIEW --> IMPLEMENT_ANALYSIS: plan approved

    IMPLEMENT_ANALYSIS --> SIMPLE_IMPLEMENT: bounded unit set
    IMPLEMENT_ANALYSIS --> COMPLEX_IMPLEMENT: complex unit set
    IMPLEMENT_ANALYSIS --> PARALLEL_IMPLEMENT: independent unit groups
    IMPLEMENT_ANALYSIS --> SEQUENTIAL_IMPLEMENT: dependency chain

    PARALLEL_IMPLEMENT --> VERIFY_PREP: all groups merged
    SEQUENTIAL_IMPLEMENT --> VERIFY_PREP: final unit complete
    SIMPLE_IMPLEMENT --> VERIFY_PREP: code complete
    COMPLEX_IMPLEMENT --> VERIFY_PREP: worker streams merged
    COMPLEX_IMPLEMENT --> BLOCKED_CLARIFY: conflict or ambiguity

    VERIFY_PREP --> VERIFY: verify.json ready
    VERIFY --> REVIEW: verification ok
    VERIFY --> FIX_ANALYSIS: verification failed
    VERIFY --> BLOCKED_CLARIFY: cannot verify
    VERIFY --> BLOCKED_CLARIFY: 3 failed verify/fix loops

    REVIEW --> FIX_ANALYSIS: fixes required
    REVIEW --> CHECKPOINT_GIT: no blocking findings
    REVIEW --> BLOCKED_CLARIFY: 2 blocked review rounds

    FIX_ANALYSIS --> SIMPLE_IMPLEMENT: bounded fix unit set
    FIX_ANALYSIS --> COMPLEX_IMPLEMENT: complex fix unit set
    FIX_ANALYSIS --> PARALLEL_IMPLEMENT: independent fix groups
    FIX_ANALYSIS --> SEQUENTIAL_IMPLEMENT: dependency fix chain

    CHECKPOINT_GIT --> FINISH_READY: checkpoint committed or skipped by user
    FINISH_READY --> GIT_HANDOFF: user approves finish action
    GIT_HANDOFF --> LEARN_OFFER: git handoff complete or skipped

    LEARN_OFFER --> LEARN: user wants distillation
    LEARN_OFFER --> TMP_CLEANUP_OFFER: user skips learning
    LEARN --> TMP_CLEANUP_OFFER: durable learning persisted
    TMP_CLEANUP_OFFER --> [*]: delete or keep tmp by user choice

    BLOCKED_CLARIFY --> SPEC_DRAFT: user resolves scope
    BLOCKED_CLARIFY --> PLAN_DRAFT: user resolves plan detail
    BLOCKED_CLARIFY --> [*]: user cancels
```

---

## Workflow #2 — Debug a Hard Bug

Trigger: user reports a hard bug, failing test, runtime error, or regression where root cause is unclear.

```mermaid
stateDiagram-v2
    [*] --> RECEIVED

    RECEIVED --> ROUTED: bug report accepted
    ROUTED --> BUG_CONTEXT_READ: hard bug/regression selected
    ROUTED --> BLOCKED_CLARIFY: insufficient report

    BUG_CONTEXT_READ --> REPRO_ATTEMPT: report and durable context loaded
    REPRO_ATTEMPT --> RECON: repro works, partial signal found, or enough clues exist
    REPRO_ATTEMPT --> BLOCKED_CLARIFY: cannot reproduce and no useful clues

    RECON --> EVIDENCE_GATHERING: implementation/docs context mapped
    RECON --> BLOCKED_CLARIFY: affected area still unknowable

    EVIDENCE_GATHERING --> MINIMIZE: evidence captured
    MINIMIZE --> ROOT_CAUSE_ANALYSIS: minimal failing case or narrowed boundary
    ROOT_CAUSE_ANALYSIS --> HYPOTHESIS_TEST: root-cause hypothesis formed
    HYPOTHESIS_TEST --> FIX_ANALYSIS: hypothesis confirmed
    HYPOTHESIS_TEST --> EVIDENCE_GATHERING: hypothesis rejected
    HYPOTHESIS_TEST --> ARCHITECTURE_QUESTION: 3 failed fix/hypothesis loops

    FIX_ANALYSIS --> SIMPLE_FIX: bounded fix
    FIX_ANALYSIS --> COMPLEX_FIX: broad/risky fix
    FIX_ANALYSIS --> PARALLEL_FIX: independent fix units
    FIX_ANALYSIS --> SEQUENTIAL_FIX: dependency chain

    SIMPLE_FIX --> REGRESSION_GUARD: patch complete
    COMPLEX_FIX --> REGRESSION_GUARD: patch complete
    PARALLEL_FIX --> REGRESSION_GUARD: merged
    SEQUENTIAL_FIX --> REGRESSION_GUARD: final unit complete

    REGRESSION_GUARD --> VERIFY_PREP: failing guard exists or exception documented
    VERIFY_PREP --> VERIFY: verify.json ready
    VERIFY --> REVIEW: verification ok
    VERIFY --> FIX_ANALYSIS: verification failed
    VERIFY --> BLOCKED_CLARIFY: cannot verify
    VERIFY --> BLOCKED_CLARIFY: 3 failed verify/fix loops

    REVIEW --> FIX_ANALYSIS: blocking findings
    REVIEW --> CHECKPOINT_GIT: no blocking findings
    REVIEW --> BLOCKED_CLARIFY: 2 blocked review rounds

    CHECKPOINT_GIT --> FINISH_READY: checkpoint committed or skipped
    FINISH_READY --> GIT_HANDOFF: user approves finish
    GIT_HANDOFF --> LEARN_OFFER: git handoff complete or skipped

    LEARN_OFFER --> LEARN: user wants distillation
    LEARN_OFFER --> TMP_CLEANUP_OFFER: user skips learning
    LEARN --> TMP_CLEANUP_OFFER: RCA/learning persisted
    TMP_CLEANUP_OFFER --> [*]: delete or keep tmp by user choice

    ARCHITECTURE_QUESTION --> ROOT_CAUSE_ANALYSIS: continue diagnosis
    ARCHITECTURE_QUESTION --> FIX_ANALYSIS: user approves architectural fix path
    ARCHITECTURE_QUESTION --> BLOCKED_CLARIFY: needs decision

    BLOCKED_CLARIFY --> BUG_CONTEXT_READ: user provides more report detail or context
    BLOCKED_CLARIFY --> ARCHITECTURE_QUESTION: user resolves the architectural decision
    BLOCKED_CLARIFY --> [*]: user cancels
```

---

## Workflow #3 — Security Analysis / Security Remediation

Trigger: explicit security review/audit, security-sensitive diff, dependency/tool/MCP/plugin/installer/CI change, auth/crypto/secrets/path traversal/command execution surface, an `escalate` verdict from Workflow #1/#2 security triage, or a `hanko--git-seal` finish-gate finding that needs deeper security analysis.

```mermaid
stateDiagram-v2
    [*] --> RECEIVED

    RECEIVED --> ROUTED: security review requested or escalated
    ROUTED --> SECURITY_SCOPE_READ: security workflow selected
    ROUTED --> BLOCKED_CLARIFY: insufficient scope

    SECURITY_SCOPE_READ --> SECURITY_TOOLING_READINESS: scope loaded
    SECURITY_TOOLING_READINESS --> RECON: readiness recorded
    SECURITY_TOOLING_READINESS --> BLOCKED_CLARIFY: required tool/access missing and no fallback approved

    RECON --> THREAT_MODEL: threat model needed
    RECON --> SECURITY_ANALYSIS_PLAN: narrow dependency/tool finding
    RECON --> BLOCKED_CLARIFY: affected surface unknowable

    THREAT_MODEL --> SECURITY_ANALYSIS_PLAN: assets/actors/abuse cases mapped
    SECURITY_ANALYSIS_PLAN --> STATIC_AND_SUPPLY_CHAIN_ANALYSIS: checks selected

    STATIC_AND_SUPPLY_CHAIN_ANALYSIS --> FINDINGS_CLASSIFICATION: evidence captured
    FINDINGS_CLASSIFICATION --> FIX_ANALYSIS: blocking fixable findings
    FINDINGS_CLASSIFICATION --> RISK_ACCEPTANCE_REVIEW: residual/exception findings
    FINDINGS_CLASSIFICATION --> VERIFY: no material findings

    FIX_ANALYSIS --> SIMPLE_FIX: bounded fix
    FIX_ANALYSIS --> COMPLEX_FIX: broad/risky fix
    FIX_ANALYSIS --> PARALLEL_FIX: independent fix units
    FIX_ANALYSIS --> SEQUENTIAL_FIX: dependency chain

    SIMPLE_FIX --> VERIFY_PREP: patch complete
    COMPLEX_FIX --> VERIFY_PREP: patch complete
    PARALLEL_FIX --> VERIFY_PREP: merged
    SEQUENTIAL_FIX --> VERIFY_PREP: final unit complete

    VERIFY_PREP --> VERIFY: verify.json ready
    VERIFY --> RISK_ACCEPTANCE_REVIEW: residual findings remain
    VERIFY --> REVIEW: verification ok
    VERIFY --> FIX_ANALYSIS: verification failed
    VERIFY --> BLOCKED_CLARIFY: cannot verify
    VERIFY --> BLOCKED_CLARIFY: 3 failed verify/fix loops

    RISK_ACCEPTANCE_REVIEW --> FIX_ANALYSIS: user rejects risk
    RISK_ACCEPTANCE_REVIEW --> REVIEW: user accepts documented risk
    RISK_ACCEPTANCE_REVIEW --> BLOCKED_CLARIFY: needs owner decision

    REVIEW --> FIX_ANALYSIS: blocking review findings
    REVIEW --> FINISH_READY: no blocking findings
    REVIEW --> BLOCKED_CLARIFY: 2 blocked review rounds

    FINISH_READY --> GIT_HANDOFF: user approves finish
    GIT_HANDOFF --> LEARN_OFFER: `hanko--git-seal` gate complete or routed

    LEARN_OFFER --> LEARN: user wants distillation
    LEARN_OFFER --> TMP_CLEANUP_OFFER: user skips learning
    LEARN --> TMP_CLEANUP_OFFER: durable security learning persisted
    TMP_CLEANUP_OFFER --> [*]: delete or keep tmp by user choice

    BLOCKED_CLARIFY --> SECURITY_SCOPE_READ: user clarifies scope or provides missing tool/access
    BLOCKED_CLARIFY --> RISK_ACCEPTANCE_REVIEW: owner decision resolved
    BLOCKED_CLARIFY --> [*]: user cancels
```

---

## Workflow #4 — Deep Research With Multi-Source Citations

Trigger: user asks for deep research, current information, literature review, competitive intelligence, domain synthesis, or a cited research memo.

```mermaid
stateDiagram-v2
    [*] --> RECEIVED

    RECEIVED --> ROUTED: research request accepted
    ROUTED --> LIGHT_SCOPE: research workflow selected
    ROUTED --> BLOCKED_CLARIFY: ambiguous research intent

    LIGHT_SCOPE --> RESEARCH_BRIEF: topic and likely mode understood
    LIGHT_SCOPE --> BLOCKED_CLARIFY: scope too broad or missing objective

    RESEARCH_BRIEF --> USER_BRIEF_REVIEW: brief ready
    USER_BRIEF_REVIEW --> RESEARCH_BRIEF: changes requested
    USER_BRIEF_REVIEW --> MODE_SELECTION: research direction approved
    USER_BRIEF_REVIEW --> QUICK_ANSWER: user downgrades scope
    USER_BRIEF_REVIEW --> [*]: user cancels

    MODE_SELECTION --> QUERY_FRONTIER: native-only or hybrid
    MODE_SELECTION --> NOTEBOOKLM_AUTH: NotebookLM-only
    MODE_SELECTION --> BLOCKED_CLARIFY: mode requires unavailable access

    QUERY_FRONTIER --> SEARCH_DISCOVERY: subquestions and queries ready
    SEARCH_DISCOVERY --> SOURCE_SCREENING: search results gathered
    SEARCH_DISCOVERY --> QUERY_FRONTIER: weak results or source gaps

    SOURCE_SCREENING --> FETCH_NATIVE: source set selected
    FETCH_NATIVE --> FETCH_PLUGIN_FALLBACK: native webfetch failed or weak
    FETCH_NATIVE --> EVIDENCE_MATRIX: native retrieval sufficient
    FETCH_PLUGIN_FALLBACK --> EVIDENCE_MATRIX: fallback retrieval sufficient
    FETCH_PLUGIN_FALLBACK --> QUERY_FRONTIER: retrieval gaps remain

    NOTEBOOKLM_AUTH --> NOTEBOOKLM_IMPORT: auth ok
    NOTEBOOKLM_AUTH --> QUERY_FRONTIER: fallback to native/hybrid approved
    NOTEBOOKLM_IMPORT --> NOTEBOOKLM_ANSWER: sources ready
    NOTEBOOKLM_ANSWER --> EVIDENCE_MATRIX: answer and references captured

    EVIDENCE_MATRIX --> CITATION_VERIFY: claims normalized
    CITATION_VERIFY --> GAP_LOOP: unsupported, stale, or conflicting claims
    CITATION_VERIFY --> SYNTHESIS: citations verified

    GAP_LOOP --> QUERY_FRONTIER: more discovery needed
    GAP_LOOP --> SOURCE_SCREENING: enough candidates, fetch more
    GAP_LOOP --> SYNTHESIS: gaps documented and acceptable

    SYNTHESIS --> REVIEW: memo drafted
    REVIEW --> GAP_LOOP: blocking evidence/citation finding
    REVIEW --> DELIVERY: no blocking findings

    DELIVERY --> PERSISTENCE_DECISION: final answer or artifact delivered
    PERSISTENCE_DECISION --> LEARN_OFFER: persistence choice recorded
    LEARN_OFFER --> LEARN: user wants reusable distillation
    LEARN_OFFER --> TMP_CLEANUP_OFFER: user skips learning
    LEARN --> TMP_CLEANUP_OFFER: durable learning persisted
    TMP_CLEANUP_OFFER --> [*]: delete or keep tmp by user choice

    QUICK_ANSWER --> DELIVERY: lightweight answer produced
    DELIVERY --> [*]: quick-answer run, nothing to persist
    BLOCKED_CLARIFY --> LIGHT_SCOPE: user resolves scope
    BLOCKED_CLARIFY --> [*]: user cancels
```

`QUICK_ANSWER` runs skip `PERSISTENCE_DECISION`, `LEARN_OFFER`, and `TMP_CLEANUP_OFFER`.

---

## Workflow #5 — Public Company Financial Analysis

Trigger: public-company analysis, stock analysis, earnings analysis, valuation, DCF, comps, filings extraction, business or growth analysis, sector or macro-aware market research, or a direct finance operation.

```mermaid
stateDiagram-v2
  [*] --> RECEIVED
  RECEIVED --> INTENT_CLASSIFY
  INTENT_CLASSIFY --> MODE_SELECTION: ambiguous
  INTENT_CLASSIFY --> DIRECT_OPERATION: operation matched
  INTENT_CLASSIFY --> BANK_STATUS: mode matched

  MODE_SELECTION --> BANK_STATUS
  DIRECT_OPERATION --> BANK_STATUS
  BANK_STATUS --> BANK_QUERY: user asks bank
  BANK_QUERY --> BANK_STATUS
  BANK_STATUS --> ARTIFACT_AUDIT
  ARTIFACT_AUDIT --> REUSE_DECISION
  REUSE_DECISION --> REFRESH_PLAN: stale/missing/suspect
  REUSE_DECISION --> SOURCE_SCREENING: reusable enough
  REFRESH_PLAN --> SOURCE_SCREENING
  SOURCE_SCREENING --> SOURCE_POLICY_GATE: paid/vendor/external source
  SOURCE_SCREENING --> SOURCE_GATHERING
  SOURCE_POLICY_GATE --> SOURCE_GATHERING: approved
  SOURCE_POLICY_GATE --> BLOCKED_CLARIFY: declined

  SOURCE_GATHERING --> EXTRACTION
  EXTRACTION --> NORMALIZE
  NORMALIZE --> ASSUMPTION_LOCK: full_analysis or valuation_deep_dive
  NORMALIZE --> MODULE_EXECUTION: quick_update or direct operation
  ASSUMPTION_LOCK --> MODULE_EXECUTION
  MODULE_EXECUTION --> MODEL_COMPUTE: valuation needed
  MODULE_EXECUTION --> FRESHNESS_VERIFY
  MODEL_COMPUTE --> MODEL_VALIDATE
  MODEL_VALIDATE --> FRESHNESS_VERIFY: validation passed
  MODEL_VALIDATE --> MODEL_COMPUTE: validation failed, computation needs correction
  MODEL_VALIDATE --> ASSUMPTION_LOCK: validation failed, assumptions need correction
  MODEL_VALIDATE --> BLOCKED_CLARIFY: 3 failed validation rounds
  FRESHNESS_VERIFY --> CROSS_VERIFY
  CROSS_VERIFY --> GAP_LOOP: material gap/conflict
  GAP_LOOP --> SOURCE_GATHERING: more gathering needed, round budget remains
  GAP_LOOP --> SYNTHESIS: gap documented and accepted after 2 rounds
  CROSS_VERIFY --> SYNTHESIS: no material gap
  SYNTHESIS --> REVIEW
  REVIEW --> SYNTHESIS: blocking findings
  REVIEW --> DELIVERY: no blocking findings
  REVIEW --> BLOCKED_CLARIFY: 2 blocked review rounds
  DELIVERY --> BANK_UPDATE_DECISION
  BANK_UPDATE_DECISION --> PERSISTENCE_DECISION
  PERSISTENCE_DECISION --> LEARN_OFFER
  LEARN_OFFER --> LEARN
  LEARN_OFFER --> TMP_CLEANUP_OFFER
  LEARN --> TMP_CLEANUP_OFFER
  TMP_CLEANUP_OFFER --> COMPLETE
  COMPLETE --> [*]
  BLOCKED_CLARIFY --> MODE_SELECTION: user resolves scope/source decision
  BLOCKED_CLARIFY --> [*]: user cancels
```

WF5 terminal state is `COMPLETE`.
