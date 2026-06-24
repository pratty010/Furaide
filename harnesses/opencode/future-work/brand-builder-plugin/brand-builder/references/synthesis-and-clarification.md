# Synthesis And Clarification

## Clarification Gate

Before specialist dispatch, the orchestrator checks required inputs for the selected intent.

- If required context is missing, ask targeted clarification questions only for missing fields.
- Do not run specialist analysis on thin or ambiguous evidence.
- Clarification responses must preserve intent and pause dispatch until resolved.

## Dispatch Ordering

Use deterministic ordering to keep synthesis consistent:

1. Primary specialist for selected intent.
2. Supporting specialist(s) for evidence quality, machine legibility, or challenge review.
3. Anti-voice review pass for unsupported claims and overconfidence checks when applicable.

If dispatch fails for one supporting specialist, continue with available results and mark uncertainty.

## Specialist Result Intake

Normalize each specialist output into a shared shape before synthesis:

- `specialist`
- `workflow_domain`
- `evidence_used`
- `judgment`
- `confidence`
- `worker_outputs_used`
- `risks_or_uncertainties`
- `recommended_next_action`

Reject or re-request outputs that omit evidence or confidence disclosures.

### Current-State Assessment Intake

When the workflow domain is `current_state_assessment`, the diagnostician output must also include:

- `scores: { signal, evidence, visibility, narrative }` — the four dimension scores (0-100 integers)
- `dominant_failure_mode: { dimension, reason }` — lowest-scoring dimension with explanation
- `improvements: [{ action, impact, ease, priority }]` — top 3 ranked improvements
- `next_best_action` — concrete next step for the user

The orchestrator must:
1. Verify that scores are present and 0-100 integers.
2. Check that confidence level reflects artifact sufficiency — if only 1-2 artifacts are available but confidence is "high," challenge the diagnostician output via anti-voice review.
3. Preserve coverage gaps and thin-evidence caveats in the final response — do not smooth over low confidence.
4. Include `recommended_next_action` as the next workflow to run (typically `awase` or `kurabokko`).

## single_final_response

The orchestrator must return exactly one user-facing answer per request. The answer must contain all fields below:

- `request_understood`
- `evidence_used`
- `specialists_consulted`
- `answer`
- `uncertainty_or_missing_context`
- `recommended_next_action`

No multi-message specialist fan-out is allowed. Synthesis stays orchestrator-owned.

## Failure Recovery

When execution degrades:

- **Missing input failure:** trigger clarification gate and pause.
- **Specialist unavailable:** proceed with remaining specialists, mark reduced confidence, and provide fallback next action.
- **Conflicting specialist judgments:** surface conflict in `uncertainty_or_missing_context`, prefer evidence-backed overlap, and request one narrow clarification if needed.
- **Template contract failure:** request corrected specialist output before final synthesis when possible.

### Role-Fit Assessment Intake

When the workflow domain is `role_fit_assessment`, the diagnostician output must also include:

- `scores: { fit_score, bracket, bucket_scores }` — the weighted fit score, 5-band bracket, and all 6 bucket scores
- `blockers` — hard blockers (missing must-have skills, severe mismatch, weak proof). Must be non-empty when applicable.
- `easy_wins` — easy wins (presentation gaps, near-miss preferred skills). May be empty.
- `strengths` — bucket scores ≥ 70 threshold. May be empty.
- `role_family_slug` — stable lowercase slug for longitudinal tracking
- `parsed_job` — the complete parsedJob audit trail from `parseJobDescription`
- `snapshot_id` — ID of the persisted role-fit snapshot for provenance

The orchestrator must:
1. Verify blocker-first ordering in the final response — blockers MUST precede easyWins, which MUST precede strengths. Re-order the diagnostician judgment if this contract is violated by the specialist.
2. Check that confidence claims match the JD source quality — if `sourceQuality` is `partial` but confidence is `high`, challenge the diagnostician output via anti-voice review.
3. Preserve uncertainty instead of smoothing it away — if the JD was partially fetched or profile artifacts are thin, the uncertainty caveat must appear before any strengths in the final response.
4. Verify that the role-family snapshot was persisted (snapshot_id present) before returning the final response. If missing, surface this as a partial-result caveat.
5. Verify that parsed requirement buckets are visible in the output — the user must see what the JD was parsed into (must-have skills, preferred skills, responsibilities, qualifications) so they can evaluate parser quality.

