import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js'

const TMP = '/tmp/satori-cc-test'
mkdirSync(TMP, { recursive: true })

const skillTurn = JSON.stringify({
  type: 'assistant',
  message: {
    id: 'msg_01',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{
      type: 'tool_use',
      id: 'toolu_01',
      name: 'Skill',
      input: { skill: 'brainstorming' },
    }],
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  uuid: 'turn-1',
  parentUuid: null,
  isSidechain: false,
  isMeta: false,
  ts: '2026-06-17T10:00:00.000Z',
})

const sessionId = 'test-session-001'
const slug = 'test-project'

test('ClaudeCodeAdapter emits capability.invoked for Skill tool_use', async () => {
  const projDir = join(TMP, slug)
  mkdirSync(projDir, { recursive: true })
  const transcript = join(projDir, `${sessionId}.jsonl`)
  writeFileSync(transcript, `${skillTurn}\n`)

  const adapter = new ClaudeCodeAdapter(TMP)
  const events: import('../../src/types/events.js').EventEnvelope[] = []
  for await (const ev of adapter.scan(new Map())) {
    events.push(ev)
  }

  const capInvoked = events.filter(e => e.event_type === 'capability.invoked')
  expect(capInvoked.length).toBeGreaterThan(0)
  const payload = capInvoked[0]?.payload as { capability_id: string; observability_level: string }
  expect(payload.capability_id).toBe('brainstorming')
  expect(payload.observability_level).toBe('observed')

  rmSync(TMP, { recursive: true })
})

test('ClaudeCodeAdapter keeps multiple Skill tool_use blocks in one assistant turn', async () => {
  const projDir = join(TMP, `${slug}-multi`)
  mkdirSync(projDir, { recursive: true })
  const transcript = join(projDir, 'multi-session.jsonl')
  writeFileSync(transcript, `${JSON.stringify({
    type: 'assistant',
    message: {
      id: 'msg_02',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'tool_use', id: 'toolu_a', name: 'Skill', input: { skill: 'brainstorming' } },
        { type: 'tool_use', id: 'toolu_b', name: 'Skill', input: { skill: 'tdd' } },
      ],
    },
    ts: '2026-06-17T10:00:00.000Z',
  })}\n`)

  const adapter = new ClaudeCodeAdapter(TMP)
  const events: import('../../src/types/events.js').EventEnvelope[] = []
  for await (const ev of adapter.scan(new Map())) {
    events.push(ev)
  }

  const capabilities = events
    .filter(e => e.event_type === 'capability.invoked')
    .map(e => (e.payload as { capability_id: string }).capability_id)
  expect(capabilities).toContain('brainstorming')
  expect(capabilities).toContain('tdd')
  rmSync(projDir, { recursive: true })
})
