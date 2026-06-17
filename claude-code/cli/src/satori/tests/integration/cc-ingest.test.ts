import { test, expect, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js'
import { appendEvent, readEvents } from '../../src/store/event-log.js'
import { SatoriCache } from '../../src/store/sqlite-cache.js'

const TMP = '/tmp/satori-integration-test'
const EVENTS_DIR = join(TMP, 'events')
const DB_PATH = join(TMP, 'cache.sqlite')
const PROJ_DIR = join(TMP, 'transcripts', 'my-project')

mkdirSync(PROJ_DIR, { recursive: true })

const sessionId = 'sess-integration-001'
const lines = [
  JSON.stringify({
    type: 'user', uuid: 'u1', parentUuid: null, isSidechain: false, isMeta: false,
    ts: '2026-06-17T10:00:00.000Z',
    message: { role: 'user', content: 'brainstorm a feature' },
  }),
  JSON.stringify({
    type: 'assistant', uuid: 'a1', parentUuid: 'u1', isSidechain: false, isMeta: false,
    ts: '2026-06-17T10:00:02.000Z',
    message: {
      role: 'assistant', model: 'claude-sonnet-4-6',
      content: [{ type: 'tool_use', id: 'toolu_99', name: 'Skill', input: { skill: 'brainstorming' } }],
      usage: { input_tokens: 200, output_tokens: 80 },
    },
  }),
]
writeFileSync(join(PROJ_DIR, `${sessionId}.jsonl`), `${lines.join('\n')}\n`)

afterAll(() => rmSync(TMP, { recursive: true }))

test('end-to-end: CC transcript → event log → FTS5 cache → BM25 query', async () => {
  const adapter = new ClaudeCodeAdapter(join(TMP, 'transcripts'))
  const checkpoints = new Map()
  const events: import('../../src/types/events.js').EventEnvelope[] = []
  for await (const ev of adapter.scan(checkpoints)) {
    events.push(ev)
    appendEvent(ev, EVENTS_DIR)
  }

  const capEvents = events.filter(e => e.event_type === 'capability.invoked')
  expect(capEvents.length).toBe(1)
  expect((capEvents[0]?.payload as { capability_id: string }).capability_id).toBe('brainstorming')

  const readBack = [...readEvents('2026-06-17', 'claude_code', EVENTS_DIR)]
  expect(readBack.some(e => e.event_type === 'capability.invoked')).toBe(true)

  const cache = new SatoriCache(DB_PATH)
  cache.upsertCapability({
    capability_id: 'brainstorming',
    name: 'Brainstorming',
    description: 'Explores user intent and requirements before building',
    harness: 'claude_code',
    type: 'skill',
    path: '/skills/brainstorming/SKILL.md',
    content_hash: 'deadbeef',
    trigger_hints: ['feature', 'design', 'create'],
    scanned_at: '2026-06-17T10:00:00Z',
  })
  const results = cache.bm25Search('brainstorm feature', 5)
  expect(results[0]?.capability_id).toBe('brainstorming')
  cache.close()
})
