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

test('buildMetricProjections uses a global baseline across all capabilities', () => {
  const mixedEvents = [
    makeTypedEvent('capability.invoked', 'cc:p/s1', 0, 'claude_code', {
      session_id: 's1', turn_index: 0, capability_id: 'brainstorming',
      capability_type: 'skill', harness: 'claude_code', trigger: 'model',
      observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_01',
    }),
    makeTypedEvent('capability.invoked', 'cc:p/s2', 0, 'claude_code', {
      session_id: 's2', turn_index: 0, capability_id: 'tdd',
      capability_type: 'skill', harness: 'claude_code', trigger: 'model',
      observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_02',
    }),
    makeTypedEvent('outcome.observed', 'cc:p/s1', 1, 'claude_code', {
      tool_use_id: 'toolu_01', session_id: 's1',
      status: 'success', used_downstream: true,
      attribution: { skill: 'brainstorming' },
    }),
    makeTypedEvent('outcome.observed', 'cc:p/s2', 1, 'claude_code', {
      tool_use_id: 'toolu_02', session_id: 's2',
      status: 'failure', used_downstream: false,
      attribution: { skill: 'tdd' },
    }),
  ]

  const proj = buildMetricProjections(mixedEvents, 1)
  const brainstorming = proj.get('brainstorming')
  const tdd = proj.get('tdd')

  expect(brainstorming?.used_downstream_rate).not.toBeNull()
  expect(tdd?.used_downstream_rate).not.toBeNull()
  expect(brainstorming?.used_downstream_rate?.shrunken).toBeLessThan(1.0)
  expect(tdd?.used_downstream_rate?.shrunken).toBeGreaterThan(0.0)
})

test('buildMetricProjections deduplicates hook and transcript capability events for one tool use', () => {
  const duplicatedEvents = [
    makeTypedEvent('capability.invoked', 'cc-hook:s1', 'skill.invoke:toolu_01', 'claude_code', {
      session_id: 's1', turn_index: 0, capability_id: 'brainstorming',
      capability_type: 'skill', harness: 'claude_code', trigger: 'model',
      observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_01',
    }),
    makeTypedEvent('capability.invoked', 'cc:proj/s1', '12:toolu_01', 'claude_code', {
      session_id: 's1', turn_index: 12, capability_id: 'brainstorming',
      capability_type: 'skill', harness: 'claude_code', trigger: 'model',
      observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_01',
    }),
    makeTypedEvent('outcome.observed', 'cc-hook:s1', 'skill.loaded:toolu_01', 'claude_code', {
      tool_use_id: 'toolu_01', session_id: 's1',
      status: 'success', used_downstream: false,
      attribution: { plugin: 'idisu' },
    }),
  ]

  const proj = buildMetricProjections(duplicatedEvents, 1)
  const brainstorming = proj.get('brainstorming')
  expect(brainstorming?.invocation_count).toBe(1)
})
