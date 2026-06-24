# 🌸 Furaidē — Monorepo Agent Guide

## What this repo is

5-component monorepo with harness integrations under `harnesses/` and shared resources at root. `graphify-out/` holds the architecture knowledge graph — consult it before broad codebase work.

## Before editing

- Read the nearest `AGENTS.md` in the directory tree
- Check component README before large changes
- Use `bun`/`bunx` for JS/TS, `uv` for Python tool envs

## Repo map

| Component | What it is | Local guide |
|---|---|---|
| `harnesses/opencode/` | 30-agent OpenCode fleet + installer | `harnesses/opencode/AGENTS.md` |
| `harnesses/claude-code/` | Satori plugin + github skill bundle | `harnesses/claude-code/AGENTS.md` |
| `harnesses/pi-agent/` | Pi coding-agent extension package | `harnesses/pi-agent/AGENTS.md` |
| `harnesses/openclaw/` | OpenCLAW persona workspace configs | `harnesses/openclaw/AGENTS.md` |

## Commands

No monorepo-wide test command. Each component has its own correctness gate — refer to its local AGENTS.md.

## Always / Ask first / Never

**Always**: Keep changes scoped to one component. Preserve user changes. Run component-specific verification.

**Ask first**: Deleting directories. Moving shared files across components. Pushing or creating PRs.

**Never**: Commit secrets. Edit installed/generated state as source of truth. Assume one component's rules apply to another.

## Cross-component rules

- If changing shared contracts (`docs/`, `scripts/`, `skills/`, root files, cross-harness naming), inspect all affected READMEs and AGENTS files
- If changing installer paths, check docs + scripts + tests together
