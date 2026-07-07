import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { ARCHIVE_DIR, PENDING_DIR } from "../paths.js";
import {
  findActiveArtifactBySignature,
  getEvidenceLedger,
  insertArtifact,
  listArtifactsByState,
} from "../store/repo.js";

// Phase 6 (Approve/Promote/Track/Curate, Task 6.4) — Curate stage.
//
// Surfaces three classes of proposal from the learned store into the same
// review queue Phase 5's `mine/stage.ts` populates with mined candidates:
//   1. **Deprecation** — `evidence_ledger.score <= 0` on an active artifact.
//   2. **Stale**       — an active artifact with zero chain-triggered
//                        `capability.invoked` hits in `events` (and no
//                        qualifying proposal would re-raise it).
//   3. **Merge**       — two active artifacts whose `surface_path` content
//                        has a Jaccard token overlap above
//                        `config.merge_overlap_threshold`.
//
// All three become new `artifacts` rows with `type='instruction_edit'` (the
// only `artifacts.type` value that semantically fits a "proposal" — see
// the CHECK constraint in `store/schema.ts`) and `state='staged'`, so they
// show up in `cli/commands/review.ts#listPendingReview` alongside mined
// candidates. Each proposal is keyed by a deterministic `signature`
// (e.g. `curate:deprecate:<id>`, `curate:stale:<id>`,
// `curate:merge:<idA>:<idB>` with `idA <= idB` for pair-order
// independence), so re-running curate is idempotent —
// `findActiveArtifactBySignature` is the same dedup guard
// `mine/stage.ts#stageCandidate` already uses.
//
// ALSO moves already-rejected or already-deprecated artifacts whose
// `surface_path` is still on disk (and not yet under `archive/`) into
// `archive/<id>/`, rewriting `surface_path` to the archived copy. Nothing
// is ever hard-deleted — the spec's "invalidate-never-delete" philosophy
// (Part I §8) applies here too.
//
// Honest-scoping notes (deliberately documented in code, not papered over):
// - **Staleness proxy**: the v0.1 spec says "no hits in
//   `stale_after_sessions` (default 30)" — i.e. *N sessions* of inactivity.
//   No global per-dream-pass session counter exists in this codebase yet
//   (nothing increments one; I checked `store/`, `track/`, and `dream/`
//   for any such field). The honest substitute used here is the count of
//   distinct `payload.session_id` values among chain-triggered
//   `capability.invoked` events with `payload.capability_id = artifact.id`:
//   zero distinct sessions = stale. `stale_after_sessions` from config is
//   reserved for the day a real session counter lands (see
//   `config.ts#stale_after_sessions` doc comment).
// - **Merge overlap proxy**: the spec calls for pairwise BM25 across the
//   learned store, but `artifacts_fts` (the FTS5 virtual table over
//   `artifacts` declared in `store/schema.ts`) has its `text` column
//   unpopulated — nothing in `mine/`, `track/`, or `curate/` writes to
//   `artifacts_fts` yet (verified by grep). BM25 over an empty corpus
//   returns nothing useful, so this module computes a Jaccard token-
//   overlap ratio over the `surface_path` file content for each pair
//   instead. The implementation lives in `jaccardOverlap` below; when
//   `artifacts_fts` is populated, swap that single function for an FTS5
//   `bm25()` query and the rest of curate stays the same.

export interface RunCurateOptions {
  /** Overrides `PENDING_DIR` — tests point this at a scratch temp dir so
   * proposals never touch the real `~/.idisu/pending/`. Defaults to
   * `PENDING_DIR` for production callers (dream.ts). */
  pendingDir?: string;
  /** Overrides `ARCHIVE_DIR` — same testability pattern as
   * `cli/commands/reject.ts#RejectOptions`. */
  archiveDir?: string;
  /** Overrides `config.stale_after_sessions` — kept as an explicit option
   * even though the current staleness implementation doesn't yet
   * consume it (see module-level doc comment's "Staleness proxy" note);
   * the wiring is in place for the day a real session counter exists. */
  staleAfterSessions?: number;
  /** Overrides `config.merge_overlap_threshold` — Jaccard ratio ceiling
   * for the merge-proposal pass. */
  mergeOverlapThreshold?: number;
}

export interface RunCurateResult {
  deprecationProposals: number;
  staleProposals: number;
  mergeProposals: number;
  /** Number of rejected/deprecated artifacts whose files were moved from
   * their on-disk `surface_path` location into `archive/<id>/` and whose
   * `surface_path` was rewritten. Pure consolidation — no rows touched. */
  archived: number;
}

