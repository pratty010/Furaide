import { createHash } from 'node:crypto'
import type { IntentCluster } from '../types/projections.js'

const STOPWORDS = new Set(['the','a','an','is','it','to','of','in','and','or','for','with','on','at','by'])

export function extractBm25Terms(text: string, topN = 12): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1)
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w)
}

export function clusterByTermOverlap(
  promptTermSets: Array<{ id: string; terms: string[] }>,
  threshold = 0.25,
): Map<string, string[]> {
  const clusters = new Map<string, string[]>()

  for (const { id, terms } of promptTermSets) {
    let bestClusterId: string | undefined
    let bestScore = 0
    for (const [clusterId, memberIds] of clusters.entries()) {
      const repId = memberIds[0]
      const rep = promptTermSets.find(p => p.id === repId)?.terms ?? []
      const score = jaccard(terms, rep)
      if (score > bestScore && score >= threshold) {
        bestScore = score
        bestClusterId = clusterId
      }
    }
    if (bestClusterId) {
      clusters.get(bestClusterId)?.push(id)
    } else {
      const newId = createHash('sha256').update(id).digest('hex').slice(0, 12)
      clusters.set(newId, [id])
    }
  }
  return clusters
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

export function buildIntentClusters(
  clusters: Map<string, string[]>,
  promptTermSets: Array<{ id: string; terms: string[]; ts: string }>,
  existingNames: Map<string, string> = new Map(),
): IntentCluster[] {
  return [...clusters.entries()].map(([clusterId, memberIds]) => {
    const members = memberIds
      .map(id => promptTermSets.find(p => p.id === id))
      .filter((item): item is { id: string; terms: string[]; ts: string } => Boolean(item))
    const allTerms = members.flatMap(m => m.terms)
    const freq = new Map<string, number>()
    for (const t of allTerms) freq.set(t, (freq.get(t) ?? 0) + 1)
    const topTerms = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)
    const lastTs = members.map(m => m.ts).sort().at(-1) ?? new Date().toISOString()
    return {
      cluster_id: clusterId,
      name: existingNames.get(clusterId) ?? topTerms.slice(0, 3).join('/'),
      bm25_terms: topTerms,
      session_count: memberIds.length,
      last_seen: lastTs,
    } satisfies IntentCluster
  })
}
