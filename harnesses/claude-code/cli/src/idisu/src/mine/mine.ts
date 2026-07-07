import type { Database } from "bun:sqlite";
import { extractNgrams } from "../analysis/ngrams.js";
import { getSessionOutcomeLabel, upsertWorkflowNgram } from "../store/repo.js";
import { loadConfig } from "../config.js";

// Phase 5 (Mine, Task 5.1) — persist mined n-grams with an outcome split.
//
// This module is deliberately standalone: it reads `idisu.db` directly and
// writes `workflow_ngrams`, but is NOT wired into `dream/dream.ts` yet.
// Task 5.2 (candidate generation) and Task 5.3 (staging + dream wiring) are
// what turn this into a live pipeline step; the plan's Phase 5 file list
// only calls for wiring "into dream.ts" explicitly under Task 5.3's stage.ts
// step, so wiring `mine.ts` in early here would be running half of an
// unfinished mine->stage flow inside the live dream loop.

interface ToolCalledEventRow {
  payload: string;
  observed_at: string;
  source_position: number | string;
}

/**
 * Builds per-session ordered tool-name sequences from `tool.called` events.
 *
 * Ordering key: `observed_at` (matches `judge/orchestrator.ts#loadAllEvents`
 * and `store/repo.ts#getEventsForSession`'s own choice of `observed_at` as
 * the authoritative ordering column), with `source_position` as a tiebreak
 * for same-timestamp events from the same source.
 *
 * Returns parallel arrays (`sessionIds[i]` <-> `sequences[i]`) rather than a
 * Map, since that's the shape `extractNgrams`'s optional `sessionIds` param
 * expects.
 */
function loadSessionToolSequences(db: Database): {
  sessionIds: string[];
  sequences: string[][];
} {
  const rows = db
    .query(
      `SELECT payload, observed_at, source_position FROM events
       WHERE event_type='tool.called'
       ORDER BY observed_at ASC, source_position ASC`,
    )
    .all() as ToolCalledEventRow[];

  const bySession = new Map<string, string[]>();
  for (const row of rows) {
    let payload: { session_id?: string; tool_name?: string };
    try {
      payload = JSON.parse(row.payload);
    } catch {
      continue;
    }
    if (!payload.session_id || !payload.tool_name) continue;

    const list = bySession.get(payload.session_id);
    if (list) list.push(payload.tool_name);
    else bySession.set(payload.session_id, [payload.tool_name]);
  }

  const sessionIds = [...bySession.keys()];
  const sequences = sessionIds.map((id) => bySession.get(id) as string[]);
  return { sessionIds, sequences };
}

export interface MineNgramsOptions {
  /** Minimum total occurrence count for an n-gram to be kept — same `min`
   * semantics as `extractNgrams`'s existing `opts.min`. */
  min: number;
  /** Window size — same semantics as `extractNgrams`'s existing `opts.n`. */
  n: number;
}

export interface MineNgramsResult {
  ngramsPersisted: number;
}

/**
 * Mines recurring tool-call n-grams from `idisu.db`'s `events` table and
 * persists each one to `workflow_ngrams` with a success/failure split.
 *
 * Design: extraction runs once over ALL sessions' sequences (via the
 * `sessionIds`-aware `extractNgrams`), which returns, per n-gram signature,
 * every distinct session ID that contributed at least one occurrence. This
 * was chosen over running `extractNgrams` per-session (n-gram-within-that-
 * session) because a single aggregate pass naturally produces the same
 * `frequency`/`sessionCount` semantics `ngrams.ts` already has tests for,
 * while the new optional `sessionIds` param adds exactly the "which
 * sessions" tracking this task needs — no duplicate sliding-window logic.
 *
 * For each contributing session, its session-level (`segment_key='session'`)
 * `outcome_labels` row is looked up: `success` increments `success_count`,
 * `failure` increments `failure_count`. Sessions with no label yet, or
 * labeled `unknown`/`abandoned`, increment neither — there's no schema
 * column for "unknown"/"abandoned" counts, and Task 5.2's candidate
 * threshold (`>=1 success`) only needs the success/failure split.
 *
 * `frequency` on the persisted row is the total occurrence count (matching
 * `extractNgrams`'s existing meaning — sum across all sessions, not just
 * distinct-session count). `sample_sessions` stores up to 5 example session
 * IDs as a JSON array. `last_seen` is set to the time this mine pass ran.
 */