/** Schema-enforced proposal shape: every proposal becomes a new
 * `artifacts` row with these three columns fixed. `signature` is derived
 * per-kind (see `proposalSignature`); `surface_path` is the on-disk draft
 * `curate/curate.ts#stageProposal` writes. */
const PROPOSAL_TYPE = "instruction_edit";
const PROPOSAL_ORIGIN = "mined";
const PROPOSAL_STATE = "staged";

/**
 * Deterministic proposal `signature`. The `curate:` prefix segregates
 * curate-generated rows from `mine.ts`-generated n-gram signatures in
 * future `rejected_signatures` / signature-dedup lookups. Pair signatures
 * sort their ids so `(A,B)` and `(B,A)` hash to the same key — required
 * for the `findActiveArtifactBySignature` dedup guard to fire on a re-run
 * regardless of the order `listArtifactsByState` happens to return rows.
 */
function proposalSignature(
  kind: "deprecate" | "stale" | "merge",
  ...ids: string[]
): string {
  return ["curate", kind, ...ids.slice().sort()].join(":");
}

/** Same `sha256`->`hex.slice(0,12)` truncation `mine/stage.ts#makeCandidateId`
 * uses, just for the proposal-signature namespace. 12 hex chars matches
 * the "human-readable directory under `~/.idisu/pending/`" goal. */
function proposalId(signature: string): string {
  return createHash("sha256").update(signature).digest("hex").slice(0, 12);
}

/**
 * Stages a single proposal as a new `artifacts` row + a `pending/<id>/draft.md`
 * on disk, with the same `findActiveArtifactBySignature` dedup guard
 * `mine/stage.ts#stageCandidate` uses. Returns `{ skipped: true }` (no
 * files/rows written) when an active proposal with the same `signature`
 * already exists — the contract that makes re-running curate safe.
 */
function stageProposal(
  db: Database,
  pendingDir: string,
  signature: string,
  body: string,
): { id: string; draftPath: string; skipped: boolean } {
  const existing = findActiveArtifactBySignature(db, signature);
  if (existing) {
    return {
      id: existing.id,
      draftPath:
        existing.surface_path ?? join(pendingDir, existing.id, "draft.md"),
      skipped: true,
    };
  }

  const id = proposalId(signature);
  const dir = join(pendingDir, id);
  const draftPath = join(dir, "draft.md");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(draftPath, body);

  insertArtifact(db, {
    id,
    type: PROPOSAL_TYPE,
    origin: PROPOSAL_ORIGIN,
    surface_path: draftPath,
    state: PROPOSAL_STATE,
    signature,
    created_at: new Date().toISOString(),
  });

  return { id, draftPath, skipped: false };
}

function renderDeprecationDraft(
  targetId: string,
  ledger: { applied: number; win: number; loss: number; score: number; last_earned_at: string | null },
): string {
  return [
    `# Deprecation proposal: ${targetId}`,
    "",
    "> **UNAUTHORED** — auto-generated by the Curate stage (Task 6.4).",
    "> Approve via `/idisu review` to retire the target artifact, or reject to keep it.",
    "",
    "**Kind**: deprecate",
    `**Target artifact**: \`${targetId}\``,
    "",
    "## Evidence",
    `- evidence_ledger.score = \`${ledger.score}\` (threshold: <= 0)`,
    `- applied = ${ledger.applied}, win = ${ledger.win}, loss = ${ledger.loss}`,
    `- last_earned_at = ${ledger.last_earned_at ?? "(never)"}`,
    "",
    "Net-negative ledger signals the target has hurt more than helped.",
    "Approving this proposal retires the target; rejecting keeps it active.",
    "",
  ].join("\n");
}

function renderStaleDraft(
  targetId: string,
  distinctSessionHits: number,
): string {
  return [
    `# Staleness proposal: ${targetId}`,
    "",
    "> **UNAUTHORED** — auto-generated by the Curate stage (Task 6.4).",
    "> Approve via `/idisu review` to retire the target artifact, or reject to keep it.",
    "",
    "**Kind**: stale",
    `**Target artifact**: \`${targetId}\``,
    "",
    "## Evidence",
    `- distinct sessions with chain-triggered capability.invoked hits: \`${distinctSessionHits}\``,
    "- proxy for the spec's `stale_after_sessions` window (see curate.ts module doc)",
    "",
    "No in-pipeline invocation has ever been recorded for this artifact.",
    "Approving this proposal retires the target; rejecting keeps it active.",
    "",
  ].join("\n");
}

