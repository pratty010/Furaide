import type { Database } from 'bun:sqlite'
import type {
  EventEnvelope, EventType, Harness,
  CapabilityInvokedPayload, OutcomeObservedPayload,
  SessionObservedPayload, TurnObservedPayload,
} from '../types/events.js'
import { groupBy } from '../analysis/grammar.js'
import { computeRateMetric, type RateMetricResult } from '../analysis/metrics.js'
import { upsertSession, type SessionRow } from '../store/repo.js'

export interface CapabilityMetrics {
  capability_id: string
  invocation_count: number
  session_count: number
  used_downstream_rate: RateMetricResult | null
  load_success_rate: RateMetricResult | null
  model_trigger_rate: RateMetricResult | null
}

export function buildMetricProjections(
  events: EventEnvelope[],
  minSample: number,
): Map<string, CapabilityMetrics> {
  const outcomesByToolUseId = new Map<string, OutcomeObservedPayload>()
  for (const ev of events.filter(e => e.event_type === 'outcome.observed')) {
    const p = ev.payload as OutcomeObservedPayload
    if (p.tool_use_id) outcomesByToolUseId.set(p.tool_use_id, p)
  }

  const capInvocations = dedupeCapabilityInvocations(events.filter(e => e.event_type === 'capability.invoked'))
  const groups = groupBy(capInvocations, e => (e.payload as CapabilityInvokedPayload).capability_id)

  const result = new Map<string, CapabilityMetrics>()
  const globalTotals = { downstreamHits: 0, downstreamN: 0, successHits: 0, successN: 0 }

  const observedByCapability = new Map<string, EventEnvelope[]>()
  const sessionsByCapability = new Map<string, Set<string>>()
  const modelTriggersByCapability = new Map<string, EventEnvelope[]>()
  const outcomeCountsByCapability = new Map<string, { downstreamHits: number; successHits: number }>()

  for (const [capId, evs] of groups.entries()) {
    const observed = evs.filter(e => (e.payload as CapabilityInvokedPayload).observability_level === 'observed')
    const sessions = new Set(evs.map(e => (e.payload as CapabilityInvokedPayload).session_id))
    const modelTriggers = evs.filter(e => (e.payload as CapabilityInvokedPayload).trigger === 'model')

    let downstreamHits = 0
    let successHits = 0
    for (const ev of observed) {
      const p = ev.payload as CapabilityInvokedPayload
      const outcome = p.tool_use_id ? outcomesByToolUseId.get(p.tool_use_id) : undefined
      if (outcome?.used_downstream) downstreamHits++
      if (outcome?.status === 'success') successHits++
      globalTotals.downstreamHits += outcome?.used_downstream ? 1 : 0
      globalTotals.downstreamN++
      globalTotals.successHits += outcome?.status === 'success' ? 1 : 0
      globalTotals.successN++
    }

    observedByCapability.set(capId, observed)
    sessionsByCapability.set(capId, sessions)
    modelTriggersByCapability.set(capId, modelTriggers)
    outcomeCountsByCapability.set(capId, { downstreamHits, successHits })
  }

  for (const [capId, evs] of groups.entries()) {
    const observed = observedByCapability.get(capId) ?? []
    const sessions = sessionsByCapability.get(capId) ?? new Set<string>()
    const modelTriggers = modelTriggersByCapability.get(capId) ?? []
    const counts = outcomeCountsByCapability.get(capId) ?? { downstreamHits: 0, successHits: 0 }

    result.set(capId, {
      capability_id: capId,
      invocation_count: evs.length,
      session_count: sessions.size,
      used_downstream_rate: computeRateMetric(
        counts.downstreamHits,
        observed.length,
        minSample,
        globalTotals.downstreamN > 0 ? globalTotals.downstreamHits / globalTotals.downstreamN : 0.5,
        globalTotals.downstreamN,
      ),
      load_success_rate: computeRateMetric(
        counts.successHits,
        observed.length,
        minSample,
        globalTotals.successN > 0 ? globalTotals.successHits / globalTotals.successN : 0.8,
        globalTotals.successN,
      ),
      model_trigger_rate: computeRateMetric(
        modelTriggers.length,
        evs.length,
        minSample,
        0.7,
        evs.length,
      ),
    })
  }

  return result
}

