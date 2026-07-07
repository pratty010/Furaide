import { test, expect } from 'bun:test'
import { rmSync } from 'node:fs'
import { buildMetricProjections, rollupSessions } from '../../src/dream/consolidate.js'
import { makeTypedEvent } from '../../src/types/events.js'
import { openDb } from '../../src/store/db.js'
import { insertEvent, type EventRow } from '../../src/store/repo.js'

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

test('buildMetricProjections computes attribution_rate from a matching chain event', () => {
  const attributedEvents = [
    makeTypedEvent('capability.invoked', 'cc:p/s1', 0, 'claude_code', {
      session_id: 's1', turn_index: 0, capability_id: 'tdd',
      capability_type: 'skill', harness: 'claude_code', trigger: 'model',
      observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_01',
    }),
    makeTypedEvent('capability.invoked', 'cc:p/s1', '0:attribution', 'claude_code', {
      session_id: 's1', turn_index: 0, capability_id: 'tdd',
      capability_type: 'skill', harness: 'claude_code', trigger: 'chain',
      observability_level: 'observed', confidence: 1.0,
    }),
    makeTypedEvent('capability.invoked', 'cc:p/s2', 0, 'claude_code', {
      session_id: 's2', turn_index: 0, capability_id: 'tdd',
      capability_type: 'skill', harness: 'claude_code', trigger: 'model',
      observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_02',
    }),
  ]

  const proj = buildMetricProjections(attributedEvents, 1)
  const tdd = proj.get('tdd')
  expect(tdd?.attribution_rate).not.toBeNull()
  // buildMetricProjections groups all 3 raw capability.invoked rows for
  // 'tdd' (it doesn't collapse chain+model pairs the way analysis/measure.ts
  // does). Of those 3, 2 share the s1:0:tdd key (the model event and its
  // matching chain echo) and count as attributed; s2's model event has no
  // chain counterpart.
  expect(tdd?.attribution_rate?.raw).toBeCloseTo(2 / 3, 3)
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

test('rollupSessions groups events by session_id into one sessions row per session', () => {
  const dbPath = '/tmp/idisu-rollup-sessions-test.sqlite'
  rmSync(dbPath, { force: true })
  const db = openDb(dbPath)

  const toRow = (ev: ReturnType<typeof makeTypedEvent>): EventRow => ({
    event_id: ev.event_id, schema_version: ev.schema_version, source_id: ev.source_id,
    source_position: ev.source_position, observed_at: ev.observed_at, ingested_at: ev.ingested_at,
    harness: ev.harness, event_type: ev.event_type, payload_version: ev.payload_version,
    payload: ev.payload,
  })

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
    makeTypedEvent('capability.invoked', 'cc:p/s2', 0, 'claude_code', {
      session_id: 's2', turn_index: 0, capability_id: 'tdd',
      capability_type: 'skill', harness: 'claude_code', trigger: 'model',
      observability_level: 'observed', confidence: 1.0, tool_use_id: 'toolu_02',
    }),
  ]

  for (const ev of events) insertEvent(db, toRow(ev))

  const upserted = rollupSessions(db)
  expect(upserted).toBe(2)

  const rows = db.query('SELECT session_id, rollup FROM sessions ORDER BY session_id ASC').all() as
    { session_id: string; rollup: string }[]
  expect(rows.length).toBe(2)
  expect(rows.map(r => r.session_id)).toEqual(['s1', 's2'])

  const s1Rollup = JSON.parse(rows[0]!.rollup)
  expect(s1Rollup.capability_invocations).toBe(1)
  expect(s1Rollup.outcomes).toBe(1)
  expect(s1Rollup.total_events).toBe(2)

  db.close()
  rmSync(dbPath, { force: true })
})
