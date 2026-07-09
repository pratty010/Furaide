# 🥧 pi-agent/, Repo Agent Guide

## What this directory is

Source-only extension package for `@mariozechner/pi-coding-agent`. Provides web intelligence (RAG, SQLite semantic cache, provider fallbacks), usage and quota tracking via the `/usage` command, UI themes, and bundled GSD workflow skills. Pi loads it through the `"pi"` key in `package.json`.

## Commands

- `bun run typecheck` is the primary correctness gate. Must pass with 0 errors.
- `bun pm pack --dry-run` verifies package contents before publish.
- `pi -e ./src/index.ts` runs Pi locally with the extension loaded.

Prerequisites: bun and Pi CLI v0.72.1 or later.

## Directory layout

- `src/`: core source. `index.ts` (bootstrap), `web/` (RAG engine), `runtime/` (session state, quota tracking, cost table)
- `themes/`: `friday.json`, `chimu.json`
- `skills/`: GSD workflow skills (commit, plan, research, review). Each has a `SKILL.md`.
- `agents/`: 12 specialist subagent defs. Bundled for `pi-subagents-cc`. Pi does not read `agents/` from packages natively.
- `config/`: `tools.yml` (provider on/off toggles), `system.example.yml` (system prompt template)
- `src/APPEND_SYSTEM.md`: injected tool and UI guidance
- `knowledge/future_work/`: deprecated or archived code. Do not import from or modify it.

## Git and branch management

- Dev branch is `dev`. All feature work and fixes go here.
- `master` is for stable releases only. Do not commit directly.
- Use conventional commits (`feat:`, `fix:`, `chore:`).
- Push to `origin dev` after verification passes. Never force push.

## Critical constraints

- NodeNext imports must include `.ts`/`.js` extensions. Write `import { x } from "./x.ts"`, not `"./x"`.
- No build step. `tsconfig.json` has `"noEmit": true` and `allowImportingTsExtensions: true`.
- Pi core packages are peer deps, not bundled deps. Do not move them into `dependencies`.
- No TODO system. Do not reference `todo`, `manage_todo_list`, or `renderTodoBlock`.
- If you modify `src/ui/header.ts`, clean up with `dispose()` or you will cause continuous TUI re-renders.

## Always / Ask first / Never

**Always**: Run `bun run typecheck` after any code change. Use `.ts` extensions on all local imports.

**Ask first**: Before publishing, force-pushing, or modifying the extension entry-point contract.

**Never**: Remove peer deps from `package.json`. Import from `knowledge/future_work/`. Commit without passing typecheck.
