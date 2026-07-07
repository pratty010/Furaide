import type { Database } from "bun:sqlite";
import type { SessionAdapter } from "../adapters/base.js";
import { CHECKPOINTS_FILE, SPOOL_DIR } from "../paths.js";
import { type CheckpointMap, loadCheckpoints } from "../store/checkpoint.js";
import { type EventRow, insertEvent, upsertCheckpoint } from "../store/repo.js";
import { drainSpool } from "../store/spool.js";
import { type EventEnvelope, EventEnvelopeSchema } from "../types/events.js";

export interface GatherResult {
  spooledEvents: number;
  adapterEvents: number;
  sourcesScanned: number;
}

function envelopeToRow(ev: EventEnvelope): EventRow {
  return {
    event_id: ev.event_id,
    schema_version: ev.schema_version,
    source_id: ev.source_id,
    source_position: ev.source_position,
    observed_at: ev.observed_at,
    ingested_at: ev.ingested_at,
    harness: ev.harness,
    event_type: ev.event_type,
    payload_version: ev.payload_version,
    payload: ev.payload,
  };
}

// The adapter mutates `checkpoints` in place (one new object per touched
// source_id — see store/checkpoint.ts#saveCheckpoint). Diffing by reference
// against a pre-scan snapshot tells us exactly which sources this adapter
// touched this pass, so we only upsert what changed.
function persistTouchedCheckpoints(
  db: Database,
  before: CheckpointMap,
  after: CheckpointMap,
): void {
  for (const [sourceId, ck] of after) {
    if (before.get(sourceId) === ck) continue;
    upsertCheckpoint(db, sourceId, {
      inode: ck.inode ?? 0,
      size: ck.size ?? 0,
      prefix_hash: ck.prefix_hash ?? "",
      offset: ck.last_complete_line_offset,
    });
  }
}

/**
 * Phase 2 Gather: drain the hot-path spool, then run every enabled adapter's
 * incremental scan — inserting each event straight into `idisu.db` (dedup is
 * `INSERT OR IGNORE` on `event_id`, so re-ingesting is always safe) and
 * mirroring updated checkpoints into the `checkpoints` table after each
 * adapter finishes.
 */
export async function gather(
  db: Database,
  adapters: SessionAdapter[],
  checkpointsFile: string = CHECKPOINTS_FILE,
): Promise<GatherResult> {
  let spooledEvents = 0;
  for (const raw of drainSpool(SPOOL_DIR)) {
    const parsed = EventEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[idisu/gather] skipped malformed spooled event");
      continue;
    }
    insertEvent(db, envelopeToRow(parsed.data));
    spooledEvents++;
  }

  const checkpoints = loadCheckpoints(checkpointsFile);
  let adapterEvents = 0;
  let sourcesScanned = 0;

  for (const adapter of adapters) {
    const before = new Map(checkpoints);
    let count = 0;
    for await (const ev of adapter.scan(checkpoints)) {
      insertEvent(db, envelopeToRow(ev));
      count++;
    }
    persistTouchedCheckpoints(db, before, checkpoints);
    adapterEvents += count;
    sourcesScanned++;
    console.log(`[idisu/gather] ${adapter.harness}: +${count} events`);
  }

  return { spooledEvents, adapterEvents, sourcesScanned };
}
