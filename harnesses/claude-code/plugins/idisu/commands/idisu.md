---
description: "Īdisu (覚) — capability analytics and improvement suggestions for your Claude Code sessions."
argument-hint: "[dream | profile | report | review | promote <id> | reject <id> | learn --source <dir|file|url|sess> | reset]"
---

# /idisu

Īdisu (覚) — capability analytics and improvement suggestions for your Claude Code sessions.

## Actions

- `dream` or no arg -> runs `idisu dream`, then shows profile summary
- `profile` -> prints current work-style profile
- `report` -> generates and serves the HTML report
- `review` -> conversational approval gate for mined skill candidates awaiting review
- `promote <id> --to <path>` -> moves an approved candidate into an installed skill
- `reject <id> --reason "<text>"` -> archives a rejected candidate
- `learn --source <dir|file|url|session:id>` -> assembles evidence + standards into a skill-authoring prompt and hands off to `skill-creator`
- `reset` -> clears state (event log preserved)

## Steps

1. Parse the subcommand from the argument (default: `dream`).
2. Read `$IDISU_HOME/cli-path` (default: `~/.idisu/cli-path`), then shell out: `$(cat "$IDISU_HOME/cli-path") <subcommand> [args]`
   - If the CLI is not installed, print: "Īdisu not installed. Run `packages/cli/src/targets/claude-code/install.sh` first."
3. For `dream`: after completion, also run `profile` and print the first 20 lines.
4. For `learn`: do NOT rewrite the prompt inline. The CLI assembles evidence + authoring standards; you hand the block to `Skill(skill-creator)` (or `Skill(writing-skills)`) and let that skill author the final `SKILL.md`. See the `learn` section below.

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

## `learn` — skill authoring prompt builder

`learn` assembles evidence + authoring standards into a single markdown prompt and registers the result as a staged `artifacts` row (`origin='learned'`, `state='staged'`, `type='skill'`). It does **not** author the skill — the spec's load-bearing principle is that Īdisu only assembles evidence and prompts, never artifacts. Authoring belongs to the live agent via `Skill(skill-creator)` / `Skill(writing-skills)`.

1. Run `idisu learn --source <dir|file|url|session:id>`:
   - `<dir>` — a directory of files (each file's contents are embedded as evidence, capped at 256 KB per file).
   - `<file>` — a single file (its contents are embedded).
   - `https://...` — a URL (embedded as a pointer; the CLI does not fetch it).
   - `session:<id>` — a session id from `idisu.db` (a compact event-count + event-type histogram is embedded).
2. The CLI prints the instruction block to stdout and writes the same block to `pending/<id>/draft.md`. The block has three sections: a header + `## Authoring Standards` (frontmatter, voice, "When to use this skill", etc.), `## Source Evidence` (the assembled source material), and `## Handoff` containing the `<!-- handoff: skill-creator -->` marker.
3. Hand the block to `Skill(skill-creator)` (or `Skill(writing-skills)`) with the staged draft path. The skill-authoring skill reads the standards, reads the evidence, and authors the final `SKILL.md` in place at the staged `draftPath`.
4. Once the live agent has authored `SKILL.md` in place, the existing `idisu promote <id> --to <path>` flow applies (same as the `review` flow's step 3) — move the authored file to its final surface and flip the artifact to `active`.
5. Idempotency: re-running `idisu learn <source>` for the same source short-circuits via the `findActiveArtifactBySignature` dedup guard (same as `stageCandidate` for mined candidates), so the staged draft isn't re-written on repeat.
