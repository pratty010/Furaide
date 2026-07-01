# 🎭 openclaw/, Repo Agent Guide

## What this directory is

Persona workspace configs for the OpenCLAW runtime. Not a software package. Each workspace directory defines a character via SOUL, IDENTITY, MEMORY, AGENTS, TOOLS, and HEARTBEAT markdown files.

## Commands and verification

No build step, no automated tests, no lint. Edits are markdown and config review. Validate paths and persona references by reading.

To add a new persona: `cp -r agents/workspace-kinyo agents/workspace-<name>` and rewrite the files in place. Do not copy `_reference/`.

## Directory map

- `agents/workspace-kinyo/`: Kinyo, general assistant with the GOSHIN v2 security protocol
- `agents/workspace-koda/`: Koda, code-focused
- `agents/workspace-kagakusha/`: Kagakusha, research specialist
- `agents/workspace-tengan/`: Tengan, lightweight general
- Each workspace contains: `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`
- `_reference/`: local-only, gitignored. Live `openclaw.json` configs with real credentials. Never commit.

## Editing rules

- Persona files are content-first. Preserve the voice, memory patterns, and GOSHIN security patterns in `workspace-kinyo`.
- Workspace directories are safe to commit. `_reference/` is not.
- If you change the persona file structure (adding or removing SOUL/IDENTITY/etc files), update the README and the other workspaces to match.
- OpenCLAW is a separate runtime from opencode and claude-code. It does not share their toolchain.

## Always / Ask first / Never

**Always**: Preserve the SOUL/IDENTITY/MEMORY/AGENTS/TOOLS/HEARTBEAT pattern unless you are explicitly redesigning the workspace format.

**Ask first**: Before deleting a workspace, or before changing documented GOSHIN v2 security behavior.

**Never**: Commit `_reference/` contents. Commit real credentials, tokens, or live `openclaw.json` configs.