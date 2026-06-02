---
name: github
description: "GitHub Workflow Executor — spawn a Haiku subagent to handle git commits, pushes, PR creation, and CI monitoring with human-in-the-loop approval"
trigger: |
  When the user asks for help with:
  - committing code changes
  - pushing branches to GitHub
  - creating or managing pull requests
  - checking CI status or PR checks
  - branch management
  - anything that requires git or gh CLI operations
trigger_negative: |
  Don't trigger for:
  - Code review or commentary on diffs (use /code-review)
  - Brainstorming branch strategy (use /brainstorm)
  - Asking about how to use git (just answer directly)
---

# GitHub Workflow

## Purpose

This skill spawns a Haiku subagent with instructions for handling all git and GitHub operations. The Haiku subagent reads `claude-code/config/GITHUB.md` and executes git commits, pushes, PR creation, and status monitoring with human-in-the-loop approval for critical operations.

## How It Works

When you invoke `/github <task>`, this skill:

1. Reads `claude-code/config/GITHUB.md` (full GitHub workflow rules)
2. Spawns a Haiku subagent with instructions covering:
   - Commit message validation (Conventional Commits format)
   - When to ask for approval (commit, push, PR creation)
   - Safe branch operations (dev/feat/fix/chore/docs only, never master)
   - Read-only ops that don't need approval (status, diff, log, pr view)
3. The subagent executes your git/gh tasks and reports results

## Examples

```
/github commit the changes with message "feat(opencode): add hanko subagent"

/github create a PR to dev with title "feat: GitHub workflow hardening"

/github check the status of my current branch

/github push to dev and then create a PR

/github show me the latest 5 commits with their signatures
```

## Subagent Behavior

The Haiku subagent has:
- `bash: allow` — can run git and gh commands
- `question: ask` — **will ask you before any commit, push, or PR operation**
- Read-only ops (status, log, pr view) run without asking

It enforces:
- Conventional Commits format (type(scope): description)
- Safe branch naming (dev, feat/*, fix/*, chore/*, docs/*, never master)
- Setup verification (SSH signing, GitHub key, lefthook, gitleaks)
- No force-push or --no-verify bypasses

## Outputs

The subagent reports:
- Commit hash and signature status
- Push confirmation with refs
- PR URL and auto-applied labels
- CI status (jobs passing/failing)
- Error messages and fix suggestions

## Reference

Full rules: `claude-code/config/GITHUB.md`

OpenCode equivalent: use `@hanko` subagent directly in specialist workflows
