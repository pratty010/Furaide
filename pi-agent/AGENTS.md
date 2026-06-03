# AGENTS.md

This file provides guidance to AI coding agents (OpenCode, Claude Code, Cursor, etc.) working in this repository.

## What This Is

`F.R.I.D.A.Y.` is a source-only extension package for `@mariozechner/pi-coding-agent`. It provides advanced Web Intelligence (RAG, SQLite semantic caching, provider fallbacks), extensive usage/quota tracking (`/usage`), UI themes, and bundled GSD workflows. 

Pi loads this package via the `"pi"` key in `package.json`, which declares entry points for `src/index.ts`, `themes/`, and `skills/`.

## Commands

```bash
bun run typecheck        # Type-check the source (only non-trivial validation). MUST pass with 0 errors.
bun pm pack --dry-run    # Verify package contents before publish
pi -e ./src/index.ts     # Run pi locally to test the extension
```

**Type-check is the primary correctness gate.** There are no automated tests. You MUST run `bunx tsc --noEmit` after modifying code to verify your changes.

## Architecture & Directory Layout

### Core Source (`src/`)
- **`index.ts`**: The main bootstrap file. It registers the web module, themes, and intercepts `before_agent_start` to inject `APPEND_SYSTEM.md` into the agent's context.
- **`web/`**: The core RAG engine. Uses `bun:sqlite` for `KnowledgeDB` caching, local transformers for embeddings, and integrates providers like Brave, Tavily, Exa, and Context7.
- **`runtime/`**: Manages extensive session state, including API token quotas, usage tracking, and the LiteLLM cost table.

### Bundled Assets
- **`themes/`**: JSON theme files (`friday.json`, `chimu.json`).
- **`skills/`**: GSD workflow skills. Each skill is a directory containing a `SKILL.md` file with YAML frontmatter.
- **`agents/`**: Contains specialist subagent definitions (e.g., `coding-agent.md`). Note: Pi does not natively read `agents/` from packages. These are bundled for use alongside extensions like `pi-subagents-cc`.

### Archives (`knowledge/future_work/`)
Contains deprecated/archived code from previous iterations (e.g., the old Friday Todo system and the Pi Chimu Orchestrator). **DO NOT import from or modify code in this directory.**

## Git & Branch Management

- **Primary Development Branch**: All feature work, bug fixes, and agentic development MUST happen on the `dev` branch.
- **Production Branch**: The `main` (or `master`) branch is strictly reserved for stable releases and publishing. **DO NOT** commit directly to `main` or `master`.
- **Committing**: Always verify changes using `bun run typecheck` before creating a commit. Use conventional commit messages (e.g., `feat:`, `fix:`, `chore:`).
- **Pushing**: Push changes to `origin dev` only after verifying they pass the correctness gate. Never force push without explicit user consent.

## Critical Constraints & Rules

- **NodeNext Modules**: Imports MUST include `.ts` or `.js` extensions when importing local files (e.g., `import { init } from "./init.ts"`). If you omit the extension, the Pi runtime will crash.
- **Source-Only (No Build)**: `tsconfig.json` has `"noEmit": true` and `allowImportingTsExtensions: true`. We distribute the raw `.ts` files.
- **Peer Dependencies Only**: Pi core packages (`@mariozechner/pi-ai`, `pi-coding-agent`, `pi-tui`) are peers, not bundled dependencies. Do not install them as normal dependencies.
- **NO TODO SYSTEM**: The `todo` task management module (previously part of global Friday) has been completely and surgically removed from this package. Do not attempt to use, import, or reference `todo`, `manage_todo_list`, or `renderTodoBlock`.
- **NO TUI COLLISIONS**: If modifying `src/ui/header.ts`, do not introduce continuous re-renders (`setInterval`) without proper cleanup in the `dispose()` callback, as this will cause layout thrashing in the terminal.