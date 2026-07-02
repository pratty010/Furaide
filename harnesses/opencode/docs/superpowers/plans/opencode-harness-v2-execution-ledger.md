# OpenCode Harness v2 Execution Ledger

Source plan: `harnesses/opencode/docs/superpowers/plans/opencode-harness-v2-plan.md`

Branch/worktree: `feature/opencode-harness-v2` at `.worktrees/opencode-harness-v2`

Controller policy: the main session orchestrates only: analysis, delegation, review routing, verification decisions, escalation, and checkpoint coordination. Implementation work is delegated to subagents.

## Operating Rules

- Use one fresh implementation subagent per plan task unless a task must be split for safety.
- Default implementers: `impl-simple` for bounded 1-3 file/mechanical edits; `impl-complex` for multi-file integration, tests, docs rewrites, packaging, or judgment-heavy tasks.
- Use `explore` for read-only reconnaissance and spec/code discovery.
- Use `scout` for external docs/upstream verification.
- Use `general` only for narrow mechanical execution where an implementer needs a worker.
- Route all checkpoint commits through `hanko--git-seal`; no pushes without explicit approval.
- After each task: implementation self-review, spec compliance review, code-quality review, task-specific verification, then checkpoint commit if the diff is coherent.
- Run `bun test scripts/tests/` from `harnesses/opencode/` after touching agents, config, scripts, plugins, or installer-era scaffolding unless the task-specific narrower command is sufficient and the full suite is deferred to the part boundary.
- Use `uv` for Python finance verification.
- Stop and escalate on dispatch probe exit 9, repeated verification failure, unclear plan/spec conflict, package publish, or destructive deletion not covered by the plan.

## Delegation Map

| Task | Part | Implementer | Reviewers | Verification | Checkpoint Commit |
|---|---:|---|---|---|---|
| 1 Canary agent files | 1 | impl-simple | explore, impl-complex | frontmatter/path check | yes |
| 2 Dispatch probe script | 1 | impl-simple | explore, impl-complex | `bun scripts/dev/canaries/v2-dispatch-probe.mjs` | yes |
| 3 Dispatch graph lint | 1 | impl-complex | explore, impl-complex | `bun test scripts/tests/dispatch-graph.test.mjs` | yes |
| 4 Record probe results/remove canaries | 1 | impl-simple | explore, impl-complex | RESULTS.md and no canary files | yes |
| 5 Fleet cut | 1 | impl-complex | explore, impl-complex | exact survivor inventory | yes |
| 6 Scrub retired names | 1 | impl-complex | explore, impl-complex | retired-name grep zero | yes |
| 7 Built-in overrides | 1 | impl-complex | explore, impl-complex | override probe or recorded fallback | yes |
| 8 Interim manifest/config/tests | 1 | impl-complex | explore, impl-complex | `bun test scripts/tests/` | yes |
| 9 Routing manifest v10 | 2 | impl-complex | explore, impl-complex | routing/model tests | yes |
| 10 kantoku primary | 2 | impl-complex | explore, impl-complex | expected dispatch-lint failure noted | yes |
| 11 kyakuhon planner | 2 | impl-complex | explore, impl-complex | frontmatter contract check | yes |
| 12 kagami + hansei | 2 | impl-complex | explore, impl-complex | frontmatter contract check | yes |
| 13 carried-over subagents | 2 | impl-complex | explore, impl-complex | contract grep/checks; review fixes: scoped hanko bash, checkpoint policy, oni blocked-round cap | yes |
| 14 specialist DAG + kura stub | 2 | impl-complex | explore, impl-complex | dispatch lint OK, `bun test` | yes |
| 15 final agent wiring | 2 | impl-complex | explore, impl-complex | `bun test`, dispatch lint OK | yes |
| 16 rules + manifest schema | 2 | impl-complex | explore, impl-complex | `bun test` | yes |
| 17 skills manifest + pull script | 3 | impl-complex | explore, impl-complex | skills manifest test | yes |
| 18 patch applier | 3 | impl-complex | explore, impl-complex | skills manifest test | yes |
| 19 addendum/native skills | 3 | impl-complex | explore, impl-complex | frontmatter validation | yes |
| 20 sync-skills | 3 | impl-complex | explore, impl-complex | temp HOME sync test | yes |
| 21 plugin bucket restructure | 4 | impl-complex | explore, impl-complex | `bun test` | yes |
| 22 nurikabe verified hook | 4 | impl-complex + scout | explore, impl-complex | gate tests | yes |
| 23 audit logger + compaction injector | 4 | impl-complex | explore, impl-complex | hooks plugin tests, `bun test` | yes |
| 24 workflow-state v2 phases | 4 | impl-complex | explore, impl-complex | workflow-state tests | yes |
| 25 security severity vocabulary | 4 | impl-complex | explore, impl-complex | gate scripts tests | yes |
| 26 tsukumogami WF1/WF2 | 5 | impl-complex | explore, impl-complex | agent contract check | yes |
| 27 fudo WF3 | 5 | impl-complex | explore, impl-complex | agent contract check | yes |
| 28 tsuchigumo WF4 | 5 | impl-complex | explore, impl-complex | agent contract check | yes |
| 29 workflow smoke tests | 5 | impl-complex | explore, impl-complex | workflow smoke + live probe | yes |
| 30 daikoku + kura full contracts | 6 | impl-complex | explore, impl-complex | agent contract check | yes |
| 31 finance ledger scripts | 6 | impl-complex | explore, impl-complex | finance ledger tests | yes |
| 32 finance Python batch 1 | 6 | impl-complex | explore, impl-complex | `uv run pytest scripts/finance/tests` | yes |
| 33 finance Python batches 2-3 | 6 | impl-complex | explore, impl-complex | `bun test`, `uv run pytest scripts/finance/tests` | yes |
| 34 runtime docs rewrite | 6 | impl-complex | explore, impl-complex | `bun test` | yes |
| 35 reference docs + script dispositions | 6 | impl-complex | explore, impl-complex | `bun test` | yes |
| 36 final verification sweep/spec status | 6 | impl-complex | explore, impl-complex | full checklist, `bun test`, dispatch lint, pytest | yes |
| 37 package skeleton | 7 | impl-complex | explore, impl-complex | package boundary test, `bun pm pack --dry-run` | yes |
| 38 config hook | 7 | impl-complex | explore, impl-complex | config hook test | yes |
| 39 compose package plugin | 7 | impl-complex | explore, impl-complex | full plugin tests | yes |
| 40 local install + retire installer | 7 | impl-complex | explore, impl-complex | package install test, `bun test` | yes |
| 41 publish flow + final packaging sweep | 7 | impl-complex + scout if docs needed | explore, impl-complex | publish dry-run, final sweep | stop before actual publish |

