---
name: plan
description: Plan a phase of work using structured GSD workflow. Creates task breakdown, dependency analysis, and execution plan.
---

# Plan Skill

Help the user plan a phase of development work.

## Process

1. **Understand the goal**: Ask what needs to be built and why
2. **Break down tasks**: Decompose into 2-5 concrete, actionable tasks
3. **Identify dependencies**: Which tasks block others? What can run in parallel?
4. **Define acceptance criteria**: Each task gets measurable done conditions
5. **Estimate scope**: Flag tasks that seem too large and suggest splits

## Output Format

For each task provide:
- **Name**: Action-oriented (e.g., "Create user auth endpoint")
- **Files**: Exact paths created or modified
- **Action**: Specific implementation steps
- **Verify**: Command to prove completion
- **Done**: Measurable acceptance criteria

## Guidelines

- Prefer vertical slices (feature-complete) over horizontal layers (all models, then all APIs)
- Each task should be completable in 15-60 minutes
- Include verification commands (test runs, grep checks, curl commands)
- Flag external dependencies or human actions needed