export function mineNgrams(
  db: Database,
  opts: MineNgramsOptions,
): MineNgramsResult {
  const { sessionIds, sequences } = loadSessionToolSequences(db);
  const ngrams = extractNgrams(sequences, opts, sessionIds);

  const now = new Date().toISOString();
  let ngramsPersisted = 0;

  for (const gram of ngrams) {
    const contributingSessions = gram.sessionIds ?? [];

    let successCount = 0;
    let failureCount = 0;
    for (const sessionId of contributingSessions) {
      const label = getSessionOutcomeLabel(db, sessionId);
      if (label === "success") successCount++;
      else if (label === "failure") failureCount++;
      // 'unknown', 'abandoned', and unlabeled sessions: counted toward
      // neither bucket (see doc comment above).
    }

    upsertWorkflowNgram(db, {
      signature: gram.signature,
      n: opts.n,
      frequency: gram.frequency,
      success_count: successCount,
      failure_count: failureCount,
      sample_sessions: contributingSessions.slice(0, 5),
      last_seen: now,
    });
    ngramsPersisted++;
  }

  return { ngramsPersisted };
}

// ---------------------------------------------------------------------------
// Task 5.2 — candidate generation + FTS overlap suppression
// ---------------------------------------------------------------------------

interface WorkflowNgramTableRow {
  signature: string;
  frequency: number;
  success_count: number;
  failure_count: number;
  sample_sessions: string | null;
}

export interface Candidate {
  signature: string;
  frequency: number;
  successCount: number;
  failureCount: number;
  sampleSessions: string[];
  /**
   * Human-readable labels (artifact `surface_path`, falling back to `id`)
   * of existing artifacts whose FTS text is a near-match for this
   * candidate's signature, but NOT close enough to trigger suppression.
   * These are informational "you might be about to reinvent something
   * adjacent" hints, not the reason the candidate was suppressed — a
   * candidate whose overlap crosses the suppression threshold is dropped
   * from the result set entirely (see `checkArtifactOverlap` below), it is
   * never emitted with this field describing why. Empty when no artifacts
   * exist yet (true for the whole system pre-Phase-6), none matched, or
   * FTS5 is unavailable in this build.
   */
  closestSkills: string[];
}

export interface GenerateCandidatesOptions {
  /** Minimum total occurrence count. Defaults to config `min_repetition`. */
  minRepetition?: number;
  /** Minimum distinct contributing sessions. Defaults to config
   * `min_candidate_sessions`.
   *
   * Caveat: this is measured off `sample_sessions`, which `mineNgrams`
   * caps at 5 entries even when more sessions contributed (see Task 5.1's
   * doc comment on `upsertWorkflowNgram`'s call site). That cap is fine as
   * a threshold check as long as `minSessions <= 5` (true for every
   * default/expected value here): `sample_sessions.length >= minSessions`
   * is exact for actual session counts <= 5, and for actual counts > 5 the
   * capped length is still 5 >= minSessions, so the threshold still passes
   * correctly. It would stop being a valid proxy if a future config raised
   * `min_candidate_sessions` above 5.
   */
  minSessions?: number;
  /** Minimum success_count. Defaults to config `min_candidate_successes`. */
  minSuccesses?: number;
  /** Maximum bm25 score for an artifact match to count as suppressing
   * overlap (lower bm25 = closer match, so this is a ceiling, not a
   * floor). Defaults to config `candidate_overlap_bm25_max`. */
  overlapBm25Max?: number;
  /** How many top FTS matches to keep as informational `closestSkills`
   * when a candidate is NOT suppressed. Default 5. */
  overlapTopK?: number;
}

function isRejectedSignature(db: Database, signature: string): boolean {
  const row = db
    .query("SELECT 1 FROM rejected_signatures WHERE signature=?")
    .get(signature);
  return row != null;
}

function resolveArtifactLabel(db: Database, artifactId: string): string {
  const row = db
    .query("SELECT surface_path FROM artifacts WHERE id=?")
    .get(artifactId) as { surface_path: string | null } | null;
  return row?.surface_path ?? artifactId;
}

