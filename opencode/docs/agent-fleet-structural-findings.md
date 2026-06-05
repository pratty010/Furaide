# Agent Fleet Structural Findings

- Review rubric: `docs/agent-description-rubric.md`

## Inventory

| File | Mode | Model | Description | Mentions | Task Targets |
| --- | --- | --- | --- | --- | --- |
| akashi--proof-keeper.md | subagent | openai/gpt-5.2 | Proof Keeper: GitHub portfolio evaluation specialist that handles the github_proof_building intent. | kataribe--narrative-teller, kodama--growth-echo |  |
| amanojaku--voice-contrarian.md | subagent | openai/gpt-5.2 | Voice Contrarian: Adversarial claim-grounding and overconfidence challenge specialist (the brand-bundle's anti-voice gate). |  |  |
| azukiarai--data-sifter.md | subagent | opencode-go/minimax-m2.7 | Data Sifter: Bulk structured data extraction from documents, web pages, code, or filings into a JSON array matching a supplied schema. |  |  |
| bakeneko--bug-hunter.md | subagent | opencode-go/deepseek-v4-pro | Bug Hunter: Root-cause analysis of test failures and runtime errors that returns an ExecutionPacket for karakuri--command-runner. |  |  |
| chizu--implementation-planner.md | all | opencode-go/kimi-k2.5 | Implementation Planner: Converts a goal into an executor-ready plan for tsukumogami--code-forgemaster. |  | mikoshi--code-pathfinder |
| daidarabotchi--infra-shaper.md | all | opencode-go/kimi-k2.6 | Infra Shaper: DevOps, SRE, and infrastructure orchestration specialist. | karakuri--command-runner, mikoshi--code-pathfinder, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, bakeneko--bug-hunter, karakuri--command-runner, bakeneko--bug-hunter, oni--red-team-reviewer, karakuri--command-runner, bakeneko--bug-hunter, karakuri--command-runner, bakeneko--bug-hunter, mikoshi--code-pathfinder, soroban--number-sage, bakeneko--bug-hunter, karakuri--command-runner, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, tsukumogami--code-forgemaster, fudo--security-guardian, mikoshi--code-pathfinder, soroban--number-sage, karakuri--command-runner, karakuri--command-runner, soroban--number-sage, bakeneko--bug-hunter, karakuri--command-runner, soroban--number-sage, oni--red-team-reviewer, bakeneko--bug-hunter, karakuri--command-runner, bakeneko--bug-hunter, oni--red-team-reviewer, jorogumo--synthesis-weaver, mikoshi--code-pathfinder, soroban--number-sage, bakeneko--bug-hunter, karakuri--command-runner, oni--red-team-reviewer, jorogumo--synthesis-weaver, karakuri--command-runner, soroban--number-sage | mikoshi--code-pathfinder, soroban--number-sage, bakeneko--bug-hunter, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, html-preview |
| daikoku--finance-steward.md | all | opencode-go/qwen3.7-max | Finance Steward: Financial analysis and investment modeling orchestrator. | karakuri--command-runner, karakuri--command-runner, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, oni--red-team-reviewer, soroban--number-sage, yamabiko--source-echo, azukiarai--data-sifter, soroban--number-sage, kagami--truth-mirror, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, karakuri--command-runner, tsuchigumo--research-weaver, enma--compliance-judge, yamabiko--source-echo, yamabiko--source-echo, azukiarai--data-sifter, soroban--number-sage, karakuri--command-runner, soroban--number-sage, oni--red-team-reviewer, jorogumo--synthesis-weaver, oni--red-team-reviewer, soroban--number-sage, karakuri--command-runner, kagami--truth-mirror, azukiarai--data-sifter, jorogumo--synthesis-weaver, henge--format-shifter | yamabiko--source-echo, azukiarai--data-sifter, soroban--number-sage, kagami--truth-mirror, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, html-preview |
| enma--compliance-judge.md | all | opencode-go/qwen3.6-plus | Compliance Judge: Regulatory compliance and contract review orchestrator. | mikoshi--code-pathfinder, kagami--truth-mirror, oni--red-team-reviewer, mikoshi--code-pathfinder, jorogumo--synthesis-weaver, karakuri--command-runner, mikoshi--code-pathfinder, mikoshi--code-pathfinder, azukiarai--data-sifter, yamabiko--source-echo, kagami--truth-mirror, jorogumo--synthesis-weaver, oni--red-team-reviewer, daikoku--finance-steward, fudo--security-guardian, yamabiko--source-echo, mikoshi--code-pathfinder, kagami--truth-mirror, jorogumo--synthesis-weaver, oni--red-team-reviewer, mikoshi--code-pathfinder, azukiarai--data-sifter, kagami--truth-mirror, oni--red-team-reviewer, jorogumo--synthesis-weaver, henge--format-shifter | mikoshi--code-pathfinder, azukiarai--data-sifter, yamabiko--source-echo, kagami--truth-mirror, jorogumo--synthesis-weaver, oni--red-team-reviewer, html-preview |
| fudo--security-guardian.md | all | opencode-go/kimi-k2.6 | Security Guardian: Adversarial security audit, threat modeling, and vulnerability research orchestrator. | mikoshi--code-pathfinder, soroban--number-sage, azukiarai--data-sifter, karakuri--command-runner, mikoshi--code-pathfinder, soroban--number-sage, azukiarai--data-sifter, bakeneko--bug-hunter, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, azukiarai--data-sifter, oni--red-team-reviewer, jorogumo--synthesis-weaver, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, mikoshi--code-pathfinder, azukiarai--data-sifter, soroban--number-sage, bakeneko--bug-hunter, karakuri--command-runner, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, oni--red-team-reviewer, bakeneko--bug-hunter, enma--compliance-judge, mikoshi--code-pathfinder, azukiarai--data-sifter, soroban--number-sage, bakeneko--bug-hunter, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, bakeneko--bug-hunter, jorogumo--synthesis-weaver, oni--red-team-reviewer, oni--red-team-reviewer, bakeneko--bug-hunter, karakuri--command-runner, jorogumo--synthesis-weaver, azukiarai--data-sifter, soroban--number-sage | mikoshi--code-pathfinder, soroban--number-sage, azukiarai--data-sifter, bakeneko--bug-hunter, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, html-preview |
| hanko--git-seal.md | subagent | openai/gpt-5.4-mini | Git Seal: Version control and GitHub workflow executor for git commits, pushes, gh PR creation, and status checks. |  |  |
| henge--format-shifter.md | subagent | opencode-go/mimo-v2.5 | Format Shifter: Bulk format and transform between representations (Markdown, tables, JSON, SARIF, HTML, CSV, YAML) with no content changes. |  |  |
| hyakume--ats-watchman.md | subagent | openai/gpt-5.4-mini | ATS Watchman: ATS keyword coverage and machine-legibility audit specialist for the brand bundle. |  |  |
| jorogumo--synthesis-weaver.md | subagent | opencode-go/glm-5 | Synthesis Weaver: Transforms a normalized evidence corpus (Evidence Matrix, Source Manifest, Factcheck results) into a structured narrative deliverable. |  | henge--format-shifter, html-preview |
| kagami--truth-mirror.md | subagent | openai/gpt-5.4-mini | Truth Mirror: Verifies an enumerated claim list against primary or authoritative sources and returns per-claim verdicts with confidence scores. |  | azukiarai--data-sifter |
| karakuri--command-runner.md | subagent | opencode-go/mimo-v2.5 | Code Runner: Executes commands, test suites, scripts, and code execution packets on behalf of a specialist. |  |  |
| karasutengu--docs-scout.md | subagent | opencode/big-pickle | Docs Scout: External documentation, dependency lookup, and library/API reference retrieval (ctx7-baked). | latest, sojobo--system-strategist, tsukuyomi--spec-oracle | find-docs |
| kataribe--narrative-teller.md | subagent | opencode-go/kimi-k2.6 | Narrative Teller: Brand strategy and website brief specialist for the brand bundle (handles brand_strategy intent). | kodama--growth-echo, migaki--profile-polisher |  |
| kitsune--brand-orchestrator.md | all | openai/gpt-5.4 | Brand Orchestrator: User-facing entry point for the opt-in Brand Builder bundle that routes profile review and optimization requests across 8 specialist workflows. |  | akashi--proof-keeper, amanojaku--voice-contrarian, hyakume--ats-watchman, kataribe--narrative-teller, kodama--growth-echo, kudagitsune--fit-diviner, kurabokko--knowledge-keeper, migaki--profile-polisher |
| kodama--growth-echo.md | subagent | openai/gpt-5.2 | Growth Echo: Recurring-gap analysis and growth roadmap specialist (handles growth_planning intent). | migaki--profile-polisher, akashi--proof-keeper |  |
| kotodama--prose-polisher.md | subagent | google-vertex/gemini-3.1-pro-preview | Prose Polisher: Elevates draft prose to publication quality via structural edits, voice consistency, clarity, concision, and a humanizer pass. |  | humanizer |
| kudagitsune--fit-diviner.md | subagent | openai/gpt-5.2 | Fit Diviner: Current-state scoring and role-fit judgment specialist for the brand bundle. | kurabokko--knowledge-keeper, migaki--profile-polisher, kudagitsune--fit-diviner |  |
| kurabokko--knowledge-keeper.md | subagent | openai/gpt-5.4-mini | Knowledge Keeper: Artifact intake and memory hygiene specialist for the brand bundle (handles artifact_intake_update intent). | kudagitsune--fit-diviner |  |
| makimono--docs-scribe.md | subagent | opencode-go/glm-5 | Docs Scribe: Mechanical, sectioned Markdown documentation (API docs, changelogs, inline comments, README sections). |  | henge--format-shifter |
| migaki--profile-polisher.md | subagent | opencode-go/kimi-k2.6 | Profile Polisher: LinkedIn section diagnosis and rewrite-variant specialist for the brand bundle (handles linkedin_optimization intent). | akashi--proof-keeper, kataribe--narrative-teller | amanojaku--voice-contrarian |
| mikoshi--code-pathfinder.md | subagent | opencode-go/qwen3.6-plus | Code Pathfinder: Read-only codebase, library, and file-tree exploration that returns file/symbol maps and dependency graphs. |  | azukiarai--data-sifter |
| mizuchi--data-current.md | subagent | opencode-go/deepseek-v4-flash | Data Current: Schema design, SQL DDL, dbt model design, ETL/ELT pipeline architecture, and data warehouse patterns. | tsukumogami--code-forgemaster |  |
| mujina--brand-shapeshifter.md | all | openai/gpt-5.4 | Brand Shapeshifter: Brand strategy, positioning, and go-to-market narrative advisor. |  | jorogumo--synthesis-weaver, kotodama--prose-polisher, yamabiko--source-echo, kagami--truth-mirror, html-preview |
| oni--red-team-reviewer.md | subagent | openai/gpt-5.5 | Red Team Reviewer: Premium adversarial review of a bounded artifact (code diff, architecture plan, research argument, compliance posture, or written deliverable). |  |  |
| shiranui--migration-guide.md | all | opencode-go/kimi-k2.5 | Migration Guide: Phased migration and codemod orchestrator. |  | mikoshi--code-pathfinder, tsukumogami--code-forgemaster |
| sojobo--system-strategist.md | all | opencode-go/kimi-k2.5 | System Strategist: Architecture and executor-ready plan orchestrator (dual mode). |  | mikoshi--code-pathfinder |
| soroban--number-sage.md | subagent | opencode-go/deepseek-v4-flash | Number Sage: Quantitative, math, and telemetry analysis over supplied data returning tables and an Evidence Matrix. | mizuchi--data-current, mizuchi--data-current, mizuchi--data-current, azukiarai--data-sifter | azukiarai--data-sifter |
| tanuki--general-trickster.md | all | opencode/big-pickle | General Trickster: Cost-aware broad research and Q&A escape hatch for tasks that don't fit any v9.1 specialist. |  |  |
| tengu--visual-artisan.md | subagent | google-vertex/gemini-3.5-flash | Visual Artisan: Diagrams, SVG, HTML mockups, dashboards, and visual identity direction from structured data or specifications. |  | henge--format-shifter, html-preview |
| tsuchigumo--research-weaver.md | all | opencode-go/kimi-k2.5 | Research Weaver: Multi-domain deep research orchestrator. | jorogumo--synthesis-weaver, karakuri--command-runner, yamabiko--source-echo, azukiarai--data-sifter, kagami--truth-mirror, soroban--number-sage, jorogumo--synthesis-weaver, oni--red-team-reviewer, mikoshi--code-pathfinder, henge--format-shifter, mikoshi--code-pathfinder, soroban--number-sage, yamabiko--source-echo, soroban--number-sage, yamabiko--source-echo, mikoshi--code-pathfinder, soroban--number-sage, kagami--truth-mirror, yamabiko--source-echo, kagami--truth-mirror, yamabiko--source-echo, oni--red-team-reviewer, yamabiko--source-echo, kagami--truth-mirror, mikoshi--code-pathfinder, yamabiko--source-echo, yamabiko--source-echo, azukiarai--data-sifter, kagami--truth-mirror, yamabiko--source-echo, kagami--truth-mirror, soroban--number-sage, henge--format-shifter, yamabiko--source-echo, jorogumo--synthesis-weaver, yamabiko--source-echo, kagami--truth-mirror, kagami--truth-mirror, jorogumo--synthesis-weaver, henge--format-shifter, jorogumo--synthesis-weaver, kagami--truth-mirror, oni--red-team-reviewer, azukiarai--data-sifter, soroban--number-sage, mikoshi--code-pathfinder, henge--format-shifter, soroban--number-sage | yamabiko--source-echo, azukiarai--data-sifter, kagami--truth-mirror, soroban--number-sage, jorogumo--synthesis-weaver, oni--red-team-reviewer, mikoshi--code-pathfinder, henge--format-shifter, html-preview |
| tsukumogami--code-forgemaster.md | all | opencode-go/kimi-k2.5 | Code Forgemaster: Multi-file software implementation orchestrator. | karakuri--command-runner, bakeneko--bug-hunter, karakuri--command-runner, oni--red-team-reviewer, makimono--docs-scribe, karakuri--command-runner, karakuri--command-runner, karakuri--command-runner, mikoshi--code-pathfinder, bakeneko--bug-hunter, karakuri--command-runner, makimono--docs-scribe, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, karakuri--command-runner, daidarabotchi--infra-shaper, fudo--security-guardian, daikoku--finance-steward, soroban--number-sage, mikoshi--code-pathfinder, karakuri--command-runner, bakeneko--bug-hunter, karakuri--command-runner, karakuri--command-runner, oni--red-team-reviewer, makimono--docs-scribe, jorogumo--synthesis-weaver, mikoshi--code-pathfinder, karakuri--command-runner, oni--red-team-reviewer, bakeneko--bug-hunter, karakuri--command-runner, mikoshi--code-pathfinder, makimono--docs-scribe, jorogumo--synthesis-weaver, karakuri--command-runner | mikoshi--code-pathfinder, bakeneko--bug-hunter, makimono--docs-scribe, jorogumo--synthesis-weaver, oni--red-team-reviewer, karakuri--command-runner, html-preview |
| tsukuyomi--spec-oracle.md | all | opencode-go/qwen3.6-plus | Spec Oracle: Product spec, PRD, and Spec-Kit orchestrator. | karakuri--command-runner, mikoshi--code-pathfinder, azukiarai--data-sifter, kagami--truth-mirror, jorogumo--synthesis-weaver, makimono--docs-scribe, oni--red-team-reviewer, tsukumogami--code-forgemaster, tsuchigumo--research-weaver, daikoku--finance-steward, mikoshi--code-pathfinder, makimono--docs-scribe, jorogumo--synthesis-weaver, azukiarai--data-sifter, oni--red-team-reviewer, mikoshi--code-pathfinder, azukiarai--data-sifter, kagami--truth-mirror, makimono--docs-scribe, jorogumo--synthesis-weaver, oni--red-team-reviewer | mikoshi--code-pathfinder, azukiarai--data-sifter, kagami--truth-mirror, jorogumo--synthesis-weaver, makimono--docs-scribe, oni--red-team-reviewer, html-preview |
| yamabiko--source-echo.md | subagent | opencode-go/minimax-m2.7 | Source Echo: Fetches, scores, and returns a structured Source Manifest from the web for a research brief. |  | azukiarai--data-sifter |
| yumemi--story-smith.md | all | opencode-go/glm-5.1 | Story Smith: Long-form content writer orchestrator (GLM-5.1). | kotodama--prose-polisher, kagami--truth-mirror, yamabiko--source-echo, soroban--number-sage, kotodama--prose-polisher, kotodama--prose-polisher, karakuri--command-runner, yamabiko--source-echo, soroban--number-sage, kagami--truth-mirror, jorogumo--synthesis-weaver, henge--format-shifter, kotodama--prose-polisher, oni--red-team-reviewer, kotodama--prose-polisher, tsukuyomi--spec-oracle, makimono--docs-scribe, henge--format-shifter, tsuchigumo--research-weaver, yamabiko--source-echo, soroban--number-sage, kagami--truth-mirror, kotodama--prose-polisher, kotodama--prose-polisher, yamabiko--source-echo, soroban--number-sage, kagami--truth-mirror, kotodama--prose-polisher, oni--red-team-reviewer, henge--format-shifter | yamabiko--source-echo, soroban--number-sage, kagami--truth-mirror, jorogumo--synthesis-weaver, henge--format-shifter, kotodama--prose-polisher, oni--red-team-reviewer, html-preview, humanizer |

## Structural Findings

- Pending manual review.

## Specialist Findings

Task 6 rewrote the `description` field on all 12 specialists to the rubric shape (`Role Name:` · `Use for:` · `Not for:` · `Behavior:`). `mode: all` and `model:` were preserved verbatim and continue to match `docs/routing-manifest.json`. `permission.task` was left intact (Task 3 fixed it). `temperature` was tightened where the role is precision-bound, and added for `mujina--brand-shapeshifter` which previously had none.

### Misleading descriptions before the rewrite

- `mujina--brand-shapeshifter` — description was a single quoted line with a lore aside ("Shape-shifting badger spirit") and no `Behavior:` contract; `temperature` was unset. Rewritten to the rubric shape; `temperature: 0.7` added for brand-strategy creativity.
- `chizu--implementation-planner`, `shiranui--migration-guide`, `sojobo--system-strategist` — descriptions were multi-paragraph and omitted the rubric's `Behavior:` line; body content lives in `../common/agents/...` includes so the frontmatter is the only routing signal. Rewritten with explicit behavior contract each.
- `tsukuyomi--spec-oracle`, `daikoku--finance-steward`, `enma--compliance-judge`, `fudo--security-guardian`, `daidarabotchi--infra-shaper`, `yumemi--story-smith` — descriptions led with yokai flavor and ran 4-7 wrapped lines without a `Behavior:` contract; excluded routes named internal specialist handles (`pm-spec`, `devops-sre`, `security specialist`) that no longer resolve. Rewritten with operational role lead, canonical renamed exclusions, and a behavior contract.
- `tsukumogami--code-forgemaster`, `tsuchigumo--research-weaver` — same flavor-lead and internal-handle exclusion problem. Rewritten.

### Permissions tightened or kept (specialists)

- `fudo--security-guardian` keeps `edit: deny` (correct — proposes patches only, never applies).
- `mujina--brand-shapeshifter` keeps `edit: deny` (correct — lightweight advisory returns in chat).
- `chizu--implementation-planner`, `shiranui--migration-guide`, `sojobo--system-strategist` keep `edit: deny` and `question: deny` (correct — planners don't edit and don't ask, they emit `needs-clarification` blocks).
- `tsukumogami--code-forgemaster`, `tsuchigumo--research-weaver`, `tsukuyomi--spec-oracle`, `daikoku--finance-steward`, `enma--compliance-judge`, `daidarabotchi--infra-shaper`, `yumemi--story-smith` keep `edit: allow` (correct — they write deliverable files in their own worktrees like `research/<topic>/`, `specs/<feature>/`, `content/<type>/`).
- `bash: deny` on every specialist is correct and consistent; all execution routes via `karakuri--command-runner`.
- `webfetch: ask` on `tsukuyomi--spec-oracle` and `daidarabotchi--infra-shaper`; `webfetch: deny` on the three planners (chizu, shiranui, sojobo). The remaining specialists with `webfetch: allow` is correct for their domains (CVE lookups, regulatory text, primary research, source documents).
- `temperature` adjustments (each justified by the role):
  - `fudo--security-guardian` 0.6 → 0.3 (adversarial precision).
  - `daikoku--finance-steward` 0.6 → 0.5 (financial precision).
  - `enma--compliance-judge` 0.6 → 0.5 (regulatory precision).
  - `tsukumogami--code-forgemaster` 0.6 → 0.5 (deterministic routing).
  - `daidarabotchi--infra-shaper` 0.6 → 0.5 (infra precision).
  - `chizu--implementation-planner` 0.5 → 0.4 (plan precision).
  - `shiranui--migration-guide` 0.5 → 0.4 (migration precision).
  - `sojobo--system-strategist` 0.7 → 0.6 (architectural precision, mild variance for option exploration).
  - `tsuchigumo--research-weaver` 0.6 unchanged (synthesis benefits from mild variance).
  - `tsukuyomi--spec-oracle` 0.6 unchanged (Qwen thinking model default).
  - `yumemi--story-smith` 1.0 unchanged (intentional, justified in role body).
  - `mujina--brand-shapeshifter` added 0.7 (creative but bounded brand strategy).

### Specialist-to-specialist routing violations found

- `shiranui--migration-guide` `permission.task` allows `tsukumogami--code-forgemaster`. That is a specialist-to-specialist dispatch, which violates the fleet rule "Specialist→shared-subagent only; subagents dispatch T2 leaves only." The `shiranui` description has been updated to call this out ("implementation is handed off via the plan, never via direct specialist dispatch"), but the actual `permission.task` entry must be removed in a follow-up change that needs user approval (the user said in Task 6 to not touch `permission.task`).
- No other specialist has a `permission.task` entry pointing at another specialist. All other dispatch lists reference subagents only.

## Shared Subagent Findings

Task 7 rewrote the `description` field on all 15 shared subagents to the rubric shape. `mode: subagent` and `model:` were preserved verbatim and continue to match `docs/routing-manifest.json`. `permission.task` was left intact per the user's instruction. `temperature` was tightened on Qwen/GLM/DeepSeek-flash variants and left unset on reasoner/model-card-default models.

### Misleading descriptions before the rewrite

- `karakuri--command-runner`, `mikoshi--code-pathfinder`, `bakeneko--bug-hunter`, `makimono--docs-scribe`, `jorogumo--synthesis-weaver`, `kotodama--prose-polisher`, `yamabiko--source-echo`, `kagami--truth-mirror`, `soroban--number-sage`, `azukiarai--data-sifter`, `henge--format-shifter`, `tengu--visual-artisan`, `mizuchi--data-current`, `hanko--git-seal` — all carried the "Yokai name (...): The ... spirit that ..., <comma-flavored purpose>" shape, no `Behavior:` contract, and no exclusion list to prevent misroutes. The yokai flavor was leading the description and obscuring the operational role.
- `oni--red-team-reviewer` was already on the rubric shape (Task 6-style) but used a different line order (`Use for:` / `Not for:` separated) and omitted `Behavior:`. Normalized to the canonical 4-line shape with a behavior contract.
- `mizuchi--data-current` was closest to the rubric shape but the description spanned 8 wrapped lines mixing role summary, dispatch signal, and `Route here for` / `NOT for` blocks. Compressed to 4 lines with the exclusion list as a clean `Not for:` row.

### Permissions reviewed (shared subagents)

- `karakuri--command-runner` keeps `bash: allow` (correct — the only subagent with bash, by fleet rule).
- `yamabiko--source-echo`, `kagami--truth-mirror` keep `webfetch: allow`; `websearch: allow` on yamabiko, `websearch: deny` on kagami (correct — yamabiko retrieves, kagami verifies against supplied or known URLs only).
- `hanko--git-seal` keeps `bash: allow` and `question: ask` (correct — the human-in-the-loop gate is the operational contract; bash is for git/gh; question gates every push/commit/PR/merge).
- `mikoshi--code-pathfinder`, `bakeneko--bug-hunter`, `makimono--docs-scribe`, `jorogumo--synthesis-weaver`, `kotodama--prose-polisher`, `soroban--number-sage`, `azukiarai--data-sifter`, `henge--format-shifter`, `tengu--visual-artisan`, `mizuchi--data-current` all keep `edit: deny` and `bash: deny` (correct — read/execute/format/visual workers, no mutations).
- `oni--red-team-reviewer` keeps `edit: deny`, `bash: deny`, `question: deny`, no skills (correct — judgment-only, no further dispatch).
- T2 leaves (`azukiarai--data-sifter`, `henge--format-shifter`) confirm `task: { "*": deny }` (correct — never dispatch further, T2 leaves only).

### `temperature` adjustments (shared subagents)

Each change is justified by the role's precision/creativity balance. Unset values are kept unset (model card default).

- `mikoshi--code-pathfinder` 0.6 → 0.5 (Qwen thinking model + deterministic tool use; routing precision).
- `makimono--docs-scribe` 0.6 → 0.5 (GLM-5 + mechanical documentation; reduced variance).
- `jorogumo--synthesis-weaver` 0.6 → 0.5 (GLM-5 + narrative assembly; mild variance acceptable, deterministic preferred).
- `soroban--number-sage` 0.6 → 0.5 (DeepSeek-flash + numerical precision; tight bound).
- `karakuri--command-runner` unchanged (mimo-v2.5 card default).
- `bakeneko--bug-hunter` unchanged (deepseek-v4-pro reasoner — temperature override degrades reasoning).
- `yamabiko--source-echo` unchanged (minimax-m2.7 card default).
- `kagami--truth-mirror` unchanged (gpt-5.4-mini card default; close to deterministic for verification).
- `azukiarai--data-sifter` unchanged (minimax-m2.7 card default; bulk extraction).
- `henge--format-shifter` unchanged (mimo-v2.5 card default; format-only).
- `kotodama--prose-polisher` 1.0 unchanged (Gemini family requirement; required for variance in phrasing).
- `tengu--visual-artisan` 1.0 unchanged (Gemini family requirement).
- `mizuchi--data-current` 0.5 unchanged (DeepSeek-flash + schema design precision).
- `hanko--git-seal` unchanged (gpt-5.4-mini card default; deterministic git ops).

### Dispatch chain review (shared subagents)

All `permission.task` entries were left intact. Inspection of the post-rewrite `task:` maps:

- `mikoshi--code-pathfinder` → `azukiarai--data-sifter` (subagent → T2 leaf): correct.
- `makimono--docs-scribe` → `henge--format-shifter` (subagent → T2 leaf): correct.
- `jorogumo--synthesis-weaver` → `henge--format-shifter` (subagent → T2 leaf): correct.
- `yamabiko--source-echo` → `azukiarai--data-sifter` (subagent → T2 leaf): correct.
- `kagami--truth-mirror` → `azukiarai--data-sifter` (subagent → T2 leaf): correct.
- `soroban--number-sage` → `azukiarai--data-sifter` and → `mizuchi--data-current` (subagent → T2 leaf + subagent dispatch when task shifts from compute to schema): correct per the documented dispatch arm in the role body.
- `tengu--visual-artisan` → `henge--format-shifter` (subagent → T2 leaf): correct.
- `oni--red-team-reviewer`, `bakeneko--bug-hunter`, `azukiarai--data-sifter`, `henge--format-shifter`, `hanko--git-seal`, `mizuchi--data-current` → no `task:` entries (`"*": deny` only). Correct — leaf or judgment-only.

No specialist→specialist dispatch violations found in the shared-subagent layer.

## Other Agent Findings

Task 7 rewrote 2 escape hatches (`tanuki--general-trickster`, `karasutengu--docs-scout`) and 9 brand-builder agents (`kitsune--brand-orchestrator` + 8 sub-familiars). `mode:` and `model:` were preserved. Brand-builder subagents are `mode: subagent`; `tanuki` and `kitsune` are `mode: all` (orchestrator role).

### Misleading descriptions before the rewrite

- `tanuki--general-trickster` — description led with yokai flavor ("shape-shifting raccoon-dog, master of all trades") and was missing a `Behavior:` contract; the v9.1 specialist list was implicit. Rewritten with an explicit `Not for:` list naming all 12 current specialists.
- `karasutengu--docs-scout` — description was a single quoted line with one-liner use-cases but no `Not for:` or `Behavior:` contracts; the ctx7 protocol was buried mid-line. Rewritten with operational role lead, exclusions for `mikoshi--code-pathfinder` (internal codebase) and architect roles, and a behavior contract describing the ctx7 → webfetch → websearch fallback chain.
- All 9 brand-builder agents — descriptions led with yokai name and a flavor aside; many used internal-bundle jargon ("brand_strategy intent", "github_proof_building intent") without explaining the user-facing trigger; some omitted exclusions entirely. Rewritten with: role first, user-facing `Use for:` examples including the common user phrases, `Not for:` naming the closest non-bundle misroutes, and a `Behavior:` contract stating the BB-RESULT output shape and the advisory (no mutation) posture.
- `kodama--growth-echo` had `bug chizu--implementation-planner` and `bug oni--red-team-reviewer` mentions left over from earlier drafts (visible in raw body). Description rewrite alone doesn't fix body text — see Proposed Structural Changes #4.

### Permissions reviewed (brand-builder + escape hatches)

- `tanuki--general-trickster` keeps `edit: deny`, `bash: deny`, `webfetch: allow`, `websearch: allow`, `question: ask` (correct — read-only research with clarifying question gate).
- `karasutengu--docs-scout` keeps `edit: deny`, `bash: deny`, `webfetch: allow`, `websearch: allow`, `question: deny`, `todowrite: deny`, `skill: { find-docs: allow }` (correct — pure retrieval; no follow-up state; the find-docs skill is the operational core).
- `kitsune--brand-orchestrator` keeps `edit: deny`, `bash: deny`, `webfetch: allow`, `websearch: allow`, `question: ask` and the 8 sub-familiar `task: allow` entries (correct — orchestrator routes via task; the question gate is for hard-gate clarification).
- All 8 brand-bundle sub-familiars keep `edit: deny`, `bash: deny`, `question: deny` (correct — subagents return BB-RESULT, never ask the user, never edit). Exception: `kodama--growth-echo` has `websearch: allow` (correct — growth recommendations can require brief market-trend lookups for `time_horizon` validation); the other 7 sub-familiars keep `websearch: deny` (correct — no need).
- `kataribe--narrative-teller`, `kodama--growth-echo`, `migaki--profile-polisher` had `temperature: 0.6`; tightened to 0.5 (role is precision-bound; advisory/rewrite outputs benefit from reduced variance).

### Brand-bundle routing closure

- `kitsune--brand-orchestrator` `permission.task` permits all 8 sub-familiars. Closure check: every sub-familiar's `permission.task` is `*` deny (they do not dispatch further). The bundle is closed — no specialist→specialist or subagent→specialist chains from inside the bundle.
- `migaki--profile-polisher` `permission.task` permits `amanojaku--voice-contrarian` (anti-voice gate within the bundle). Correct — same bundle, both `mode: subagent`.
- `kudagitsune--fit-diviner` `permission.task` is `*` deny but its body references `@kurabokko--knowledge-keeper` and `@migaki--profile-polisher` as followups. These are textual recommendations, not dispatch permissions; they are correctly out-of-band. (See Proposed Structural Changes #5.)

## Proposed Structural Changes

Proposals only; not applied in this task. Each requires explicit user approval.

1. **Remove `tsukumogami--code-forgemaster: allow` from `shiranui--migration-guide` `permission.task`.** (Carried over from Task 6 specialist findings.) The presence of this entry currently lets a migration specialist dispatch a coding specialist, which breaks the specialist→subagent-only dispatch rule. Migration execution should reach `tsukumogami` only via the plan handoff (the user invokes `tsukumogami` directly with the migration plan in hand) or via `karakuri--command-runner` for gated shell work.
2. **Consider a T2 codemod leaf.** If migration work needs bulk renames that exceed `henge--format-shifter`'s scope, a dedicated codemod T2 leaf would be the correct escalation target in place of a specialist dispatch. Out of scope for Task 7 but worth queueing.
3. **Body content includes are unresolved for the three common/ specialists.** `chizu--implementation-planner.md`, `shiranui--migration-guide.md`, and `sojobo--system-strategist.md` all reference `../common/agents/.../core.md` includes. The `common/` directory does not exist in this worktree, so the body of these specialists is effectively empty. This is a fleet-merge concern, not an agent-defect concern, but it should be flagged for the merge process. (The integrity tests pass because they validate frontmatter and rename maps, not body resolution.)
4. **`mujina--brand-shapeshifter` is described as the only lightweight-advisory specialist.** If other specialists grow similarly lightweight siblings, consider a `mode: advisory` value in addition to `primary`/`subagent`/`all`. Out of scope for Task 7; queue as a future structural question.
5. **Stale body references in brand-bundle sub-familiars.** `kodama--growth-echo` body still says "you are the Brand Builder growth chizu--implementation-planner" (copy-paste artifact) and `amanojaku--voice-contrarian` body says "anti-voice oni--red-team-reviewer" (same issue). These are body-text defects caught during description review. Description frontmatter is now clean (the rubric shape was applied) but the body still has the same misleading internal-handle reference. Recommended: a separate "body cleanup" pass to remove stale internal-handle references. Out of scope for Task 7 (rubric is frontmatter-only) but worth flagging.
6. **`tanuki--general-trickster` description now names 12 specialists in `Not for:`.** The list will go stale whenever a new specialist is added. Consider extracting the specialist list to a single source of truth (`docs/routing-manifest.json` or a fleet index) and referencing it. Out of scope for Task 7; queue as a future maintenance question.
7. **Brand-bundle sub-familiars all use `openai/gpt-5.2` or `openai/gpt-5.4-mini`.** This is currently a soft cap usage: `gpt-5.2` is the primary for `kudagitsune--fit-diviner`, `kodama--growth-echo`, `akashi--proof-keeper`, `amanojaku--voice-contrarian` (4 subagents); `gpt-5.4-mini` is primary for `hanko--git-seal`, `hyakume--ats-watchman`, `kurabokko--knowledge-keeper` (3 subagents). Neither model is on the reserved cap list (`opencode-go/glm-5.1`, `opencode-go/qwen3.7-max`, `google-vertex/gemini-3.1-pro-preview`, `openai/gpt-5.5`). However, the 4 sub-familiars sharing `gpt-5.2` create a concentration risk: if that model deprecates or rate-limits, the brand-bundle degrades uniformly. Consider diversifying (e.g., `opencode-go/qwen3.6-plus` for `kodama--growth-echo`, `openai/gpt-5.4-mini` for `kudagitsune--fit-diviner`). Out of scope for Task 7; flag for the fleet operator.

## Approval Gate

- Do not apply hierarchy changes until the user approves this file.
