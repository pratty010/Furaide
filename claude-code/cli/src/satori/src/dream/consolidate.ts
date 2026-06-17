import type { EventEnvelope, CapabilityInvokedPayload, OutcomeObservedPayload } from '../types/events.js'
import { groupBy } from '../analysis/grammar.js'
import { computeRateMetric, type RateMetricResult } from '../analysis/metrics.js'

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

  const capInvocations = events.filter(e => e.event_type === 'capability.invoked')
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
