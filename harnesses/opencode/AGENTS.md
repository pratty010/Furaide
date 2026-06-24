# ⛩️ opencode/ — Repo Agent Guide

## What this directory is

Source tree for the OpenCode fleet. Install-target runtime files live under `config/`. Three kinds of deliverables: fleet config (agents, plugins, scripts), optional brand-builder bundle (Kitsune domain), standalone companion tools (`tools/opencode-all/`).

## Directory map

- `config/` — install-target source files (`AGENTS.md`, `fleet-manifest.json`, `opencode.jsonc`)
- `agents/` — 39 shikigami definitions (12 specialists + 16 subagents + 2 escape-hatch + 9 brand-builder)
- `plugins/` — 4 gate plugins (nio, nurikabe, komainu, migawari)
- `scripts/` — installer, uninstaller, workflow state engine, agent support scripts
- `rules/` — memory contract and other rules
- `docs/` — architecture, workflows, operator guide, routing manifest, model guides
- `command/` — brand-builder slash commands
- `skills/` — brand-builder skills
- `brand-builder-plugin/` — opt-in plugin with its own deps
- `tools/opencode-all/` — standalone companion tool (shipped independently)

## Commands

- `bun test scripts/tests/` — run installer/config tests
- `bash scripts/install-fleet.sh --dry-run` — preview installation
- `bash scripts/install-fleet.sh --list` — list installable components
- Brand-builder may need `cd brand-builder-plugin && bun install` for its own deps

## Editing rules

- `config/fleet-manifest.json` is the installer source of truth — edit here, not in installer code
- `config/opencode.jsonc` is the runtime config source copied into installs
- `config/AGENTS.md` is the installed fleet usage guide, not this repo guide
- When moving paths, update scripts + tests + README together
- Gate plugins and routing manifest paths are runtime-sensitive (nio.js, nurikabe.js exec `scripts/workflow-state.mjs` at runtime)

## Always / Ask first / Never

**Always**: Run `bun test scripts/tests/` after changing installer, manifest, config, agent inventory, or plugin wiring.

**Ask first**: Before removing docs, rules, plugins, or opt-in brand-builder assets.

**Never**: Patch `node_modules`. Remove gate plugins casually. Edit installed user paths as if they were source.

## Roadmap awareness

- `tools/opencode-all/` is shipped and independent
- `docs/superpowers/specs/2026-06-18-web-tools-v0.1-design.md` is planning-stage work, not shipped runtime behavior
