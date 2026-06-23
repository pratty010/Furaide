---
description: Evaluate GitHub repositories for proof quality with per-repo dispositions, proof-gap detection, and next-project recommendations. Requires an explicit list of repos chosen by the user.
argument-hint: "<repo1,repo2,...> [proof-objective]"
agent: kitsune--brand-orchestrator
---

Set intent to github_proof_building and proceed.

Before dispatching, confirm selected_repos is an explicit list provided by the user — never auto-select repos. Also ask for the proof objective (what the user wants to demonstrate) if not provided.

$ARGUMENTS