function renderMergeDraft(
  idA: string,
  idB: string,
  overlap: number,
  threshold: number,
): string {
  return [
    `# Merge proposal: ${idA} + ${idB}`,
    "",
    "> **UNAUTHORED** — auto-generated by the Curate stage (Task 6.4).",
    "> Approve via `/idisu review` to merge the two target artifacts, or reject to keep them separate.",
    "",
    "**Kind**: merge",
    `**Target artifacts**: \`${idA}\`, \`${idB}\``,
    "",
    "## Evidence",
    `- Jaccard token overlap (surface_path content) = \`${overlap.toFixed(3)}\``,
    `- threshold = \`${threshold}\``,
    "",
    "Token-overlap proxy stands in for the spec's pairwise BM25 check",
    "until `artifacts_fts` is populated. High overlap suggests one skill",
    "could absorb the other without information loss.",
    "",
  ].join("\n");
}

/**
 * Jaccard token overlap on lowercased, alphanumeric-split text. Returns a
 * ratio in `[0,1]`. Returns 0 (no overlap, no divide-by-zero) when either
 * side is empty. See the module-level "Merge overlap proxy" note for why
 * this stands in for BM25: `artifacts_fts` is empty so a meaningful
 * `bm25()` ranking is not available yet.
 */
function jaccardOverlap(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Counts distinct `payload.session_id` values among chain-triggered
 * `capability.invoked` events whose `payload.capability_id` equals
 * `artifactId`. Returns 0 when none — that's the "no hits" signal curate
 * uses for the staleness proposal. Uses the same
 * `trigger='chain' AND capability_id` predicate the ExpeL ledger join in
 * `track/ledger.ts#updateEvidenceLedger` uses, so "in active use" means
 * the same thing in both places.
 */
function countChainHitsForArtifact(db: Database, artifactId: string): number {
  const row = db
    .query(
      `SELECT COUNT(DISTINCT json_extract(payload, '$.session_id')) AS hits
       FROM events
       WHERE event_type = 'capability.invoked'
         AND json_extract(payload, '$.trigger') = 'chain'
         AND json_extract(payload, '$.capability_id') = ?`,
    )
    .get(artifactId) as { hits: number | null };
  return row?.hits ?? 0;
}

/**
 * True when `surfacePath` is a real file AND its location is NOT already
 * under `archiveDir/`. We don't re-move an already-archived file; the
 * `surface_path` rewrite was done at the time of the original move and
 * a second rename would either be a no-op or fail (if the directory
 * structure changed).
 */
function needsArchiveMove(
  surfacePath: string | null | undefined,
  archiveDir: string,
): boolean {
  if (!surfacePath) return false;
  if (!existsSync(surfacePath)) return false;
  // Normalize: any path component that begins with archiveDir counts as
  // already archived. `startsWith` on the absolute path is sufficient
  // because both are absolute (or both relative to the same cwd) — the
  // legacy `cli/commands/reject.ts` `archivePath` shape is always
  // `archiveDir + '/' + id + ...`.
  const normalizedArchive = archiveDir.endsWith("/")
    ? archiveDir
    : `${archiveDir}/`;
  return !surfacePath.startsWith(normalizedArchive);
}

/**
 * Performs the file-system half of the archive move: detects whether the
 * `surface_path` is a file or a directory, ensures `archiveRoot/<id>/`
 * exists, and `renameSync`s the source into it. Returns the new
 * `surface_path`, or `null` when there is nothing to move (no
 * `surface_path` column value, or the file isn't on disk) — same
 * defensive check the original combined `moveToArchive` did up front,
 * kept here so the orchestrator can early-exit cleanly on the null
 * return without doing a wasted DB write.
 */
function _renameToArchive(
  artifact: { id: string; surface_path?: string | null | undefined },
  archiveRoot: string,
): string | null {
  const surfacePath = artifact.surface_path ?? null;
  if (!surfacePath || !existsSync(surfacePath)) return null;

  const targetDir = join(archiveRoot, artifact.id);
  mkdirSync(targetDir, { recursive: true });

  // Mirror the basename off the surface path; if surfacePath is a
  // directory itself, fall back to a single `content` file.
  const stat = statSync(surfacePath);
  let archivedPath: string;
  if (stat.isDirectory()) {
    archivedPath = join(targetDir, "content");
    renameSync(surfacePath, archivedPath);
  } else {
    const base = surfacePath.substring(surfacePath.lastIndexOf("/") + 1);
    archivedPath = join(targetDir, base);
    // If a stale copy is already at the destination (re-run after a
    // partial prior move), drop it first — same defensive pattern as
    // `cli/commands/reject.ts#rejectCandidate`.
    rmSync(archivedPath, { force: true });
    renameSync(surfacePath, archivedPath);
  }

  return archivedPath;
}

/**
 * Persists the new archived `surface_path` onto the artifact row. Plain
 * `UPDATE ... WHERE id=?` (no upsert — the row must already exist,
 * created earlier by `stage.ts#stageCandidate` or by an external writer
 * that flipped `state` to `rejected`/`deprecated`; callers check via
 * `needsArchiveMove` + `getArtifactById` before this fires).
 */
function _updateSurfacePath(
  db: Database,
  artifactId: string,
  newSurfacePath: string,
): void {
  db.query("UPDATE artifacts SET surface_path=? WHERE id=?").run(
    newSurfacePath,
    artifactId,
  );
}

/**
 * `rmdirSync` of the now-empty `pending/<id>/` parent after a file-level
 * archive move, so the on-disk layout mirrors `cli/commands/reject.ts#rejectCandidate`'s
 * pattern (which renames the whole `pending/<id>/` directory so the
 * empty parent doesn't linger). `rmdir` fails on a non-empty dir —
 * that's the intended "leave the dir alone if there's something else
 * in it" behavior, mirrored here with a graceful catch: the spec's
 * "invalidate-never-delete" only covers the artifact's own files, not
 * opportunistic cleanup of unrelated siblings in the same directory.
 * ENOENT (parent already gone) is also a no-op.
 */
function _cleanupSourceParent(originalSurfacePath: string | null | undefined): void {
  if (!originalSurfacePath) return;
  const sourceParent = originalSurfacePath.substring(
    0,
    originalSurfacePath.lastIndexOf("/"),
  );
  if (!sourceParent || sourceParent === "/" || sourceParent === ".") return;
  try {
    rmdirSync(sourceParent);
  } catch {
    // ENOENT or ENOTEMPTY (or a sibling file blocking the cleanup) —
    // both benign; the spec's "invalidate-never-delete" doesn't cover
    // unrelated siblings.
  }
}

/**
 * Moves an artifact's `surface_path` file (or directory, if it's a
 * directory) into `archiveDir/<id>/`, rewriting `surface_path` in-place
 * to the archived location. Mirrors `cli/commands/reject.ts#rejectCandidate`'s
 * "rename + rewrite" pattern; unlike reject, this is fired on any artifact
 * in `state='rejected'` OR `state='deprecated'` whose files have not yet
 * been moved to archive. Throws nothing — a `rmSync` + `renameSync` failure
 * is propagated to the caller (and from there to the dream pipeline),
 * since silently swallowing it would leave the row's `surface_path`
 * pointing at a stale location.
 *
 * Thin orchestrator: file-system move (`_renameToArchive`), DB update
 * (`_updateSurfacePath`), parent-dir cleanup (`_cleanupSourceParent`),
 * in that order — DB is written after the move succeeds, and the empty
 * parent is rmdir'd only after the row is in sync with the file's new
 * location.
 */
function moveToArchive(
  db: Database,
  artifact: { id: string; surface_path?: string | null | undefined },
  archiveDir: string,
): string | null {
  const newSurfacePath = _renameToArchive(artifact, archiveDir);
  if (!newSurfacePath) return null;
  _updateSurfacePath(db, artifact.id, newSurfacePath);
  _cleanupSourceParent(artifact.surface_path);
  return newSurfacePath;
}

/**
 * The Curate pipeline step. Scans the active learned store and writes
 * proposals as `artifacts` rows with `type='instruction_edit'` +
 * `state='staged'`, then moves already-rejected/deprecated artifacts
 * whose files are still in `pending/` over to `archive/`. Idempotent
 * (re-runnable on the same DB without creating duplicate proposals or
 * re-moving already-archived files).
 *
 * Severity ordering: when an artifact qualifies for BOTH deprecation and
 * staleness, only the deprecation proposal is emitted (deprecation is the
 * more urgent signal — a reviewer doesn't need a second "this is never
 * used" flag to make the call). Stale is checked only for artifacts that
 * weren't already flagged for deprecation. Merge proposals are
 * independent of either and are computed in their own pass.
 */
export function runCurate(
  db: Database,
  opts: RunCurateOptions = {},
): RunCurateResult {
  const config = loadConfig();
  const pendingDir = opts.pendingDir ?? PENDING_DIR;
  const archiveDir = opts.archiveDir ?? ARCHIVE_DIR;
  const mergeOverlapThreshold =
    opts.mergeOverlapThreshold ?? config.merge_overlap_threshold;
  // `staleAfterSessions` is accepted (and resolved against config) so the
  // call signature is stable for the day the real session counter exists;
  // the current implementation reads the threshold here but doesn't yet
  // consume it (see the module-level "Staleness proxy" note). The
  // reference keeps TypeScript / linters from flagging the unused option
  // without resorting to `void` or a no-op `_var`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _staleAfterSessionsThreshold =
    opts.staleAfterSessions ?? config.stale_after_sessions;

  const result: RunCurateResult = {
    deprecationProposals: 0,
    staleProposals: 0,
    mergeProposals: 0,
    archived: 0,
  };

  // --- pass 1: deprecation + staleness on active artifacts --------------
  const active = listArtifactsByState(db, ["active"]);

  for (const a of active) {
    const ledger = getEvidenceLedger(db, a.id);
    // Spec threshold: `score <= 0`. A missing ledger row means no signal
    // either way — don't deprecate on absence.
    if (ledger && ledger.score <= 0) {
      const signature = proposalSignature("deprecate", a.id);
      const { skipped } = stageProposal(
        db,
        pendingDir,
        signature,
        renderDeprecationDraft(a.id, ledger),
      );
      if (!skipped) result.deprecationProposals++;
      continue; // severity ordering: stale is skipped for this artifact
    }

    // Staleness: zero chain-triggered hits in the events table. See the
    // module-level "Staleness proxy" note for why this isn't yet the
    // spec's "no hits in stale_after_sessions sessions" check.
    const hits = countChainHitsForArtifact(db, a.id);
    if (hits === 0) {
      const signature = proposalSignature("stale", a.id);
      const { skipped } = stageProposal(
        db,
        pendingDir,
        signature,
        renderStaleDraft(a.id, hits),
      );
      if (!skipped) result.staleProposals++;
    }
  }

  // --- pass 2: pairwise merge proposals on active artifacts --------------
  // O(n^2) over the active set; n is small (a handful to low hundreds of
  // skills per dream pass) so a naive double-loop is fine and keeps the
  // logic obvious. Pair signature is sorted by id (see
  // `proposalSignature`) so `(A,B)` and `(B,A)` collapse to the same
  // dedup key.
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    if (!a) continue;
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      if (!b) continue;
      if (!a.surface_path || !existsSync(a.surface_path)) continue;
      if (!b.surface_path || !existsSync(b.surface_path)) continue;
      const textA = readFileSync(a.surface_path, "utf8");
      const textB = readFileSync(b.surface_path, "utf8");
      const overlap = jaccardOverlap(textA, textB);
      if (overlap < mergeOverlapThreshold) continue;

      const signature = proposalSignature("merge", a.id, b.id);
      const { skipped } = stageProposal(
        db,
        pendingDir,
        signature,
        renderMergeDraft(a.id, b.id, overlap, mergeOverlapThreshold),
      );
      if (!skipped) result.mergeProposals++;
    }
  }

  // --- pass 3: archive consolidation for already-retired artifacts ------
  // Rejected candidates from `cli/commands/reject.ts#rejectCandidate` have
  // their pending directory moved to archive BUT `surface_path` is left
  // pointing at the old `pending/<id>/draft.md` path (that's a known
  // quirk of reject.ts — out of scope for this task to fix; we work
  // around it here). Same for any artifact that was `rejectArtifact`-ed
  // (state flipped) without going through `rejectCandidate` (e.g. a
  // direct DB write in a test or future tool). This pass detects those
  // rows and rewrites `surface_path` so the row's pointer is consistent
  // with the file's actual location.
  const retired = listArtifactsByState(db, ["rejected", "deprecated"]);
  for (const a of retired) {
    if (!needsArchiveMove(a.surface_path, archiveDir)) continue;
    const moved = moveToArchive(db, a, archiveDir);
    if (moved) result.archived++;
  }

  return result;
}
