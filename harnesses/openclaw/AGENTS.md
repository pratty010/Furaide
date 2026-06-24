# 🎭 openclaw/ — Repo Agent Guide

## What this directory is

Persona workspace configs for the OpenCLAW runtime, not a software package. Each workspace defines a character's SOUL, IDENTITY, MEMORY, and tools.

## Commands / verification

No build step. No automated tests. Edits are markdown/config review. Validate paths and persona references manually.

## Directory map

- `agents/workspace-kinyo/` — Kinyo persona (general assistant, GOSHIN v2 security)
- `agents/workspace-koda/` — Koda persona (code-focused)
- `agents/workspace-kagakusha/` — Kagakusha persona (research specialist)
- `agents/workspace-tengan/` — Tengan persona (lightweight general)
- `_reference/` — local-only, gitignored (live configs with real credentials)

## Editing rules

- Persona files are content-first; preserve voice, memory patterns, and GOSHIN security patterns
- Workspace directories are safe to commit; `_reference/` must never be committed
- If changing persona file structure (adding/removing SOUL/MEMORY/etc files), update README accordingly

## Always / Ask first / Never

**Always**: Preserve SOUL/IDENTITY/MEMORY/AGENTS/TOOLS/HEARTBEAT pattern unless explicitly redesigning the workspace format.

**Ask first**: Before deleting a workspace. Before changing documented security behavior (e.g., GOSHIN v2).

**Never**: Commit `_reference/` contents. Commit real credentials or tokens. Commit live `openclaw.json` configs.
