# 🌸 Furaidē, Monorepo Agent Guide

## What this repo is

5-component monorepo: four harness integrations under `harnesses/` plus a shared layer at repo root (`skills/`, `docs/`, `scripts/`, `packages/`, `graphify-out/`). `graphify-out/` holds the architecture knowledge graph. Consult it before broad codebase work.

## Before editing

- Read the nearest `AGENTS.md` in the directory tree.
- Check the component README before large changes.
- Use `bun`/`bunx` for JS/TS, `uv` for Python tool envs.

## Repo map

| Component | What it is | Local guide |
|---|---|---|
| `harnesses/opencode/` | 30-agent OpenCode fleet plus installer | `harnesses/opencode/AGENTS.md` |
| `harnesses/claude-code/` | Īdisu + Rejion plugins plus github skill support bundle | `harnesses/claude-code/AGENTS.md` |
| `harnesses/pi-agent/` | Pi coding-agent extension package | `harnesses/pi-agent/AGENTS.md` |
| `harnesses/openclaw/` | OpenCLAW persona workspace configs | `harnesses/openclaw/AGENTS.md` |
| Root shared layer | `skills/`, `docs/`, `scripts/`, `packages/`, `graphify-out/` | this file |

## Commands

No monorepo-wide test command. Each component has its own correctness gate. Refer to the local AGENTS.md.

Common repo-wide tooling:

- `lefthook.yml`, `.shellcheckrc`, and `trivy.yaml` at root drive the pre-push hooks: `shellcheck`, `semgrep-diff`, `trivy-quick`, run sequentially. Pushes take about 8 minutes.
- `.github/workflows/` runs CI on `dev` pushes and PRs to `master`. `ci.yml` only runs `harnesses/claude-code/cli` pytest. opencode and pi-agent have no CI job. `security.yml` runs trivy, semgrep, and snyk scans.

## Always / Ask first / Never

**Always**: Keep changes scoped to one component. Preserve user changes. Run the component-specific verification step.

**Ask first**: Deleting directories. Moving shared files across components. Pushing or creating PRs.

**Never**: Commit secrets. Stage `harnesses/openclaw/_reference/` or any `future-work/` path. Edit installed or generated state as source of truth. Assume one component's rules apply to another. Force-push.

## Cross-component rules

- If you change shared contracts (`docs/`, `scripts/`, `skills/`, `packages/`, root files, cross-harness naming), inspect all affected READMEs and AGENTS files.
- If you change installer paths, check docs, scripts, and tests together.
- `.claude-plugin/marketplace.json` at repo root is the Claude Code plugin discovery protocol. Keep it at root.
- Branches: only `dev` and `master` persist locally. Feature work goes on `dev`, stable releases on `master`. Conventional commits, SSH-signed, with `Co-Authored-By` trailer.
