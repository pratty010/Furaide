#!/usr/bin/env bun
// packages/cli/bin/furaide.ts
//
// CLI entrypoint. Primary runner is bun (`bun run bin/furaide.ts`).
// Node+tsx fallback: `npx tsx bin/furaide.ts`.

import { runCli } from "../src/router.ts";

runCli(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`furaide: fatal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
