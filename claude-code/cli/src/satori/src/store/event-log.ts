import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { EVENTS_DIR } from '../paths.js'
import { EventEnvelopeSchema, makeEventId, type EventEnvelope } from '../types/events.js'

export { makeEventId }

function partitionDir(date: string, eventsDir: string): string {
  return join(eventsDir, date)
}

function logFile(date: string, harness: string, eventsDir: string): string {
  return join(partitionDir(date, eventsDir), `${harness}.jsonl`)
}

function normalizeHookEvent(raw: Record<string, unknown>): EventEnvelope | null {
  if (raw.platform !== 'claude-code' || typeof raw.event !== 'string') return null

  const observedAt = typeof raw.ts === 'string' ? raw.ts : new Date().toISOString()
  const sessionId = typeof raw.session_id === 'string' ? raw.session_id : 'unknown-session'
  const toolUseId = typeof raw.tool_use_id === 'string' ? raw.tool_use_id : undefined
  const hookEventId = typeof raw.hook_event_id === 'string' ? raw.hook_event_id : undefined
  const sourcePosition = toolUseId
    ? `${raw.event}:${toolUseId}`
    : hookEventId ?? `${raw.event}:${observedAt}`

  const envelopeBase = {
    schema_version: 1 as const,
    event_id: makeEventId(`cc-hook:${sessionId}`, sourcePosition),
    source_id: `cc-hook:${sessionId}`,
    source_position: sourcePosition,
    observed_at: observedAt,
    ingested_at: observedAt,
    harness: 'claude_code' as const,
    payload_version: 1,
  }

  switch (raw.event) {
    case 'session.start':
      return EventEnvelopeSchema.parse({
        ...envelopeBase,
        event_type: 'session.observed',
        payload: {
          session_id: sessionId,
          harness: 'claude_code',
          workspace: typeof raw.cwd === 'string' ? raw.cwd : undefined,
          model: typeof raw.model === 'string' ? raw.model : undefined,
          source: typeof raw.source === 'string' ? raw.source : undefined,
          started_at: observedAt,
          transcript_pointer: typeof raw.transcript_path === 'string' ? raw.transcript_path : '',
        },
      })
    case 'skill.invoke':
    case 'skill.user_typed': {
      const skill = typeof raw.skill === 'string' ? raw.skill : undefined
      if (!skill) return null
      return EventEnvelopeSchema.parse({
        ...envelopeBase,
        event_type: 'capability.invoked',
        payload: {
          session_id: sessionId,
          turn_index: 0,
          capability_id: skill,
          capability_type: 'skill',
          harness: 'claude_code',
          trigger: raw.event === 'skill.user_typed' ? 'user' : 'model',
          tool_use_id: toolUseId,
          observability_level: 'observed',
          confidence: raw.event === 'skill.user_typed' ? 0.8 : 1,
        },
      })
    }
    case 'skill.loaded':
    case 'skill.load_failed':
      return EventEnvelopeSchema.parse({
        ...envelopeBase,
        event_type: 'outcome.observed',
        payload: {
          tool_use_id: toolUseId ?? sourcePosition,
          session_id: sessionId,
          status: raw.event === 'skill.load_failed' || raw.exit_code !== 0 ? 'failure' : 'success',
          exit_code: typeof raw.exit_code === 'number' ? raw.exit_code : undefined,
          run_time_seconds: typeof raw.run_time_seconds === 'number' ? raw.run_time_seconds : undefined,
          used_downstream: false,
          attribution: { plugin: 'satori' },
          error_class: raw.event === 'skill.load_failed' ? 'skill_load_failed' : undefined,
        },
      })
    default:
      return null
  }
}

const seenIds = new Set<string>() // in-process dedup cache

export function appendEvent(event: EventEnvelope, eventsDir: string = EVENTS_DIR): void {
  EventEnvelopeSchema.parse(event) // throws on invalid schema
  if (seenIds.has(event.event_id)) return
  const date = event.observed_at.slice(0, 10)
  const dir = partitionDir(date, eventsDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(logFile(date, event.harness, eventsDir), `${JSON.stringify(event)}\n`)
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
    : readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().map(f => join(dir, f))
  const seen = new Set<string>() // cross-process dedup on read
  for (const file of files) {
    if (!existsSync(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        const ev = EventEnvelopeSchema.safeParse(parsed).success
          ? EventEnvelopeSchema.parse(parsed)
          : normalizeHookEvent(parsed)
        if (!ev) {
          console.warn('[satori] skipped malformed event line')
          continue
        }
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
