import type { EventEnvelope } from '../types/events.js'
import type { CapabilityInvokedPayload } from '../types/events.js'

export type DimensionKey =
  | 'capability'
  | 'harness'
  | 'workspace'
  | 'session'
  | 'date'
  | 'hour'
  | 'trigger'
  | 'observability_level'
  | 'intent_cluster'

export function extractDimension(event: EventEnvelope, dim: DimensionKey): string | undefined {
  switch (dim) {
    case 'harness': return event.harness
    case 'session': {
      const p = event.payload as Record<string, unknown>
      return p.session_id as string | undefined
    }
    case 'capability': {
      if (event.event_type !== 'capability.invoked') return undefined
      return (event.payload as CapabilityInvokedPayload).capability_id
    }
    case 'trigger': {
      if (event.event_type !== 'capability.invoked') return undefined
      return (event.payload as CapabilityInvokedPayload).trigger
    }
    case 'observability_level': {
      if (event.event_type !== 'capability.invoked') return undefined
      return (event.payload as CapabilityInvokedPayload).observability_level
    }
    case 'intent_cluster': {
      if (event.event_type !== 'prompt.observed') return undefined
      return (event.payload as { intent_cluster_id?: string }).intent_cluster_id
    }
    case 'date': return event.observed_at.slice(0, 10)
    case 'hour': return event.observed_at.slice(0, 13)
    case 'workspace': {
      const p = event.payload as Record<string, unknown>
      return p.workspace as string | undefined
    }
    default: return undefined
  }
}