/**
 * Searches `artifacts_fts` for existing artifacts whose text overlaps this
 * candidate's n-gram signature, using FTS5's built-in `bm25()` ranking.
 *
 * The signature (e.g. `"Read>Edit>Bash"`) is split on `>` into its
 * constituent tool names and turned into a prefix-OR FTS query (same
 * shape as `store/sqlite-cache.ts#bm25Search`'s existing convention), since
 * the raw `>`-joined signature isn't a token any indexed artifact text
 * would contain verbatim.
 *
 * Fails soft (returns "no overlap") rather than throwing when:
 * - `artifacts_fts` doesn't exist (FTS5 not compiled into this SQLite
 *   build — same guard rationale as `store/db.ts#openDb`'s `FTS_SQL` try/
 *   catch).
 * - the MATCH query matches nothing.
 *
 * A candidate is suppressed when the single closest match's bm25 score is
 * `<= overlapBm25Max` (lower bm25 = closer match — this is why "above
 * threshold => suppressed" in the task description is implemented here as
 * "bm25 distance below/at a ceiling", not a literal `score > threshold`
 * comparison; see `config.ts`'s `candidate_overlap_bm25_max` doc comment).
 */
function checkArtifactOverlap(
  db: Database,
  signature: string,
  overlapBm25Max: number,
  overlapTopK: number,
): { suppressed: boolean; closestSkills: string[] } {
  const terms = signature.split(">").filter(Boolean);
  if (terms.length === 0) return { suppressed: false, closestSkills: [] };

  const ftsQuery = terms.map((t) => `${t}*`).join(" OR ");

  let rows: Array<{ artifact_id: string; score: number }>;
  try {
    rows = db
      .query(
        `SELECT artifact_id, bm25(artifacts_fts) as score FROM artifacts_fts
         WHERE artifacts_fts MATCH ? ORDER BY score ASC LIMIT ?`,
      )
      .all(ftsQuery, overlapTopK) as Array<{
      artifact_id: string;
      score: number;
    }>;
  } catch {
    // artifacts_fts missing (FTS5 unavailable) or malformed MATCH query —
    // no overlap data available, don't suppress on missing information.
    return { suppressed: false, closestSkills: [] };
  }

  const closest = rows[0];
  if (!closest) return { suppressed: false, closestSkills: [] };

  const suppressed = closest.score <= overlapBm25Max;
  if (suppressed) return { suppressed: true, closestSkills: [] };

  return {
    suppressed: false,
    closestSkills: rows.map((r) => resolveArtifactLabel(db, r.artifact_id)),
  };
}

/**
 * Turns persisted `workflow_ngrams` rows into skill candidates: filters by
 * the frequency/session/success thresholds, drops anything matching a
 * `rejected_signatures` row (rejection memory — never re-propose what the
 * user already said no to), then drops anything whose closest FTS match
 * against existing `artifacts` is too close a duplicate (AWM overlap
 * hygiene). What's left is emitted as `Candidate` objects.
 *
 * Does not read from `mineNgrams`'s in-memory result — reads the persisted
 * `workflow_ngrams` table directly, so it can run as a separate step (or
 * standalone, e.g. for tests) against whatever was last mined.
 */
export function generateCandidates(
  db: Database,
  opts: GenerateCandidatesOptions = {},
): Candidate[] {
  const config = loadConfig();
  const minRepetition = opts.minRepetition ?? config.min_repetition;
  const minSessions = opts.minSessions ?? config.min_candidate_sessions;
  const minSuccesses = opts.minSuccesses ?? config.min_candidate_successes;
  const overlapBm25Max =
    opts.overlapBm25Max ?? config.candidate_overlap_bm25_max;
  const overlapTopK = opts.overlapTopK ?? 5;

  const rows = db
    .query(
      `SELECT signature, frequency, success_count, failure_count, sample_sessions
       FROM workflow_ngrams
       WHERE frequency >= ? AND success_count >= ?`,
    )
    .all(minRepetition, minSuccesses) as WorkflowNgramTableRow[];

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const sampleSessions: string[] = row.sample_sessions
      ? JSON.parse(row.sample_sessions)
      : [];
    if (sampleSessions.length < minSessions) continue;

    if (isRejectedSignature(db, row.signature)) continue;

    const { suppressed, closestSkills } = checkArtifactOverlap(
      db,
      row.signature,
      overlapBm25Max,
      overlapTopK,
    );
    if (suppressed) continue;

    candidates.push({
      signature: row.signature,
      frequency: row.frequency,
      successCount: row.success_count,
      failureCount: row.failure_count,
      sampleSessions,
      closestSkills,
    });
  }

  return candidates;
}
