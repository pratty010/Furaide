# 🧠 claude-code/ — Repo Agent Guide

## What this directory is

Satori plugin + `github` skill / `hanko--git-seal` support bundle for Claude Code. Shared engines in `cli/`, installed by `scripts/bootstrap.sh`.

## Commands

- `cd cli/src/satori && bun test` — run Satori test suite
- `cd cli/src/satori && bun run typecheck` — TypeScript type check
- `cd cli/src/satori && bun run lint` — biome lint
- `bash scripts/bootstrap.sh --help` — bootstrap installer

## Directory map

- `cli/` — Satori CLI engine (Bun/TypeScript + Python)
- `plugins/satori/` — Claude Code plugin: hooks, commands, manifest
- `config/` — install-target material: CLAUDE.md, settings.json, statusline-command, hanko--git-seal agent
- `scripts/` — bootstrap and uninstall scripts
- `docs/` — reference docs

## Editing rules

- Plugin marketplace path expectations: `.claude-plugin/marketplace.json` at repo root is the discovery protocol
- Hooks and plugin manifests are runtime-sensitive (paths relative to `CLAUDE_PLUGIN_ROOT`)
- `config/` is install-target material; don't confuse it with source-only docs
- `cli/src/satori` is the primary code area for Satori engine changes

## Always / Ask first / Never

**Always**: Run Satori tests/typecheck when touching CLI or plugin code.

**Ask first**: Before changing marketplace/distribution assumptions or plugin manifest paths.

**Never**: Commit captured payloads from hook debugging (`SATORI_CAPTURE_HOOK_PAYLOADS` output). Commit real user data to test fixtures.
