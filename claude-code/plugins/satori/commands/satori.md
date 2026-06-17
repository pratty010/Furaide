---
description: "Satori (覚) — capability analytics and improvement suggestions for your Claude Code sessions."
argument-hint: "[dream | profile | backlog [--status=open] | report | improve <capability-id> | mark <id> accepted|rejected]"
---

# /satori

Satori (覚) — capability analytics and improvement suggestions for your Claude Code sessions.

## Actions

- `dream` or no arg -> runs `satori dream`, then shows profile summary
- `profile` -> prints current work-style profile
- `backlog [--status=open]` -> lists open improvement suggestions
- `report` -> generates and serves the HTML report
- `improve <capability-id>` -> shows improvement brief for handoff to skill-creator
- `mark <id> accepted|rejected` -> records outcome after applying an improvement

## Steps

1. Parse the subcommand from the argument (default: `dream`).
2. Read `~/.satori/cli-path`, then shell out: `$(cat ~/.satori/cli-path) <subcommand> [args]`
   - If the CLI is not installed, print: "Satori not installed. Run `claude-code/scripts/bootstrap.sh` first."
3. For `dream`: after completion, also run `profile` and print the first 20 lines.
4. For `improve`: after printing the brief, invoke `Skill(skill-creator)` or `Skill(writing-skills)` with the brief as context. Never rewrite the capability inline.
5. After the user applies or rejects an improvement, run `satori mark <id> accepted|rejected`.
