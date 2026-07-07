import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { dreamLock } from '../lock.js'
import { loadConfig } from '../config.js'
import { loadCheckpoints, saveCheckpoint } from '../store/checkpoint.js'
import { appendEvent, readEvents } from '../store/event-log.js'
import { EVENTS_DIR, STATE_DIR, STATE_MANIFEST, CHECKPOINTS_FILE, LAST_DREAM_FILE } from '../paths.js'
import { ClaudeCodeAdapter } from '../adapters/claude-code.js'
import { orient } from './orient.js'
import { gather } from './gather.js'
import { buildMetricProjections } from './consolidate.js'
import { pruneAndIndex } from './prune.js'
import { writeProfile } from '../projections/profile.js'
import { clusterByTermOverlap, buildIntentClusters } from '../analysis/intent.js'
import type { SessionAdapter } from '../adapters/base.js'
import type { StateManifest } from '../types/projections.js'

export interface DreamRunResult {
  eventsIngested: number
  metricsComputed: number
  clustersFound: number
  durationMs: number
}

export async function runDream(opts: { force?: boolean; scheduled?: boolean } = {}): Promise<DreamRunResult> {
  const t0 = Date.now()
  const config = loadConfig()

  return dreamLock.withLock(async () => {
    if (opts.scheduled && !opts.force && existsSync(LAST_DREAM_FILE)) {
      const last = Number.parseInt((await import('node:fs')).readFileSync(LAST_DREAM_FILE, 'utf8').trim(), 10)
      if (Number.isFinite(last)) {
        const elapsedHours = (Date.now() / 1000 - last) / 3600
        if (elapsedHours < config.dream_interval_hours) {
          return {
            eventsIngested: 0,
            metricsComputed: 0,
            clustersFound: 0,
            durationMs: Date.now() - t0,
          }
        }
      }
    }

    const orientation = orient()
    console.log('[idisu/dream] Phase 1 Orient complete')

    const adapters: SessionAdapter[] = []
    if (config.harnesses.includes('claude_code')) {
      adapters.push(new ClaudeCodeAdapter())
    }
    if (config.harnesses.includes('codex')) {
      const { CodexAdapter } = await import('../adapters/codex.js')
      adapters.push(new CodexAdapter())
    }
    if (config.harnesses.includes('opencode')) {
      const { OpenCodeAdapter } = await import('../adapters/opencode.js')
      adapters.push(new OpenCodeAdapter())
    }

    const checkpoints = loadCheckpoints(CHECKPOINTS_FILE)
    const { newEvents } = await gather(adapters, checkpoints, config.lookback_days)

    for (const ev of newEvents) appendEvent(ev)
    saveCheckpoint(checkpoints, {
      source_id: '_dream_pass',
      last_complete_line_offset: 0,
      last_scanned_at: new Date().toISOString(),
    }, CHECKPOINTS_FILE)
    console.log(`[idisu/dream] Phase 2 Gather: +${newEvents.length} events`)

    const allEvents = []
    if (existsSync(EVENTS_DIR)) {
      const dates = readdirSync(EVENTS_DIR).sort()
      for (const date of dates) {
        allEvents.push(...readEvents(date))
      }
    }

    const metrics = buildMetricProjections(allEvents, config.min_sample_threshold)

    const promptEvents = allEvents.filter(e => e.event_type === 'prompt.observed')
    const termSets = promptEvents.map(e => ({
      id: e.event_id,
      terms: ((e.payload as { features?: { bm25_terms?: string[] } }).features?.bm25_terms ?? []),
      ts: e.observed_at,
    }))
    const clusterMap = clusterByTermOverlap(termSets)
    const clusters = buildIntentClusters(clusterMap, termSets)

    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
    writeProfile(metrics, clusters)

    const lastEvent = allEvents.at(-1)
    const manifest: StateManifest = {
      schema_version: 1,
      built_through_event_id: lastEvent?.event_id ?? 'none',
      built_at: new Date().toISOString(),
      generation: (orientation.manifest?.generation ?? 0) + 1,
    }
    writeFileSync(STATE_MANIFEST, JSON.stringify(manifest, null, 2))
    console.log(`[idisu/dream] Phase 3 Consolidate: ${metrics.size} capabilities, ${clusters.length} clusters`)

    pruneAndIndex(config.evidence_retention_days)
    console.log('[idisu/dream] Phase 4 Prune complete')
    writeFileSync(LAST_DREAM_FILE, `${Math.floor(Date.now() / 1000)}\n`)

    return {
      eventsIngested: newEvents.length,
      metricsComputed: metrics.size,
      clustersFound: clusters.length,
      durationMs: Date.now() - t0,
    }
  })
}
