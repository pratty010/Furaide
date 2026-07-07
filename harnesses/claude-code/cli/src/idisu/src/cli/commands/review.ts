import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { IDISU_DB } from "../../paths.js";
import { openDb } from "../../store/db.js";
import { listStagedArtifactsWithNgrams } from "../../store/repo.js";

// Phase 6 (Approve/Promote/Track/Curate, Task 6.2) — read-only listing of
// the pending-review queue. This module never mutates `artifacts` or the
// filesystem; `promote.ts`/`reject.ts` (Task 6.1) own state transitions.
// It exists so the live-agent-facing `/idisu review` slash command
// (`plugins/idisu/commands/idisu.md`) has a machine-readable feed of
// candidates + evidence pointers to present to the user, before handing
// approved ones to `skill-creator` and then `idisu promote`.

export interface ReviewEntry {
  id: string;
  signature: string | null;
  frequency: number;
  successCount: number;
  failureCount: number;
  sampleSessions: string[];
  /** `pending/<id>/draft.md` — the unauthored placeholder `stage.ts` wrote.
   * `null` only if the artifact somehow has no `surface_path` (shouldn't
   * happen for a `stageCandidate`-produced row, but the column is nullable
   * in `schema.ts`). */
  draftPath: string | null;
  /** `pending/<id>/evidence.md`, derived as a sibling of `draftPath` — same
   * directory `stage.ts#stageCandidate` writes both files into. Not read
   * from the DB (there's no separate column for it); this is the one place
   * that convention is assumed rather than stored. */
  evidencePath: string | null;
  createdAt: string;
}

/**
 * Resolves the CLI-facing `ReviewEntry` shape from a raw
 * `StagedArtifactWithNgrams` row — applies the `?? 0` / `?? []` defaults
 * to the left-joined columns (so callers, including the live agent
 * parsing `--json` output, don't need a null-check per field), parses
 * `sample_sessions` back from its JSON TEXT column shape to a real
 * `string[]`, and derives the `evidencePath` sibling of `draftPath`.
 * The SQL itself lives in `listStagedArtifactsWithNgrams` per the
 * `store/repo.ts` "all SQL helpers live here" convention.
 */
function toReviewEntry(row: ReturnType<typeof listStagedArtifactsWithNgrams>[number]): ReviewEntry {
  const draftPath = row.surface_path ?? null;
  const evidencePath = draftPath ? `${dirname(draftPath)}/evidence.md` : null;
  return {
    id: row.id,
    signature: row.signature ?? null,
    frequency: row.frequency ?? 0,
    successCount: row.success_count ?? 0,
    failureCount: row.failure_count ?? 0,
    sampleSessions: row.sample_sessions
      ? (JSON.parse(row.sample_sessions) as string[])
      : [],
    draftPath,
    evidencePath,
    createdAt: row.created_at,
  };
}

/**
 * Lists all `artifacts` rows with `state='staged'` joined to their
 * `workflow_ngrams` outcome-split stats. The join can miss — e.g. a
 * candidate staged without a corresponding `workflow_ngrams` row (not
 * how the real `dream.ts` pipeline works, but possible for a standalone
 * `stageCandidate` caller) — in which case the outcome-split fields
 * default to `0`/`[]` rather than `null`, so callers (including the
 * live agent parsing `--json` output) don't need a null-check per
 * field. Ordered oldest-first (`created_at ASC`) so the review queue
 * is presented in the order candidates were mined.
 */
export function listPendingReview(db: Database): ReviewEntry[] {
  return listStagedArtifactsWithNgrams(db).map(toReviewEntry);
}

function renderHuman(entries: ReviewEntry[]): void {
  if (entries.length === 0) {
    console.log("[idisu] No candidates pending review.");
    return;
  }
  console.log(`[idisu] ${entries.length} candidate(s) pending review:\n`);
  for (const e of entries) {
    console.log(`- ${e.id}  ${e.signature ?? "(no signature)"}`);
    console.log(
      `    frequency=${e.frequency} success=${e.successCount} failure=${e.failureCount} sessions=${e.sampleSessions.length}`,
    );
    console.log(`    draft:    ${e.draftPath ?? "(missing)"}`);
    console.log(`    evidence: ${e.evidencePath ?? "(missing)"}`);
  }
  console.log(
    "\nRun `/idisu review` in Claude Code for the conversational approval flow.",
  );
}

/**
 * `idisu review [--json]` — headless-safe, read-only. Prints the pending
 * queue either as a formatted list (default) or as a JSON array (`--json`,
 * the shape `plugins/idisu/commands/idisu.md`'s `/idisu review` step parses
 * to drive the live-agent conversational flow). Never promotes or rejects;
 * that's `idisu promote`/`idisu reject` (Task 6.1), invoked by the agent
 * after user approval.
 *
 * Returns the `ReviewEntry[]` so the CLI smoke test (and any future
 * programmatic caller) can assert on the queue shape without parsing
 * stdout. The `cli/index.ts` handler ignores the return value, so this
 * is a non-breaking addition.
 */
export function cmdReview(args: string[]): ReviewEntry[] {
  const json = args.includes("--json");

  const db = openDb(IDISU_DB);
  try {
    const entries = listPendingReview(db);
    if (json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      renderHuman(entries);
    }
    return entries;
  } finally {
    db.close();
  }
}
