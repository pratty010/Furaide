import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from '../paths.js'
import type { CapabilityMetrics } from '../dream/consolidate.js'
import type { IntentCluster } from '../types/projections.js'

export function renderProfileMd(
  metrics: Map<string, CapabilityMetrics>,
  clusters: IntentCluster[],
  harness: string,
): string {
  void harness
  const topByInvocations = [...metrics.values()]
    .sort((a, b) => b.invocation_count - a.invocation_count)
    .slice(0, 10)

  const lines = [
    '# Satori — Capability Profile',
    `_Last updated: ${new Date().toISOString()}_`,
    '',
    '## Top capabilities by invocation',
    '| Capability | Invocations | Sessions | Downstream% | Success% |',
    '|---|---|---|---|---|',
    ...topByInvocations.map(m =>
      `| ${m.capability_id} | ${m.invocation_count} | ${m.session_count} | ${fmtRate(m.used_downstream_rate)} | ${fmtRate(m.load_success_rate)} |`,
    ),
    '',
    '## Recurring intent clusters',
    ...clusters.slice(0, 8).map(c => `- **${c.name}** (${c.session_count} sessions): \`${c.bm25_terms.slice(0, 4).join(', ')}\``),
  ]
  return lines.join('\n')
}

function fmtRate(r: { shrunken: number; n: number } | null): string {
  if (!r) return 'n/a'
  return `${(r.shrunken * 100).toFixed(0)}% (n=${r.n})`
}

export function writeProfile(
  metrics: Map<string, CapabilityMetrics>,
  clusters: IntentCluster[],
  harness = 'claude_code',
): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(join(STATE_DIR, 'profile.md'), renderProfileMd(metrics, clusters, harness))
  writeFileSync(join(STATE_DIR, 'profile.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    capabilities: [...metrics.values()],
    intent_clusters: clusters,
  }, null, 2))
}
