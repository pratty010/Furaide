import { test, expect } from 'bun:test'
import { renderProfileMd } from '../../src/projections/profile.js'
import type { CapabilityMetrics } from '../../src/dream/consolidate.js'

function metric(overrides: Partial<CapabilityMetrics> = {}): CapabilityMetrics {
  return {
    capability_id: 'tdd',
    invocation_count: 3,
    session_count: 2,
    used_downstream_rate: null,
    load_success_rate: null,
    model_trigger_rate: null,
    attribution_rate: { raw: 0.667, shrunken: 0.667, ci: { lower: 0.1, upper: 0.9, center: 0.667 }, n: 3 },
    ...overrides,
  }
}

test('renderProfileMd surfaces attribution_rate in the top-capabilities table', () => {
  const metrics = new Map<string, CapabilityMetrics>([['tdd', metric()]])
  const md = renderProfileMd(metrics, [], 'claude_code')

  expect(md).toContain('Attribution%')
  expect(md).toContain('67% (n=3)')
})

test('renderProfileMd reports n/a for a capability with no attribution_rate yet', () => {
  const metrics = new Map<string, CapabilityMetrics>([
    ['tdd', metric({ attribution_rate: null })],
  ])
  const md = renderProfileMd(metrics, [], 'claude_code')

  const row = md.split('\n').find(l => l.startsWith('| tdd'))
  expect(row).toBeDefined()
  expect(row).toContain('n/a')
})
