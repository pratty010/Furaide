---
name: puraguin
description: Inspect Claude Code skill-usage analytics. Use when you want an overview of which skills have fired recently, a deep-dive on a specific skill's effectiveness, or to build an evidence pack for improving a skill's description.
---

# /puraguin

Wraps the `puraguin` CLI to surface skill-usage analytics.

## When to invoke

- "show me skill usage overview" → run `puraguin run` then `puraguin report --overview`
- "deep dive on /<skill>" → `puraguin report --skill <skill>`
- "improve /<skill>" → `puraguin improve --skill <skill>`, read the evidence pack from the printed `evidence_path`, then hand off to `Skill(skill-creator)` (relevant parts only) or `Skill(writing-skills)` to revise the SKILL.md description. After the user applies or rejects the rewrite, call `puraguin improve --mark <skill> applied` or `... rejected`.

## Steps

1. Detect intent from the user's message (overview / skill deep-dive / improve / mark / raw query).
2. Shell out via the Bash tool to the relevant `puraguin` subcommand.
3. For overview and deep-dive: parse the printed `urls` list and tell the user the URL to open.
4. For improve: read the evidence pack file at the printed `evidence_path`, summarise the key patterns (~10 lines), then explicitly invoke `Skill(skill-creator)` or `Skill(writing-skills)` with the evidence pack content as input. Do NOT attempt to rewrite the SKILL.md inline yourself.
5. After the user confirms the rewrite was applied or rejected, run the `--mark` subcommand to update the DB.

## Commands

```bash
puraguin run                        # ingest + judge + aggregate
puraguin report --overview          # build + serve overview.html
puraguin report --skill X           # build + serve skill-X.html
puraguin improve --skill X          # build evidence pack
puraguin improve --skill X --mark applied
puraguin improve --skill X --mark rejected
```

## Hand-off rules

Puraguin does NOT rewrite skills. When the user wants to apply an improvement:
- The evidence pack at `~/.puraguin/evidence/<skill>-<date>.md` contains current SKILL.md, exemplars, gaps, and patterns.
- Invoke `Skill(skill-creator)` for skills that need structural changes, or `Skill(writing-skills)` for description-only rewrites.
- Pass the evidence pack content as the input to whichever skill is invoked.
- After the user accepts or rejects the resulting rewrite, record the outcome with `puraguin improve --mark`.
