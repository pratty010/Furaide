import { test, expect } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { appendEvent, readEvents, makeEventId } from '../../src/store/event-log.js'
import { makeTypedEvent } from '../../src/types/events.js'

const TEST_DIR = '/tmp/satori-test-event-log'

test('makeEventId is deterministic', () => {
  expect(makeEventId('src', 0)).toBe(makeEventId('src', 0))
  expect(makeEventId('src', 0)).not.toBe(makeEventId('src', 1))
})

test('appendEvent writes parseable JSONL and readEvents returns it', () => {
  const dir = join(TEST_DIR, 'append-test')
  mkdirSync(dir, { recursive: true })
  const ev = makeTypedEvent('session.observed', 'cc:test/s1', 0, 'claude_code', {
    session_id: 's1', harness: 'claude_code', transcript_pointer: '/p',
    started_at: '2026-06-17T10:00:00Z',
  })
  appendEvent(ev, dir)
  const events = [...readEvents('2026-06-17', 'claude_code', dir)]
  expect(events).toHaveLength(1)
  expect(events[0]?.event_id).toBe(ev.event_id)
  rmSync(dir, { recursive: true })
})

test('appendEvent deduplicates by event_id on second write', () => {
  const dir = join(TEST_DIR, 'dedup-test')
  mkdirSync(dir, { recursive: true })
  const ev = makeTypedEvent('session.observed', 'cc:test/s-dedup', 99, 'claude_code', {
    session_id: 's-dedup', harness: 'claude_code', transcript_pointer: '/p',
    started_at: '2026-06-17T10:00:00Z',
  })
  appendEvent(ev, dir)
  appendEvent(ev, dir) // second write must be a no-op
  const events = [...readEvents('2026-06-17', 'claude_code', dir)]
  expect(events).toHaveLength(1)
  rmSync(dir, { recursive: true })
})