## Safe Redirects

If request intent is unsupported or under-specified, redirect to nearest safe workflow from intent routing.

- Explain why redirect is safer for current evidence.
- Preserve user goal in rewritten task framing.
- Provide the next immediate step under `recommended_next_action`.

## Surface Optimization Synthesis Rules

When both `linkedin_optimization` and `github_proof_building` specialist outputs are present, the orchestrator MUST enforce the following ordering and contract rules.

### LinkedIn-First Ordering (D-14)

The final `answer` body MUST present LinkedIn optimization output before GitHub proof-building output. This is a locked user decision from D-14 — do not reorder.

**Ordering rule:**
1. LinkedIn section diagnoses, caveats, and rewrite variants appear first.
2. GitHub repo dispositions, proof gaps, improvements, and next-project ideas appear second.
3. When only one surface output is available, present that surface without the other — do not fabricate missing sections.

### LinkedIn Optimization Intake

When the workflow domain is `linkedin_optimization`, the specialist output must include:

- `section_diagnoses` — per-section objects for headline, about, experience, featured, and skills
- `rewrite_variants` — per-section variant arrays with locked counts (headline=3, about=2, experience=2/bullet, featured=2, skills=1)
- `voice_risks` — anti-voice reviewer findings with `flagged_claims`, `contradictions`, `overconfidence_notes`, and `assessment`
- `stale_evidence_warning` — present if evidence >30 days per D-19; otherwise `null`
- `missing_artifact_flag` — `true` if LinkedIn artifact is missing (diagnose-only mode per D-20); otherwise `false`
- `confidence` — `"high"` | `"medium"` | `"low"`
- `uncertainties` — explicit list of what the specialist is unsure about
- `recommended_next_action` — what the user should do next

The orchestrator must:
1. **Caveats before variants:** Present `voice_risks.assessment` and `uncertainties` before the variant text for each section. Low-confidence or missing LinkedIn evidence MUST surface the caveat prominently — do not bury thin-evidence warnings after confident-sounding variant text.
2. **Stale evidence gate:** If `stale_evidence_warning` is present, surface it prominently before detailed recommendations. Recommend `kurabokko` refresh.
3. **Diagnose-only mode (D-20):** If `missing_artifact_flag` is `true`, present the section diagnoses but note that full rewrite variants are unavailable until the LinkedIn profile artifact is provided. Do not block — diagnose-only output still has value.
4. **Phase 3/4 context:** Variant rationale should reference Phase 3 assessment scores and Phase 4 role-fit blockers where relevant, but the primary audience is the user evaluating whether to adopt the variant.
5. **Section visibility requirement:** The intake must require section visibility for `headline`, `about`, `experience`, `featured`, and `skills`. Missing-section flags should be surfaced before any rewrite suggestions.
6. **Anti-voice gate:** If `voice_risks` contains unresolved `flagged_claims` or `contradictions`, surface these to the user alongside the affected variants. Do not suppress anti-voice findings.

### GitHub Proof Building Intake

When the workflow domain is `github_proof_building`, the specialist output must include:

- `selected_repos` — explicit array of repo names chosen by the user (D-08, D-12)
- `repo_dispositions` — per-repo objects with `disposition` (Highlight/Improve soon/Keep but de-emphasize/Do not surface), scores, and qualitative notes
- `evaluation_order` — the explicit ordering statement per D-09: `"portfolio value -> proof quality -> engineering quality"`
- `proof_gaps` — detected gaps across the repo set with `repo_name`, `gap_description`, and `projected_impact`
- `proof_improvements` — top-level summary of the most impactful improvements across all evaluated repos
- `next_project_ideas` — concrete, actionable project recommendations derived from gaps and role-family blockers (GH-04)
- `stale_evidence_warning` — present if evidence >30 days per D-19
- `confidence` — `"high"` | `"medium"` | `"low"`
- `uncertainties` — factors that reduce confidence
- `recommended_next_action` — what the user should do next

The orchestrator must:
1. **Selected-repo scope visibility:** Display exactly which repos were evaluated. The user must see the scope boundary — repos outside `selected_repos` MUST NOT appear in dispositions or recommendations.
2. **Visible repo dispositions:** Present each repo with its disposition label, scores, and qualitative diagnosis. Do not collapse multi-repo results into a single summary.
3. **Proof gaps before improvements:** Present proof gaps before proof improvements so the user understands what's missing before what to do about it.
4. **Next-project ideas visible:** The final output must include both proof improvements (changes to existing repos) and next-project ideas (new repos to build) per GH-04. These are distinct categories — do not merge them.
5. **Evaluation order statement:** The `evaluation_order` from D-09 must appear verbatim in the output so the user understands how dispositions were determined.
6. **Advisory posture:** All recommendations are advisory. Do not prescribe auto-modifications, code generation, or repo mutations.

