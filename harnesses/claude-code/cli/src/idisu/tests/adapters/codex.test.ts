import { test, expect, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CodexAdapter } from '../../src/adapters/codex.js'

const TMP = '/tmp/satori-codex-test'
const SESS_DIR = join(TMP, '2026', '06', '17')
mkdirSync(SESS_DIR, { recursive: true })

afterAll(() => rmSync(TMP, { recursive: true }))

const sessionLines = [
  JSON.stringify({ type: 'session_meta', payload: { id: 'codex-sess-001', task: 'write tests' }, timestamp: '2026-06-17T10:00:00Z' }),
  JSON.stringify({ type: 'response_item', payload: {
    type: 'function_call', id: 'fc_01',
    name: 'exec_command',
    arguments: JSON.stringify({ command: `cat ${join(TMP, 'skills', 'tdd', 'SKILL.md')}` }),
  }, timestamp: '2026-06-17T10:00:05Z' }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', output: 'done' }, timestamp: '2026-06-17T10:00:10Z' }),
]
const sessionFile = join(SESS_DIR, 'rollout-2026-06-17T10:00:00Z-codex-sess-001.jsonl')
writeFileSync(sessionFile, `${sessionLines.join('\n')}\n`)

mkdirSync(join(TMP, 'skills', 'tdd'), { recursive: true })
writeFileSync(join(TMP, 'skills', 'tdd', 'SKILL.md'), '# TDD\nTest-driven development.\n')

test('CodexAdapter emits capability.invoked (inferred) for function_call to SKILL.md', async () => {
  const adapter = new CodexAdapter(TMP, join(TMP, 'skills'))
  const events = []
  for await (const ev of adapter.scan(new Map())) events.push(ev)

  const cap = events.filter(e => e.event_type === 'capability.invoked')
  expect(cap.length).toBeGreaterThan(0)
  const p = cap[0]?.payload as { observability_level: string; capability_id: string }
  expect(p.observability_level).toBe('inferred')
  expect(p.capability_id).toBe('tdd')
})
