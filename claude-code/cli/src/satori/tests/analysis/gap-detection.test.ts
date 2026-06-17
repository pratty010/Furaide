import { test, expect } from 'bun:test'
import { generateGapCandidates } from '../../src/analysis/gap-detection.js'

test('generateGapCandidates returns candidates ranked by BM25 score', () => {
  const promptTerms = ['brainstorm', 'feature', 'design', 'requirements']
  const firingCapabilities = new Set<string>(['writing-plans'])
  const bm25Results = [
    { capability_id: 'brainstorming', rank: -2.1 },
    { capability_id: 'tdd', rank: -0.5 },
  ]
  const candidates = generateGapCandidates(promptTerms, firingCapabilities, bm25Results)
  expect(candidates.some(c => c.capability_id === 'brainstorming')).toBe(true)
  expect(candidates.some(c => c.capability_id === 'writing-plans')).toBe(false)
})
