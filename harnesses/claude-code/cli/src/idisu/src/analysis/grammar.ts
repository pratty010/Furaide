import type { EventEnvelope } from '../types/events.js'

export function groupBy<K>(
  events: EventEnvelope[],
  keyFn: (ev: EventEnvelope) => K | undefined,
): Map<K, EventEnvelope[]> {
  const map = new Map<K, EventEnvelope[]>()
  for (const ev of events) {
    const key = keyFn(ev)
    if (key === undefined) continue
    const existing = map.get(key) ?? []
    existing.push(ev)
    map.set(key, existing)
  }
  return map
}

export function applyMetric<K, V>(
  groups: Map<K, EventEnvelope[]>,
  metricFn: (events: EventEnvelope[]) => V,
): Map<K, V> {
  const result = new Map<K, V>()
  for (const [key, items] of groups.entries()) {
    result.set(key, metricFn(items))
  }
  return result
}

export function compareVsThreshold<K>(metrics: Map<K, number>, threshold: number): Set<K> {
  const flagged = new Set<K>()
  for (const [key, value] of metrics.entries()) {
    if (value < threshold) flagged.add(key)
  }
  return flagged
}

export function rankByMetric<K>(metrics: Map<K, number>): Array<{ key: K; value: number; rank: number }> {
  return [...metrics.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value], i) => ({ key, value, rank: i + 1 }))
}

export function vsBaseline<K>(
  current: Map<K, number>,
  baseline: Map<K, number>,
): Map<K, { current: number; baseline: number; delta: number }> {
  const result = new Map<K, { current: number; baseline: number; delta: number }>()
  for (const [key, cur] of current.entries()) {
    const base = baseline.get(key) ?? 0
    result.set(key, { current: cur, baseline: base, delta: cur - base })
  }
  return result
}
