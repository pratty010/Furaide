---
name: commit
description: Create a git commit with AI-generated message. Analyzes staged changes and writes a concise, meaningful commit message.
---

# Commit Skill

Create a well-crafted git commit from staged changes.

## Process

1. **Check status**: Run `git status` to see staged and unstaged changes
2. **Analyze diff**: Run `git diff --staged` to understand what changed
3. **Read recent history**: Run `git log --oneline -5` to match commit style
4. **Draft message**: Write commit message matching project conventions
5. **Commit**: Execute `git commit -m "..."` with the crafted message

## Commit Message Format

```
type(scope): concise description

Optional body explaining why, not what.
```

Types: feat, fix, refactor, docs, test, chore, style, perf

## Guidelines

- Message should explain WHY, not WHAT (the diff shows what)
- Keep subject line under 72 characters
- Use imperative mood ("add feature" not "added feature")
- Reference issue numbers if applicable
- Do NOT commit .env files or credentials
- If nothing is staged, inform the user and suggest what to stage
