import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js'

const TMP = '/tmp/idisu-cc-test'
rmSync(TMP, { recursive: true, force: true })
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

// ── Deep-read fixture (Task 2.3) ──────────────────────────────────────────────
//
// Record shapes below follow the v0.2 Claude Code spec
// (docs/superpowers/specs/2026-07-05-claude-code-v2-spec.md §1 "Ingest"):
//  - `assistant` record: tool_use chain (all tools, not just Skill) + a
//    top-level `attributionSkill` (native skill-usage attribution) + `message.usage`.
//  - `user` record: a `tool_result` block carrying an error/exit-code signal.
//  - `system` record: `subtype: 'turn_duration'` carrying durationMs/messageCount/sessionKind.
//  - `pr-link` record: a distinct top-level `type` marking a session merged into a PR.

const deepSessionId = 'test-session-deep-001'
const deepSlug = 'deep-project'

const deepAssistantTurn = JSON.stringify({
  type: 'assistant',
  uuid: 'turn-deep-1',
  parentUuid: null,
  isSidechain: false,
  isMeta: false,
  ts: '2026-07-06T10:00:00.000Z',
  attributionSkill: 'tdd',
  message: {
    id: 'msg_deep_01',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [
      { type: 'tool_use', id: 'toolu_deep_read', name: 'Read', input: { file_path: '/a.ts' } },
      { type: 'tool_use', id: 'toolu_deep_bash', name: 'Bash', input: { command: 'bun test' } },
    ],
    usage: { input_tokens: 500, output_tokens: 120 },
  },
})

const deepUserToolResult = JSON.stringify({
  type: 'user',
  uuid: 'turn-deep-2',
  parentUuid: 'turn-deep-1',
  isSidechain: false,
  isMeta: false,
  ts: '2026-07-06T10:00:05.000Z',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_deep_bash',
        is_error: true,
        content: 'exit code: 1\nFAIL tests/foo.test.ts',
      },
    ],
  },
})

const deepTurnDuration = JSON.stringify({
  type: 'system',
  subtype: 'turn_duration',
  ts: '2026-07-06T10:00:06.000Z',
  durationMs: 4321,
  messageCount: 3,
  sessionKind: 'agent',
})

const deepPrLink = JSON.stringify({
  type: 'pr-link',
  ts: '2026-07-06T10:05:00.000Z',
  pr_number: 42,
  pr_url: 'https://github.com/example/repo/pull/42',
  merged: true,
})

test('cc adapter emits tool.called + capability.invoked (attributionSkill) + outcome from pr-link', async () => {
  const projDir = join(TMP, deepSlug)
  mkdirSync(projDir, { recursive: true })
  const transcript = join(projDir, `${deepSessionId}.jsonl`)
  writeFileSync(
    transcript,
    `${[deepAssistantTurn, deepUserToolResult, deepTurnDuration, deepPrLink].join('\n')}\n`,
  )

  const adapter = new ClaudeCodeAdapter(TMP)
  const events: import('../../src/types/events.js').EventEnvelope[] = []
  for await (const ev of adapter.scan(new Map())) {
    events.push(ev)
  }

  const types = events.map(e => e.event_type)
  expect(types).toContain('capability.invoked') // from attributionSkill
  expect(types).toContain('tool.called') // from tool_use blocks
  expect(types).toContain('turn.observed') // from turn_duration system record

  const attributionEvent = events.find(
    e =>
      e.event_type === 'capability.invoked' &&
      (e.payload as { capability_id: string }).capability_id === 'tdd',
  )
  expect(attributionEvent).toBeDefined()

  const toolCalled = events
    .filter(e => e.event_type === 'tool.called')
    .map(e => (e.payload as { tool_name: string }).tool_name)
  expect(toolCalled).toContain('Read')
  expect(toolCalled).toContain('Bash')

  const outcomeEvents = events.filter(e => e.event_type === 'outcome.observed')
  expect(outcomeEvents.find(e => (e.payload as Record<string, unknown>).kind === 'pr-link')?.payload).toMatchObject({
    kind: 'pr-link',
    status: 'success',
  })

  rmSync(projDir, { recursive: true })
})
