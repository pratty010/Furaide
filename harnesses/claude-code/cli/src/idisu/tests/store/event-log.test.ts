import { test, expect } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendEvent, readEvents, makeEventId } from '../../src/store/event-log.js'
import { makeTypedEvent } from '../../src/types/events.js'

const TEST_DIR = '/tmp/idisu-test-event-log'

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
  const events = [...readEvents(ev.observed_at.slice(0, 10), 'claude_code', dir)]
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
  const events = [...readEvents(ev.observed_at.slice(0, 10), 'claude_code', dir)]
  expect(events).toHaveLength(1)
  rmSync(dir, { recursive: true })
})

test('readEvents normalizes Claude hook lines into event envelopes', () => {
  const dir = join(TEST_DIR, 'hook-line-test')
  const partition = join(dir, '2026-06-17')
  mkdirSync(partition, { recursive: true })
  writeFileSync(join(partition, 'claude_code.jsonl'), `${JSON.stringify({
    ts: '2026-06-17T10:00:00Z',
    platform: 'claude-code',
    event: 'skill.invoke',
    session_id: 'sess-1',
    skill: 'brainstorming',
    tool_use_id: 'toolu_01',
  })}\n`)

  const events = [...readEvents('2026-06-17', 'claude_code', dir)]
  expect(events).toHaveLength(1)
  expect(events[0]?.event_type).toBe('capability.invoked')
  expect((events[0]?.payload as { capability_id: string }).capability_id).toBe('brainstorming')
  rmSync(dir, { recursive: true })
})

test('readEvents keeps hook invocation and outcome events with the same tool_use_id', () => {
  const dir = join(TEST_DIR, 'hook-outcome-test')
  const partition = join(dir, '2026-06-17')
  mkdirSync(partition, { recursive: true })
  writeFileSync(join(partition, 'claude_code.jsonl'), `${JSON.stringify({
    ts: '2026-06-17T10:00:00Z',
    platform: 'claude-code',
    event: 'skill.invoke',
    session_id: 'sess-1',
    skill: 'brainstorming',
    tool_use_id: 'toolu_01',
  })}\n${JSON.stringify({
    ts: '2026-06-17T10:00:01Z',
    platform: 'claude-code',
    event: 'skill.loaded',
    session_id: 'sess-1',
    tool_use_id: 'toolu_01',
    exit_code: 0,
    run_time_seconds: 1.2,
  })}\n`)

  const events = [...readEvents('2026-06-17', 'claude_code', dir)]
  expect(events).toHaveLength(2)
  expect(events[0]?.event_type).toBe('capability.invoked')
  expect(events[1]?.event_type).toBe('outcome.observed')
  rmSync(dir, { recursive: true })
})
