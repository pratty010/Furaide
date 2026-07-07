import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { ARCHIVE_DIR, IDISU_DB, PENDING_DIR } from "../../paths.js";
import { openDb } from "../../store/db.js";
import {
  getArtifactById,
  insertRejectedSignature,
  rejectArtifact,
} from "../../store/repo.js";

// Phase 6 (Approve/Promote/Track/Curate, Task 6.1) — retires a staged
// candidate without deleting its evidence, and records its signature so a
// future dream pass's mining step can skip re-surfacing the same pattern
// (that lookup isn't wired up in this task — `rejected_signatures` is
// written here; nothing yet reads it back during mining).

export interface RejectOptions {
  /** Overrides `PENDING_DIR` — see `promote.ts#PromoteOptions`. */
  pendingDir?: string;
  /** Overrides `ARCHIVE_DIR` — same testability reason. */
  archiveDir?: string;
}

export interface RejectResult {
  id: string;
  archivePath: string;
  rejectedAt: string;
}

/**
 * Core reject logic, split out from `cmdReject` for direct testability (see
 * `promoteCandidate`'s equivalent note in `promote.ts`).
 *
 * Moves the whole `pending/<id>/` directory (both `draft.md` and
 * `evidence.md`) to `archive/<id>/` — unlike promote, nothing is deleted:
 * the spec's "invalidate-never-delete" philosophy means a rejection is a
 * state change, not a purge, so the historical record stays browsable under
 * `archive/`. Also inserts a `rejected_signatures` row keyed on the
 * artifact's `signature` column (rejection memory) and flips
 * `artifacts.state` to `'rejected'`.
 *
 * Throws (does not print/exit) on: unknown id, artifact not in `'staged'`
 * state, or a missing `pending/<id>/` directory on disk.
 */
export function rejectCandidate(
  db: Database,
  id: string,
  reason: string,
  opts: RejectOptions = {},
): RejectResult {
  const pendingDir = opts.pendingDir ?? PENDING_DIR;
  const archiveDir = opts.archiveDir ?? ARCHIVE_DIR;

  const artifact = getArtifactById(db, id);
  if (!artifact) {
    throw new Error(`No artifact found with id: ${id}`);
  }
  if (artifact.state !== "staged") {
    throw new Error(
      `Artifact ${id} is in state '${artifact.state}', not 'staged' — cannot reject.`,
    );
  }

  const candidateDir = join(pendingDir, id);
  if (!existsSync(candidateDir)) {
    throw new Error(
      `No pending candidate directory found for ${id} at ${candidateDir}`,
    );
  }

  mkdirSync(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, id);
  // Clear any stale prior archive at this id before the move — renameSync
  // fails if the destination directory already exists and is non-empty.
  rmSync(archivePath, { recursive: true, force: true });
  renameSync(candidateDir, archivePath);

  const rejectedAt = new Date().toISOString();
  if (artifact.signature) {
    insertRejectedSignature(db, {
      signature: artifact.signature,
      reason,
      rejected_at: rejectedAt,
    });
  }
  rejectArtifact(db, id);

  return { id, archivePath, rejectedAt };
}

function parseArgs(args: string[]): { id?: string; reason?: string } {
  const id = args[0];
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx !== -1 ? args[reasonIdx + 1] : undefined;
  return { id, reason };
}

/**
 * `idisu reject <id> --reason "<text>"` — headless-safe: parses argv, runs,
 * prints one result/error line, exits 0/1. No prompts.
 */
export function cmdReject(args: string[]): void {
  const { id, reason } = parseArgs(args);
  if (!id || !reason) {
    console.error('Usage: idisu reject <id> --reason "<reason>"');
    process.exit(1);
  }

  const db = openDb(IDISU_DB);
  try {
    const result = rejectCandidate(db, id, reason);
    console.log(`[idisu] Rejected ${id} -> archived at ${result.archivePath}`);
  } catch (err) {
    console.error(
      `[idisu] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  } finally {
    db.close();
  }
}
