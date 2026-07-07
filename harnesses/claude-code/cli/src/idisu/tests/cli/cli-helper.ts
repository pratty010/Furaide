// Shared helper for the CLI smoke tests in promote.test.ts,
// reject.test.ts, and review.test.ts.
//
// The CLI wrappers `cmdPromote` / `cmdReject` / `cmdReview` resolve
// their target DB at the module-level constant `IDISU_DB`, which
// `src/paths.ts` reads from `process.env.IDISU_HOME` exactly once
// at module load. Because `paths.ts` is module-cached across the
// whole test process, an in-process `process.env.IDISU_HOME` set
// from a per-test `beforeAll` hook is silently ignored once any
// earlier test (alphabetically: `config.test.ts`) has already
// imported `paths.ts`.
//
// The cleanest workaround that doesn't require touching
// `src/paths.ts` is to run the CLI in a *subprocess* via
// `Bun.spawn`: the child has its own process, its own env, and
// reads `IDISU_HOME` fresh on its first import of `paths.ts`.
// The tests in this directory use this helper to invoke
// `src/cli/index.ts` as a real subprocess with a custom env, and
// then assert on the exit code / stdout / stderr shape — a true
// end-to-end smoke test of the CLI surface the live agent drives.
//
// Setup that the CLI expects to find on disk (the artifacts row in
// the SQLite db, the candidate's `draft.md` / `evidence.md` files)
// is done in-process via the existing `openDb(path)` / direct
// `writeFileSync` calls — those use explicit paths and are not
// affected by the `IDISU_HOME` cache problem.

import { spawn } from "bun";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = resolve(__dirname, "../../src/cli/index.ts");

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `bun run src/cli/index.ts <args...>` as a subprocess with
 * `IDISU_HOME` redirected at `home` and returns the exit code,
 * stdout, and stderr. Used by the CLI smoke tests to exercise the
 * real CLI surface (parseArgs → openDb → console.log/exit) without
 * the in-process `IDISU_HOME` module-cache trap described at the
 * top of this file.
 */
export async function runCli(
  home: string,
  args: string[],
): Promise<CliResult> {
  const proc = spawn({
    cmd: ["bun", "run", CLI_ENTRY, ...args],
    env: { ...process.env, IDISU_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export { join };
