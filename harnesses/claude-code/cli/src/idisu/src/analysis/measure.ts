import type { Database } from "bun:sqlite";
import type {
  CapabilityInvokedPayload,
  EventEnvelope,
  EventType,
  Harness,
} from "../types/events.js";
import { groupBy } from "./grammar.js";
import { type RateMetricResult, computeRateMetric } from "./metrics.js";

/**
 * Task 3.2 (Phase 3 Measure): computes the subset of the v0.2 metric catalog
 * (spec §2) that is honestly derivable from `idisu.db`'s `events` table alone,
 * and persists each capability/metric pair into `metric_rollups`.
 *
 * No time-windowing convention existed anywhere in this codebase prior to
 * this task (`grep min_sample_threshold`/`window` in config.ts and schema.ts
 * turned up nothing). `'all_time'` is adopted as the simplest defensible
 * default: one rollup per capability over the full retained event history.
 * Narrower windows (e.g. `'7d'`) can be added later as additional rows under
 * the same `(capability, window, metric)` key without a schema change.
 */
export const ALL_TIME_WINDOW = "all_time";

export interface CapabilityMeasurement {
  capability: string;
  invocation_count: number;
  model_trigger_rate: RateMetricResult | null;
  attribution_rate: RateMetricResult | null;
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

function readAllEventsFromDb(db: Database): EventEnvelope[] {
  const rows = db
    .query("SELECT * FROM events ORDER BY observed_at ASC")
    .all() as EventTableRow[];
  return rows.map(rowToEnvelope);
}

/**
 * Computes per-capability measurements from a flat event list. Exported
 * separately from `measure()` so callers (and tests) can compute without a
 * live `Database` handle.
 *
 * Metric semantics:
 *
 * - `invocation_count`: count of "real" (logically distinct) capability
 *   invocations. `trigger: 'chain'` events (ClaudeCodeAdapter's
 *   attributionSkill echo — see `emitFromAssistant`'s `if (attributionSkill)`
 *   branch) are redundant ONLY when they share `(session_id, turn_index,
 *   capability_id)` with a `'user'`/`'model'` event for the same capability:
 *   in that case the chain event is Claude Code's own after-the-fact
 *   bookkeeping of which skill was "active" that turn, not a distinct
 *   invocation, and counting it too would double-count that invocation.
 *   A capability CAN, however, be attributed via `attributionSkill` with no
 *   accompanying explicit tool_use at all (e.g. a skill "active" during a
 *   turn whose actions were plain Read/Bash calls, not a `Skill` tool_use)
 *   — in that case the `chain` event is that invocation's ONLY signal, and
 *   dropping it unconditionally would make the capability disappear from
 *   `metric_rollups` entirely. So a `chain` event is excluded only when a
 *   `'user'`/`'model'` event exists for the same key; otherwise it counts as
 *   one real invocation in its own right.
 * - `model_trigger_rate`: of the real invocations for a capability, the rate
 *   with `trigger === 'model'` (vs `'user'`), Wilson/EB-shrunk via
 *   `computeRateMetric`, using the global model-trigger rate across all
 *   capabilities as the shrinkage prior.
 * - `attribution_rate`: of the real invocations for a capability, the rate
 *   that have a matching `trigger: 'chain'` event for the same
 *   `(session_id, turn_index, capability_id)` — i.e. were independently
 *   confirmed by Claude Code's native attributionSkill signal rather than
 *   resting solely on the bare tool-use/user trigger. Same shrinkage
 *   treatment as `model_trigger_rate`.
 */
export function computeCapabilityMeasurements(
  events: EventEnvelope[],
  minSample: number,
): Map<string, CapabilityMeasurement> {
  const capEvents = events.filter((e) => e.event_type === "capability.invoked");

  const chainEvents = capEvents.filter(
    (e) => (e.payload as CapabilityInvokedPayload).trigger === "chain",
  );
  const nonChainEvents = capEvents.filter(
    (e) => (e.payload as CapabilityInvokedPayload).trigger !== "chain",
  );

  const chainKeys = new Set(
    chainEvents.map((e) => {
      const p = e.payload as CapabilityInvokedPayload;
      return `${p.session_id}:${p.turn_index}:${p.capability_id}`;
    }),
  );

  const nonChainKeys = new Set(
    nonChainEvents.map((e) => {
      const p = e.payload as CapabilityInvokedPayload;
      return `${p.session_id}:${p.turn_index}:${p.capability_id}`;
    }),
  );

  // A chain event only represents a genuinely distinct invocation when no
  // 'user'/'model' event exists for the same (session, turn, capability)
  // key — otherwise it's a redundant echo of that already-counted event.
  const chainOnlyEvents = chainEvents.filter((e) => {
    const p = e.payload as CapabilityInvokedPayload;
    return !nonChainKeys.has(`${p.session_id}:${p.turn_index}:${p.capability_id}`);
  });

  const realInvocations = [...nonChainEvents, ...chainOnlyEvents];
  const groups = groupBy(
    realInvocations,
    (e) => (e.payload as CapabilityInvokedPayload).capability_id,
  );

  const isAttributed = (e: EventEnvelope): boolean => {
    const p = e.payload as CapabilityInvokedPayload;
    return chainKeys.has(`${p.session_id}:${p.turn_index}:${p.capability_id}`);
  };

  const globalN = realInvocations.length;
  const globalModelHits = realInvocations.filter(
    (e) => (e.payload as CapabilityInvokedPayload).trigger === "model",
  ).length;
  const globalAttribHits = realInvocations.filter(isAttributed).length;
  const globalModelMean = globalN > 0 ? globalModelHits / globalN : 0.5;
  const globalAttribMean = globalN > 0 ? globalAttribHits / globalN : 0.5;

  const result = new Map<string, CapabilityMeasurement>();
  for (const [capId, evs] of groups.entries()) {
    const modelHits = evs.filter(
      (e) => (e.payload as CapabilityInvokedPayload).trigger === "model",
    ).length;
    const attribHits = evs.filter(isAttributed).length;

    result.set(capId, {
      capability: capId,
      invocation_count: evs.length,
      model_trigger_rate: computeRateMetric(
        modelHits,
        evs.length,
        minSample,
        globalModelMean,
        globalN,
      ),
      attribution_rate: computeRateMetric(
        attribHits,
        evs.length,
        minSample,
        globalAttribMean,
        globalN,
      ),
    });
  }

  return result;
}

/**
 * Reads `metric_rollups` back out, grouped by capability, for a given
 * window. Used by the profile projection writers so `profile.json`/
 * `profile.md` display the same durable numbers this module persisted,
 * rather than re-deriving them from an independent in-memory pass.
 */
export function readMetricRollups(
  db: Database,
  window: string,
): Map<string, Record<string, number>> {
  const rows = db
    .query(
      "SELECT capability, metric, value FROM metric_rollups WHERE window = ?",
    )
    .all(window) as { capability: string; metric: string; value: number }[];

  const result = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const bucket = result.get(row.capability) ?? {};
    bucket[row.metric] = row.value;
    result.set(row.capability, bucket);
  }
  return result;
}

