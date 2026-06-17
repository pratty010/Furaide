import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { EVENTS_DIR } from '../paths.js'
import { EventEnvelopeSchema, makeEventId, type EventEnvelope } from '../types/events.js'

export { makeEventId }

function partitionDir(date: string, eventsDir: string): string {
  return join(eventsDir, date)
}

function logFile(date: string, harness: string, eventsDir: string): string {
  return join(partitionDir(date, eventsDir), `${harness}.jsonl`)
}

const seenIds = new Set<string>() // in-process dedup cache

export function appendEvent(event: EventEnvelope, eventsDir: string = EVENTS_DIR): void {
  EventEnvelopeSchema.parse(event) // throws on invalid schema
  if (seenIds.has(event.event_id)) return
  const date = event.observed_at.slice(0, 10)
  const dir = partitionDir(date, eventsDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(logFile(date, event.harness, eventsDir), JSON.stringify(event) + '\n')
  seenIds.add(event.event_id)
}

export function* readEvents(
  date: string,
  harness?: string,
  eventsDir: string = EVENTS_DIR,
): Generator<EventEnvelope> {
  const dir = partitionDir(date, eventsDir)
  if (!existsSync(dir)) return
  const files = harness
    ? [logFile(date, harness, eventsDir)]
    : readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f))
  const seen = new Set<string>() // cross-process dedup on read
  for (const file of files) {
    if (!existsSync(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = EventEnvelopeSchema.parse(JSON.parse(line))
        if (seen.has(ev.event_id)) continue
        seen.add(ev.event_id)
        yield ev
      } catch {
        // skip and warn — never advance checkpoint past malformed line
        console.warn('[satori] skipped malformed event line')
      }
    }
  }
}
