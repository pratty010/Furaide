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
