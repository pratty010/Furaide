# Intent Routing

## Routing Table

| intent_id | required_inputs | clarification_required | primary_specialist | supporting_specialists | helper_command | safe_redirect |
|-----------|-------------------|----------------------|---------------------|------------------------|-----------------|---------------|
| current_state_assessment | resume, LinkedIn profile, GitHub profile | artifact evidence, role target | kudagitsune | kurabokko | kudagitsune | None |
| role_fit_assessment | resume, target job description | job description, role target | kudagitsune | kurabokko | awase | current_state_assessment |
| linkedin_optimization | requested_sections (headline/about/experience/featured/skills), role target, LinkedIn profile, resume | requested_sections, role target | migaki | hyakume, amanojaku | migaki | current_state_assessment |
| github_proof_building | selected_repos (explicit repo names), proof objective, GitHub profile, resume | selected_repos, proof objective | akashi | kurabokko | akashi | current_state_assessment |
| brand_strategy | resume, LinkedIn, GitHub, personal website | website_goal, brand_direction | kataribe | amanojaku, hyakume | kataribe | linkedin_optimization |
| growth_planning | role_target, time_horizon, profile artifacts, brand strategy | role_target, time_horizon, constraints | kodama | kurabokko, amanojaku | kodama | brand_strategy |
| progress_feedback | existing snapshots and current artifacts | only when no snapshots exist yet | deterministic worker engine (`runProgressComparison`) | None | omokage | current_state_assessment / kurabokko |
| artifact_intake_update | resume, LinkedIn, GitHub, website artifacts | artifact type, update scope | kurabokko | None | kurabokko | None |

## Insufficient Context Rules

The orchestrator MUST ask for clarification before proceeding when any of the following are missing:

- **Artifact evidence:** For any assessment workflow (current_state, role_fit), at least one artifact (resume, LinkedIn, GitHub) must be provided.
- **Role target:** For role_fit_assessment, a target role or job description must be specified.
- **Job description:** For role_fit_assessment, the actual JD text or pasted content is required.
- **Profile surface:** For linkedin_optimization, which LinkedIn sections to optimize (`requested_sections`) must be specified per D-14. Never auto-select sections.
- **Repository scope:** For github_proof_building, which repositories to evaluate (`selected_repos`) must be specified per D-08 and D-12. Never auto-select repos.
- **Website goal and brand direction:** For `brand_strategy` in active website workflow mode, `website_goal` and `brand_direction` must be specified. Do not produce a build-ready website brief without explicit direction.
- **Role target and time horizon:** For `growth_planning`, `role_target` (role title + seniority) and `time_horizon` (3-9 month planning window) must be specified. Without a target role there is no frame for growth recommendations.
- **Progress history:** For `progress_feedback`, at least one stored snapshot must exist. When zero snapshots exist, ask for intake/assessment context first and redirect safely to `kudagitsune` or `kurabokko`.
- **Approval scope:** Before any public-surface mutation or optimization output, the user must confirm the scope of changes recommended.

When clarification is required, the orchestrator returns a clarification response using the `## Clarification Gate` format from synthesis-and-clarification.md and does not dispatch specialists until sufficient context is provided.
