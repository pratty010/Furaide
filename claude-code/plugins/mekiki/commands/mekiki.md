---
description: "Mekiki (目利き — 'appraiser'): inspect Claude Code skill-usage analytics — overview of all skills, per-skill deep-dive, or improvement evidence packs."
argument-hint: "[overview | skill <name> | improve <name> | mark <name> applied|rejected | run]"
---

# /mekiki

Wraps the `mekiki` CLI to surface skill-usage analytics.

## Actions

- `overview` (or no arg) → `mekiki run` then `mekiki report --overview`
- `skill <name>` → `mekiki report --skill <name>`
- `improve <name>` → `mekiki improve --skill <name>`, then hand off evidence pack to `Skill(skill-creator)` or `Skill(writing-skills)`
- `mark <name> applied|rejected` → `mekiki improve --skill <name> --mark applied|rejected`
- `run` → `mekiki run` (ingest + judge + aggregate only, no report)

## Steps

1. Parse `$ARGUMENTS` to detect the action (default: overview).
2. Shell out via Bash to the relevant `mekiki` subcommand.
3. For `overview` and `skill`: parse the printed `urls` list and tell the user the URL to open.
4. For `improve`: read the evidence pack file at the printed `evidence_path` (~10-line summary of key patterns), then explicitly invoke `Skill(skill-creator)` or `Skill(writing-skills)` with the evidence pack content as input. Do NOT rewrite the SKILL.md inline.
5. After the user confirms the rewrite was applied or rejected, run the `--mark` subcommand to update the DB.

## Commands (reference)

```bash
mekiki run                              # ingest + judge + aggregate
mekiki report --overview                # build + serve overview.html
mekiki report --skill <name>            # build + serve skill-<name>.html
mekiki improve --skill <name>           # build evidence pack
mekiki improve --skill <name> --mark applied
mekiki improve --skill <name> --mark rejected
```

## Hand-off rules

Mekiki does NOT rewrite skills. When the user wants to apply an improvement:
- The evidence pack at `~/.mekiki/evidence/<skill>-<date>.md` contains current SKILL.md, exemplars, gaps, and patterns.
- Invoke `Skill(skill-creator)` for structural changes, or `Skill(writing-skills)` for description-only rewrites.
- Pass the evidence pack content as input to whichever skill is invoked.
- After the user accepts or rejects the result, record the outcome with `mekiki improve --mark`.