### Single recommended_next_action

When both surface outputs are present, the orchestrator selects exactly one `recommended_next_action` for the final response:
- Prefer the LinkedIn `recommended_next_action` when LinkedIn was requested (surface optimization starts with profile positioning).
- Fall back to the GitHub `recommended_next_action` when only GitHub output is available.
- When neither specialist provides one, recommend `bb-current-state` as the default next step.

## Progress Feedback Intake

When the workflow domain is `progress_feedback`, intake must come from deterministic worker output (`runProgressComparison`) and include:

- `arrows` for signal/evidence/visibility/narrative using `↑`, `↓`, `→`
- `meaningfulChanges` using the locked 10-point threshold
- `narrativeSummary` explaining meaningful movement (or stability)
- `failureModeChange` and `workflowChange` drift where present
- `surfaceEvents` tied to snapshot trigger/artifact-version evidence
- `recommendedNextWorkflow` inherited from latest snapshot history
- `confidence` and explicit uncertainty when history depth is thin

The orchestrator must:
1. Preserve visible arrow notation in user-facing output (no hidden internal-only deltas).
2. Explain meaningful-change narrative and any failure-mode/workflow drift.
3. Reference surface events as evidence-backed labels (no fabricated specialist prose).
4. Emit exactly one final `recommended_next_action`, inherited from latest snapshot `recommendedNextWorkflow` when available.
5. Keep inline summaries concise in mixed responses; allow `omokage` to include per-snapshot breakdown detail.
6. If no snapshot history exists, use safe redirect behavior instead of claiming comparison results.

### Uncertainty Aggregation

Combine uncertainties from all consulted specialists into the `uncertainty_or_missing_context` field. Include:
- Explicit uncertainties from each specialist output
- Stale evidence warnings from any specialist
- Missing context flags (e.g., missing LinkedIn artifact, thin evidence, partial JD)

Do not smooth over or minimize uncertainties — they are preserved verbatim from specialist outputs.

## Brand and Growth Synthesis Rules

When both `brand_strategy` and `growth_planning` specialist outputs are present, the orchestrator MUST enforce the following ordering and contract rules.

### Brand-First Ordering

The final `answer` body MUST present brand strategy output before growth planning output. The brand strategy section (including website brief, proof shelf, and builder-boundary caveats) appears first; the growth planning section (recurring gaps, project/proof recommendations, certificate gating, timeline) appears second.

**Ordering rule:**
1. Brand strategy: website-needed recommendation, site job, website brief, proof shelf, builder-boundary caveat.
2. Growth planning: recurring gaps, project/proof recommendations, certificate recommendations (if GROW-02 passed), what-not-to-pursue, timeline plan.
3. When only one specialist output is available, present that output without the other — do not fabricate missing sections.

### Brand Strategy Intake

When the workflow domain is `brand_strategy`, the specialist output must include:

- `workflow_domain` — always `"brand_strategy"` for orchestrator routing
- `mode` — `"advisory"` or `"active"` — mirrors the input mode
- `evidence_used` — list of artifact types consumed
- `site_recommended` — boolean from the runtime engine; whether a dedicated website is recommended
- `brand_direction` — the user's stated or inferred brand positioning
- `site_job` — the website's purpose statement (active mode)
- `website_brief` — the concrete build-ready brief containing `site_job`, `audience`, `section_map`, proof notes, and voice constraints. Full in active mode, minimal in advisory mode.
- `proof_shelf` — what proof lives on-site (summaries) vs off-site (full GitHub repos, LinkedIn recommendations)
- `alignment_checklist` — cross-surface alignment items between LinkedIn, GitHub, resume, and website
- `stale_evidence_warning` — present if evidence >30 days per D-19; otherwise `null`
- `builder_handoff` — explicit boundary statement: build-ready brief, no implementation, no deployment, no hosting
- `confidence` — `"high"` | `"medium"` | `"low"` with rationale
- `uncertainties` — explicit list of what the specialist is unsure about
- `recommended_next_action` — single highest-leverage next step

