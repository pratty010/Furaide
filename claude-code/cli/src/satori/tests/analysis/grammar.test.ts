import { test, expect } from 'bun:test'
import { groupBy, applyMetric, compareVsThreshold } from '../../src/analysis/grammar.js'
import { makeTypedEvent } from '../../src/types/events.js'

const events = [
  makeTypedEvent('capability.invoked', 'cc:p/s1', 0, 'claude_code', {
    session_id: 's1', turn_index: 0, capability_id: 'brainstorming',
    capability_type: 'skill', harness: 'claude_code', trigger: 'model',
    observability_level: 'observed', confidence: 1.0,
  }),
  makeTypedEvent('capability.invoked', 'cc:p/s1', 1, 'claude_code', {
    session_id: 's1', turn_index: 1, capability_id: 'brainstorming',
    capability_type: 'skill', harness: 'claude_code', trigger: 'model',
    observability_level: 'observed', confidence: 1.0,
  }),
  makeTypedEvent('capability.invoked', 'cc:p/s2', 0, 'claude_code', {
    session_id: 's2', turn_index: 0, capability_id: 'tdd',
    capability_type: 'skill', harness: 'claude_code', trigger: 'user',
    observability_level: 'observed', confidence: 1.0,
  }),
]

test('groupBy capability splits events correctly', () => {
  const groups = groupBy(events, e => {
    if (e.event_type !== 'capability.invoked') return undefined
    return (e.payload as { capability_id: string }).capability_id
  })
  expect(groups.get('brainstorming')?.length).toBe(2)
  expect(groups.get('tdd')?.length).toBe(1)
})

test('applyMetric count works', () => {
  const groups = groupBy(events, e => {
    if (e.event_type !== 'capability.invoked') return undefined
    return (e.payload as { capability_id: string }).capability_id
  })
  const counts = applyMetric(groups, items => items.length)
  expect(counts.get('brainstorming')).toBe(2)
  expect(counts.get('tdd')).toBe(1)
})

test('compareVsThreshold flags capabilities below threshold', () => {
  const counts = new Map([['brainstorming', 5], ['tdd', 1]])
  const flagged = compareVsThreshold(counts, 2)
  expect(flagged.has('tdd')).toBe(true)
  expect(flagged.has('brainstorming')).toBe(false)
})
