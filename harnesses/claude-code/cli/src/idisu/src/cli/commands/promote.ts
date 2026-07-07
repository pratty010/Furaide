import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { IDISU_DB, PENDING_DIR } from "../../paths.js";
import { openDb } from "../../store/db.js";
import { getArtifactById, promoteArtifact } from "../../store/repo.js";

// Phase 6 (Approve/Promote/Track/Curate, Task 6.1) — moves a staged
// candidate (Phase 5's `mine/stage.ts#stageCandidate` output) into an
// installed skill surface.

export interface PromoteOptions {
  /** Overrides `PENDING_DIR` — tests point this at a scratch temp dir, same
   * pattern as `mine/stage.ts#StageCandidateOptions`. */
  pendingDir?: string;
}

export interface PromoteResult {
  id: string;
  surfacePath: string;
  promotedAt: string;
}

/**
 * Core promote logic, split out from `cmdPromote` (the CLI wrapper below) so
 * tests can call it directly without going through argv parsing / exit codes
 * — same split as `stageCandidate` vs. `dream.ts`'s pipeline wiring.
 *
 * Moves (not copies) `pending/<id>/draft.md` to `<to>/SKILL.md`, then removes
 * the whole `pending/<id>/` directory — including `evidence.md`. The pending
 * directory's only job was holding draft + evidence for the reviewer; once
 * promoted, the evidence trail lives on in the DB (the `nodes`/`edges` rows
 * `stage.ts` wrote), so a leftover `evidence.md` would just be an orphaned
 * file with no further purpose. Rejection (`reject.ts`) takes the opposite
 * choice — it preserves both files under `archive/` — because a rejected
 * candidate is exactly the case the spec's "invalidate-never-delete"
 * philosophy is protecting; a *promoted* one has already been fully
 * captured by the `artifacts` row's `state='active'` + `surface_path`.
 *
 * Throws (does not print/exit) on: unknown id, artifact not in `'staged'`
 * state, or a missing `draft.md` on disk — callers decide how to surface
 * that (the CLI wrapper turns it into a stderr message + exit code 1).
 */
export function promoteCandidate(
  db: Database,
  id: string,
  to: string,
  opts: PromoteOptions = {},
): PromoteResult {
  const pendingDir = opts.pendingDir ?? PENDING_DIR;

  const artifact = getArtifactById(db, id);
  if (!artifact) {
    throw new Error(`No artifact found with id: ${id}`);
  }
  if (artifact.state !== "staged") {
    throw new Error(
      `Artifact ${id} is in state '${artifact.state}', not 'staged' — cannot promote.`,
    );
  }

  const candidateDir = join(pendingDir, id);
  const draftPath = join(candidateDir, "draft.md");
  if (!existsSync(draftPath)) {
    throw new Error(`No draft.md found for candidate ${id} at ${draftPath}`);
  }

  mkdirSync(to, { recursive: true });
  const surfacePath = join(to, "SKILL.md");
  renameSync(draftPath, surfacePath);
  rmSync(candidateDir, { recursive: true, force: true });

  const promotedAt = new Date().toISOString();
  promoteArtifact(db, id, surfacePath, promotedAt);

  return { id, surfacePath, promotedAt };
}

function parseArgs(args: string[]): { id?: string; to?: string } {
  const id = args[0];
  const toIdx = args.indexOf("--to");
  const to = toIdx !== -1 ? args[toIdx + 1] : undefined;
  return { id, to };
}

/**
 * `idisu promote <id> --to <path>` — headless-safe: parses argv, runs, prints
 * one result/error line, exits 0/1. No prompts.
 */
export function cmdPromote(args: string[]): void {
  const { id, to } = parseArgs(args);
  if (!id || !to) {
    console.error("Usage: idisu promote <id> --to <path>");
    process.exit(1);
  }

  const db = openDb(IDISU_DB);
  try {
    const result = promoteCandidate(db, id, to);
    console.log(`[idisu] Promoted ${id} -> ${result.surfacePath}`);
  } catch (err) {
    console.error(
      `[idisu] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  } finally {
    db.close();
  }
}
