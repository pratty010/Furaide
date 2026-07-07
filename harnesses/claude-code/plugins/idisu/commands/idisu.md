---
description: "Īdisu (覚) — capability analytics and improvement suggestions for your Claude Code sessions."
argument-hint: "[dream | profile | backlog [--status=open] | report | improve <capability-id> | mark <id> accepted|rejected | review]"
---

# /idisu

Īdisu (覚) — capability analytics and improvement suggestions for your Claude Code sessions.

## Actions

- `dream` or no arg -> runs `idisu dream`, then shows profile summary
- `profile` -> prints current work-style profile
- `backlog [--status=open]` -> lists open improvement suggestions
- `report` -> generates and serves the HTML report
- `improve <capability-id>` -> shows improvement brief for handoff to skill-creator
- `mark <id> accepted|rejected` -> records outcome after applying an improvement
- `review` -> conversational approval gate for mined skill candidates awaiting review

## Steps

1. Parse the subcommand from the argument (default: `dream`).
2. Read `$IDISU_HOME/cli-path` (default: `~/.idisu/cli-path`), then shell out: `$(cat "$IDISU_HOME/cli-path") <subcommand> [args]`
   - If the CLI is not installed, print: "Īdisu not installed. Run `packages/cli/src/targets/claude-code/install.sh` first."
3. For `dream`: after completion, also run `profile` and print the first 20 lines.
4. For `improve`: after printing the brief, invoke `Skill(skill-creator)` or `Skill(writing-skills)` with the brief as context. Never rewrite the capability inline.
5. After the user applies or rejects an improvement, run `idisu mark <id> accepted|rejected`.

## `review` — conversational approval gate

`review` is read-only on the CLI side (`idisu review --json` never mutates state); every decision is made by you and the user in conversation, then executed via `idisu promote`/`idisu reject`.

1. Run `idisu review --json` to fetch the pending queue. Each entry has `{id, signature, frequency, successCount, failureCount, sampleSessions, draftPath, evidencePath, createdAt}`. If the array is empty, tell the user there's nothing pending and stop.
2. For each candidate, in order:
   a. `Read` `draftPath` and `evidencePath` directly — `--json` only gives you pointers, not content.
   b. Present a concise summary: the signature (tool sequence), frequency and success/failure split, and the sample session ids. Note that `draftPath` is an unauthored placeholder (Phase 5 output), not a finished skill.
   c. Ask the user: approve, edit/discuss, or reject.
3. On approval: hand the candidate off to `Skill(skill-creator)` conventions to author the real `SKILL.md` in place at `draftPath` (frontmatter `name` + `description`, body per skill-creator's structure) — do not just keep the placeholder content. Once authored, run `idisu promote <id> --to <path>` where `<path>` is the target skill directory the user confirms (e.g. a `skills/<name>/` directory), which moves the authored file to `<path>/SKILL.md` and flips the artifact to `active`.
4. On rejection: ask for a short reason, then run `idisu reject <id> --reason "<reason>"`. This archives the candidate (draft + evidence preserved under `archive/`) and records the signature so future dream passes don't re-surface it.
5. Move to the next candidate until the queue is empty or the user stops.
