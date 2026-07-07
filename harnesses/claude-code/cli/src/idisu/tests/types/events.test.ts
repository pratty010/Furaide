import { test, expect } from 'bun:test'
import {
  EventEnvelopeSchema,
  CapabilityInvokedPayloadSchema,
  makeTypedEvent,
  makeEventId,
} from '../../src/types/events.js'

const base = {
  schema_version:  1 as const,
  event_id:        'abc123',
  source_id:       'cc:proj/sess',
  source_position: 0,
  observed_at:     '2026-06-17T10:00:00Z',
  ingested_at:     '2026-06-17T10:01:00Z',
  harness:         'claude_code' as const,
  event_type:      'session.observed' as const,
  payload_version: 1,
  payload:         {},
}

test('EventEnvelopeSchema parses valid envelope', () => {
  expect(() => EventEnvelopeSchema.parse(base)).not.toThrow()
})

test('EventEnvelopeSchema rejects unknown event_type', () => {
  expect(() => EventEnvelopeSchema.parse({ ...base, event_type: 'bad.type' })).toThrow()
})

test('CapabilityInvokedPayloadSchema enforces observability_level', () => {
  const p = {
    session_id: 's1', turn_index: 0,
    capability_id: 'brainstorming', capability_type: 'skill' as const,
    harness: 'claude_code' as const, trigger: 'model' as const,
    observability_level: 'observed' as const, confidence: 0.95,
  }
  expect(() => CapabilityInvokedPayloadSchema.parse(p)).not.toThrow()
})

test('makeTypedEvent attaches correct schema_version and event_type', () => {
  const ev = makeTypedEvent('session.observed', 'cc:x', 0, 'claude_code', {
    session_id: 's', harness: 'claude_code', transcript_pointer: '/p',
    started_at: '2026-06-17T10:00:00Z',
  })
  expect(ev.schema_version).toBe(1)
  expect(ev.event_type).toBe('session.observed')
})

test('makeEventId is deterministic', () => {
  expect(makeEventId('src', 0)).toBe(makeEventId('src', 0))
  expect(makeEventId('src', 0)).not.toBe(makeEventId('src', 1))
})

test('makeEventId produces stable 32-character hex strings', () => {
  const eventId = makeEventId('s', 3)
  // Verify stability: same input always produces same output
  expect(eventId).toBe(makeEventId('s', 3))
  // Verify length: exactly 32 characters
  expect(eventId).toHaveLength(32)
  // Verify hex format: only contains 0-9 and a-f
  expect(/^[0-9a-f]{32}$/.test(eventId)).toBe(true)
})
