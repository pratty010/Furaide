import type { Database } from "bun:sqlite";
import type { EventEnvelope, EventType, Harness } from "../types/events.js";
import type { SegmentLabel } from "../judge/interface.js";

export interface EventRow {
  event_id: string;
  schema_version: number;
  source_id: string;
  source_position: number | string;
  observed_at: string;
  ingested_at: string;
  harness: string;
  event_type: string;
  payload_version: number;
  payload: unknown;
}

export interface SessionRow {
  session_id: string;
  harness: string;
  started_at?: string;
  ended_at?: string;
  cwd?: string;
  model?: string;
  outcome_label?: string;
  rollup?: string;
}

export interface CheckpointRow {
  inode: number;
  size: number;
  prefix_hash: string;
  offset: number;
}

export function insertEvent(db: Database, e: EventRow): void {
  db.query(`INSERT OR IGNORE INTO events
    (event_id,schema_version,source_id,source_position,observed_at,ingested_at,harness,event_type,payload_version,payload)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    e.event_id,
    e.schema_version,
    e.source_id,
    e.source_position,
    e.observed_at,
    e.ingested_at,
    e.harness,
    e.event_type,
    e.payload_version,
    JSON.stringify(e.payload),
  );
}

export function countEvents(db: Database): number {
  return (db.query("SELECT COUNT(*) c FROM events").get() as any).c;
}

export function getCheckpoint(
  db: Database,
  sourceId: string,
): { inode: number; size: number; prefix_hash: string; offset: number } | null {
  return (
    (db
      .query(
        "SELECT inode,size,prefix_hash,offset FROM checkpoints WHERE source_id=?",
      )
      .get(sourceId) as any) ?? null
  );
}

export function upsertCheckpoint(
  db: Database,
  sourceId: string,
  c: { inode: number; size: number; prefix_hash: string; offset: number },
): void {
  db.query(`INSERT INTO checkpoints (source_id,inode,size,prefix_hash,offset,updated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(source_id) DO UPDATE SET inode=excluded.inode,size=excluded.size,
      prefix_hash=excluded.prefix_hash,offset=excluded.offset,updated_at=excluded.updated_at`).run(
    sourceId,
    c.inode,
    c.size,
    c.prefix_hash,
    c.offset,
  );
}

// Row shape as it actually comes back from `SELECT * FROM events` — `payload`
// is still the raw JSON TEXT column here, unlike `EventRow.payload` above
// (`unknown`, i.e. already-decoded) which describes the *insert* shape.
// Same row->envelope conversion as dream/consolidate.ts's private
// `rowToEnvelope`; kept as its own small function here rather than exported
// from consolidate.ts to avoid coupling Judge (Phase 4) to Consolidate
// (Phase 3) internals.
interface EventTableRow {
  event_id: string;
  schema_version: number;
  source_id: string;
  source_position: number | string;
  observed_at: string;
  ingested_at: string;
  harness: string;
  event_type: string;
  payload_version: number;
  payload: string;
}

function rowToEnvelope(row: EventTableRow): EventEnvelope {
  return {
    schema_version: row.schema_version as 1,
    event_id: row.event_id,
    source_id: row.source_id,
    source_position: row.source_position,
    observed_at: row.observed_at,
    ingested_at: row.ingested_at,
    harness: row.harness as Harness,
    event_type: row.event_type as EventType,
    payload_version: row.payload_version,
    payload: JSON.parse(row.payload),
  };
}

/**
 * All events in `idisu.db`, ordered by `observed_at`.
 *
 * Phase 5 (Task 5.4) — pulled out as a shared export rather than adding a
 * fourth private copy of the same `SELECT * FROM events ... -> rowToEnvelope`
 * pattern already duplicated in `dream/consolidate.ts#rollupSessions` and
 * `dream/dream.ts#readAllEventsFromDb` (and this file's own
 * `getEventsForSession`). `cli/commands/report.ts` is the new caller (Task
 * 5.4, migrating off the legacy JSONL `store/event-log.ts`); the two
 * dream-pipeline copies are left as-is here to keep this migration scoped to
 * report.ts rather than a broader refactor.
 */
export function readAllEvents(db: Database): EventEnvelope[] {
  const rows = db
    .query("SELECT * FROM events ORDER BY observed_at ASC")
    .all() as EventTableRow[];
  return rows.map(rowToEnvelope);
}

/**
 * All events belonging to one logical session, ordered by `observed_at`.
 *
 * Grouping key is `payload.session_id` (not raw `source_id`) — same rationale
 * as `rollupSessions` in dream/consolidate.ts: a session can appear under two
 * different `source_id`s (`cc:<slug>/<id>` transcript vs `cc-hook:<id>` hook
 * path) but only one `payload.session_id`.
 */
export function getEventsForSession(
  db: Database,
  sessionId: string,
): EventEnvelope[] {
  const rows = db
    .query("SELECT * FROM events ORDER BY observed_at ASC")
    .all() as EventTableRow[];
  return rows
    .map(rowToEnvelope)
    .filter(
      (e) =>
        (e.payload as { session_id?: string } | null)?.session_id === sessionId,
    );
}

export function upsertSession(db: Database, s: SessionRow): void {
  db.query(`INSERT INTO sessions
    (session_id,harness,started_at,ended_at,cwd,model,outcome_label,rollup)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET
      harness=excluded.harness, started_at=excluded.started_at, ended_at=excluded.ended_at,
      cwd=excluded.cwd, model=excluded.model, outcome_label=excluded.outcome_label,
      rollup=excluded.rollup`).run(
    s.session_id,
    s.harness,
    s.started_at ?? null,
    s.ended_at ?? null,
    s.cwd ?? null,
    s.model ?? null,
    s.outcome_label ?? null,
    s.rollup ?? null,
  );
}

// Phase 4 (Judge, Task 4.3) — persists a Tier-1 or Tier-2/LLM SegmentLabel
// into `outcome_labels`. Keyed on the table's `UNIQUE(session_id,
// segment_key)` constraint: the orchestrator inserts every Tier-1 result
// first (including `unknown` ones) then, for segments it sends to the LLM
// tier, upserts again over the same key with `tier:'llm'` + `judge_model`
// set — the ON CONFLICT DO UPDATE arm is what makes that overwrite work
// without a separate read-then-branch step, mirroring `upsertCheckpoint`/
// `upsertSession` above.
export function upsertOutcomeLabel(db: Database, l: SegmentLabel): void {
  db.query(`INSERT INTO outcome_labels
    (session_id,segment_key,label,tier,evidence_ref,judge_model,created_at)
    VALUES (?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(session_id,segment_key) DO UPDATE SET
      label=excluded.label, tier=excluded.tier, evidence_ref=excluded.evidence_ref,
      judge_model=excluded.judge_model, created_at=excluded.created_at`).run(
    l.session_id,
    l.segment_key,
    l.label,
    l.tier,
    l.evidence_ref ?? null,
    l.judge_model ?? null,
  );
}

// Phase 5 (Mine, Task 5.1) — session-level outcome lookup for the n-gram ->
// outcome join in mine/mine.ts. `segment_key='session'` is the granularity
// that maps to "this session's tool sequence was part of a
// successful/failed run" (see orchestrator.ts's own session-level updates
// via `updateSessionOutcomeLabel`). Returns `null` when the session has no
// session-level label at all (not yet judged) — callers treat that the same
// as `unknown`/`abandoned`: doesn't count toward success or failure.
export function getSessionOutcomeLabel(
  db: Database,
  sessionId: string,
): string | null {
  const row = db
    .query(
      "SELECT label FROM outcome_labels WHERE session_id=? AND segment_key='session'",
    )
    .get(sessionId) as { label: string } | null;
  return row?.label ?? null;
}

export interface WorkflowNgramRow {
  signature: string;
  n: number;
  frequency: number;
  success_count: number;
  failure_count: number;
  sample_sessions: string[];
  last_seen: string;
}

// Phase 5 (Mine, Task 5.1) — upserts a mined n-gram's outcome-split stats.
// Keyed on `signature` (the table's PRIMARY KEY): a re-mine (next dream
// pass) overwrites the previous counts wholesale rather than accumulating,
// since `mine.ts` recomputes frequency/success/failure from the full event
// history each time it runs (not an incremental delta).
export function upsertWorkflowNgram(db: Database, row: WorkflowNgramRow): void {
  db.query(`INSERT INTO workflow_ngrams
    (signature,n,frequency,success_count,failure_count,sample_sessions,last_seen)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(signature) DO UPDATE SET
      n=excluded.n, frequency=excluded.frequency, success_count=excluded.success_count,
      failure_count=excluded.failure_count, sample_sessions=excluded.sample_sessions,
      last_seen=excluded.last_seen`).run(
    row.signature,
    row.n,
    row.frequency,
    row.success_count,
    row.failure_count,
    JSON.stringify(row.sample_sessions),
    row.last_seen,
  );
}

// ---------------------------------------------------------------------------
// Phase 5 (Mine, Task 5.3) — artifacts/nodes/edges helpers.
//
// Nothing before this task has written to `artifacts`, `nodes`, or `edges`
// (Task 5.2's `generateCandidates` only *reads* `artifacts`/`artifacts_fts`
// for overlap suppression). `stage.ts` is the first writer, so these are new
// minimal typed helpers rather than an extension of an existing pattern —
// they follow the same parameterized-SQL, no-ORM, plain-object style as
// `insertEvent`/`upsertSession` above.
// ---------------------------------------------------------------------------

export interface ArtifactRow {
  id: string;
  type: "skill" | "memory" | "instruction_edit";
  origin: "mined" | "learned" | "preexisting";
  surface_path?: string | null;
  state: string;
  signature?: string | null;
  created_at: string;
  promoted_at?: string | null;
  deprecated_at?: string | null;
}

// `INSERT OR IGNORE` keyed on `id` (the table's PRIMARY KEY): `stage.ts`
// derives `id` deterministically from `candidate.signature`, and callers are
// expected to have already checked `findActiveArtifactBySignature` before
// calling this — the `OR IGNORE` is a defensive no-op on a re-run with the
// same candidate, not the primary duplicate guard.
export function insertArtifact(db: Database, a: ArtifactRow): void {
  db.query(`INSERT OR IGNORE INTO artifacts
    (id,type,origin,surface_path,state,signature,created_at,promoted_at,deprecated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    a.id,
    a.type,
    a.origin,
    a.surface_path ?? null,
    a.state,
    a.signature ?? null,
    a.created_at,
    a.promoted_at ?? null,
    a.deprecated_at ?? null,
  );
}

/**
 * Looks up an active (not deprecated) artifact by mining `signature` — the
 * duplicate-staging guard: `stage.ts#stageCandidate` and `dream.ts`'s mine ->
 * stage wiring both call this before staging a candidate, so a signature
 * already staged/promoted from a previous dream pass isn't re-staged.
 * "Active" here means `deprecated_at IS NULL`; there's no schema-level enum
 * on `artifacts.state` (unlike e.g. `outcome_labels.label`), so this checks
 * the one column (`deprecated_at`) that unambiguously marks retirement
 * rather than assuming a fixed set of non-deprecated state strings.
 */
export function findActiveArtifactBySignature(
  db: Database,
  signature: string,
): ArtifactRow | null {
  return (
    (db
      .query(
        "SELECT * FROM artifacts WHERE signature=? AND deprecated_at IS NULL LIMIT 1",
      )
      .get(signature) as ArtifactRow | null) ?? null
  );
}

export interface NodeRow {
  id: string;
  type: string;
  label?: string | null;
  attrs?: string | null;
}

// `INSERT OR IGNORE` keyed on `id` (PRIMARY KEY) — this is the primary dedup
// mechanism for node rows (e.g. re-staging the same session as evidence for
// two different candidates should not attempt a second insert of that
// session's node row).
export function insertNode(db: Database, n: NodeRow): void {
  db.query(`INSERT OR IGNORE INTO nodes (id,type,label,attrs) VALUES (?,?,?,?)`).run(
    n.id,
    n.type,
    n.label ?? null,
    n.attrs ?? null,
  );
}

export interface EdgeRow {
  src: string;
  dst: string;
  type: string;
  valid_at: string;
  invalid_at?: string | null;
}

// `edges.id` is an autoincrement surrogate key (see schema.ts) — there's no
// natural unique key to dedup on here, so unlike `insertNode`/`insertArtifact`
// this is a plain INSERT. Callers (stage.ts) are expected to only call this
// once per (artifact, session) pair per staging call, guarded upstream by
// `findActiveArtifactBySignature`.
export function insertEdge(db: Database, e: EdgeRow): void {
  db.query(
    `INSERT INTO edges (src,dst,type,valid_at,invalid_at) VALUES (?,?,?,?,?)`,
  ).run(e.src, e.dst, e.type, e.valid_at, e.invalid_at ?? null);
}

// ---------------------------------------------------------------------------
// Phase 6 (Approve/Promote/Track/Curate, Task 6.1) — artifact lookup/state-
// transition helpers backing `cli/commands/promote.ts` and `reject.ts`.
// ---------------------------------------------------------------------------

/**
 * Looks up an artifact by its primary key regardless of state — unlike
 * `findActiveArtifactBySignature` (mining's duplicate-staging guard, keyed on
 * `signature` and filtered to non-deprecated rows), this is the plain by-id
 * lookup `promote`/`reject` need to fetch a specific pending candidate (and
 * to tell the caller "not found" vs "found but in the wrong state").
 */
export function getArtifactById(db: Database, id: string): ArtifactRow | null {
  return (
    (db.query("SELECT * FROM artifacts WHERE id=?").get(id) as ArtifactRow | null) ?? null
  );
}

/**
 * Flips a staged artifact to `state='active'` and records where it now lives
 * on disk (`surface_path`) and when (`promoted_at`). Plain `UPDATE ... WHERE
 * id=?`, not an upsert — the row must already exist (created by
 * `stage.ts#stageCandidate`); callers are expected to have checked
 * `getArtifactById` first (see `promote.ts#promoteCandidate`).
 */
export function promoteArtifact(
  db: Database,
  id: string,
  surfacePath: string,
  promotedAt: string,
): void {
  db.query(
    `UPDATE artifacts SET state='active', surface_path=?, promoted_at=? WHERE id=?`,
  ).run(surfacePath, promotedAt, id);
}

/** Flips an artifact to `state='rejected'`. No `deprecated_at` touch here —
 * that column means "retired after having been active"; a rejected
 * *candidate* never made it to active in the first place. */
export function rejectArtifact(db: Database, id: string): void {
  db.query(`UPDATE artifacts SET state='rejected' WHERE id=?`).run(id);
}

export interface RejectedSignatureRow {
  signature: string;
  reason?: string | null;
  rejected_at: string;
}

// `INSERT OR IGNORE` keyed on `signature` (PRIMARY KEY): rejecting the same
// signature twice (e.g. a re-mined near-duplicate later staged again and
// rejected again) shouldn't error — the first rejection's reason/timestamp
// wins, matching the "record it once" intent of a rejection-memory table.
export function insertRejectedSignature(db: Database, r: RejectedSignatureRow): void {
  db.query(
    `INSERT OR IGNORE INTO rejected_signatures (signature,reason,rejected_at) VALUES (?,?,?)`,
  ).run(r.signature, r.reason ?? null, r.rejected_at);
}

// ---------------------------------------------------------------------------
// Phase 6 (Approve/Promote/Track/Curate, Task 6.3) — ExpeL evidence ledger
// helpers backing `track/ledger.ts`.
// ---------------------------------------------------------------------------

/**
 * Looks up a segment's outcome label at an EXACT `(session_id, segment_key)`
 * key — the finer-grained sibling of `getSessionOutcomeLabel` (which hardcodes
 * `segment_key='session'`). `track/ledger.ts#updateEvidenceLedger` uses this
 * to try the turn-specific label first (`turn:<n>`) before falling back to
 * the session-level label, since `judge/tier1.ts#labelTurnSegments` only ever
 * emits a `turn:<n>` row when a concrete failure is attributable there —
 * there's no positive per-turn signal, so a turn segment with no row is not
 * itself meaningful and the caller should fall back rather than treat it as
 * `unknown`.
 */
export function getOutcomeLabel(
  db: Database,
  sessionId: string,
  segmentKey: string,
): string | null {
  const row = db
    .query(
      "SELECT label FROM outcome_labels WHERE session_id=? AND segment_key=?",
    )
    .get(sessionId, segmentKey) as { label: string } | null;
  return row?.label ?? null;
}

export interface EvidenceLedgerRow {
  artifact_id: string;
  applied: number;
  win: number;
  loss: number;
  score: number;
  last_earned_at: string | null;
}

/** Plain by-id lookup, mirroring `getArtifactById`'s shape/rationale — used by
 * tests and by `ledger.ts` callers that want to assert/read the accumulated
 * row rather than blindly upsert. */
export function getEvidenceLedger(
  db: Database,
  artifactId: string,
): EvidenceLedgerRow | null {
  return (
    (db
      .query("SELECT * FROM evidence_ledger WHERE artifact_id=?")
      .get(artifactId) as EvidenceLedgerRow | null) ?? null
  );
}

/**
 * Additively upserts one attribution occurrence's outcome onto an artifact's
 * `evidence_ledger` row: `applied`/`win`/`loss`/`score` are all *deltas*
 * (typically `{applied:1, win:1, score:1}` for a success, `{applied:1,
 * loss:1, score:-1}` for a failure, `{applied:1}` alone for unknown/
 * abandoned — see `ledger.ts` for the mapping), added onto whatever the row
 * already holds — unlike every other `upsert*` in this file (which overwrite
 * fields wholesale on conflict), because the ledger's whole purpose is a
 * running count across many dream passes, not last-write-wins state.
 * `lastEarnedAt`, when passed, only advances on a win or a loss (an actual
 * score movement) — not on an `applied`-only unknown/abandoned occurrence —
 * so callers pass `undefined` for those and the existing timestamp is kept
 * via `COALESCE`.
 */
export function upsertEvidenceLedger(
  db: Database,
  artifactId: string,
  delta: { applied: number; win: number; loss: number; score: number },
  lastEarnedAt?: string,
): void {
  db.query(`INSERT INTO evidence_ledger
    (artifact_id,applied,win,loss,score,last_earned_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(artifact_id) DO UPDATE SET
      applied=evidence_ledger.applied + excluded.applied,
      win=evidence_ledger.win + excluded.win,
      loss=evidence_ledger.loss + excluded.loss,
      score=evidence_ledger.score + excluded.score,
      last_earned_at=COALESCE(excluded.last_earned_at, evidence_ledger.last_earned_at)`).run(
    artifactId,
    delta.applied,
    delta.win,
    delta.loss,
    delta.score,
    lastEarnedAt ?? null,
  );
}

// ---------------------------------------------------------------------------
// Phase 6 (Approve/Promote/Track/Curate, Task 6.4) — Curate helpers backing
// `curate/curate.ts`. Mirrors the per-section helper blocks above
// (parameterized SQL, no ORM, plain-object row interfaces, doc comments
// explaining each helper's place in the pipeline).
// ---------------------------------------------------------------------------

/**
 * Lists artifacts whose `state` is any of the given values. Used by
 * `curate/curate.ts` to find (a) `'active'` rows for the deprecation /
 * staleness / overlap scans, and (b) `'rejected'` + `'deprecated'` rows
 * whose on-disk files may still need to be moved to `archive/`. The
 * `state` column is a plain `TEXT NOT NULL` (no CHECK constraint, see
 * `schema.ts`), so we filter by string equality in code rather than relying
 * on a schema enum — matches `findActiveArtifactBySignature`'s same
 * "filter at the call site" choice above for `deprecated_at IS NULL`.
 *
 * Ordered by `id ASC` for stable iteration order — the curate pairwise
 * overlap pass treats (A,B) and (B,A) as the same pair, so any pair-order
 * determinism in this query would be redundant; `id ASC` is just so the
 * draft file naming / log ordering is reproducible across runs.
 */
export function listArtifactsByState(
  db: Database,
  states: string[],
): ArtifactRow[] {
  if (states.length === 0) return [];
  const placeholders = states.map(() => "?").join(",");
  return db
    .query(
      `SELECT * FROM artifacts WHERE state IN (${placeholders}) ORDER BY id ASC`,
    )
    .all(...states) as ArtifactRow[];
}

// ---------------------------------------------------------------------------
// Phase 6 (Approve/Promote/Track/Curate, Task 6.2) — Review-queue helper
// backing `cli/commands/review.ts`. All SQL lives here per the
// parameterized-SQL / no-ORM / plain-object-row convention this file
// enforces; `review.ts` only does the `dirname` derivation for the
// evidence-pointer column and the JSON parsing for `sample_sessions`.
// ---------------------------------------------------------------------------

/**
 * Row shape returned by `listStagedArtifactsWithNgrams` — the artifact
 * columns (one `ArtifactRow`'s worth) plus the outcome-split columns
 * from a `LEFT JOIN workflow_ngrams`. All four join columns are
 * nullable here (a staged candidate can exist with no corresponding
 * `workflow_ngrams` row, see the doc comment on
 * `listStagedArtifactsWithNgrams`); the caller is expected to apply
 * `?? 0` / `?? []` defaults to produce the
 * CLI-facing `ReviewEntry` shape. We don't pre-default here so the
 * NULL/non-NULL distinction is observable at the call site.
 */
export interface StagedArtifactWithNgrams extends ArtifactRow {
  frequency: number | null;
  success_count: number | null;
  failure_count: number | null;
  sample_sessions: string | null;
}

/**
 * Lists all `artifacts` rows with `state='staged'`, left-joined against
 * `workflow_ngrams` on `signature` for the outcome-split stats
 * (`upsertWorkflowNgram` writes that table; `artifacts` itself only
 * carries `signature`, not frequency/success/failure counts). The join
 * can miss — e.g. a candidate staged without a corresponding
 * `workflow_ngrams` row (not how the real dream pipeline works, but
 * possible for a standalone `stageCandidate` caller) — in which case
 * the outcome-split columns come back `NULL` and the caller (see
 * `cli/commands/review.ts#listPendingReview`) applies `?? 0` / `?? []`
 * defaults rather than null-checking per field.
 *
 * Ordered oldest-first (`created_at ASC`) so the review queue is
 * presented in the order candidates were mined, not reverse-
 * chronological — the live `/idisu review` flow assumes FIFO so the
 * conversation can walk the queue in mining order. `sample_sessions`
 * is returned as the raw JSON TEXT column (Bun's SQLite driver doesn't
 * auto-decode it); `review.ts` calls `JSON.parse` on it at the
 * call site, same as `getEventsForSession`'s envelope-decoding pattern
 * above.
 */
export function listStagedArtifactsWithNgrams(
  db: Database,
): StagedArtifactWithNgrams[] {
  return db
    .query(
      `SELECT a.id as id, a.type as type, a.origin as origin,
              a.surface_path as surface_path, a.state as state,
              a.signature as signature, a.created_at as created_at,
              a.promoted_at as promoted_at, a.deprecated_at as deprecated_at,
              w.frequency as frequency,
              w.success_count as success_count, w.failure_count as failure_count,
              w.sample_sessions as sample_sessions
       FROM artifacts a
       LEFT JOIN workflow_ngrams w ON w.signature = a.signature
       WHERE a.state = 'staged'
       ORDER BY a.created_at ASC`,
    )
    .all() as StagedArtifactWithNgrams[];
}