interface EventTableRow {
  event_id: string
  schema_version: number
  source_id: string
  source_position: number | string
  observed_at: string
  ingested_at: string
  harness: string
  event_type: string
  payload_version: number
  payload: string
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
  }
}

/**
 * Phase 3 Consolidate: derives one `sessions` row per logical session from the
 * full event history in `idisu.db`.
 *
 * Grouping key: `payload.session_id`, not raw `source_id`. A single logical
 * session can appear under two different `source_id`s (`cc:<slug>/<id>` from
 * the transcript adapter and `cc-hook:<id>` from the live hook path — see
 * ClaudeCodeAdapter and consolidate's own dedupeCapabilityInvocations above),
 * and the `sessions` table's primary key is `session_id`. Grouping by raw
 * `source_id` would split one session into two rows; `payload.session_id` is
 * what actually identifies a session across both source styles. Falls back to
 * `source_id` only for the (currently theoretical) case of a payload with no
 * `session_id`.
 *
 * `model`/`cwd` are best-effort: as of this writing no event producer in this
 * codebase actually populates them (the `session_start.sh` hook emits a raw,
 * non-`EventEnvelope`-shaped line that `gather()` drops as malformed before it
 * ever reaches `idisu.db`, and no adapter sets `TurnObservedPayload.model`).
 * The lookup below still checks `session.observed`/`turn.observed` payloads so
 * it starts working the moment either producer is wired up, but today it will
 * typically leave both columns `null` — that's a known gap for later work, not
 * a bug in this rollup.
 */
export function rollupSessions(db: Database): number {
  const rows = db.query('SELECT * FROM events ORDER BY observed_at ASC').all() as EventTableRow[]
  const events = rows.map(rowToEnvelope)

  const bySession = new Map<string, EventEnvelope[]>()
  for (const ev of events) {
    const payload = ev.payload as { session_id?: string }
    const sessionId = payload.session_id ?? ev.source_id
    const group = bySession.get(sessionId)
    if (group) group.push(ev)
    else bySession.set(sessionId, [ev])
  }

  let upserted = 0
  for (const [sessionId, evs] of bySession.entries()) {
    // `bySession` only ever gains entries via `push`/single-element-array
    // above, so every group has at least one event.
    const first = evs[0] as EventEnvelope
    let started_at = first.observed_at
    let ended_at = first.observed_at
    for (const e of evs) {
      if (e.observed_at < started_at) started_at = e.observed_at
      if (e.observed_at > ended_at) ended_at = e.observed_at
    }

    let model: string | undefined
    let cwd: string | undefined
    for (const e of evs) {
      if (e.event_type === 'session.observed') {
        const p = e.payload as SessionObservedPayload
        model = model ?? p.model
        cwd = cwd ?? p.workspace
      } else if (e.event_type === 'turn.observed') {
        const p = e.payload as TurnObservedPayload
        model = model ?? p.model
      }
      if (model && cwd) break
    }

    const rollup = {
      tool_calls: evs.filter(e => e.event_type === 'tool.called').length,
      capability_invocations: evs.filter(e => e.event_type === 'capability.invoked').length,
      outcomes: evs.filter(e => e.event_type === 'outcome.observed').length,
      turns: evs.filter(e => e.event_type === 'turn.observed').length,
      total_events: evs.length,
    }

    const row: SessionRow = {
      session_id: sessionId,
      harness: first.harness,
      started_at,
      ended_at,
      cwd,
      model,
      rollup: JSON.stringify(rollup),
    }
    upsertSession(db, row)
    upserted++
  }

  return upserted
}

function dedupeCapabilityInvocations(events: EventEnvelope[]): EventEnvelope[] {
  const deduped = new Map<string, EventEnvelope>()

  for (const event of events) {
    const payload = event.payload as CapabilityInvokedPayload
    const semanticKey = payload.tool_use_id
      ? `${payload.session_id}:${payload.tool_use_id}:${payload.capability_id}:${event.event_type}`
      : event.event_id
    const existing = deduped.get(semanticKey)

    if (!existing) {
      deduped.set(semanticKey, event)
      continue
    }

    const shouldPreferCurrent = existing.source_id.startsWith('cc-hook:') && !event.source_id.startsWith('cc-hook:')
    if (shouldPreferCurrent) {
      deduped.set(semanticKey, event)
    }
  }

  return [...deduped.values()]
}
