# 🥧 pi-agent/ — Repo Agent Guide

## What this directory is

Source-only extension package for `@mariozechner/pi-coding-agent`. Provides Web Intelligence (RAG, SQLite semantic caching, provider fallbacks), usage/quota tracking (`/usage`), UI themes, and bundled GSD workflows. Pi loads it via the `"pi"` key in `package.json`.

## Commands

- `bun run typecheck` — primary correctness gate (MUST pass with 0 errors)
- `bun pm pack --dry-run` — verify package contents before publish
- `pi -e ./src/index.ts` — run Pi locally to test the extension

## Directory layout

- `src/` — core source: `index.ts` (bootstrap), `web/` (RAG engine), `runtime/` (session state, quota tracking, cost table)
- `themes/` — JSON theme files (`friday.json`, `chimu.json`)
- `skills/` — GSD workflow skills (each dir has `SKILL.md`)
- `agents/` — specialist subagent defs (bundled for `pi-subagents-cc`; Pi doesn't read agents/ from packages natively)
- `knowledge/future_work/` — deprecated/archived code. **Do not import from or modify.**

## Git & branch management

- Dev branch is `dev`. All feature work and fixes go here.
- `main`/`master` is for stable releases only — do not commit directly.
- Use conventional commits (`feat:`, `fix:`, `chore:`).
- Push to `origin dev` after verification passes. Never force push.

## Critical constraints

- **NodeNext**: Imports MUST include `.ts`/`.js` extensions (`import { x } from "./x.ts"`)
- **No build**: `tsconfig.json` has `"noEmit": true`, `allowImportingTsExtensions: true`
- **Peer deps only**: Pi core packages are peers, not bundled deps
- **No TODO system**: Do not reference `todo`, `manage_todo_list`, or `renderTodoBlock`
- **No TUI collisions**: If modifying `src/ui/header.ts`, avoid continuous re-renders without proper `dispose()` cleanup

## Always / Ask first / Never

**Always**: Run `bun run typecheck` after any code change. Use `.ts` extensions on all local imports.

**Ask first**: Before publishing, force-pushing, or modifying the extension's entry-point contract.

**Never**: Remove peer deps from `package.json`. Import from `knowledge/future_work/`. Commit without passing typecheck.