The orchestrator must:
1. **Builder boundary enforcement:** The final answer MUST include an explicit advisory boundary caveat stating that the brand strategy is advisory-only — no website implementation, deployment, or hosting is included. The brief is build-ready for handoff to a future builder workflow.
2. **Website brief visibility:** The website brief content (site job, audience, section map) must be visible in the final answer body when in active mode. When in advisory mode, present the website-needed recommendation without a full brief.
3. **Proof shelf visibility:** On-site vs off-site proof placement must be explained in the final answer so the user understands which content lives where.
4. **Uncertainty before confidence:** If confidence is `low` or `medium`, surface the reasons (stale evidence, missing surfaces, unvalidated brand direction) before presenting confident-sounding recommendations.
5. **Builder handoff:** The final answer must include a clear builder handoff note — "when you're ready to implement this brief, the builder workflow can handle local site creation." Do not offer implementation, deployment, or hosting steps in this phase.

### Growth Planning Intake

When the workflow domain is `growth_planning`, the specialist output must include:

- `workflow_domain` — always `"growth"` for orchestrator routing
- `role_family_slug` — computed from the target role for longitudinal tracking
- `evidence_used` — array of snapshot IDs, role-fit history items, and profile state references consumed
- `recurring_gaps` — array of detected repeated gaps, each with `blocker_label`, `occurrence_count`, `trend`, and `role_family_context`
- `project_proof_recommendations` — array of project/proof actions, each with `gap`, `recommendation`, and `priority`. **This is the default path.**
- `certificate_recommendations` — array of certificate recommendations (empty when GROW-02 gate does not pass), each with `gap`, `certificate`, `rationale`, `why_beats_project_proof`, and `projected_timeline`
- `certificate_gating_explanation` — when certificates are non-empty: an explicit statement that the GROW-02 gate passed and why. When empty: a statement that project/proof alternatives cover the detected gaps.
- `what_not_to_pursue` — array of explicitly discouraged actions with rationale tied to the user's horizon and role context
- `timeline_plan` — phased plan structure with `horizon_months` and `phases` (each with `name`, `focus`, `actions`)
- `confidence` — `"high"` | `"medium"` | `"low"` with evidence depth notes
- `uncertainties` — factors that reduce confidence (thin history, single-snapshot, missing context)
- `recommended_next_action` — single highest-leverage step with rationale and suggested timeframe

The orchestrator must:
1. **Project/proof-first ordering:** Project/proof recommendations must appear before any certificate content in the final answer body. This is the default growth path — certificate recommendations are conditional on the GROW-02 gate.
2. **Certificate gating visibility:** When `certificate_recommendations` is non-empty, the GROW-02 gate explanation must appear BEFORE the specific certificate names and details. The user must understand why the certificate was recommended before seeing which certificate. When empty, the certificate gating explanation must state that project/proof alternatives cover the detected gaps — do not silently omit certificate guidance.
3. **Recurring-gap visibility:** All recurring gaps must appear before recommendations so the user understands what problems are being addressed. Each gap must include the occurrence count and trend direction.
4. **What-not-to-pursue visibility:** Explicitly discouraged actions must appear in the final answer. These are focus-preserving: they prevent the user from spending effort on low-signal activities.
5. **Advisory posture:** All growth recommendations are advisory. The final answer must include an explicit advisory posture statement — no automatic enrollment, no profile modification, no publication.
6. **Timeline visibility:** The phased timeline plan must appear in the final answer with phase names and focus areas.

### Combined Ordering: Brand Before Growth

When both brand and growth specialist outputs are present in a single response:
1. Brand strategy section appears first (website recommendation, brief, proof shelf, builder boundary).
2. Growth planning section appears second (recurring gaps, project/proof recommendations, certificate gating, timeline).
3. Evidence from both specialists is merged and de-duplicated.
4. Uncertainties from both specialists are aggregated.

### Single recommended_next_action

When both brand and growth outputs are present, the orchestrator selects exactly one `recommended_next_action` for the final response. This single recommended_next_action aggregation rule prevents the user from receiving conflicting next-step guidance:
- Prefer the brand `recommended_next_action` when brand was explicitly requested (brand positioning informs growth direction).
- Fall back to the growth `recommended_next_action` when brand was advisory-only or growth was the primary request.
- When neither specialist provides one, recommend `bb-current-state` as the default next step.