## Progress Log

| Time | Event | Evidence |
|---|---|---|
| 2026-07-02 | Execution started; worktree created; ledger initialized | `.worktrees/opencode-harness-v2`, this file |
| 2026-07-02 | Baseline `bun test scripts/tests/` failed before implementation | 437 pass / 6 fail. Failures: `scripts/tests/web-search-tool.test.mjs` provider-wrapper timeout; `scripts/tests/web-tools-budget-oneshot.test.mjs` 3 budget threshold failures; `scripts/tests/web-tools-budget-pricing.test.mjs` 2 warning/budget state failures. Treat as pre-existing baseline unless directed otherwise. |
| 2026-07-02 | User decision: proceed with known-red baseline | Do not investigate baseline web-tools failures now. Continue plan implementation; do not claim full-suite green until resolved. |
| 2026-07-02 | User instruction: no future clarification questions | Controller decides from plan/spec and records critical moments here. Stop only for impossible/tooling blockers or actions requiring explicit external approval such as actual publish/push. |
| 2026-07-02 | Review protocol corrected | Combine spec-compliance and code-quality review in one `general` subagent pass. If review finds issues, route fixes to `impl-simple` or `impl-complex` by scope, then re-review with `general`. |
| 2026-07-02 | Part 1 Task 1 completed by impl-simple | `agents/_v2-leaf.md`, `agents/_v2-impl.md`, `agents/_v2-spec.md` |
| 2026-07-02 | Part 1 Task 2 implemented; probe run exit 8 | `scripts/dev/canaries/v2-dispatch-probe.mjs`; JSON: `{"a_depth2":false,"b_depth3":false,"c_deny_enforced":true,"samples":{"d2":"Unknown agent type: _v2-impl is not a valid agent type\n","d3":"chain\n","dn":"Unknown agent type: _v2-spec is not a valid agent type\n"}}` |
| 2026-07-02 | Part 1 Task 3 implemented; red/green verified | `scripts/lint-dispatch-graph.mjs`, `scripts/tests/dispatch-graph.test.mjs`; red: module not found; green: 4 pass |
| 2026-07-02 | Part 1 Task 4 completed; canary results recorded and canaries removed | `scripts/dev/canaries/RESULTS.md`; hub-and-spoke through `kantoku`, state machines unchanged, deny-enforcement passed |
| 2026-07-02 | Part 1 Task 5 completed by impl-complex | Task 5 completed: 12 files moved to ignored `future-work/agents/` for local reference only, 11 retired from active fleet, active survivor inventory verified exactly 7 (bakeneko, daikoku, fudo, hanko, oni, tsuchigumo, tsukumogami). Future-work paths must not be staged. [checkpoint: cb05ec3] |
| 2026-07-02 | Part 1 Task 6 completed by impl-complex | Task 6 completed: scrubbed 61 matches of retired names from 7 survivor agents; updated subagent mappings to general, explore, scout, and kagami--verifier; verified zero matches remaining. |
| 2026-07-02 | Post-Task-6 broader cleanup | Removed 6 moved-agent cross-references from active survivor agent files; broad removed-agent grep over active `agents/*.md` now returns 0 hits. |
| 2026-07-02 | Part 1 Task 7 completed by impl-complex | Created `agents/general.md`, `agents/explore.md`, `agents/scout.md`. Override probe failed (subagent mode); fallback applied to `config/opencode.jsonc` (model, instructions, permission). Recorded in `RESULTS.md`. |
| 2026-07-02 | Task 7 config fallback shape corrected | `config/opencode.jsonc` inline agent blocks now use `prompt` instead of `instructions` for `general`, `explore`, and `scout`. |
| 2026-07-02 | Part 1 Task 8 completed by impl-complex | Updated `config/fleet-manifest.json`, `config/opencode.jsonc`, `scripts/lib/agent-fleet-map.mjs`, and fleet tests to reflect interim v2 fleet (10 agents). Verified fleet tests pass; 5 pre-existing web-tools failures remain in baseline. |
| 2026-07-02 | Part 2 Task 9 completed by impl-complex | `docs/routing-manifest.json` bumped to v10 with 15 v2 agents; routing/model trio `bun test scripts/tests/routing-manifest.test.mjs scripts/tests/model-failover.test.mjs scripts/tests/model-resolve.test.mjs` passed 18/18. |
| 2026-07-02 | Part 2 Task 10 completed by impl-complex | agents/kantoku--workflow-director.md created; dispatch lint returned OK (existence check skipped by script); reference-integrity test failed: kyakuhon--spec-planner missing. |
| 2026-07-02 | Part 2 Task 11 completed by impl-simple | `agents/kyakuhon--spec-planner.md` now exists at the exact path; frontmatter contract and retired/moved-name search in the new file both passed. |
| 2026-07-02 | Part 2 Task 12 completed by impl-simple | agents/kagami--verifier.md and agents/hansei--lesson-keeper.md created; frontmatter checks passed; removed/moved-name grep returned 0 hits. |
| 2026-07-02 | Part 2 Task 13 completed by impl-complex | `hanko--git-seal`, `bakeneko--bug-hunter`, and `oni--red-team-reviewer` updated for v2 contracts; removed/moved-name grep returned 0 hits in those files. |
| 2026-07-02 | Part 2 Task 14 completed by impl-complex | Specialist agents updated with scoped permissions and anti-recursion lines; `kura--knowledge-banker.md` created; `agent-fleet-map.mjs` updated to 15 agents; dispatch lint OK. |
| 2026-07-02 | Task 14 Verification | `bun scripts/lint-dispatch-graph.mjs` -> OK. `bun test` -> 407 pass / 22 fail. Failures are expected mid-migration (Task 15) or pre-existing (web-tools). Grep for retired names -> 0 hits. |
| 2026-07-02 | Part 2 Task 15 completed by impl-complex | Final agent wiring in `opencode.jsonc` and `fleet-manifest.json` (15 agents); updated models and permissions. Updated tests to match v2 fleet and handle model resolution. `bun test` -> 424 pass / 5 fail (only pre-existing web-tools failures remain). Dispatch lint OK. |
| 2026-07-02 | Tasks 16-20 verified from commit history | Task 16 `867538c`, Task 17 `2c0b049`, Task 18 `7c41157`, Task 19 `639b542`, Task 20 `b8a34a2` plus follow-up fixes `0fc6a7a` and `087ded2`; user stated work is complete through Task 20. |
| 2026-07-02 | Part 4 Task 21 found partially applied | Worktree already contains plugin bucket renames and related config/test edits before controller resumed. Preserve and complete from current dirty state; do not revert partial work. |
| 2026-07-02 | Part 4 Task 21 completed | Bucketed plugin layout verified at `plugins/gates/*`, `plugins/failover/migawari.js`, and `plugins/tools/web-tools.ts` + `plugins/tools/web-tools/**`. Verification commands: `rg -n "plugins/(nio|nurikabe|komainu|migawari|web-tools)(\\.js|\\.ts|/|\\b)" scripts config docs --glob '!docs/superpowers/**'` -> 0 hits; `bun test scripts/tests/delivery-gate.test.mjs scripts/tests/gate-enforcer.test.mjs scripts/tests/install-web-tools.test.mjs scripts/tests/web-tools-plugin-assembly.test.mjs scripts/tests/web-tools-plugin-execute.test.mjs scripts/tests/jsonc.test.mjs` -> pass. Known remaining baseline failures outside this targeted set remain the pre-existing web-tools budget/provider tests recorded above. |
| 2026-07-02 | Part 4 Task 22 completed | Verified live plugin docs at `https://opencode.ai/docs/plugins/`; documented event chosen for delivery gating: `tool.execute.before` (scoped to `tool === "deliver"`). `response.before` is not documented on the live page. Updated `plugins/gates/nurikabe.js` header comment with doc URL and rewired hook accordingly. Verification: `bun test scripts/tests/delivery-gate.test.mjs scripts/tests/gate-enforcer.test.mjs` -> pass. |
| 2026-07-02 | Part 4 Task 23 completed | Added `plugins/hooks/audit-logger.js` (`tool.execute.after`) and `plugins/hooks/compaction-injector.js` (`experimental.session.compacting` per live plugin docs), created `scripts/tests/hooks-plugins.test.mjs`, activated both plugin entries in `config/opencode.jsonc`, and added hook files to the `workflow-gates` manifest component. Verification: `bun test scripts/tests/hooks-plugins.test.mjs` and `bun test scripts/tests/gate-enforcer.test.mjs scripts/tests/delivery-gate.test.mjs scripts/tests/jsonc.test.mjs` -> pass. |
| 2026-07-02 | Part 4 Task 24 completed | Replaced `workflow-state.mjs` with spec-backed `WORKFLOWS` maps for WF1-WF5, validated per-workflow phase names/transitions, preserved CAS/ownership exit codes, added loop-cap enforcement metadata, and extended `workflow-state.test.mjs` for representative valid paths, invalid transitions, cap rejection, and gate warn caps. Verification: `bun test scripts/tests/workflow-state.test.mjs` -> pass. |
| 2026-07-02 | Part 4 Task 25 completed | Updated `scripts/security-severity.mjs` to emit unified v2 verdicts (`ok|warn|critical|escalate`), attach `required_action` only for `critical` findings, default critical action to `fix-in-place`, and reject legacy `alternative-required` / `escalate-security` / `accepted-risk` values with migration hints. No runtime callers under `scripts/` or `plugins/` required changes beyond the script itself; added focused coverage in `scripts/tests/gate-scripts.test.mjs`. Verification: `bun test scripts/tests/gate-scripts.test.mjs` -> 19 pass / 0 fail; `rg -n "alternative-required|escalate-security|accepted-risk" scripts plugins` -> matches only in `scripts/security-severity.mjs` migration-hint map and rejection tests in `scripts/tests/gate-scripts.test.mjs`. |
| 2026-07-02 | Part 4 review fixes applied for Tasks 21-25 | Updated `scripts/tests/crash-safety.test.mjs` to use WF v2 states (`RECEIVED` init, `ROUTED` first advance) while preserving kill/resume invariants; normalized plugin merge/unmerge wiring in `scripts/install-fleet.sh`, `scripts/merge-config.mjs`, and `scripts/unmerge-config.mjs` so bucket paths remain relative to `plugins/` (`./plugins/gates/nio.js`, `./plugins/tools/web-tools.ts`, etc.) and optional `plugins/` prefixes are stripped only once. Added normalization coverage in `scripts/tests/merge-config.test.mjs`. Verification: `bun test scripts/tests/crash-safety.test.mjs` -> 2 pass / 0 fail; `bun test scripts/tests/installer-confirmation.test.mjs scripts/tests/installer-wiring.test.mjs scripts/tests/merge-config.test.mjs` -> 27 pass / 0 fail; `bun test scripts/tests/` -> 465 pass / 5 fail. Remaining failures match pre-existing web-tools budget tests: `scripts/tests/web-tools-budget-oneshot.test.mjs` (3) and `scripts/tests/web-tools-budget-pricing.test.mjs` (2). |
| 2026-07-02 | Part 5 Task 26 completed by impl-complex | Rewrote `agents/tsukumogami--code-forgemaster.md` to the WF1/WF2 v2 contract: owns `COMPLEX_IMPLEMENT` / `PARALLEL_IMPLEMENT` / `SEQUENTIAL_IMPLEMENT` and `*_FIX` twins, consumes `implementation-analysis.md` / `fix-analysis.md`, writes `.opencode/tmp/<workflow-id>/worker-briefs/`, dispatches only `general`, merges `worker-results/`, prepares `VERIFY_PREP` upward without direct verifier dispatch, preserves Task 14 frontmatter limits, and includes the anti-recursion line plus simple-criteria table. |
| 2026-07-02 | Part 5 Task 27 completed by impl-complex | Rewrote `agents/fudo--security-guardian.md` to the WF3 v2 contract: owns `SECURITY_SCOPE_READ` through `FINISH_READY`, adds the adaptive-scope table, tooling-readiness file list, scanner/tool-selection table, unified `ok`/`warn`/`critical`/`escalate` findings vocabulary with `required_action`, depth-gated `RISK_ACCEPTANCE_REVIEW`, explicit boundary vs `hanko--git-seal`, allowed delegation limited to `explore`, `scout`, `general`, `tsukumogami--code-forgemaster`, and `kagami--verifier`, preserves Task 14 permission row, keeps the exact anti-recursion line, and removes legacy/deferred-agent references plus non-application-security governance language. |
| 2026-07-02 | Part 5 Task 28 completed by impl-complex | Rewrote `agents/tsuchigumo--research-weaver.md` to the WF4 v2 contract: owns `LIGHT_SCOPE` through `SYNTHESIS` / `DELIVERY`, restores the research-brief approval gate with required brief items, adds research defaults and source-confidence tables, enforces native `websearch` / `webfetch` first with plugin fallback only after failure or insufficiency, documents the exact NotebookLM auth predicate and allowed/disallowed command families, makes quick-answer runs skip persistence/learn offers, preserves Task 14 frontmatter limits, applies the depth-2 `general`-only delegation rule, keeps the exact anti-recursion line, and removes legacy/deferred-agent references. |
| 2026-07-02 | Part 5 Task 29 completed by impl-complex | Added `scripts/tests/workflow-smoke.test.mjs` covering WF1-WF5 happy/failure paths, legal/illegal transitions, WF1 verify-cap escalation, WF2 hypothesis-loop escalation, WF3 risk-acceptance route, WF4 quick-answer terminal behavior, and WF5 gap-loop/COMPLETE coverage. Updated `scripts/workflow-state.mjs` so WF4 `QUICK_ANSWER -> DELIVERY` runs are terminal for that downgraded path (`DELIVERY -> PERSISTENCE_DECISION` now rejected when `previous_phase === QUICK_ANSWER`). Verification: `bun test scripts/tests/workflow-smoke.test.mjs` -> 5 pass / 0 fail; `bun test scripts/tests/workflow-state.test.mjs scripts/tests/workflow-smoke.test.mjs` -> 15 pass / 0 fail. Live probe `opencode run --agent kantoku--workflow-director "trivial test: add a comment line to scripts/dev/canaries/RESULTS.md"` did not reach `kantoku`: runtime reported `agent "kantoku--workflow-director" not found. Falling back to default agent`, then the fallback `build` agent inserted a temporary HTML comment into `RESULTS.md`; the incidental comment was removed and the exact outcome recorded under `scripts/dev/canaries/RESULTS.md` A6. |

## Open Risks

- `future-work/` is ignored at repo root, but Task 5 intentionally moves deferred agents there. Checkpoint staging must be explicit if those artifacts should remain tracked; otherwise commit as deletions only.
- Part 7 package commands mention npm; use `bun pm pack` where compatible and escalate only if npm-specific behavior is required.
- `opencode run` live probes may be expensive or depend on local auth/runtime state. If unavailable, record exact failure in `scripts/dev/canaries/RESULTS.md` and escalate only for blocker statuses specified by the plan.
- Worktree baseline full harness test is red before plan edits. Proceeding with explicit user decision to treat failures as known pre-existing baseline issues.
