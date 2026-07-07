import { z } from 'zod'
import { createHash } from 'crypto'

// ── Envelope ─────────────────────────────────────────────────────────────────

export const HarnessSchema = z.enum(['claude_code', 'codex', 'opencode'])
export type Harness = z.infer<typeof HarnessSchema>

export const EventTypeSchema = z.enum([
  'session.observed',
  'capability.invoked',
  'tool.called',
  'outcome.observed',
  'turn.observed',
])
export type EventType = z.infer<typeof EventTypeSchema>

export const EventEnvelopeSchema = z.object({
  schema_version:  z.literal(1),
  event_id:        z.string().min(1),
  source_id:       z.string().min(1),
  source_position: z.union([z.number().int().nonnegative(), z.string()]),
  observed_at:     z.string().datetime(),
  ingested_at:     z.string().datetime(),
  harness:         HarnessSchema,
  event_type:      EventTypeSchema,
  payload_version: z.number().int().positive(),
  payload:         z.unknown(),
})
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>

// ── Payloads ──────────────────────────────────────────────────────────────────

export const SessionObservedPayloadSchema = z.object({
  session_id:          z.string(),
  harness:             HarnessSchema,
  workspace:           z.string().optional(),
  model:               z.string().optional(),
  source:              z.string().optional(),
  started_at:          z.string().datetime(),
  ended_at:            z.string().datetime().optional(),
  ended_cleanly:       z.boolean().optional(),
  transcript_pointer:  z.string(),
})

export const TurnObservedPayloadSchema = z.object({
  session_id:    z.string(),
  turn_index:    z.number().int().nonnegative(),
  role:          z.enum(['user', 'assistant']),
  model:         z.string().optional(),
  ts:            z.string().datetime(),
  usage:         z.object({
    input:            z.number().int().nonnegative(),
    output:           z.number().int().nonnegative(),
    cache_read:       z.number().int().nonnegative().optional(),
    cache_creation:   z.number().int().nonnegative().optional(),
  }).optional(),
  prompt_source: z.string().optional(),
  is_sidechain:  z.boolean().default(false),
  is_meta:       z.boolean().default(false),
})

export const ObservabilityLevelSchema = z.enum(['observed', 'inferred', 'unobservable'])
export type ObservabilityLevel = z.infer<typeof ObservabilityLevelSchema>

export const CapabilityInvokedPayloadSchema = z.object({
  session_id:          z.string(),
  turn_index:          z.number().int().nonnegative(),
  capability_id:       z.string(),
  capability_type:     z.enum(['skill', 'agent', 'command', 'plugin']),
  harness:             HarnessSchema,
  trigger:             z.enum(['model', 'user', 'chain']),
  tool_use_id:         z.string().optional(),
  observability_level: ObservabilityLevelSchema,
  confidence:          z.number().min(0).max(1),
  topk_candidates:     z.array(z.string()).optional(),
})

export const ToolCalledPayloadSchema = z.object({
  session_id:           z.string(),
  turn_index:           z.number().int().nonnegative(),
  tool_name:            z.string(),
  tool_use_id:          z.string(),
  parent_capability_id: z.string().optional(),
  args_present:         z.boolean(),
  ts:                   z.string().datetime(),
})

export const OutcomeObservedPayloadSchema = z.object({
  tool_use_id:      z.string(),
  session_id:       z.string(),
  status:           z.enum(['success', 'failure']),
  exit_code:        z.number().int().optional(),
  run_time_seconds: z.number().nonnegative().optional(),
  used_downstream:  z.boolean(),
  attribution: z.object({
    skill:  z.string().optional(),
    plugin: z.string().optional(),
  }),
  error_class: z.string().optional(),
})

// ── Payload type exports ──────────────────────────────────────────────────────

export type SessionObservedPayload    = z.infer<typeof SessionObservedPayloadSchema>
export type TurnObservedPayload       = z.infer<typeof TurnObservedPayloadSchema>
export type CapabilityInvokedPayload  = z.infer<typeof CapabilityInvokedPayloadSchema>
export type ToolCalledPayload         = z.infer<typeof ToolCalledPayloadSchema>
export type OutcomeObservedPayload    = z.infer<typeof OutcomeObservedPayloadSchema>

// ── Factory helpers ───────────────────────────────────────────────────────────

export function makeEventId(sourceId: string, sourcePosition: number | string): string {
  return createHash('sha256').update(`${sourceId}:${sourcePosition}`).digest('hex').slice(0, 32)
}

export function makeTypedEvent(
  eventType: EventType,
  sourceId: string,
  sourcePosition: number | string,
  harness: Harness,
  payload: unknown,
): EventEnvelope {
  const now = new Date().toISOString()
  return {
    schema_version:  1,
    event_id:        makeEventId(sourceId, sourcePosition),
    source_id:       sourceId,
    source_position: sourcePosition,
    observed_at:     now,
    ingested_at:     now,
    harness,
    event_type:      eventType,
    payload_version: 1,
    payload,
  }
}
