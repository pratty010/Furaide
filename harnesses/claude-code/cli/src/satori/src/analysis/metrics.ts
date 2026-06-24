export function wilsonCI(successes: number, n: number, z = 1.96): {
  lower: number; upper: number; center: number
} {
  if (n === 0) return { lower: 0, upper: 1, center: 0.5 }
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const margin = (z / denom) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    center,
  }
}

export function empiricalBayesShrink(
  successes: number,
  n: number,
  globalMean: number,
  globalN: number,
): number {
  const kappa = Math.max(1, globalN / 10)
  const alpha = globalMean * kappa
  const beta = (1 - globalMean) * kappa
  return (successes + alpha) / (n + alpha + beta)
}

export interface RateMetricResult {
  raw: number
  shrunken: number
  ci: { lower: number; upper: number; center: number }
  n: number
}

export function computeRateMetric(
  successes: number,
  n: number,
  minSample: number,
  globalMean: number,
  globalN: number,
): RateMetricResult | null {
  if (n < minSample) return null
  return {
    raw: n === 0 ? 0 : successes / n,
    shrunken: empiricalBayesShrink(successes, n, globalMean, globalN),
    ci: wilsonCI(successes, n),
    n,
  }
}

export type MetricKey =
  | 'used_downstream_rate'
  | 'model_trigger_rate'
  | 'load_success_rate'
  | 'invocation_count'
  | 'session_count'
