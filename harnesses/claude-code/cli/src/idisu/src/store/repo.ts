import type { Database } from "bun:sqlite";

export interface EventRow {
  event_id: string; schema_version: number; source_id: string; source_position: number | string;
  observed_at: string; ingested_at: string; harness: string; event_type: string;
  payload_version: number; payload: unknown;
}

export interface SessionRow {
  session_id: string; harness: string; started_at?: string; ended_at?: string;
  cwd?: string; model?: string; outcome_label?: string; rollup?: string;
}

export interface CheckpointRow {
  inode: number; size: number; prefix_hash: string; offset: number;
}

export function insertEvent(db: Database, e: EventRow): void {
  db.query(`INSERT OR IGNORE INTO events
    (event_id,schema_version,source_id,source_position,observed_at,ingested_at,harness,event_type,payload_version,payload)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    e.event_id, e.schema_version, e.source_id, e.source_position, e.observed_at,
    e.ingested_at, e.harness, e.event_type, e.payload_version, JSON.stringify(e.payload));
}

export function countEvents(db: Database): number {
  return (db.query("SELECT COUNT(*) c FROM events").get() as any).c;
}

export function getCheckpoint(db: Database, sourceId: string):
  { inode: number; size: number; prefix_hash: string; offset: number } | null {
  return db.query("SELECT inode,size,prefix_hash,offset FROM checkpoints WHERE source_id=?").get(sourceId) as any ?? null;
}

export function upsertCheckpoint(db: Database, sourceId: string,
  c: { inode: number; size: number; prefix_hash: string; offset: number }): void {
  db.query(`INSERT INTO checkpoints (source_id,inode,size,prefix_hash,offset,updated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(source_id) DO UPDATE SET inode=excluded.inode,size=excluded.size,
      prefix_hash=excluded.prefix_hash,offset=excluded.offset,updated_at=excluded.updated_at`)
    .run(sourceId, c.inode, c.size, c.prefix_hash, c.offset);
}

export function upsertSession(db: Database, s: SessionRow): void {
  db.query(`INSERT INTO sessions
    (session_id,harness,started_at,ended_at,cwd,model,outcome_label,rollup)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(session_id) DO UPDATE SET
      harness=excluded.harness, started_at=excluded.started_at, ended_at=excluded.ended_at,
      cwd=excluded.cwd, model=excluded.model, outcome_label=excluded.outcome_label,
      rollup=excluded.rollup`).run(
    s.session_id, s.harness, s.started_at ?? null, s.ended_at ?? null, s.cwd ?? null,
    s.model ?? null, s.outcome_label ?? null, s.rollup ?? null);
}