export function upsertMetricRollup(
  db: Database,
  capability: string,
  window: string,
  metric: string,
  value: number,
): void {
  db.query(`INSERT INTO metric_rollups (capability, window, metric, value, computed_at)
    VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(capability, window, metric) DO UPDATE SET
      value=excluded.value, computed_at=excluded.computed_at`).run(
    capability,
    window,
    metric,
    value,
  );
}

export interface MeasureOptions {
  minSample?: number;
  window?: string;
}

/**
 * Phase 3 Measure: reads all events from `idisu.db`, computes the metric
 * catalog subset above per capability, and upserts each into
 * `metric_rollups` keyed `(capability, window, metric)`.
 *
 * `minSample` defaults to 1 (not the config `min_sample_threshold` default of
 * 5, which is `buildMetricProjections`'s in-memory-profile threshold): a
 * capability with only 1-4 invocations should still get a rollup row rather
 * than being silently gated out, since `metric_rollups` is meant to be the
 * durable source of truth profile writers read from, not just a
 * confidence-gated display projection.
 *
 * Returns the number of `metric_rollups` rows written/updated.
 */
export function measure(db: Database, opts: MeasureOptions = {}): number {
  const window = opts.window ?? ALL_TIME_WINDOW;
  const minSample = opts.minSample ?? 1;

  const events = readAllEventsFromDb(db);
  const measurements = computeCapabilityMeasurements(events, minSample);

  let written = 0;
  for (const [capId, m] of measurements.entries()) {
    upsertMetricRollup(
      db,
      capId,
      window,
      "invocation_count",
      m.invocation_count,
    );
    written++;

    if (m.model_trigger_rate) {
      upsertMetricRollup(
        db,
        capId,
        window,
        "model_trigger_rate",
        m.model_trigger_rate.shrunken,
      );
      written++;
    }
    if (m.attribution_rate) {
      upsertMetricRollup(
        db,
        capId,
        window,
        "attribution_rate",
        m.attribution_rate.shrunken,
      );
      written++;
    }
  }

  return written;
}
