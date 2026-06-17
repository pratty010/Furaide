import { test, expect } from 'bun:test'
import { wilsonCI, empiricalBayesShrink, computeRateMetric } from '../../src/analysis/metrics.js'

test('wilsonCI returns [0,1] interval for 0/0', () => {
  const { lower, upper } = wilsonCI(0, 0)
  expect(lower).toBe(0)
  expect(upper).toBe(1)
})

test('wilsonCI upper > lower for 5/10 with z=1.96', () => {
  const { lower, upper, center } = wilsonCI(5, 10)
  expect(upper).toBeGreaterThan(lower)
  expect(center).toBeCloseTo(0.5, 1)
})

test('empiricalBayesShrink pulls 1/1 toward global mean', () => {
  const shrunk = empiricalBayesShrink(1, 1, 0.8, 100)
  expect(shrunk).toBeLessThan(1.0)
  expect(shrunk).toBeGreaterThan(0.8)
})

test('computeRateMetric returns null for n < minSample', () => {
  const result = computeRateMetric(3, 5, 10, 0.8, 100)
  expect(result).toBeNull()
})

test('computeRateMetric returns shrunken estimate for adequate sample', () => {
  const result = computeRateMetric(8, 10, 5, 0.7, 80)
  expect(result).not.toBeNull()
  expect(result!.shrunken).toBeGreaterThan(0.5)
  expect(result!.shrunken).toBeLessThan(1.0)
})
