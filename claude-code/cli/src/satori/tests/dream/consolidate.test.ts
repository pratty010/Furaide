import { test, expect } from 'bun:test'
import { buildMetricProjections } from '../../src/dream/consolidate.js'
import { makeTypedEvent } from '../../src/types/events.js'

const events = [
  makeTypedEvent('capability.invoked', 'cc:p/s1', 0, 'claude_code', {
    session_id: 's1', turn_index: 0, capability_id: 'brainstorming',
    capability_type: 'skill', harness: 'claude_code', trigger: 'model',
    observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_01',
  }),
  makeTypedEvent('outcome.observed', 'cc:p/s1', 1, 'claude_code', {
    tool_use_id: 'toolu_01', session_id: 's1',
    status: 'success', used_downstream: true,
    attribution: { skill: 'brainstorming' },
  }),
]

test('buildMetricProjections counts invocations per capability', () => {
  const proj = buildMetricProjections(events, 5)
  const b = proj.get('brainstorming')
  expect(b?.invocation_count).toBe(1)
})

test('buildMetricProjections computes used_downstream_rate for observed events', () => {
  const proj = buildMetricProjections(events, 1)
  const b = proj.get('brainstorming')
  expect(b?.used_downstream_rate).not.toBeNull()
  expect(b?.used_downstream_rate?.raw).toBe(1.0)
})
