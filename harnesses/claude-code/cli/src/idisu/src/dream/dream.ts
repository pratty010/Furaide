import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { SessionAdapter } from "../adapters/base.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { loadConfig } from "../config.js";
import { dreamLock } from "../lock.js";
import { LAST_DREAM_FILE, STATE_DIR, STATE_MANIFEST } from "../paths.js";
import { writeProfile } from "../projections/profile.js";
import type { EventEnvelope, EventType, Harness } from "../types/events.js";
import type { IntentCluster, StateManifest } from "../types/projections.js";
import { buildMetricProjections, rollupSessions } from "./consolidate.js";
import { gather } from "./gather.js";
import { orient } from "./orient.js";
import { pruneAndIndex } from "./prune.js";

export interface DreamRunResult {
  eventsIngested: number;
  metricsComputed: number;
  clustersFound: number;
  sessionsRolledUp: number;
  durationMs: number;
}

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

// Consolidate reads the full historical corpus back out of idisu.db now that
// Gather writes there. (The old JSONL event-log stays importable as a Phase
// 2 bridge per Finding F1, but nothing in the dream pipeline writes to it
// anymore — see gather.ts.)
function readAllEventsFromDb(db: Database): EventEnvelope[] {
  const rows = db
    .query("SELECT * FROM events ORDER BY observed_at ASC")
    .all() as EventTableRow[];
  return rows.map(rowToEnvelope);
}

export async function runDream(
  opts: { force?: boolean; scheduled?: boolean } = {},
): Promise<DreamRunResult> {
  const t0 = Date.now();
  const config = loadConfig();

  return dreamLock.withLock(async () => {
    if (opts.scheduled && !opts.force && existsSync(LAST_DREAM_FILE)) {
      const last = Number.parseInt(
        (await import("node:fs")).readFileSync(LAST_DREAM_FILE, "utf8").trim(),
        10,
      );
      if (Number.isFinite(last)) {
        const elapsedHours = (Date.now() / 1000 - last) / 3600;
        if (elapsedHours < config.dream_interval_hours) {
          return {
            eventsIngested: 0,
            metricsComputed: 0,
            clustersFound: 0,
            sessionsRolledUp: 0,
            durationMs: Date.now() - t0,
          };
        }
      }
    }

    const orientation = orient();
    const { db } = orientation;
    console.log("[idisu/dream] Phase 1 Orient complete");

    try {
      const adapters: SessionAdapter[] = [];
      if (config.harnesses.includes("claude_code")) {
        adapters.push(new ClaudeCodeAdapter());
      }
      if (config.harnesses.includes("codex")) {
        const { CodexAdapter } = await import("../adapters/codex.js");
        adapters.push(new CodexAdapter());
      }
      if (config.harnesses.includes("opencode")) {
        const { OpenCodeAdapter } = await import("../adapters/opencode.js");
        adapters.push(new OpenCodeAdapter());
      }

      const { spooledEvents, adapterEvents } = await gather(db, adapters);
      const eventsIngested = spooledEvents + adapterEvents;
      console.log(
        `[idisu/dream] Phase 2 Gather: +${eventsIngested} events (spool ${spooledEvents}, adapters ${adapterEvents})`,
      );

      const allEvents = readAllEventsFromDb(db);

      const metrics = buildMetricProjections(
        allEvents,
        config.min_sample_threshold,
      );

      // v0.1's intent-cluster feature had no producer for a 'prompt.observed'
      // event even before this rewrite (see analysis/dimensions.ts); v0.2's
      // event-kind union dropped it outright with nothing replacing it, so
      // there is currently no data to cluster.
      const clusters: IntentCluster[] = [];

      const sessionsRolledUp = rollupSessions(db);

      if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
      writeProfile(metrics, clusters);

      const lastEvent = allEvents.at(-1);
      const manifest: StateManifest = {
        schema_version: 1,
        built_through_event_id: lastEvent?.event_id ?? "none",
        built_at: new Date().toISOString(),
        generation: (orientation.manifest?.generation ?? 0) + 1,
      };
      writeFileSync(STATE_MANIFEST, JSON.stringify(manifest, null, 2));
      console.log(
        `[idisu/dream] Phase 3 Consolidate: ${metrics.size} capabilities, ${clusters.length} clusters, ${sessionsRolledUp} sessions rolled up`,
      );

      pruneAndIndex(config.evidence_retention_days);
      console.log("[idisu/dream] Phase 4 Prune complete");
      writeFileSync(LAST_DREAM_FILE, `${Math.floor(Date.now() / 1000)}\n`);

      return {
        eventsIngested,
        metricsComputed: metrics.size,
        clustersFound: clusters.length,
        sessionsRolledUp,
        durationMs: Date.now() - t0,
      };
    } finally {
      db.close();
    }
  });
}
