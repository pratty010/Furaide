import { readdirSync, existsSync } from 'node:fs'
import { EVENTS_DIR } from '../paths.js'
import { readEvents } from '../store/event-log.js'
import type { EventEnvelope } from '../types/events.js'
import type { CheckpointMap } from '../store/checkpoint.js'
import type { SessionAdapter } from '../adapters/base.js'

export interface GatherResult {
  newEvents: EventEnvelope[]
  eventsScanned: number
  sourcesScanned: number
}

export async function gather(
  adapters: SessionAdapter[],
  checkpoints: CheckpointMap,
  lookbackDays: number,
): Promise<GatherResult> {
  const newEvents: EventEnvelope[] = []
  let sourcesScanned = 0

  for (const adapter of adapters) {
    let count = 0
    for await (const ev of adapter.scan(checkpoints)) {
      newEvents.push(ev)
      count++
    }
    sourcesScanned++
    console.log(`[satori/gather] ${adapter.harness}: +${count} events`)
  }

  const eventsFromLog: EventEnvelope[] = []
  if (existsSync(EVENTS_DIR)) {
    const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10)
    const dates = readdirSync(EVENTS_DIR).filter(d => d >= cutoff).sort()
    for (const date of dates) {
      eventsFromLog.push(...readEvents(date, undefined, EVENTS_DIR))
    }
  }

  return {
    newEvents,
    eventsScanned: eventsFromLog.length,
    sourcesScanned,
  }
}
