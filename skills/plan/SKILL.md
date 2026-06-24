---
name: plan
description: Use when you need to write a detailed, executor-ready implementation plan. Creates a structured plan file with exact file paths, code snippets, verification commands, and no judgment calls left to the implementer. Invoke when the task is multi-file, has uncertain approach, or changes ripple across the codebase.
---

# /plan

Write an implementation plan for the current task.

## When to invoke

- Multi-file changes (3+ files)
- Uncertain approach or design choice
- Changes with cross-codebase ripple effects
- Before delegating to a subagent
- Anytime alignment is needed before building

## Steps

1. Read the relevant files and understand the current state.
2. Identify the exact changes needed: file paths, line numbers, code snippets.
3. Determine execution order (dependencies between steps).
4. Write the plan to `~/.claude/plans/<slug>.md` using the structure below.
5. Return the plan path.

## Plan structure

```markdown
# <Title>

## Context
<What exists today, what problem this solves>

## Execution steps

**Step N — <name>**
- File: `path/to/file.ext` (line X–Y)
- Change: <exact diff or replacement>
- Verification: `command to verify`

## Verification
<Commands to run after all steps to confirm success>
```

## Rules

- Every step must have an exact file path.
- Every step must have a verification command.
- No "TBD", no "as appropriate", no judgment calls.
- If the plan exceeds output context, chunk it (Part 1/N → confirm → Part 2/N).
