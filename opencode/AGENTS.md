# 🌸 Furaidē — Monorepo Agent Guide

## What this repo is

5-component monorepo: `opencode/`, `claude-code/`, `pi-agent/`, `openclaw/`, `common/`. `graphify-out/` holds the architecture knowledge graph — consult it before broad codebase work.

## Before editing

- Read the nearest `AGENTS.md` in the directory tree
- Check component README before large changes
- Use `bun`/`bunx` for JS/TS, `uv` for Python tool envs

## Repo map

| Component | What it is | Local guide |
|---|---|---|
| `opencode/` | 30-agent OpenCode fleet + installer | `opencode/AGENTS.md` |
| `claude-code/` | Satori plugin + github skill bundle | `claude-code/AGENTS.md` |
| `pi-agent/` | Pi coding-agent extension package | `pi-agent/AGENTS.md` |
| `openclaw/` | OpenCLAW persona workspace configs | `openclaw/AGENTS.md` |
| `common/` | Shared skills, docs, installer scripts | `common/README.md` |

## Commands

No monorepo-wide test command. Each component has its own correctness gate — refer to its local AGENTS.md.

## Always / Ask first / Never

**Always**: Keep changes scoped to one component. Preserve user changes. Run component-specific verification.

**Ask first**: Deleting directories. Moving shared files across components. Pushing or creating PRs.

**Never**: Commit secrets. Edit installed/generated state as source of truth. Assume one component's rules apply to another.

## Cross-component rules

- If changing shared contracts (`common/`, root docs, cross-harness naming), inspect all affected READMEs and AGENTS files
- If changing installer paths, check docs + scripts + tests together
